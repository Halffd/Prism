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
          resolve(__dirname, '../../libs/llm-service/src/wasm-pkg-web'),
          resolve(__dirname, '../../dist/apps/extension/assets/wasm-pkg-web'),
          { recursive: true },
        );
        cpSync(
          resolve(__dirname, '../../libs/llm-service/src/wasm-pkg-web'),
          resolve(__dirname, '../../dist/apps/extension/wasm-pkg-web'),
          { recursive: true },
        );
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
        content: resolve(__dirname, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Use fixed names for extension files that are referenced in manifest.json
          if (chunkInfo.name === 'background') {
            return 'background.js';
          } else if (chunkInfo.name === 'content') {
            return 'content.js';
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