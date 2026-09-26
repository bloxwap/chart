/**
 * Crispness + consistency linter for the hand-authored SVGs in assets/icons.
 *
 * The set is repo-local by design: no npm icon packages, no CDN references.
 * Every icon is a 24×24 Lucide-style stroke icon in `currentColor`. For the
 * icons to render crisply at toolbar sizes (16–24px), geometry must be
 * disciplined:
 *
 *   1. Baseline Lucide attributes on the root <svg> (shared with build-icons).
 *   2. Every numeric coordinate/length is a multiple of 0.25 — no arbitrary
 *      precision slop (e.g. 2.295) that blurs and drifts between editors.
 *   3. stroke-width is set once on the root; children never override
 *      presentation attributes that belong to the set baseline (except
 *      `fill="currentColor"` for solid dots/stars and `stroke-dasharray`).
 *   4. No external or machine-generated cruft: no <image>, <use>, <script>,
 *      <style>, class=, id=, url(...), data:, or http(s) references.
 *   5. Formatting: single line is not required, but no trailing whitespace
 *      inside attribute values and no space before '/>'.
 *
 * Exit code 1 with a per-icon report when any rule fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const here = join(root, 'assets', 'icons');

const REQUIRED_ATTRS = [
  'viewBox="0 0 24 24"',
  'fill="none"',
  'stroke="currentColor"',
  'stroke-width="1.5"',
  'stroke-linecap="round"',
  'stroke-linejoin="round"',
];

const GRID = 0.25;
const TOLERANCE = 1e-9;

function lint(name, svg) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  for (const attr of REQUIRED_ATTRS) {
    if (!svg.includes(attr)) fail(`missing baseline attribute ${attr}`);
  }
  if (!svg.startsWith('<svg ') || !svg.trimEnd().endsWith('</svg>')) {
    fail('expected a single root <svg>');
  }

  // Well-formedness: every opened tag is self-closed or closed.
  const tags = svg.match(/<[^>]+>/g) ?? [];
  const stack = [];
  for (const tag of tags) {
    if (tag.startsWith('</')) {
      const closing = tag.slice(2, -1);
      if (stack.pop() !== closing) fail(`unbalanced tag ${tag}`);
    } else if (!tag.endsWith('/>')) {
      stack.push(tag.slice(1).split(/[\s>]/)[0]);
    }
  }
  if (stack.length !== 0) fail(`unclosed tags ${stack.join(', ')}`);

  // Repo-local, hand-authored only: nothing external or editor-generated.
  // (The xmlns namespace URI is an identifier, not a fetched reference.)
  for (const banned of ['<image', '<use', '<script', '<style', '<text', '<foreignObject', 'href=', 'src=', 'xlink', 'url(', 'data:', ' id=', ' class=', ' style=']) {
    if (svg.includes(banned)) fail(`banned content: ${banned.trim()}`);
  }

  // Formatting nits.
  if (/"\s+\/>/.test(svg)) fail('space before "/>"');
  if (/="[^"]*\s"/.test(svg)) fail('trailing whitespace inside an attribute value');

  // Children may carry only geometry + the allowed presentation overrides.
  for (const tag of tags) {
    if (tag.startsWith('</') || tag.startsWith('<svg')) continue;
    if (/\sstroke-width=/.test(tag)) fail(`child overrides stroke-width: ${tag}`);
    if (/\sstroke=/.test(tag)) fail(`child overrides stroke color: ${tag}`);
    if (/\sfill=/.test(tag) && !/\sfill="currentColor"/.test(tag)) {
      fail(`child fill must be fill="currentColor": ${tag}`);
    }
  }

  // Crispness grid: every number in geometry-bearing attributes is a
  // multiple of 0.25. Arc flags (0/1) and rotation angles pass trivially.
  const attrRe = /(d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|points|stroke-dasharray)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(svg)) !== null) {
    const [, attr, value] = m;
    const numRe = /-?\d*\.?\d+(?:e-?\d+)?/gi;
    let n;
    while ((n = numRe.exec(value)) !== null) {
      const v = Number(n[0]);
      const q = v / GRID;
      if (Math.abs(q - Math.round(q)) > TOLERANCE) {
        fail(`off-grid value ${n[0]} in ${attr}="${value.length > 40 ? value.slice(0, 40) + '…' : value}"`);
      }
    }
  }

  return errors;
}

const files = readdirSync(here)
  .filter((f) => f.endsWith('.svg'))
  .sort();

let failed = 0;
for (const file of files) {
  const svg = readFileSync(join(here, file), 'utf8').trim().replace(/\s*\n\s*/g, '');
  const errors = lint(file, svg);
  if (errors.length > 0) {
    failed++;
    console.error(`✗ ${file}`);
    for (const e of errors) console.error(`    ${e}`);
  }
}

if (failed > 0) {
  console.error(`\nicon lint: ${failed}/${files.length} icons failed`);
  process.exit(1);
}
console.log(`icon lint: ${files.length} icons clean (24×24 grid, 0.25 coordinate grid, repo-local)`);
