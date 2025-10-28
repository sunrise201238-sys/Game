import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared/src'),
      '@slingshot/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@i18n': resolve(__dirname, '../i18n'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
