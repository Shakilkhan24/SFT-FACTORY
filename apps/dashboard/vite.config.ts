/**
 * `dashboard/vite` — the dev server and the production build.
 *
 * ## Why the proxy is here, and not CORS
 *
 * pack `04` §3: "**CORS closed by default**." D9 says the dashboard is
 * private. So the browser must see **one origin**:
 *
 * * in **development**, this server proxies `/v1` to the API — so the
 *   page and the API are the same origin as far as the browser is
 *   concerned, and no `Access-Control-Allow-Origin` header is needed
 *   anywhere;
 * * in **production**, the API serves the built `dist/` (pack `02` §3
 *   names `apps/api` as serving the "static dashboard"), so the same
 *   origin holds.
 *
 * So `@fastify/cors` is **not** added, and it must not be: a CORS
 * header on a private API is an invitation, and the pack closes it by
 * default.
 *
 * ## The proxy target
 *
 * The target is read from the environment so the dev server can point
 * at a different API without a rebuild. The default is the API's
 * development port.
 */

/**
 * Vite's configuration type.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The API's address, in development.
 */
const API_TARGET = process.env['FACTORY_API_URL'] ?? 'http://127.0.0.1:3001';

/**
 * The dev server's port.
 */
const PORT = Number(process.env['FACTORY_DASHBOARD_PORT'] ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      // The API's base path. Everything under `/v1` is proxied, and
      // the path is **not** rewritten — the API serves `/v1/...`.
      '/v1': {
        target: API_TARGET,
        changeOrigin: false,
      },
    },
  },
  build: {
    // The API serves the built dashboard, so the output must be
    // relative — a file:// URL or a path under `/` both have to work.
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
