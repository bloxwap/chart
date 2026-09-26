import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../out/', import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const failures = [];
const exists = async (path) => { try { return (await stat(path)).isFile(); } catch { return false; } };
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? walk(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}
for (const required of [
  'index.html', '404.html', 'docs/index.html', 'search.json', 'icon.svg',
  'chart-demo/demo/index.html', 'chart-demo/dist/index.js', 'chart-demo/dist/ui/index.js',
  'chart-demo/assets/fonts/Geist-Regular.woff2', 'chart-demo/assets/fonts/GeistMono-Regular.woff2',
]) {
  if (!await exists(join(root, required))) failures.push(`Missing ${required}`);
}
const files = (await walk(root)).filter((file) => extname(file) === '.html');
let checked = 0;
for (const file of files) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<(?:a|link|script|img|iframe)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
    const pathname = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!pathname) continue;
    let target;
    if (pathname.startsWith('/')) {
      if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
        failures.push(`${file.slice(root.length)} links outside basePath: ${href}`); continue;
      }
      target = resolve(root, `.${pathname.slice(basePath.length) || '/'}`);
    } else target = resolve(dirname(file), pathname);
    if (!await exists(target) && !await exists(join(target, 'index.html')) && !await exists(`${target}.html`)) {
      failures.push(`${file.slice(root.length)} has broken link/asset: ${href}`);
    }
    checked++;
  }
}
if (failures.length) throw new Error([...new Set(failures)].join('\n'));
await writeFile(join(root, '.nojekyll'), '');
await writeFile(join(root, '_docs-config.json'), JSON.stringify({ basePath }));
console.log(`Static export verified: ${files.length} HTML pages, ${checked} local links/assets, basePath "${basePath || '/'}".`);
