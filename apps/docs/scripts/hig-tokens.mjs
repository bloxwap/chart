import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const vendor = new URL('../vendor/hig/', import.meta.url);
export const manifest = JSON.parse(await readFile(new URL('manifest.json', vendor), 'utf8'));
export const colors = Object.fromEntries(Object.entries(manifest.colors).map(([key, value]) => [key, value.srgb]));
export const chartTheme = {
  theme: { background: colors.surface, textColor: colors.text, borderColor: colors.border, fontFamily: '"Bloxwap Sans", system-ui, sans-serif', monoFamily: '"Bloxwap Mono", monospace', scaleFontFamily: '"Bloxwap Mono", monospace' },
  grid: { color: colors.border },
  crosshair: { color: colors.muted, labelBackground: colors.action, labelColor: colors.onAction },
  series: { upColor: colors.buy, downColor: colors.sell, wickUpColor: colors.buy, wickDownColor: colors.sell, borderUpColor: colors.buy, borderDownColor: colors.sell },
};
const aliases = { 'bloxwap-black': 'background', 'bloxwap-green': 'action', background: 'background', foreground: 'text', card: 'surface', 'card-foreground': 'text', popover: 'nested', 'popover-foreground': 'text', primary: 'action', 'primary-foreground': 'onAction', secondary: 'nested', 'secondary-foreground': 'text', muted: 'nested', 'muted-foreground': 'muted', accent: 'nested', 'accent-foreground': 'text', destructive: 'negative', border: 'border', input: 'border', ring: 'focus' };
const vars = Object.entries(aliases).map(([key, role]) => `  --${key}: var(--hig-${role});`);
for (const [key, value] of Object.entries(manifest.radius)) vars.push(`  --radius-${key === 'pill' ? 'full' : key}: ${value / 16}rem;`);
vars.push('  --radius: var(--radius-lg);', '  --radius-2xl: var(--radius-xl);');
for (const [key, role] of Object.entries({ xs:'xs', sm:'sm', md:'md', lg:'lg', xl:'xl', '2xl':'xxl', '3xl':'xxxl', '4xl':'section', '5xl':'section', '6xl':'section' })) vars.push(`  --space-${key}: var(--hig-space-${role});`);
for (const [key, value] of Object.entries(manifest.motion)) vars.push(`  --duration-${key}: ${value}ms;`);
for (const [key, role] of Object.entries(manifest.type)) {
  vars.push(`  --type-${key}-size: ${role.size / 16}rem;`, `  --type-${key}-line: ${role.lineHeight / 16}rem;`, `  --type-${key}-weight: ${role.weight};`);
}
vars.push(`  --control-h: ${manifest.density.comfortable.control / 16}rem;`, `  --control-h-sm: ${manifest.density.compact.control / 16}rem;`, '  --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);', '  --ease-standard: ease-out;', '  --icon-md: 16px;', '  --control-min-w: 6rem;');
const css = `/* Generated from pinned HIG manifest by scripts/hig-tokens.mjs. */\n:root {\n${vars.join('\n')}\n}\n@media (prefers-reduced-motion: reduce) {\n  :root { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; }\n}\n`;
const output = new URL('../styles/hig.generated.css', import.meta.url);
if (process.argv.includes('--write')) await writeFile(output, css);
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), css, 'HIG adapter drift: run node apps/docs/scripts/hig-tokens.mjs --write');
  const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
  for (const [file, hash] of Object.entries(provenance.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(file, vendor))).digest('hex'), hash, `Pinned HIG artifact changed: ${file}`);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual((await readdir(new URL('../styles/', import.meta.url))).sort(), ['hig.generated.css']);
  const { readdir: list } = await import('node:fs/promises');
  async function checkSurface(dir) {
    for (const entry of await list(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await checkSurface(path);
      else if (/\.(css|tsx?)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        assert.ok(!/@workspace\/(tokens|ui)|tokens\.generated\.css|--bloxwap-\w+\s*:\s*(#|oklch|color\()/.test(source), `Obsolete imports or copied palette: ${path}`);
      }
    }
  }
  await checkSurface(new URL('../app/', import.meta.url));
  await checkSurface(new URL('../components/', import.meta.url));
  console.log('HIG provenance, generated adapter and copied-palette drift checks passed.');
}
