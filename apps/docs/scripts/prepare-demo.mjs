import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const repository = new URL('../../../', import.meta.url);
const output = new URL('../public/chart-demo/', import.meta.url);

// Preserve the demo's relative imports and fonts. There is only one playground
// implementation: the same HTML served by `npm run demo` is published with docs.
await rm(output, { recursive: true, force: true });
await mkdir(new URL('demo/', output), { recursive: true });
await Promise.all([
  cp(new URL('apps/playground/index.html', repository), new URL('demo/index.html', output)),
  cp(new URL('packages/chart/dist/', repository), new URL('dist/', output), { recursive: true }),
  cp(new URL('packages/chart/assets/fonts/', repository), new URL('assets/fonts/', output), { recursive: true }),
]);
console.log('Prepared the complete chart demo for the documentation site.');

// The embedded documentation example explicitly overrides the canvas preset's
// family; an iframe cannot inherit the parent's Next.js font variables.
const fontPackage = new URL('../../../node_modules/@bloxwap/font/', import.meta.url);
await cp(new URL('fonts/', fontPackage), new URL('assets/bloxwap-font/fonts/', output), { recursive: true });
await cp(new URL('bloxwap-font.css', fontPackage), new URL('assets/bloxwap-font/bloxwap-font.css', output));
await cp(new URL('LICENSE', fontPackage), new URL('assets/bloxwap-font/LICENSE', output));
const demo = new URL('demo/index.html', output);
const html = (await readFile(demo, 'utf8'))
  .replace('<style>', '<link rel="stylesheet" href="../assets/bloxwap-font/bloxwap-font.css" /><style>')
  .replace(/@font-face \{[^}]+\}/g, '')
  .replaceAll("'Geist'", "'Bloxwap Sans'")
  .replaceAll('12px "Geist"', '12px "Bloxwap Sans"')
  .replaceAll('12px "Geist Mono"', '12px "Bloxwap Mono"')
  .replace('config: defineConfig({', `config: defineConfig({ theme: { fontFamily: '"Bloxwap Sans", "Bloxwap Sans Scripts", system-ui, sans-serif' },`);
await writeFile(demo, html);
