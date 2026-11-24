import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync, rmSync, readFileSync } from 'fs';

// Workspace aliases come straight from tsconfig.base.json — one source of
// truth, no nx plugin. The nx tsconfig-paths plugin walked every linked git
// worktree, so a stale apps/tui tsconfig in another worktree broke the
// alias map for every build.
function tsconfigAliases() {
  const tsconfig = JSON.parse(
    readFileSync(resolve(__dirname, '../../tsconfig.base.json'), 'utf-8'),
  );
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const aliases = [];
  for (const [find, targets] of Object.entries(paths)) {
    // Skip wildcard entries: the extension imports only exact specifiers,
    // and an approximate alias rewrites deeper paths incorrectly.
    if (find.includes('*') || !targets?.[0]) continue;
    aliases.push({
      // Exact match: a string `find` also rewrites deeper specifiers, so
      // `@prism/agent/src/lib/x` would become `libs/agent/src/index.ts/src/lib/x`.
      find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      replacement: resolve(__dirname, '../../', targets[0]),
    });
  }
  return aliases;
}

// Export the configuration using default export
export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/extension',

  server: {
    port: 4200,
    host: 'localhost',
  },

  preview: {
    port: 4300,
    host: 'localhost',
  },

  plugins: [
    react(),
    {
      name: 'tsconfig-paths',
      // No-op: the aliases are applied via resolve.alias below. This
      // entry exists to keep the plugin list self-describing after the
      // nx tsconfig-paths plugin was removed.
    },
    {
      // The wasm core's browser pkg must sit next to the chunk that
      // dynamic-imports it (assets/). See libs/llm-service loader.
      name: 'copy-wasm-pkg',
      closeBundle() {
        // assets/: for hashed page chunks (popup/chat/settings).
        // root: for background.js — the service worker resolves
        // './wasm-pkg-web/' relative to itself. SW usage is
        // request/response only (sendMessage relay); no stream state
        // ever lives in the service worker.
        //
        // Copy into a staging dir first so the source's `.gitignore`
        // (which exists to keep the generated pkg out of git) is never
        // shipped — a browser package must not carry build-system
        // meta-files, and one stray `*` rule confused the Android
        // package's own file scan.
        const staging = resolve(__dirname, '../../dist/.wasm-pkg-stage');
        rmSync(staging, { recursive: true, force: true });
        cpSync(
          resolve(__dirname, '../../libs/ai-core/src/wasm-pkg-web'),
          staging,
          { recursive: true },
        );
        rmSync(resolve(staging, '.gitignore'), { force: true });
        cpSync(staging, resolve(__dirname, '../../dist/apps/extension/assets/wasm-pkg-web'), {
          recursive: true,
        });
        cpSync(staging, resolve(__dirname, '../../dist/apps/extension/wasm-pkg-web'), {
          recursive: true,
        });
        rmSync(staging, { recursive: true, force: true });
      },
    },
    {
      // The content script must be a single self-contained file with no
      // import statements: Firefox loads manifest-declared content scripts
      // as classic scripts (its content_scripts schema has no `type`
      // property), so an ES module fails with "import declarations may
      // only appear at top level of a module". Chrome accepts a module
      // content script but a classic one works in both.
      //
      // A separate Rollup pass produces the content script on its own,
      // inlined into one IIFE with no shared chunks. It runs in
      // writeBundle because Vite empties the output directory before
      // writing, which would otherwise delete the file it produced.
      name: 'bundle-content-script-standalone',
      async writeBundle() {
        // Vite's build API is used rather than raw Rollup because it
        // applies the TypeScript and React transforms the content script
        // needs. The build runs in a separate Vite environment so it does
        // not recurse into this config's plugins.
        const { build } = await import('vite');
        await build({
          root: __dirname,
          configFile: false,
          logLevel: 'error',
          resolve: {
            // The content script dynamically imports the React popups,
            // which pull in several workspace packages. Each one ships
            // only type declarations, so they must all be aliased to
            // their source entries.
            alias: tsconfigAliases(),
          },
          plugins: [react()],
          // The content script runs as a classic script in the page, where
          // there is no `process` global. Vite rewrites `process.env` to
          // an object literal, so the configuration reads in the shared
          // libraries (which fall back to their defaults) resolve
          // without touching Node globals. `process.env.NODE_ENV` has to
          // be spelled out separately or React's development build reads
          // it at runtime and throws.
          define: {
            'process.env': '{}',
            'process.env.NODE_ENV': JSON.stringify('production'),
          },
          build: {
            outDir: '../../dist/apps/extension',
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, 'src/content/content.ts'),
              formats: ['iife'],
              name: 'PrismContent',
              fileName: () => 'content.js',
            },
            rollupOptions: {
              output: { inlineDynamicImports: true },
            },
          },
        });
      },
    },
  ],

  resolve: {
    alias: tsconfigAliases(),
  },

  build: {
    outDir: '../../dist/apps/extension',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        settings: resolve(__dirname, 'settings.html'),
        chat: resolve(__dirname, 'chat.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
        // The content script is built separately below: it must be a
        // single self-contained file with no import statements.
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Use fixed names for extension files that are referenced in manifest.json
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          // For other entries, use the hashed names
          return `[name]-[hash].js`;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});