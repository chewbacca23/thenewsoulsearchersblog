// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { handleRemarksRequest } from './cloudflare/kind-remarks.js';

/** In-memory /api/remarks for `npm run dev`. Production uses the Worker KV. */
function remarksDevApi() {
  /** @type {Record<string, string>} */
  const store = {};
  const kv = {
    async get(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async put(key, value) {
      store[key] = String(value);
    },
  };
  return {
    name: 'remarks-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/remarks')) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const host = req.headers.host || '127.0.0.1:4321';
          const request = new Request(`http://${host}${url}`, {
            method: req.method,
            headers: { 'content-type': String(req.headers['content-type'] || '') },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const response = await handleRemarksRequest(request, { STATS: kv });
          if (!response) return next();
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://thenewsoulsearchers.de',
  trailingSlash: 'never',
  compressHTML: true,
  redirects: {
    '/patches': '/shop',
    '/hooks': '/marketplace',
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/looks') &&
        !page.includes('/bar-italia') &&
        !page.includes('/members') &&
        !page.includes('/admin') &&
        !page.includes('/auth') &&
        !page.includes('/callback'),
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        const path = new URL(item.url).pathname;
        if (path === '/' || path === '') {
          return { ...item, priority: 1, changefreq: 'daily' };
        }
        if (path.startsWith('/cities')) {
          return { ...item, priority: 0.9, changefreq: 'weekly' };
        }
        if (path.startsWith('/stories') || path === '/week' || path === '/calendar') {
          return { ...item, priority: 0.85, changefreq: 'weekly' };
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [remarksDevApi()],
    build: {
      cssMinify: true,
    },
    server: {
      // Local Call upon board (scripts/local-hooks-api.mjs on :8788).
      proxy: {
        '/api/hooks': {
          target: 'http://127.0.0.1:8788',
          changeOrigin: true,
        },
      },
    },
  },
});
