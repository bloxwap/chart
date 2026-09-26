/**
 * Zero-dependency playground server for @bloxwap/chart.
 *
 *   npm run demo          (or: bun apps/playground/serve.ts)
 *
 * Keep browser URLs stable while serving the app and library workspaces.
 */
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = new URL('../../', import.meta.url);
const mounts = ([
  ['/demo/', 'apps/playground/'],
  ['/dist/', 'packages/chart/dist/'],
  ['/assets/', 'packages/chart/assets/'],
  ['/bench/', 'packages/chart/bench/'],
] as const).map(([prefix, directory]) => ({ prefix, root: fileURLToPath(new URL(directory, repository)) }));
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
    let path: string;
    try { path = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad Request', { status: 400 }); }
    if (path === '/') return Response.redirect('/demo/', 302);
    const mount = mounts.find(({ prefix }) => path.startsWith(prefix));
    if (!mount) return new Response('Not Found', { status: 404 });
    if (path.endsWith('/')) path += 'index.html';

    const filePath = resolve(mount.root, path.slice(mount.prefix.length));
    if (!filePath.startsWith(resolve(mount.root) + sep)) return new Response('Forbidden', { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response('Not Found', { status: 404 });

    return new Response(file, {
      headers: { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' },
    });
  },
});

console.log(`chart-ts demo → http://localhost:${server.port}/demo/`);
