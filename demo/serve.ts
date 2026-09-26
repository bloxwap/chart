/**
 * Zero-dependency demo server for chart-ts.
 *
 *   bun run demo          (or: bun demo/serve.ts)
 *
 * Serves the repo root so the playground at /demo/ can import /dist/*.
 */

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8641);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') return Response.redirect('/demo/', 302);
    if (path.endsWith('/')) path += 'index.html';

    // Resolve against root and refuse traversal outside it.
    const filePath = new URL(`.${path}`, `file://${root}`).pathname;
    if (!filePath.startsWith(root)) return new Response('Forbidden', { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response('Not Found', { status: 404 });

    const ext = filePath.slice(filePath.lastIndexOf('.'));
    return new Response(file, {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
    });
  },
});

console.log(`chart-ts demo → http://localhost:${server.port}/demo/`);
