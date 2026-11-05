/**
 * Sandboxed expression evaluator for the `code_eval` agent tool.
 *
 * The original implementation used `new Function(...)`, which is both
 * unsandboxed (the evaluated code could reach the whole extension origin's
 * globals) and unusable inside the extension, because the extension CSP is
 * `script-src 'self' 'wasm-unsafe-eval'` — no `unsafe-eval` — so the
 * `Function` constructor throws an EvalError there.
 *
 * This module replaces it with a recursive-descent parser and interpreter for
 * a deliberately small expression language. Nothing is ever compiled to
 * JavaScript: the input is tokenised, parsed into an AST and walked by the
 * evaluator. Only literals, arrays, objects, property access, arrow
 * functions, arithmetic, comparisons, boolean logic and a whitelist of pure
 * helpers are reachable.
 *
 * The module has no dependency on browser APIs, so it runs unchanged in the
 * extension, in a service worker and in plain node.
 */

/** Longest input the evaluator will consider. */
const MAX_INPUT_LENGTH = 2000;
/** Maximum number of AST nodes a single expression may produce. */
const MAX_NODE_COUNT = 500;
/** Maximum nesting depth of the AST. */
const MAX_DEPTH = 64;
/** Maximum number of elements an array, object or argument list may hold. */
const MAX_LITERAL_SIZE = 200;
/** Maximum number of parameters an arrow function may declare. */
const MAX_PARAM_COUNT = 8;

export interface SandboxResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface SandboxOptions {
  /** Reserved for API parity; evaluation is bounded structurally. */
  timeoutMs?: number;
}

type TokenType = 'number' | 'string' | 'identifier' | 'punctuation' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'global'; name: string }
  | { kind: 'namespace'; name: string }
  | { kind: 'identifier'; name: string }
  | {
      kind: 'unary';
      operator: '-' | '+' | '!' | 'typeof';
      operand: Node;
    }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'conditional'; test: Node; consequent: Node; alternate: Node }
  | { kind: 'call'; callee: Node; args: Node[] }
  | { kind: 'member'; object: Node; name: string; args?: Node[] }
  | { kind: 'index'; object: Node; property: Node; args?: Node[] }
  | { kind: 'array'; elements: Node[] }
  | { kind: 'object'; properties: { key: string; value: Node }[] }
  | { kind: 'arrow'; params: string[]; body: Node };

/** Lexical scope for arrow function parameters. */
interface Scope {
  values: Map<string, unknown>;
  parent: Scope | null;
}

class SandboxError extends Error {}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Builds an object with no prototype, so it exposes only the properties that
 * were explicitly assigned to it. Namespaces use this to guarantee that no
 * inherited member (`toString`, `constructor`, …) is reachable.
 */
function nullPrototypeRecord<T extends object>(source: T): T {
  return Object.assign(Object.create(null) as T, source);
}

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  hypot: Math.hypot,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
  trunc: Math.trunc,
};

const MATH_CONSTANTS: Record<string, number> = {
  E: Math.E,
  PI: Math.PI,
};

/**
 * Pure string helpers. Every entry is a total function over strings and
 * returns a primitive, so none of them can be used to reach an object graph.
 */
const STRING_FUNCTIONS: Record<
  string,
  (value: string, ...rest: unknown[]) => unknown
> = {
  charAt: (value, index) => value.charAt(Number(index) || 0),
  charCodeAt: (value, index) => value.charCodeAt(Number(index) || 0),
  concat: (value, ...rest) => value.concat(...rest.map(String)),
  endsWith: (value, suffix) => value.endsWith(String(suffix)),
  includes: (value, needle) => value.includes(String(needle)),
  indexOf: (value, needle) => value.indexOf(String(needle)),
  lastIndexOf: (value, needle) => value.lastIndexOf(String(needle)),
  padEnd: (value, length, pad) =>
    value.padEnd(Number(length) || 0, String(pad ?? ' ')),
  padStart: (value, length, pad) =>
    value.padStart(Number(length) || 0, String(pad ?? ' ')),
  repeat: (value, count) => value.repeat(Math.min(Number(count) || 0, 10_000)),
  replace: (value, needle, replacement) =>
    value.replace(String(needle), String(replacement)),
  replaceAll: (value, needle, replacement) =>
    value.replaceAll(String(needle), String(replacement)),
  slice: (value, start, end) =>
    end === undefined
      ? value.slice(Number(start) || 0)
      : value.slice(Number(start) || 0, Number(end) || 0),
  split: (value, separator) => value.split(String(separator)),
  startsWith: (value, prefix) => value.startsWith(String(prefix)),
  substring: (value, start, end) =>
    end === undefined
      ? value.substring(Number(start) || 0)
      : value.substring(Number(start) || 0, Number(end) || 0),
  toLowerCase: (value) => value.toLowerCase(),
  toUpperCase: (value) => value.toUpperCase(),
  trim: (value) => value.trim(),
};

