/**
 * Runs the test suite with --experimental-test-coverage and enforces 100%
 * line/branch/function coverage on every compiled src file (dist/**). The
 * generated embedded-wasm file is excluded. Exits 1 below threshold.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(new URL('..', import.meta.url).pathname);
const THRESHOLD = 100;
const EXCLUDE = [/kernels\.base64\.js$/];

function collectTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTests(full));
    else if (entry.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const tests = collectTests(join(root, 'dist-test'));
if (tests.length === 0) {
  console.error('check-coverage: no compiled tests found — run npm run build:ts-test first');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--experimental-test-coverage', ...tests],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error('check-coverage: test run failed');
  process.exit(1);
}

// Coverage table rows look like: "#  dist/foo.js | 100.00 | 100.00 | 100.00 | "
const rowRe = /^[ℹ#]\s+(.+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
const rows = [];
for (const line of result.stdout.split('\n')) {
  const m = rowRe.exec(line);
  if (m === null) continue;
  rows.push({ file: m[1], line: Number(m[2]), branch: Number(m[3]), func: Number(m[4]) });
}
if (rows.length === 0) {
  console.error('check-coverage: could not parse coverage table from test output');
  process.exit(1);
}

let failed = false;
for (const row of rows) {
  if (EXCLUDE.some((re) => re.test(row.file))) continue;
  const bad = row.line < THRESHOLD || row.branch < THRESHOLD || row.func < THRESHOLD;
  if (bad) {
    failed = true;
    console.error(
      `BELOW THRESHOLD: ${row.file} — line ${row.line}% branch ${row.branch}% funcs ${row.func}%`,
    );
  }
}
if (failed) {
  console.error(`check-coverage: FAILED (threshold ${THRESHOLD}%)`);
  process.exit(1);
}
console.log(`check-coverage: OK — all covered files at ${THRESHOLD}% (${rows.length} rows)`);
