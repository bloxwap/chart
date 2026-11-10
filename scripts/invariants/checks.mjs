import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const fail = (message) => { throw new Error(`chart-ts: ${message}`); };
const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// Preserve strings while removing JSONC trailing commas.
export function parseBunLock(text) {
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g,
    (token) => token.startsWith('"') ? token : ''));
}

export function lockVersions(root) {
  const npm = new Map();
  const bun = new Map();
  function add(map, name, version) {
    if (!version) fail(`missing locked version for ${name}`);
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(version);
  }
  for (const [path, entry] of Object.entries(json(join(root, 'package-lock.json')).packages)) {
    if (entry.link || !path.includes('node_modules/')) continue;
    add(npm, entry.name ?? path.split('node_modules/').at(-1), entry.version);
  }
  for (const entry of Object.values(parseBunLock(read(join(root, 'bun.lock'))).packages)) {
    const resolved = entry[0];
    const split = resolved.lastIndexOf('@');
    const name = resolved.slice(0, split);
    const version = resolved.slice(split + 1);
    if (version.startsWith('workspace:')) continue;
    add(bun, name, version);
  }
  return { npm, bun };
}

export function checkLocks(root) {
  const { npm, bun } = lockVersions(root);
  const errors = [];
  for (const name of new Set([...npm.keys(), ...bun.keys()])) {
    const a = [...(npm.get(name) ?? [])].sort().join(', ');
    const b = [...(bun.get(name) ?? [])].sort().join(', ');
    if (a !== b) errors.push(`${name}: npm=[${a}] bun=[${b}]`);
  }
  if (errors.length) fail(`lockfile mismatch:\n${errors.join('\n')}`);
  console.log(`lockfiles OK: ${npm.size} package names, ${[...npm.values()].reduce((n, v) => n + v.size, 0)} name/version pairs`);
}

export function checkTsrs(root) {
  const manifests = [join(root, 'package.json')];
  for (const dir of ['packages', 'apps']) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(root, dir, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(path)) manifests.push(path);
    }
  }
  let pin;
  for (const path of manifests) {
    const pkg = json(path);
    for (const section of sections) {
      const version = pkg[section]?.tsrs;
      if (version === undefined) continue;
      if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) fail(`${relative(root, path)}: tsrs must be an exact version, got ${version}`);
      if (pin && pin !== version) fail(`${relative(root, path)}: tsrs ${version} differs from ${pin}`);
      pin = version;
    }
  }
  if (!pin) fail('no tsrs workspace pin found');
  for (const [lock, versions] of Object.entries(lockVersions(root))) {
    let platforms = 0;
    for (const [name, values] of versions) {
      if (name !== 'tsrs' && !name.startsWith('@tsrs/')) continue;
      if (name.startsWith('@tsrs/')) platforms++;
      if ([...values].some((value) => value !== pin)) fail(`${lock}: ${name} resolves to ${[...values]}, expected ${pin}`);
    }
    if (!versions.has('tsrs') || !platforms) fail(`${lock}: missing tsrs/compiler platform packages`);
  }
  console.log(`tsrs pins OK: ${pin}`);
}

// Tokenize emitted ESM, ignoring comments and keeping quoted strings whole.
// Reject computed imports because their dependencies cannot be verified statically.
export function moduleSpecifiers(source) {
  const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g)]
    .map(([token]) => token).filter((token) => !token.startsWith('//') && !token.startsWith('/*'));
  const result = [];
  const string = (token) => token && (token[0] === '"' || token[0] === "'" || token[0] === '`');
  function take(token) {
    if (!string(token) || token.includes('${') || token.includes('\\')) fail('unverifiable module specifier (computed or escaped import)');
    result.push(token.slice(1, -1));
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'import' && tokens[i - 1] !== '.') {
      if (tokens[i + 1] === '.') continue; // import.meta
      if (tokens[i + 1] === '(') {
        take(tokens[i + 2]);
        if (![',', ')'].includes(tokens[i + 3])) fail('unverifiable computed dynamic import');
      } else if (string(tokens[i + 1])) take(tokens[i + 1]);
    }
    if (token === 'from' && string(tokens[i + 1])) take(tokens[i + 1]);
  }
  return result;
}

export function checkDependencies(root) {
  const pkg = json(join(root, 'packages/chart/package.json'));
  if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.optionalDependencies ?? {}).length) fail('chart must have zero runtime dependencies (including optionalDependencies)');
  if (!pkg.peerDependencies?.react || pkg.peerDependenciesMeta?.react?.optional !== true || Object.keys(pkg.peerDependencies).some((name) => name !== 'react')) fail('react must be the only peer dependency and must be optional');
  // React in devDependencies is intentional for testing the optional adapter.
  const dist = join(root, 'packages/chart/dist');
  const files = readdirSync(dist, { recursive: true }).filter((path) => path.endsWith('.js'));
  if (!files.includes('index.js')) fail('missing dist/index.js; run npm run build first');
  for (const file of files) {
    for (const specifier of moduleSpecifiers(read(join(dist, file)))) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
      if (file.replaceAll('\\', '/').startsWith('react/') && ['react', 'react/jsx-runtime'].includes(specifier)) continue;
      fail(`dist/${file}: forbidden runtime import ${specifier}`);
    }
  }
  console.log(`zero runtime dependencies OK: scanned ${files.length} JavaScript files`);
}

export function checkTreeShaking(root) {
  const pkgDir = join(root, 'packages/chart');
  if (json(join(pkgDir, 'package.json')).sideEffects !== false) fail('chart must declare sideEffects:false');
  const kernel = read(join(pkgDir, 'dist/wasm/kernels.base64.js')).match(/["'](AGFzb[\da-zA-Z+/=]+)["']/)?.[1];
  if (!kernel) fail('could not identify WASM kernel base64 payload');
  const temp = mkdtempSync(join(root, '.invariants-'));
  try {
    const installed = join(temp, 'node_modules/@bloxwap/chart');
    mkdirSync(installed, { recursive: true });
    cpSync(join(pkgDir, 'dist'), join(installed, 'dist'), { recursive: true });
    cpSync(join(pkgDir, 'package.json'), join(installed, 'package.json'));
    for (const [symbol, subpath, budget, expectedKernel] of [
      ['parseColor', '', 2400, false],
      ['smaValues', '/indicators', 800, false],
      ['createChart', '', 240000, true],
    ]) {
      const entry = join(temp, `${symbol}.js`);
      const output = join(temp, `${symbol}.bundle.js`);
      writeFileSync(entry, `export { ${symbol} } from '@bloxwap/chart${subpath}';\n`);
      execFileSync('bun', ['build', entry, '--minify', '--target=browser', `--outfile=${output}`], { stdio: 'pipe' });
      const bundle = read(output);
      const size = Buffer.byteLength(bundle);
      console.log(`${symbol}: ${size} bytes (budget ${budget}), kernel ${bundle.includes(kernel) ? 'present' : 'absent'}`);
      if (bundle.includes(kernel) !== expectedKernel) fail(`${symbol}: unexpected kernel payload ${expectedKernel ? 'absence' : 'presence'}`);
      if (size > budget) fail(`${symbol}: bundle ${size} bytes exceeds ${budget} byte budget`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
