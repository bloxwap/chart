// HIG adoption guard for the docs site. Tokens, CSS and components come from the vendored
// @bloxwap/hig-* candidate tarballs (vendor/bloxwap-hig); this script only derives the manifest roles
// that @bloxwap/hig-tokens/css does not emit as variables yet (radius, type, motion, density) and the
// canvas-compatible sRGB chart theme, and fails CI when copies of HIG sources creep back in.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tokens } from '@bloxwap/hig-tokens';

const require = createRequire(import.meta.url);
export const manifest = tokens;
export const tokensCssPath = require.resolve('@bloxwap/hig-tokens/css');
export const colors = Object.fromEntries(Object.entries(manifest.colors).map(([key, value]) => [key, value.srgb]));
/** CSS value of a role as a modern browser computes it from @bloxwap/hig-tokens/css. */
export const cssColor = (role) => manifest.colors[role].oklch ?? manifest.colors[role].srgb;
export const chartTheme = {
  theme: { background: colors.surface, textColor: colors.text, borderColor: colors.border, fontFamily: '"Bloxwap Sans", system-ui, sans-serif', monoFamily: '"Bloxwap Mono", monospace', scaleFontFamily: '"Bloxwap Mono", monospace' },
  grid: { color: colors.border },
  crosshair: { color: colors.muted, labelBackground: colors.action, labelColor: colors.onAction },
  series: { upColor: colors.buy, downColor: colors.sell, wickUpColor: colors.buy, wickDownColor: colors.sell, borderUpColor: colors.buy, borderDownColor: colors.sell },
};

const rem = (px) => `${px / 16}rem`;
const vars = [];
for (const [key, value] of Object.entries(manifest.radius)) vars.push(`  --hig-radius-${key}: ${key === 'pill' ? '9999px' : rem(value)};`);
for (const [key, role] of Object.entries(manifest.type)) vars.push(`  --hig-type-${key}-size: ${rem(role.size)};`, `  --hig-type-${key}-line: ${rem(role.lineHeight)};`, `  --hig-type-${key}-weight: ${role.weight};`);
for (const [key, value] of Object.entries(manifest.motion)) vars.push(`  --hig-duration-${key}: ${value}ms;`);
for (const [key, value] of Object.entries(manifest.density)) vars.push(`  --hig-control-${key}: ${rem(value.control)};`);
const css = `/* Generated from @bloxwap/hig-tokens ${manifest.version} manifest by scripts/hig-tokens.mjs; do not edit. */\n:root {\n${vars.join('\n')}\n}\n@media (prefers-reduced-motion: reduce) {\n  :root { ${Object.keys(manifest.motion).map((key) => `--hig-duration-${key}: 0ms;`).join(' ')} }\n}\n`;
const output = new URL('../styles/hig-roles.generated.css', import.meta.url);
if (process.argv.includes('--write')) await writeFile(output, css);

if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), css, 'HIG role drift: run node apps/docs/scripts/hig-tokens.mjs --write');
  const vendor = new URL('../../../vendor/bloxwap-hig/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
  for (const [file, hash] of Object.entries(provenance.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(file, vendor))).digest('hex'), hash, `Vendored HIG tarball changed: ${file}`);
  const docsPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['tokens', 'contracts', 'react']) {
    const spec = docsPackage.dependencies[`@bloxwap/hig-${name}`];
    assert.ok(spec?.startsWith('file:../../vendor/bloxwap-hig/') && spec.includes(provenance.version), `@bloxwap/hig-${name} must come from the pinned vendored tarball`);
    assert.equal(JSON.parse(await readFile(new URL(`../../../node_modules/@bloxwap/hig-${name}/package.json`, import.meta.url), 'utf8')).version, provenance.version, `Installed @bloxwap/hig-${name} is not ${provenance.version}; run npm ci`);
  }
  assert.deepEqual((await readdir(new URL('../styles/', import.meta.url))).sort(), ['hig-roles.generated.css'], 'Only the generated HIG role file belongs in styles/');
  // No copied palettes, token snapshots, primitive classes or font binaries in the docs shell.
  const forbidden = [
    [/--(hig|bloxwap)-[\w-]+\s*:\s*(#|oklch\(|rgb|color\()/, 'copied palette declaration'],
    [/vendor\/hig\/|tokens\.generated\.css|@workspace\/(tokens|ui)/, 'obsolete token snapshot import'],
    [/(^|[\s"'.])btn(--[\w-]+)?\b(?![-\w])/m, 'duplicate .btn primitive (use @bloxwap/hig-react Button or .hig-button)'],
  ];
  async function checkSurface(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await checkSurface(path);
      else if (/\.(ttf|otf|woff2?)$/.test(entry.name)) assert.fail(`Copied font binary: ${path}`);
      else if (/\.(css|tsx?)$/.test(entry.name) && !entry.name.endsWith('.generated.css')) {
        const source = await readFile(path, 'utf8');
        for (const [pattern, reason] of forbidden) assert.ok(!pattern.test(source), `${reason}: ${path.pathname}`);
      }
    }
  }
  for (const dir of ['app/', 'components/', 'lib/', 'styles/']) await checkSurface(new URL(`../${dir}`, import.meta.url));
  console.log(`HIG ${provenance.version} tarball provenance, installed versions, generated roles and copy drift checks passed.`);
}
