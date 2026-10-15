// Before/after evidence: screenshots of representative pages and the chart demo at desktop and 390px.
// Usage: node apps/docs/scripts/capture-hig.mjs <static-export-dir> <evidence-dir> <before|after>
// External requests are blocked so the playground uses its offline synthetic market in both captures.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const [outDir, evidenceDir, label] = process.argv.slice(2);
if (!outDir || !evidenceDir || !label) throw new Error('Usage: capture-hig.mjs <static-export-dir> <evidence-dir> <before|after>');
const root = resolve(outDir);
const basePath = JSON.parse(await readFile(join(root, '_docs-config.json'), 'utf8')).basePath ?? '';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!path.startsWith(`${basePath}/`)) throw new Error('Not found');
    let file = resolve(root, `.${path.slice(basePath.length)}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Not found');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(join(root, '404.html')));
  }
});
const port = Number(process.env.PORT ?? 4111);
await new Promise(done => server.listen(port, '127.0.0.1', done));
const origin = `http://127.0.0.1:${port}`;
const pages = [['home', '/'], ['getting-started', '/docs/getting-started/'], ['configuration', '/docs/api/configuration/'], ['playground', '/docs/playground/']];
const viewports = [['desktop', { width: 1440, height: 1000 }, false], ['mobile', { width: 390, height: 844 }, true]];
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, viewport, isMobile] of viewports) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, reducedMotion: 'reduce' });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    for (const [slug, path] of pages) {
      await page.goto(`${origin}${basePath}${path}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      if (slug === 'playground') {
        await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.__chartStats?.().bars > 0, null, { timeout: 60000 });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: join(evidenceDir, `${label}-${slug}-${name}.png`), fullPage: slug !== 'configuration' });
      console.log(`${label}-${slug}-${name}.png`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
