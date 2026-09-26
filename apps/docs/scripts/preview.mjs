import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../out/', import.meta.url)).replace(/\/$/, '');
let basePath;
try { ({ basePath } = JSON.parse(await readFile(join(root, '_docs-config.json'), 'utf8'))); }
catch { throw new Error('Build the docs first with npm run docs:build.'); }
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (basePath && path === '/') { response.writeHead(302, { Location: `${basePath}/` }); response.end(); return; }
    if (basePath && path !== basePath && !path.startsWith(`${basePath}/`)) throw new Error('Not found');
    let file = resolve(root, `.${path.slice(basePath.length) || '/'}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Not found');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(join(root, '404.html')));
  }
});
const port = Number(process.env.PORT ?? 3901);
server.listen(port, '127.0.0.1', () => console.log(`Static docs preview → http://localhost:${port}${basePath}/`));
