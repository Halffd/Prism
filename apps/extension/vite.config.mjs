import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync } from 'fs';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

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
    nxViteTsPaths(),
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
        cpSync(
          resolve(__dirname, '../../libs/ai-core/src/wasm-pkg-web'),
          resolve(__dirname, '../../dist/apps/extension/assets/wasm-pkg-web'),
          { recursive: true },
        );
        cpSync(
          resolve(__dirname, '../../libs/ai-core/src/wasm-pkg-web'),
          resolve(__dirname, '../../dist/apps/extension/wasm-pkg-web'),
          { recursive: true },
        );
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
            alias: [
              // The content script dynamically imports the React popups,
              // which pull in several workspace packages. Each one ships
              // only type declarations, so they must all be aliased to
              // their source entries.
              //
              // The aliases are exact matches: a string alias also
              // rewrites deeper specifiers, so `@prism/firebase-auth/src/utils`
              // would become `.../index.ts/src/utils` and fail to load.
              ...[
                'ui-components',
                'shared-types',
                'redux-store',
                'api-client',
                'shared-db',
                'image-gen',
                'supabase-client',
                'logging',
                'ai-core',
                'agent',
                'context-manager',
                'llm',
                'rag',
                'deepsearch',
                'web-search',
                'firebase-auth',
                'ocr',
                'stt',
                'tts',
                'inpaint',
                'model-gen',
                'audio-gen',
                'video-gen',
                'ai-factory',
                'ai-builder',
                'council',
              ].map((name) => ({
                find: new RegExp(`^@prism/${name}$`),
                replacement: resolve(
                  __dirname,
                  `../../libs/${name}/src/index.ts`,
                ),
              })),
            ],
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
    alias: {
      '@prism/api-client': resolve(__dirname, '../../libs/api-client/src'),
      '@prism/shared-types': resolve(__dirname, '../../libs/shared-types/src'),
      '@prism/image-gen': resolve(__dirname, '../../libs/image-gen/src'),
    },
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