/**
 * Post-processes coverage/lcov.info for Codecov:
 *
 * - Prefixes SF paths with `packages/chart/` — Node reports package-relative
 *   source paths via source maps; Codecov needs repository-relative ones.
 * - Drops zero-hit DA records on lines the compiler erases (doc comments,
 *   `import type`, `export type`). Source maps misattribute these, so they
 *   show up as uncovered even though nothing executable exists there.
 *   LF/LH are recomputed from the surviving DA records.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(new URL('..', import.meta.url).pathname);
const lcovPath = join(root, 'coverage', 'lcov.info');
const ERASED_RE = /^\s*($|\/\/|\/\*|\*|\*\/|import\s+type\b|export\s+type\b)/;

const input = readFileSync(lcovPath, 'utf8').split('\n');
const out = [];
let record = [];
let file = null;
let srcLines = null;
let droppedTotal = 0;

function flush() {
  if (record.length === 0) return;
  const kept = [];
  let dropped = 0;
  for (const line of record) {
    if (line.startsWith('DA:')) {
      const comma = line.indexOf(',');
      const n = Number(line.slice(3, comma));
      const hits = Number(line.slice(comma + 1));
      if (hits === 0 && n >= 1 && n <= srcLines.length && ERASED_RE.test(srcLines[n - 1])) {
        dropped++;
        continue;
      }
    } else if (line.startsWith('LF:') || line.startsWith('LH:')) {
      continue; // recomputed below
    }
    kept.push(line);
  }
  const da = kept.filter((l) => l.startsWith('DA:'));
  kept.push(`LF:${da.length}`);
  kept.push(`LH:${da.filter((l) => !l.endsWith(',0')).length}`);
  droppedTotal += dropped;
  out.push(...kept);
  record = [];
}

for (const line of input) {
  if (line.startsWith('SF:')) {
    flush();
    file = line.slice(3);
    srcLines = readFileSync(join(root, file), 'utf8').split('\n');
    out.push(`SF:packages/chart/${file}`);
  } else if (line === 'end_of_record') {
    record.push(line);
    flush();
    srcLines = null;
  } else if (line !== '') {
    record.push(line);
  }
}

writeFileSync(lcovPath, out.join('\n') + '\n');
console.log(`lcov-sanitize: ${out.filter((l) => l.startsWith('SF:')).length} files, dropped ${droppedTotal} erased-line DA records`);