/** Pure array helpers. They only read and rebuild the array they receive. */
const ARRAY_FUNCTIONS: Record<
  string,
  (array: unknown[], ...rest: unknown[]) => unknown
> = {
  concat: (array, ...others) => ([] as unknown[]).concat(array, ...others),
  every: (array, predicate) =>
    array.every((item, index) =>
      Boolean((predicate as (a: unknown, i: number) => unknown)(item, index)),
    ),
  filter: (array, predicate) =>
    array.filter((item, index) =>
      Boolean((predicate as (a: unknown, i: number) => unknown)(item, index)),
    ),
  find: (array, predicate) =>
    array.find((item, index) =>
      Boolean((predicate as (a: unknown, i: number) => unknown)(item, index)),
    ),
  flat: (array: unknown[]) => array.flat(),
  flatMap: (array, transform) =>
    array.flatMap((item, index) =>
      (transform as (a: unknown, i: number) => unknown)(item, index),
    ),
  includes: (array, needle) => array.includes(needle),
  indexOf: (array, needle) => array.indexOf(needle),
  join: (array, separator) =>
    array.join(typeof separator === 'string' ? separator : ','),
  map: (array, transform) =>
    array.map((item, index) =>
      (transform as (a: unknown, i: number) => unknown)(item, index),
    ),
  reduce: (array, reducer, initial) =>
    initial === undefined
      ? array.reduce(
          reducer as (
            accumulator: unknown,
            item: unknown,
            index: number,
          ) => unknown,
        )
      : array.reduce(
          reducer as (
            accumulator: unknown,
            item: unknown,
            index: number,
          ) => unknown,
          initial,
        ),
  reverse: (array) => array.slice().reverse(),
  slice: (array: unknown[], start?: unknown, end?: unknown) =>
    end === undefined
      ? array.slice(start as number)
      : array.slice(start as number, end as number),
  some: (array, predicate) =>
    array.some((item, index) =>
      Boolean((predicate as (a: unknown, i: number) => unknown)(item, index)),
    ),
  sort: (array, comparator) =>
    comparator === undefined
      ? array.slice().sort()
      : array.slice().sort(comparator as (a: unknown, b: unknown) => number),
  toString: (array: unknown[]) => array.toString(),
};

/**
 * Namespaces whose members are exposed to the expression language. Every
 * namespace is a prototype-less object, so only the whitelisted members are
 * reachable.
 */
const NAMESPACES: Record<string, Record<string, unknown>> = nullPrototypeRecord(
  {
    Math: nullPrototypeRecord({ ...MATH_FUNCTIONS, ...MATH_CONSTANTS }),
    JSON: nullPrototypeRecord({
      stringify: (value: unknown) => JSON.stringify(value) ?? 'undefined',
      parse: (text: string) => JSON.parse(text) as unknown,
    }),
    Object: nullPrototypeRecord({
      keys: (value: object) => Object.keys(value),
      values: (value: object) => Object.values(value),
      entries: (value: object) => Object.entries(value),
      fromEntries: (pairs: [string, unknown][]) => Object.fromEntries(pairs),
    }),
    Array: nullPrototypeRecord({
      isArray: (value: unknown) => Array.isArray(value),
      from: (value: unknown[]) => Array.from(value),
      of: (...items: unknown[]) => items,
    }),
    Number: nullPrototypeRecord({
      isInteger: (value: unknown) => Number.isInteger(value),
      isFinite: (value: unknown) => Number.isFinite(value),
      isNaN: (value: unknown) => Number.isNaN(value),
      parseFloat: (value: string) => Number.parseFloat(value),
      parseInt: (value: string, radix?: unknown) =>
        Number.parseInt(value, typeof radix === 'number' ? radix : 10),
    }),
    String: nullPrototypeRecord({
      fromCharCode: (...codes: unknown[]) =>
        String.fromCharCode(...codes.map((code) => Number(code) || 0)),
    }),
  },
);

