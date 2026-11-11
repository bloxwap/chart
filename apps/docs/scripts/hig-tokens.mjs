// HIG adoption guard for the docs site. Tokens, roles, CSS and components come from the published
// @bloxwap/hig package. @bloxwap/hig/tokens/css emits the radius, type, motion and density roles, so
// this script only derives the canvas-compatible sRGB chart theme from the typed manifest, and its
// --check fails CI when copies of HIG sources or role declarations creep back in.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tokens } from '@bloxwap/hig/tokens';

const require = createRequire(import.meta.url);
export const manifest = tokens;
export const tokensCssPath = require.resolve('@bloxwap/hig/tokens/css');
export const colors = Object.fromEntries(Object.entries(manifest.colors).map(([key, value]) => [key, value.srgb]));
/** CSS value of a role as a modern browser computes it from @bloxwap/hig/tokens/css. */
export const cssColor = (role) => manifest.colors[role].oklch ?? manifest.colors[role].srgb;
export const chartTheme = {
  theme: { background: colors.surface, textColor: colors.text, borderColor: colors.border, fontFamily: '"Bloxwap Sans", system-ui, sans-serif', monoFamily: '"Bloxwap Mono", monospace', scaleFontFamily: '"Bloxwap Mono", monospace' },
  grid: { color: colors.border },
  crosshair: { color: colors.muted, labelBackground: colors.action, labelColor: colors.onAction },
  series: { upColor: colors.buy, downColor: colors.sell, wickUpColor: colors.buy, wickDownColor: colors.sell, borderUpColor: colors.buy, borderDownColor: colors.sell },
};

const retiredPackages = ['tokens', 'contracts', 'react', 'native', 'native-fonts', 'chart', 'feedback', 'og-fonts'].map((name) => `@bloxwap/hig-${name}`);
/** bun.lock is JSON with trailing commas. */
const parseLock = (text) => JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));

if (process.argv.includes('--check')) {
  const root = new URL('../../../', import.meta.url);
  const release = JSON.parse(await readFile(new URL('docs/hig-adoption/registry-release.json', root), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const bunLock = parseLock(await readFile(new URL('bun.lock', root), 'utf8'));
  const rootPackage = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const manifests = [new URL('package.json', root)];
  for (const pattern of rootPackage.workspaces) {
    const dir = new URL(pattern.replace('*', ''), root);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const manifestUrl = new URL(`${entry.name}/package.json`, dir);
      if (entry.isDirectory() && existsSync(manifestUrl)) manifests.push(manifestUrl);
    }
  }
  for (const manifestUrl of manifests) {
    const manifestJson = JSON.parse(await readFile(manifestUrl, 'utf8'));
    for (const name of retiredPackages) {
      assert.equal(manifestJson.dependencies?.[name], undefined, `${name} is retired; depend on @bloxwap/hig (${manifestUrl.pathname})`);
      assert.equal(manifestJson.devDependencies?.[name], undefined, `${name} is retired; depend on @bloxwap/hig (${manifestUrl.pathname})`);
    }
  }
  const packageName = '@bloxwap/hig';
  const chartVersion = JSON.parse(await readFile(new URL('packages/chart/package.json', root), 'utf8')).version;
  // Published 0.2.0 peers @bloxwap/chart ^0.3.0, which excludes this workspace's 0.5.0. The override
  // keeps that required peer on the workspace package so install does not fetch a second chart.
  assert.equal(rootPackage.overrides?.[packageName]?.['@bloxwap/chart'], chartVersion, 'root override must point the HIG chart peer at the workspace chart version');
  assert.equal(bunLock.overrides?.[packageName]?.['@bloxwap/chart'], chartVersion, 'bun.lock override must match the workspace chart version');
  const docsPackage = JSON.parse(await readFile(new URL('apps/docs/package.json', root), 'utf8'));
  const pinned = release.packages[packageName];
  assert.equal(docsPackage.dependencies[packageName], release.version, `${packageName} must use the coordinated registry version`);
  assert.equal(docsPackage.devDependencies?.[packageName], undefined, `${packageName} is a direct dependency, not a second devDependency`);
  const locked = lock.packages[`node_modules/${packageName}`];
  assert.equal(locked.version, release.version, `${packageName} lockfile version drifted`);
  assert.equal(locked.resolved, `https://registry.npmjs.org/@bloxwap/hig/-/hig-${release.version}.tgz`, `${packageName} must resolve from npm`);
  assert.equal(locked.resolved, pinned.resolved);
  assert.equal(locked.integrity, pinned.integrity, `${packageName} registry integrity drifted`);
  const bunEntry = bunLock.packages[packageName];
  assert.ok(bunEntry, `${packageName} is missing from bun.lock`);
  assert.equal(bunEntry[0], `${packageName}@${release.version}`, `${packageName} bun.lock version drifted`);
  assert.equal(bunEntry.at(-1), pinned.integrity, `${packageName} bun.lock integrity drifted`);
  for (const name of retiredPackages) {
    assert.equal(lock.packages[`node_modules/${name}`], undefined, `${name} remains in package-lock.json`);
    assert.equal(bunLock.packages[name], undefined, `${name} remains in bun.lock`);
  }
  assert.equal(JSON.parse(await readFile(new URL(`node_modules/${packageName}/package.json`, root), 'utf8')).version, release.version, `Installed ${packageName} is not ${release.version}; run bun install --frozen-lockfile`);
  assert.ok(!existsSync(new URL('../styles/', import.meta.url)), 'styles/ is gone: radius/type/motion/density roles come from @bloxwap/hig/tokens/css');
  // No copied palettes, role declarations, token snapshots, primitive classes or font binaries in the docs shell.
  const forbidden = [
    [/--(hig|bloxwap)-[\w-]+\s*:\s*(#|oklch\(|rgb|color\()/, 'copied palette declaration'],
    [/--hig-(radius|type|motion|density|font|duration|control)-[\w-]+\s*:/, 'local HIG role declaration (use the @bloxwap/hig/tokens/css role)'],
    [/var\(--hig-(duration|control)-|var\(--hig-type-[a-z]+-line\)/, 'retired generated role name (use --hig-motion-duration-*, --hig-density-*-control, --hig-type-*-line-height)'],
    [/vendor\/hig\/|tokens\.generated\.css|@workspace\/(tokens|ui)/, 'obsolete token snapshot import'],
    [/(^|[\s"'.])btn(--[\w-]+)?\b(?![-\w])/m, 'duplicate .btn primitive (use @bloxwap/hig/react Button or .hig-button)'],
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
  console.log(`HIG ${release.version} registry integrity, installed versions, package-owned roles and copy drift checks passed.`);
}
