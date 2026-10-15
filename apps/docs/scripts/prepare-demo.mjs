import { chartTheme, tokensCssPath } from './hig-tokens.mjs';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const repository = new URL('../../../', import.meta.url);
const output = new URL('../public/chart-demo/', import.meta.url);

// Preserve the demo's relative imports. There is only one playground
// implementation: the same HTML served by `npm run demo` is published with docs.
// Its Geist assets are not copied: the docs copy below swaps every Geist
// reference for Bloxwap Sans/Mono.
await rm(output, { recursive: true, force: true });
await mkdir(new URL('demo/', output), { recursive: true });
await Promise.all([
  cp(new URL('apps/playground/index.html', repository), new URL('demo/index.html', output)),
  cp(tokensCssPath, new URL('assets/hig-tokens.css', output)), // @bloxwap/hig-tokens/css, unmodified
  cp(new URL('packages/chart/dist/', repository), new URL('dist/', output), { recursive: true }),
]);

// An iframe cannot inherit the parent's Next.js font variables, so the demo
// ships its own copy of the Latin Bloxwap Sans/Mono faces. The package's other
// script companions (CJK, Arabic, ...) are left out; the demo never shows them.
const fontPackage = new URL('../../../node_modules/@bloxwap/font/', import.meta.url);
const fontOutput = new URL('assets/bloxwap-font/', output);
const families = ['BloxwapSans', 'BloxwapMono'];
await Promise.all([
  ...families.map((family) => cp(new URL(`fonts/${family}/`, fontPackage), new URL(`fonts/${family}/`, fontOutput), { recursive: true })),
  cp(new URL('LICENSE', fontPackage), new URL('LICENSE', fontOutput)),
]);
const packageCss = await readFile(new URL('bloxwap-font.css', fontPackage), 'utf8');
const license = packageCss.split('\n').find((line) => line.includes('Open Font License'));
const faces = packageCss.match(/@font-face \{[^}]+\}/g)
  .filter((face) => families.some((family) => face.includes(`./fonts/${family}/`)));
if (faces.length !== 4) throw new Error(`Expected 4 Latin Bloxwap Sans/Mono faces, found ${faces.length}.`);
await writeFile(new URL('bloxwap-font.css', fontOutput), `/*\n * Latin Bloxwap Sans and Mono, trimmed from @bloxwap/font/bloxwap-font.css by apps/docs/scripts/prepare-demo.mjs.\n${license}\n */\n${faces.join('\n')}\n`);

const SANS = '"Bloxwap Sans", system-ui, sans-serif';
const MONO = '"Bloxwap Mono", ui-monospace, monospace';
const demo = new URL('demo/index.html', output);
const html = (await readFile(demo, 'utf8'))
  .replace('<style>', `<link rel="stylesheet" href="../assets/hig-tokens.css" /><link rel="stylesheet" href="../assets/bloxwap-font/bloxwap-font.css" /><style>
    /* SDK chrome (header, rails, menus, dialogs): doubled class outranks the injected TOOLBAR_CSS. */
    body { background: var(--hig-surface); color: var(--hig-text); }
    body:not(.light) .cts-theme.cts-theme { --cts-bg: var(--hig-background); --cts-panel: var(--hig-surface); --cts-panel-raised: var(--hig-nested); --cts-edge: var(--hig-border); --cts-idle: var(--hig-muted); --cts-muted: var(--hig-faint); --cts-hover: var(--hig-text); --cts-accent: var(--hig-action); --cts-on-accent: var(--hig-onAction); }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
    .cts-theme.cts-theme { --cts-font: ${SANS}; --cts-mono: ${MONO}; }`)
  .replace(/@font-face \{[^}]+\}/g, '')
  .replaceAll("'Geist'", "'Bloxwap Sans'")
  .replaceAll('12px "Geist"', '12px "Bloxwap Sans"')
  .replaceAll('12px "Geist Mono"', '12px "Bloxwap Mono"')
  // Canvas text: the bloxwapDark preset uses system-ui for all three families.
  .replace('config: defineConfig({', `config: defineConfig({ ...${JSON.stringify(chartTheme)},`);
const themedHtml = html.replace("presetChartTheme('bloxwapDark')", `presetChartTheme(${JSON.stringify(chartTheme)})`);
if (/Geist/.test(themedHtml)) throw new Error('The docs chart demo still references Geist.');
await writeFile(demo, themedHtml);
console.log('Prepared the complete chart demo for the documentation site.');