/** Global callables that are not namespaces. */
const GLOBALS: Record<string, unknown> = nullPrototypeRecord({
  String: (value: unknown) => String(value),
  Boolean: (value: unknown) => Boolean(value),
  Number: (value: unknown) => Number(value),
  parseInt: (value: string, radix?: unknown) =>
    Number.parseInt(value, typeof radix === 'number' ? radix : 10),
  parseFloat: (value: string) => Number.parseFloat(value),
  isNaN: (value: unknown) => Number.isNaN(value),
  isFinite: (value: unknown) => Number.isFinite(value),
  NaN,
  Infinity,
});

/**
 * Property names that expose the prototype chain or the `Function` call
 * primitives. They are rejected even when they appear on a plain object.
 *
 * The list is built by assignment because `__proto__` and `constructor` are
 * interpreted specially in an object literal.
 */
const FORBIDDEN_PROPERTIES: Record<string, true> = nullPrototypeRecord<
  Record<string, true>
>({});
for (const name of [
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'constructor',
  'prototype',
  'call',
  'apply',
  'bind',
]) {
  FORBIDDEN_PROPERTIES[name] = true;
}

const PUNCTUATION = [
  '===',
  '!==',
  '**',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '=>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  '<',
  '>',
  '!',
  '?',
];

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function isIdentifierStart(character: string): boolean {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    character === '_' ||
    character === '$'
  );
}

