#!/usr/bin/env node
/**
 * Generate the extension's offline provider-id snapshot from the core.
 *
 * The core's provider table lives in Rust (`providers.rs` ->
 * `PROVIDERS`) and is exposed through the wasm export
 * `providers_json()`. A hand-maintained copy drifts whenever the core
 * adds a provider, and nothing catches it: the popup's first paint has
 * no wasm yet, so it cannot read the live table.
 *
 * This script runs the core's own export at build time and writes the
 * result to `apps/extension/src/generated/core-providers.ts`. The
 * output is committed, so the offline path never reaches a network or a
 * stale hand-written list.
 *
 * Run it with --check to verify the snapshot is current without
 * writing (used in CI as a drift gate).
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '..');
const WASM_PKG = resolve(REPO, 'libs/ai-core/src/wasm-pkg-node');
const OUT = resolve(REPO, 'apps/extension/src/generated/core-providers.ts');

const checkOnly = process.argv.includes('--check');

/**
 * Run `providers_json()` through the node-target wasm pkg. The node pkg
 * initializes synchronously, so this needs no worker or browser.
 */
async function readCoreTable() {
  const pkg = await import(resolve(WASM_PKG, 'prism_wasm.js'));
  const raw = pkg.providers_json();
  const table = JSON.parse(raw);
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error('core provider table is empty');
  }
  return table;
}

/** Emit a minimal, dependency-free module. */
function render(ids) {
  return `// GENERATED FILE - do not edit by hand.
// Run \`node scripts/generate-core-providers.mjs\` to regenerate.
//
// The ids come from prism-core's own provider table (crates/prism-core/
// src/providers.rs) by running its wasm export providers_json() at
// build time. A hand-maintained copy here would drift away from the
// core; this file is regenerated whenever the core changes.
//
// Order matches the core's declaration order.

/** Canonical provider ids the core knows how to build a request for. */
export const CORE_PROVIDER_IDS: readonly string[] = [
${ids.map((id) => `  '${id}',`).join('\n')}
];
`;
}

async function main() {
  const table = await readCoreTable();
  const ids = table.map((p) => p.id);
  if (ids.length === 0) throw new Error('no provider ids');

  const body = render(ids);

  if (checkOnly) {
    if (!existsSync(OUT)) {
      console.error(`snapshot missing: ${OUT}`);
      process.exit(1);
    }
    const current = readFileSync(OUT, 'utf-8');
    if (current !== body) {
      console.error(
        'core-providers.ts is stale: the core table changed. Run ' +
          '`node scripts/generate-core-providers.mjs` and commit it.',
      );
      process.exit(1);
    }
    console.log(`snapshot current (${ids.length} providers)`);
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);
  console.log(`wrote ${ids.length} provider ids -> ${OUT}`);
}

main().catch((error) => {
  console.error(`generate-core-providers failed: ${error}`);
  process.exit(1);
});
