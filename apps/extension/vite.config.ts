import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

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

  plugins: [react(), nxViteTsPaths()],

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
          return '[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});