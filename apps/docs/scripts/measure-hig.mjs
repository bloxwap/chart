// Before/after size report for the HIG package migration.
// Usage (from the repo root, after `npm run docs:build` with the same base path for both exports):
//   node apps/docs/scripts/measure-hig.mjs <baseline-export-directory> <baseline-commit>
import { readdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function sizes(dir) {
  const result = { css: 0, javascript: 0, fonts: 0, total: 0, files: 0 };
  async function walk(path) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const next = `${path}/${file.name}`;
      if (file.isDirectory()) { await walk(next); continue; }
      const size = (await stat(next)).size;
      result.total += size; result.files++;
      const kind = file.name.endsWith('.css') ? 'css' : file.name.endsWith('.js') ? 'javascript' : /\.(woff2?|ttf)$/.test(file.name) ? 'fonts' : null;
      if (kind) result[kind] += size;
    }
  }
  await walk(dir);
  return result;
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const [baselineDirectory, baselineCommit] = process.argv.slice(2);
if (!baselineDirectory || !baselineCommit) throw new Error('Usage: node apps/docs/scripts/measure-hig.mjs <baseline-export-directory> <baseline-commit>');
const before = await sizes(baselineDirectory);
const after = await sizes('apps/docs/out');
const delta = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, b[key] - a[key]]));

// Hand-maintained docs CSS (excludes generated output) and docs source files removed by the migration.
const cssFiles = (ref) => git('ls-tree', '-r', '--name-only', ref, 'apps/docs').split('\n').filter((f) => f.endsWith('.css') && !f.includes('.generated.'));
const cssStats = (ref) => cssFiles(ref).reduce((sum, file) => { const text = git('show', `${ref}:${file}`); return { files: sum.files + 1, lines: sum.lines + text.split('\n').length, bytes: sum.bytes + Buffer.byteLength(text) }; }, { files: 0, lines: 0, bytes: 0 });
const removed = git('diff', '--name-only', '--diff-filter=D', baselineCommit, '--', 'apps/docs').split('\n').filter(Boolean);
const removedBytes = removed.reduce((sum, file) => sum + Number(git('cat-file', '-s', `${baselineCommit}:${file}`)), 0);
const lockPackages = (text) => Object.keys(JSON.parse(text).packages).filter(Boolean);
const beforeLock = lockPackages(git('show', `${baselineCommit}:package-lock.json`));
const afterLock = lockPackages(await readFile('package-lock.json', 'utf8'));
const docsDeps = (text) => Object.keys({ ...JSON.parse(text).dependencies, ...JSON.parse(text).devDependencies });
const provenance = JSON.parse(await readFile('vendor/bloxwap-hig/provenance.json', 'utf8'));
// Generated token adapters: hig.generated.css (copied snapshot, step 1), hig-roles.generated.css (step 2), none since
// @bloxwap/hig-tokens/css emits the roles itself.
const generated = (ref) => ['hig.generated.css', 'hig-roles.generated.css'].reduce((sum, file) => { try { return sum + Buffer.byteLength(git('show', `${ref}:apps/docs/styles/${file}`)); } catch { return sum; } }, 0);

console.log(JSON.stringify({
  baselineCommit,
  hig: { commit: provenance.commit, version: provenance.version },
  toolchain: { node: process.version, next: JSON.parse(await readFile('node_modules/next/package.json', 'utf8')).version, basePath: JSON.parse(await readFile('apps/docs/out/_docs-config.json', 'utf8')).basePath },
  measurement: 'uncompressed bytes of the complete static export (not transfer size or per-route bundles)',
  export: { before, after, delta: delta(before, after) },
  docsCss: { handWritten: { before: cssStats(baselineCommit), after: cssStats('HEAD') }, generatedAdapterBytes: { before: generated(baselineCommit), after: generated('HEAD') } },
  removedDocsFiles: { count: removed.length, bytes: removedBytes, files: removed },
  dependencies: {
    docsDirect: { before: docsDeps(git('show', `${baselineCommit}:apps/docs/package.json`)).length, after: docsDeps(await readFile('apps/docs/package.json', 'utf8')).length },
    lockfilePackages: { before: beforeLock.length, after: afterLock.length, added: afterLock.filter((p) => !beforeLock.includes(p)), removed: beforeLock.filter((p) => !afterLock.includes(p)) },
  },
}, null, 2));
