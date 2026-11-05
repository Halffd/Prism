import { describe, expect, it } from '@jest/globals';
import { evaluateInSandbox } from '../sandbox';

async function evaluate(expression: string): Promise<unknown> {
  const result = await evaluateInSandbox(expression);
  expect(result.ok).toBe(true);
  return result.value;
}

async function expectBlocked(expression: string): Promise<void> {
  const result = await evaluateInSandbox(expression);
  expect(result.ok).toBe(false);
}

describe('evaluateInSandbox', () => {
  describe('arithmetic and comparison', () => {
    it('evaluates arithmetic with the usual precedence', async () => {
      await expect(evaluate('1 + 2 * 3')).resolves.toBe(7);
      await expect(evaluate('(1 + 2) * 3')).resolves.toBe(9);
      await expect(evaluate('2 ** 10')).resolves.toBe(1024);
      await expect(evaluate('7 % 3')).resolves.toBe(1);
    });

    it('evaluates comparisons with loose and strict equality', async () => {
      await expect(evaluate('1 == "1"')).resolves.toBe(true);
      await expect(evaluate('1 === "1"')).resolves.toBe(false);
      await expect(evaluate('null == undefined')).resolves.toBe(true);
      await expect(evaluate('0 == false')).resolves.toBe(true);
      await expect(evaluate('1 != 2')).resolves.toBe(true);
    });

    it('evaluates boolean logic and conditionals', async () => {
      await expect(evaluate('(1 < 2) && (3 > 2)')).resolves.toBe(true);
      await expect(evaluate('false || "fallback"')).resolves.toBe('fallback');
      await expect(evaluate('1 > 2 ? "yes" : "no"')).resolves.toBe('no');
    });

    it('reports the result of typeof', async () => {
      await expect(evaluate('typeof "x"')).resolves.toBe('string');
      await expect(evaluate('typeof 1')).resolves.toBe('number');
      await expect(evaluate('typeof []')).resolves.toBe('object');
    });
  });

  describe('collections', () => {
    it('evaluates array literals and their members', async () => {
      await expect(evaluate('[1, 2, 3]')).resolves.toEqual([1, 2, 3]);
      await expect(evaluate('[1, 2, 3].length')).resolves.toBe(3);
      await expect(evaluate('[1, 2, 3].join("-")')).resolves.toBe('1-2-3');
      await expect(evaluate('[[1, 2], [3]].flat()')).resolves.toEqual([
        1, 2, 3,
      ]);
    });

    it('evaluates object literals and their members', async () => {
      await expect(evaluate('({ a: 1, b: 2 }).a')).resolves.toBe(1);
      await expect(evaluate('Object.keys({ a: 1, b: 2 })')).resolves.toEqual([
        'a',
        'b',
      ]);
    });

    it('does not expose a missing property', async () => {
      await expectBlocked('({ a: 1 }).missing');
    });

    it('applies array helpers with an arrow function', async () => {
      await expect(evaluate('[1, 2, 3].map(x => x * 2)')).resolves.toEqual([
        2, 4, 6,
      ]);
      await expect(evaluate('[1, 2, 3].filter(x => x > 1)')).resolves.toEqual([
        2, 3,
      ]);
      await expect(
        evaluate('[1, 2, 3].reduce((acc, item) => acc + item, 0)'),
      ).resolves.toBe(6);
    });
  });

  describe('strings and helpers', () => {
    it('evaluates string members', async () => {
      await expect(evaluate('"abc".length')).resolves.toBe(3);
      await expect(evaluate('"abc".toUpperCase()')).resolves.toBe('ABC');
      await expect(evaluate('"a,b".split(",")')).resolves.toEqual(['a', 'b']);
      await expect(evaluate('"  x ".trim()')).resolves.toBe('x');
      await expect(evaluate('"abc".includes("b")')).resolves.toBe(true);
    });

    it('evaluates the whitelisted Math helpers', async () => {
      await expect(evaluate('Math.max(3, 9)')).resolves.toBe(9);
      await expect(evaluate('Math.sqrt(16)')).resolves.toBe(4);
      await expect(evaluate('Math.PI')).resolves.toBe(Math.PI);
    });

    it('evaluates the whitelisted global conversions', async () => {
      await expect(evaluate('String(123)')).resolves.toBe('123');
      await expect(evaluate('Number("42")')).resolves.toBe(42);
      await expect(evaluate('parseInt("42")')).resolves.toBe(42);
      await expect(evaluate('JSON.stringify({ a: 1 })')).resolves.toBe(
        '{"a":1}',
      );
    });
  });

  describe('containment', () => {
    it('blocks access to the extension globals', async () => {
      await expectBlocked('globalThis');
      await expectBlocked('process');
      await expectBlocked('require("fs")');
      await expectBlocked('fetch("https://example.com")');
      await expectBlocked('eval("1 + 1")');
    });

    it('blocks reaching the prototype chain from a value', async () => {
      await expectBlocked('({}).constructor');
      await expectBlocked('({}).__proto__');
      await expectBlocked('([]).constructor');
      await expectBlocked('"".constructor.constructor("return process")()');
      await expectBlocked('({}).constructor.constructor("return 1")()');
    });

    it('blocks statements', async () => {
      await expectBlocked('while (true) {}');
      await expectBlocked('new Function("return 1")');
    });

    it('rejects a forbidden property used as an object key', async () => {
      await expectBlocked('({ constructor: 1 })');
      await expectBlocked('({ __proto__: 1 })');
    });

    it('does not expose inherited object members', async () => {
      await expectBlocked('({}).toString');
      await expectBlocked('({}).hasOwnProperty');
    });
  });

  describe('limits', () => {
    it('rejects an empty expression', async () => {
      await expectBlocked('');
      await expectBlocked('   ');
    });

    it('rejects an expression that is too long', async () => {
      await expectBlocked(`1 + ${'1 + '.repeat(500)}1`);
    });

    it('rejects an expression that is nested too deeply', async () => {
      await expectBlocked(`${'('.repeat(100)}1${')'.repeat(100)}`);
    });

    it('rejects an array literal that is too large', async () => {
      await expectBlocked(
        `[${Array.from({ length: 300 }, (_, i) => i).join(',')}]`,
      );
    });
  });
});
