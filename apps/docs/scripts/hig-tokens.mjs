// HIG adoption guard for the docs site. Tokens, roles, CSS and components come from the vendored
// @bloxwap/hig-* candidate tarballs (vendor/bloxwap-hig). @bloxwap/hig-tokens/css emits the radius, type,
// motion and density roles, so this script only derives the canvas-compatible sRGB chart theme from the
// typed manifest, and its --check fails CI when copies of HIG sources or role declarations creep back in.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

if (process.argv.includes('--check')) {
  const vendor = new URL('../../../vendor/bloxwap-hig/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
  for (const [file, hash] of Object.entries(provenance.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(file, vendor))).digest('hex'), hash, `Vendored HIG tarball changed: ${file}`);
  const reportBytes = await readFile(new URL('../../../docs/hig-adoption/issue-115/candidate-report.json', import.meta.url));
  assert.equal(createHash('sha256').update(reportBytes).digest('hex'), provenance.releaseReportSha256, 'Candidate report changed');
  const report = JSON.parse(reportBytes);
  assert.equal(report.sourceCommit, provenance.commit); assert.equal(report.artifactVersion, provenance.version); assert.equal(report.sourceTreeDirty, false);
  const docsPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['tokens', 'contracts', 'react', 'og-fonts']) {
    const field = name === 'og-fonts' ? 'devDependencies' : 'dependencies';
    const spec = docsPackage[field][`@bloxwap/hig-${name}`];
    assert.ok(spec?.startsWith('file:../../vendor/bloxwap-hig/') && spec.includes(provenance.version), `@bloxwap/hig-${name} must come from the pinned vendored tarball`);
    assert.equal(JSON.parse(await readFile(new URL(`../../../node_modules/@bloxwap/hig-${name}/package.json`, import.meta.url), 'utf8')).version, provenance.version, `Installed @bloxwap/hig-${name} is not ${provenance.version}; run npm ci`);
  }
  assert.ok(!existsSync(new URL('../styles/', import.meta.url)), 'styles/ is gone: radius/type/motion/density roles come from @bloxwap/hig-tokens/css');
  // No copied palettes, role declarations, token snapshots, primitive classes or font binaries in the docs shell.
  const forbidden = [
    [/--(hig|bloxwap)-[\w-]+\s*:\s*(#|oklch\(|rgb|color\()/, 'copied palette declaration'],
    [/--hig-(radius|type|motion|density|font|duration|control)-[\w-]+\s*:/, 'local HIG role declaration (use the @bloxwap/hig-tokens/css role)'],
    [/var\(--hig-(duration|control)-|var\(--hig-type-[a-z]+-line\)/, 'retired generated role name (use --hig-motion-duration-*, --hig-density-*-control, --hig-type-*-line-height)'],
    [/vendor\/hig\/|tokens\.generated\.css|@workspace\/(tokens|ui)/, 'obsolete token snapshot import'],
    [/(^|[\s"'.])btn(--[\w-]+)?\b(?![-\w])/m, 'duplicate .btn primitive (use @bloxwap/hig-react Button or .hig-button)'],
  ];
  async function checkSurface(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await checkSurface(path);
      else if (/\.(ttf|otf|woff2?)$/.test(entry.name)) assert.fail(`Copied font binary: ${path}`);
      else if (/\.(css|tsx?)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        for (const [pattern, reason] of forbidden) assert.ok(!pattern.test(source), `${reason}: ${path.pathname}`);
      }
    }
  }
  for (const dir of ['app/', 'components/', 'lib/']) await checkSurface(new URL(`../${dir}`, import.meta.url));
  console.log(`HIG ${provenance.version} tarball provenance, installed versions, package-owned roles and copy drift checks passed.`);
}