function isIdentifierPart(character: string): boolean {
  return isIdentifierStart(character) || isDigit(character);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (
      isDigit(character) ||
      (character === '.' && isDigit(source[index + 1] ?? ''))
    ) {
      const start = index;
      if (character === '0') {
        const marker = source[index + 1];
        if (
          marker === 'x' ||
          marker === 'X' ||
          marker === 'b' ||
          marker === 'B' ||
          marker === 'o' ||
          marker === 'O'
        ) {
          index += 2;
          while (index < source.length && /[0-9a-fA-F_]/.test(source[index])) {
            index += 1;
          }
          tokens.push({
            type: 'number',
            value: source.slice(start, index),
            position: start,
          });
          continue;
        }
      }

      while (index < source.length && /[0-9_]/.test(source[index])) {
        index += 1;
      }
      if (source[index] === '.') {
        index += 1;
        while (index < source.length && /[0-9_]/.test(source[index])) {
          index += 1;
        }
      }
      if (source[index] === 'e' || source[index] === 'E') {
        const exponentStart = index;
        index += 1;
        if (source[index] === '+' || source[index] === '-') {
          index += 1;
        }
        if (isDigit(source[index] ?? '')) {
          while (index < source.length && isDigit(source[index])) {
            index += 1;
          }
        } else {
          index = exponentStart;
        }
      }
      tokens.push({
        type: 'number',
        value: source.slice(start, index),
        position: start,
      });
      continue;
    }

    if (character === '"' || character === "'") {
      const start = index;
      const quote = character;
      index += 1;
      let value = '';

      while (index < source.length && source[index] !== quote) {
        const current = source[index];
        if (current === '\\') {
          const next = source[index + 1];
          if (next === undefined) {
            throw new SandboxError('Unterminated string literal');
          }
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === 'r') value += '\r';
          else if (next === 'b') value += '\b';
          else if (next === 'f') value += '\f';
          else if (next === 'v') value += '\v';
          else if (next === '0') value += '\0';
          else if (next === 'u') {
            const hex = source.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new SandboxError('Invalid unicode escape');
            }
            value += String.fromCharCode(parseInt(hex, 16));
            index += 4;
          } else {
            value += next;
          }
          index += 2;
          continue;
        }
        value += current;
        index += 1;
      }

      if (index >= source.length) {
        throw new SandboxError('Unterminated string literal');
      }
      index += 1;
      tokens.push({ type: 'string', value, position: start });
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = index;
      while (index < source.length && isIdentifierPart(source[index])) {
        index += 1;
      }
      tokens.push({
        type: 'identifier',
        value: source.slice(start, index),
        position: start,
      });
      continue;
    }

    const punctuation = PUNCTUATION.find((candidate) =>
      source.startsWith(candidate, index),
    );
    if (punctuation) {
      tokens.push({
        type: 'punctuation',
        value: punctuation,
        position: index,
      });
      index += punctuation.length;
      continue;
    }

    throw new SandboxError(`Unexpected character "${character}"`);
  }

  tokens.push({ type: 'eof', value: '', position: source.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private index = 0;
  private nodeCount = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseConditional();
    this.expect('eof');
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private match(value: string): boolean {
    const token = this.peek();
    if (token.type === 'punctuation' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    const token = this.peek();
    if (token.type === 'eof' && value === 'eof') {
      this.index += 1;
      return token;
    }
    if (token.type === 'punctuation' && token.value === value) {
      this.index += 1;
      return token;
    }
    throw new SandboxError(`Expected "${value}" but found "${token.value}"`);
  }

  private track(node: Node, depth: number): Node {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_NODE_COUNT) {
      throw new SandboxError('Expression is too complex');
    }
    if (depth > MAX_DEPTH) {
      throw new SandboxError('Expression is nested too deeply');
    }
    return node;
  }

  /**
   * Attempts to parse an arrow function. Returns `null` and restores the
   * parser state when the tokens do not form one, so the caller can fall back
   * to ordinary expression parsing.
   */
  private tryParseArrow(depth: number): Node | null {
    const savedIndex = this.index;
    const savedNodeCount = this.nodeCount;

    try {
      const params: string[] = [];

      if (this.match('(')) {
        if (!this.match(')')) {
          for (;;) {
            const token = this.next();
            if (token.type !== 'identifier') {
              throw new SandboxError('Expected a parameter name');
            }
            params.push(token.value);
            if (params.length > MAX_PARAM_COUNT) {
              throw new SandboxError('Too many parameters');
            }
            if (this.match(',')) {
              continue;
            }
            this.expect(')');
            break;
          }
        }
      } else {
        const token = this.peek();
        if (token.type !== 'identifier') {
          return null;
        }
        this.next();
        params.push(token.value);
      }

      if (!this.match('=>')) {
        this.index = savedIndex;
        this.nodeCount = savedNodeCount;
        return null;
      }

      const body = this.parseConditional(depth + 1);
      return this.track({ kind: 'arrow', params, body }, depth);
    } catch {
      this.index = savedIndex;
      this.nodeCount = savedNodeCount;
      return null;
    }
  }

  private parseConditional(depth = 0): Node {
    const test = this.parseBinary(0, depth + 1);
    if (!this.match('?')) {
      return test;
    }
    const consequent = this.parseConditional(depth + 1);
    this.expect(':');
    const alternate = this.parseConditional(depth + 1);
    return this.track(
      { kind: 'conditional', test, consequent, alternate },
      depth,
    );
  }

  /**
   * Precedence climbing over the binary operators.
   */
  private parseBinary(minPrecedence: number, depth: number): Node {
    let left = this.parseUnary(depth + 1);

    for (;;) {
      const token = this.peek();
      if (token.type !== 'punctuation') {
        break;
      }

      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) {
        break;
      }

      this.next();
      const right = this.parseBinary(precedence + 1, depth + 1);
      left = this.track(
        { kind: 'binary', operator: token.value, left, right },
        depth,
      );
    }

    return left;
  }

  private parseUnary(depth: number): Node {
    const token = this.peek();
    if (
      token.type === 'punctuation' &&
      (token.value === '-' || token.value === '+' || token.value === '!')
    ) {
      this.next();
      const operand = this.parseUnary(depth + 1);
      return this.track(
        { kind: 'unary', operator: token.value, operand },
        depth,
      );
    }
    if (token.type === 'identifier' && token.value === 'typeof') {
      this.next();
      const operand = this.parseUnary(depth + 1);
      return this.track({ kind: 'unary', operator: 'typeof', operand }, depth);
    }
    return this.parsePostfix(depth + 1);
  }

  /**
   * Member access and calls bind tighter than unary operators, so they are
   * parsed after the unary prefix.
   */
  private parsePostfix(depth: number): Node {
    let node = this.parsePrimary(depth + 1);

    for (;;) {
      if (this.match('.')) {
        const member = this.next();
        if (member.type !== 'identifier') {
          throw new SandboxError('Expected a property name');
        }
        node = this.track(
          { kind: 'member', object: node, name: member.value },
          depth,
        );
        continue;
      }

      if (this.match('[')) {
        const property = this.parseConditional(depth + 1);
        this.expect(']');
        node = this.track({ kind: 'index', object: node, property }, depth);
        continue;
      }

      const token = this.peek();
      if (token.type === 'punctuation' && token.value === '(') {
        this.next();
        const args = this.parseArguments(depth + 1);
        if (node.kind === 'member') {
          node = this.track({ ...node, args }, depth);
          continue;
        }
        if (node.kind === 'index') {
          node = this.track({ ...node, args }, depth);
          continue;
        }
        node = this.track({ kind: 'call', callee: node, args }, depth);
        continue;
      }

      break;
    }

    return node;
  }

  private parsePrimary(depth: number): Node {
    const arrow = this.tryParseArrow(depth);
    if (arrow) {
      return arrow;
    }

    const token = this.next();

    if (token.type === 'number') {
      const value = Number(token.value.replace(/_/g, ''));
      if (!Number.isFinite(value)) {
        throw new SandboxError('Invalid numeric literal');
      }
      return this.track({ kind: 'number', value }, depth);
    }

    if (token.type === 'string') {
      return this.track({ kind: 'string', value: token.value }, depth);
    }

    if (token.type === 'identifier') {
      if (token.value === 'true') {
        return this.track({ kind: 'boolean', value: true }, depth);
      }
      if (token.value === 'false') {
        return this.track({ kind: 'boolean', value: false }, depth);
      }
      if (token.value === 'null') {
        return this.track({ kind: 'null' }, depth);
      }
      if (token.value === 'undefined') {
        return this.track({ kind: 'undefined' }, depth);
      }

      if (hasOwn(NAMESPACES, token.value)) {
        return this.track({ kind: 'namespace', name: token.value }, depth);
      }
      if (hasOwn(GLOBALS, token.value)) {
        return this.track({ kind: 'global', name: token.value }, depth);
      }

      // A bare name is resolved at evaluation time. It is only reachable as an
      // arrow-function parameter; anything else fails during evaluation.
      return this.track({ kind: 'identifier', name: token.value }, depth);
    }

    if (token.type === 'punctuation' && token.value === '(') {
      const expression = this.parseConditional(depth + 1);
      this.expect(')');
      return expression;
    }

    if (token.type === 'punctuation' && token.value === '[') {
      const elements: Node[] = [];
      if (this.match(']')) {
        return this.track({ kind: 'array', elements }, depth);
      }
      for (;;) {
        elements.push(this.parseConditional(depth + 1));
        if (elements.length > MAX_LITERAL_SIZE) {
          throw new SandboxError('Array literal is too large');
        }
        if (this.match(',')) {
          if (this.match(']')) {
            break;
          }
          continue;
        }
        this.expect(']');
        break;
      }
      return this.track({ kind: 'array', elements }, depth);
    }

    if (token.type === 'punctuation' && token.value === '{') {
      const properties: { key: string; value: Node }[] = [];
      if (this.match('}')) {
        return this.track({ kind: 'object', properties }, depth);
      }
      for (;;) {
        const keyToken = this.next();
        let key: string;
        if (keyToken.type === 'string' || keyToken.type === 'identifier') {
          key = keyToken.value;
        } else if (keyToken.type === 'number') {
          key = keyToken.value;
        } else {
          throw new SandboxError('Expected an object key');
        }
        if (FORBIDDEN_PROPERTIES[key] === true) {
          throw new SandboxError(`"${key}" is not allowed in the sandbox`);
        }
        this.expect(':');
        const value = this.parseConditional(depth + 1);
        properties.push({ key, value });
        if (properties.length > MAX_LITERAL_SIZE) {
          throw new SandboxError('Object literal is too large');
        }
        if (this.match(',')) {
          if (this.match('}')) {
            break;
          }
          continue;
        }
        this.expect('}');
        break;
      }
      return this.track({ kind: 'object', properties }, depth);
    }

    throw new SandboxError(`Unexpected token "${token.value}"`);
  }

  private parseArguments(depth: number): Node[] {
    const args: Node[] = [];
    if (this.match(')')) {
      return args;
    }

    for (;;) {
      args.push(this.parseConditional(depth + 1));
      if (args.length > MAX_LITERAL_SIZE) {
        throw new SandboxError('Too many arguments');
      }
      if (this.match(',')) {
        continue;
      }
      this.expect(')');
      break;
    }

    return args;
  }
}

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '**': 7,
};

