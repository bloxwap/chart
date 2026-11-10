import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { moduleSpecifiers, parseBunLock } from './checks.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(root, 'scripts/check-invariants.mjs');
function fixture(t) {
  const dir = mkdtempSync(join(root, '.invariants-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['package.json', 'package-lock.json', 'bun.lock', 'packages/chart/package.json', 'apps/docs/package.json', 'apps/playground/package.json']) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    cpSync(join(root, path), join(dir, path));
  }
  return dir;
}
function edit(dir, path, change) {
  const file = join(dir, path);
  const value = path === 'bun.lock' ? parseBunLock(readFileSync(file, 'utf8')) : JSON.parse(readFileSync(file, 'utf8'));
  change(value);
  writeFileSync(file, JSON.stringify(value));
}
function rejects(check, dir, pattern) {
  const result = spawnSync(process.execPath, [cli, check, dir], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, pattern);
}
function dist(dir) {
  cpSync(join(root, 'packages/chart/dist'), join(dir, 'packages/chart/dist'), { recursive: true });
}

test('all four gates pass on the built repository', () => {
  const result = spawnSync(process.execPath, [cli, 'all', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('#101 rejects a declared runtime dependency', (t) => {
  const dir = fixture(t);
  edit(dir, 'packages/chart/package.json', (pkg) => { pkg.dependencies = { accidental: '1.0.0' }; });
  rejects('dependencies', dir, /zero runtime dependencies/);
});
test('#101 rejects a required React peer', (t) => {
  const dir = fixture(t);
  edit(dir, 'packages/chart/package.json', (pkg) => { pkg.peerDependenciesMeta.react.optional = false; });
  rejects('dependencies', dir, /must be optional/);
});
for (const [name, source] of [
  ['static bare import', "import x from 'accidental';"],
  ['bare re-export', "export * from 'accidental';"],
  ['dynamic builtin', "const p = import('node:fs');"],
  ['React leaking into core', "import 'react';"],
  ['computed dynamic import', "const p = import('./' + name);"],
]) test(`#101 rejects ${name}`, (t) => {
  const dir = fixture(t);
  dist(dir);
  writeFileSync(join(dir, 'packages/chart/dist/leak.js'), source);
  rejects('dependencies', dir, /forbidden runtime import|unverifiable/);
});
test('specifier scanner handles comments, multiline imports and optional adapter imports', () => {
  assert.deepEqual(moduleSpecifiers(`// import 'ignored';\n/* export * from 'ignored'; */
    import { x }\n from './local.js'; export { y } from 'react'; import('react/jsx-runtime'); import.meta.url;`),
  ['./local.js', 'react', 'react/jsx-runtime']);
});
test('#102 rejects kernel leaking into parseColor', (t) => {
  const dir = fixture(t);
  dist(dir);
  const kernel = readFileSync(join(dir, 'packages/chart/dist/wasm/kernels.base64.js'), 'utf8').match(/["'](AGFzb[\da-zA-Z+/=]+)["']/)[1];
  writeFileSync(join(dir, 'packages/chart/dist/index.js'), `export function parseColor() { return '${kernel}'; }`);
  rejects('tree-shaking', dir, /parseColor: unexpected kernel payload presence/);
});
test('#102 rejects bundle budget regression without kernel leakage', (t) => {
  const dir = fixture(t);
  dist(dir);
  writeFileSync(join(dir, 'packages/chart/dist/index.js'), `export function parseColor() { return '${'a'.repeat(3000)}'; }`);
  rejects('tree-shaking', dir, /exceeds .* byte budget/);
});
for (const version of ['^0.18.0', '0.19.0']) test(`#103 rejects workspace pin ${version}`, (t) => {
  const dir = fixture(t);
  edit(dir, 'apps/docs/package.json', (pkg) => { pkg.devDependencies.tsrs = version; });
  rejects('tsrs', dir, /exact version|differs from/);
});
for (const lock of ['bun.lock', 'package-lock.json']) test(`#103 rejects platform compiler drift in ${lock}`, (t) => {
  const dir = fixture(t);
  edit(dir, lock, (data) => {
    if (lock === 'bun.lock') data.packages['@tsrs/linux-x64-gnu'][0] = '@tsrs/linux-x64-gnu@0.0.1';
    else data.packages['node_modules/@tsrs/linux-x64-gnu'].version = '0.0.1';
  });
  rejects('tsrs', dir, /expected 0.18.0/);
});
for (const mode of ['npm-only', 'bun-only', 'nested-version']) test(`#104 rejects ${mode} drift`, (t) => {
  const dir = fixture(t);
  if (mode === 'bun-only') edit(dir, 'bun.lock', (lock) => { lock.packages.accidental = ['accidental@1.0.0']; });
  else edit(dir, 'package-lock.json', (lock) => {
    lock.packages[mode === 'npm-only' ? 'node_modules/accidental' : 'node_modules/parent/node_modules/react'] = { version: '0.0.1' };
  });
  rejects('lockfiles', dir, /lockfile mismatch/);
});
test('Bun trailing comma parsing preserves string contents', () => {
  assert.deepEqual(parseBunLock('{"x": ["literal,}",],}'), { x: ['literal,}'] });
});
