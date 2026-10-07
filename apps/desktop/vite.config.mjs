import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/desktop',

  server: {
    port: 4200,
    host: 'localhost',
  },

  plugins: [react(), nxViteTsPaths()],

  resolve: {
    alias: {
      '@prism/api-client': resolve(__dirname, '../../libs/api-client/src'),
      '@prism/shared-types': resolve(__dirname, '../../libs/shared-types/src'),
      '@prism/image-gen': resolve(__dirname, '../../libs/image-gen/src'),
      '@prism/extension': resolve(__dirname, '../extension/src'),
    },
  },

  build: {
    outDir: '../../dist/apps/desktop',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
