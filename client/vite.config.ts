import { defineConfig } from 'vite';
import { resolve } from 'path';

// Vite stamps `crossorigin` on the emitted module script + stylesheet, which
// assumes assets may be served from a separate (CORS) origin. We self-host the
// assets same-origin and serve them from a service worker cache for offline
// play; a `crossorigin` (CORS-mode) request is not satisfied by the SW's
// same-origin cached responses, so those assets fail offline. Strip the
// attribute so the offline service worker can serve them.
const stripCrossorigin = {
  name: 'strip-crossorigin',
  transformIndexHtml(html: string): string {
    return html.replace(/\s+crossorigin(?=[\s>])/g, '');
  },
};

export default defineConfig({
  base: '/',
  plugins: [stripCrossorigin],
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@slingshot/shared': resolve(__dirname, '../shared/src/index.ts'),
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
