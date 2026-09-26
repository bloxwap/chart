/**
 * Renders a contact sheet of every icon in assets/icons at 16, 20, 24 and
 * 32px on both light and dark surfaces, so a design pass can be audited
 * visually at real render sizes. Everything is generated from the repo-local
 * SVGs — no external assets, fonts, or scripts.
 *
 * Output: assets/icons/preview.html (git-ignored build artifact).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const here = join(root, 'assets', 'icons');

const SIZES = [16, 20, 24, 32];

const files = readdirSync(here)
  .filter((f) => f.endsWith('.svg'))
  .sort();

function at(svg, size) {
  return svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

const rows = [];
for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  const svg = readFileSync(join(here, file), 'utf8').trim().replace(/\s*\n\s*/g, '');
  const cells = SIZES.map((s) => `<td>${at(svg, s)}<span>${s}</span></td>`).join('');
  rows.push(`<tr><th>${name}</th>${cells}</tr>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Icon contact sheet — @bloxwap/chart</title>
<style>
  body { margin: 0; font: 12px/1.4 ui-monospace, Menlo, monospace; }
  section { padding: 16px 24px 32px; }
  section.light { background: #ffffff; color: #1a1d21; }
  section.dark { background: #16181d; color: #d1d4dc; }
  h1 { font-size: 13px; font-weight: 600; margin: 8px 0 12px; }
  table { border-collapse: collapse; }
  th { text-align: right; font-weight: 400; padding: 4px 12px 4px 0; opacity: .7; }
  td { text-align: center; padding: 4px 10px; }
  td svg { display: block; margin: 0 auto; }
  td span { display: block; opacity: .35; font-size: 10px; margin-top: 2px; }
  tr:hover td, tr:hover th { background: rgba(128,128,128,.08); }
</style>
</head>
<body>
<section class="light">
  <h1>Light — ${files.length} icons @ ${SIZES.join(' / ')}px (1.5px stroke, currentColor)</h1>
  <table>
    <tr><th></th>${SIZES.map((s) => `<td><b>${s}px</b></td>`).join('')}</tr>
    ${rows.join('\n    ')}
  </table>
</section>
<section class="dark">
  <h1>Dark — ${files.length} icons @ ${SIZES.join(' / ')}px</h1>
  <table>
    <tr><th></th>${SIZES.map((s) => `<td><b>${s}px</b></td>`).join('')}</tr>
    ${rows.join('\n    ')}
  </table>
</section>
</body>
</html>
`;

const out = join(here, 'preview.html');
writeFileSync(out, html);
console.log(`${out} generated: ${files.length} icons × ${SIZES.length} sizes × 2 surfaces`);