/**
 * Reads a property from a value, optionally invoking it.
 *
 * Strings and arrays expose only the whitelisted helpers; plain objects
 * expose their own data properties.
 */
function readMember(target: unknown, key: string, args?: unknown[]): unknown {
  if (FORBIDDEN_PROPERTIES[key] === true) {
    throw new SandboxError(`"${key}" is not allowed in the sandbox`);
  }
  if (target === null || target === undefined) {
    throw new SandboxError(
      `Cannot read property "${key}" of ${String(target)}`,
    );
  }

  if (typeof target === 'string') {
    if (args) {
      const fn = STRING_FUNCTIONS[key];
      if (!fn) {
        throw new SandboxError(`"${key}" is not available on a string`);
      }
      return fn(target, ...args);
    }
    if (key === 'length') {
      return target.length;
    }
    const index = Number(key);
    if (Number.isInteger(index)) {
      return target[index];
    }
    throw new SandboxError(`"${key}" is not available on a string`);
  }

  if (Array.isArray(target)) {
    if (args) {
      const fn = ARRAY_FUNCTIONS[key];
      if (!fn) {
        throw new SandboxError(`"${key}" is not available on an array`);
      }
      return fn(target, ...args);
    }
    if (key === 'length') {
      return target.length;
    }
    const index = Number(key);
    if (Number.isInteger(index)) {
      return target[index];
    }
    throw new SandboxError(`"${key}" is not available on an array`);
  }

  if (typeof target === 'object') {
    // The value is a plain data object built by the evaluator. Only own
    // properties are visible, so an inherited member can never be reached.
    const record = target as Record<string, unknown>;
    if (!hasOwn(record, key)) {
      throw new SandboxError(`"${key}" is not available on this object`);
    }
    const value = record[key];
    if (args) {
      if (typeof value !== 'function') {
        throw new SandboxError(`"${key}" is not a function`);
      }
      return (value as (...values: unknown[]) => unknown).apply(target, args);
    }
    return value;
  }

  throw new SandboxError(`Cannot read property "${key}" of ${typeof target}`);
}

