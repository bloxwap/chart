/** npm run bench:browser --workspace @bloxwap/chart -- --output=/tmp/chart.json */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlayground } from './verify-playground.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Chart performance</title>'); return; }
    const baseline = options.baseline && path.startsWith('/baseline/');
    const demo = path.startsWith('/demo/');
    const dir = baseline ? resolve(options.baseline) : demo ? resolve(root, '../../apps/playground') : root;
    const file = resolve(dir, path.slice(baseline ? '/baseline/'.length : demo ? '/demo/'.length : 1) || 'index.html');
    if (!file.startsWith(dir + sep)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: options.headed !== 'true',
    ...(process.env.CHART_BENCH_BROWSER ? { executablePath: process.env.CHART_BENCH_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 2700, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (options.verify === 'true') {
    const result = await page.evaluate(async () => (await import('/bench/verify-browser.mjs')).verifyBrowser());
    console.log(result);
    await verifyPlayground(page, `http://127.0.0.1:${server.address().port}`);
    if (errors.length) throw new Error(errors.join('\n'));
  } else {
    const result = await page.evaluate(async options => {
      const { runInteractions } = await import('/bench/interactions.bench.mjs');
      return runInteractions({ base: options.baseline ? '/baseline/' : '/dist/', frames: Number(options.frames ?? 90) });
    }, options);
    if (errors.length) throw new Error(errors.join('\n'));
    const report = { measuredAt: new Date().toISOString(), headless: options.headed !== 'true', ...result };
    if (options.output) await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
    console.table(result.results.map(({ pixelRatio, visible, workload, cpuMs, frameIntervalMs, framesOver25Ms }) => ({
      pixelRatio, visible, workload, cpuP50: cpuMs.p50.toFixed(2), cpuP95: cpuMs.p95.toFixed(2),
      intervalP95: frameIntervalMs.p95.toFixed(2), framesOver25Ms,
    })));
  }
} finally {
  await browser?.close();
  server.close();
}