function evaluateNode(node: Node, scope: Scope | null = null): unknown {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'global':
      return GLOBALS[node.name];
    case 'namespace':
      return NAMESPACES[node.name];
    case 'identifier': {
      let current = scope;
      while (current) {
        if (current.values.has(node.name)) {
          return current.values.get(node.name);
        }
        current = current.parent;
      }
      throw new SandboxError(`"${node.name}" is not available in the sandbox`);
    }
    case 'unary': {
      if (node.operator === 'typeof') {
        return typeof evaluateNode(node.operand, scope);
      }
      const operand = evaluateNode(node.operand, scope);
      if (node.operator === '-') return -(operand as number);
      if (node.operator === '+') return +(operand as number);
      return !operand;
    }
    case 'conditional':
      return evaluateNode(node.test, scope)
        ? evaluateNode(node.consequent, scope)
        : evaluateNode(node.alternate, scope);
    case 'array':
      return node.elements.map((element) => evaluateNode(element, scope));
    case 'object': {
      const result = nullPrototypeRecord<Record<string, unknown>>({});
      for (const property of node.properties) {
        result[property.key] = evaluateNode(property.value, scope);
      }
      return result;
    }
    case 'arrow': {
      const captured = scope;
      return (...args: unknown[]) => {
        const values = new Map<string, unknown>();
        node.params.forEach((name, index) => {
          values.set(name, args[index]);
        });
        return evaluateNode(node.body, { values, parent: captured });
      };
    }
    case 'member': {
      const target = evaluateNode(node.object, scope);
      const args = node.args?.map((argument) => evaluateNode(argument, scope));
      return readMember(target, node.name, args);
    }
    case 'index': {
      const target = evaluateNode(node.object, scope);
      const rawKey = evaluateNode(node.property, scope);
      if (typeof rawKey !== 'string' && typeof rawKey !== 'number') {
        throw new SandboxError('Property key must be a string or a number');
      }
      const args = node.args?.map((argument) => evaluateNode(argument, scope));
      return readMember(target, String(rawKey), args);
    }
    case 'call': {
      const args = node.args.map((argument) => evaluateNode(argument, scope));
      const callee = node.callee;

      if (callee.kind === 'global') {
        const fn = GLOBALS[callee.name];
        if (typeof fn !== 'function') {
          throw new SandboxError(
            `"${callee.name}" is not available in the sandbox`,
          );
        }
        return (fn as (...values: unknown[]) => unknown)(...args);
      }

      if (callee.kind === 'namespace') {
        const fn = GLOBALS[callee.name] ?? NAMESPACES[callee.name];
        if (typeof fn !== 'function') {
          throw new SandboxError(
            `"${callee.name}" is not available in the sandbox`,
          );
        }
        return (fn as (...values: unknown[]) => unknown)(...args);
      }

      if (callee.kind === 'arrow') {
        const fn = evaluateNode(callee, scope) as (
          ...values: unknown[]
        ) => unknown;
        return fn(...args);
      }

      throw new SandboxError('Only whitelisted functions can be called');
    }
    case 'binary': {
      // Short-circuit before evaluating the right-hand side.
      if (node.operator === '&&') {
        const left = evaluateNode(node.left, scope);
        return left ? evaluateNode(node.right, scope) : left;
      }
      if (node.operator === '||') {
        const left = evaluateNode(node.left, scope);
        return left ? left : evaluateNode(node.right, scope);
      }

      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);

      switch (node.operator) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            return String(left) + String(right);
          }
          return (left as number) + (right as number);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          return (left as number) / (right as number);
        case '%':
          return (left as number) % (right as number);
        case '**':
          return (left as number) ** (right as number);
        case '==':
          // Loose equality, matching JavaScript semantics.
          return (left as unknown) == (right as unknown);
        case '!=':
          // Loose inequality, matching JavaScript semantics.
          return (left as unknown) != (right as unknown);
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return (left as number) < (right as number);
        case '>':
          return (left as number) > (right as number);
        case '<=':
          return (left as number) <= (right as number);
        case '>=':
          return (left as number) >= (right as number);
        default:
          throw new SandboxError(`Unsupported operator "${node.operator}"`);
      }
    }
    default:
      throw new SandboxError('Unsupported expression');
  }
}

/**
 * Evaluates a sandboxed expression.
 *
 * Returns `{ ok: true, value }` on success and `{ ok: false, error }` when the
 * expression is malformed, uses a disallowed construct, or exceeds the
 * structural limits.
 */
export async function evaluateInSandbox(
  code: string,
  options: SandboxOptions = {},
): Promise<SandboxResult> {
  void options;

  if (typeof code !== 'string') {
    return { ok: false, error: 'Expression must be a string' };
  }

  if (code.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: 'Expression is too long' };
  }

  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, error: 'Expression is empty' };
  }

  try {
    const tokens = tokenize(trimmed);
    const ast = new Parser(tokens).parse();
    const value = evaluateNode(ast);

    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { ok: false, error: 'Expression did not produce a finite number' };
    }

    return { ok: true, value };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not evaluate expression';
    return { ok: false, error: message };
  }
}
