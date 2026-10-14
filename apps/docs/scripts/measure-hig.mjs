import { readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function sizes(dir) {
  const result = { css: 0, javascript: 0, fonts: 0 };
  async function walk(path) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const next = `${path}/${file.name}`;
      if (file.isDirectory()) await walk(next);
      else { const kind = file.name.endsWith('.css') ? 'css' : file.name.endsWith('.js') ? 'javascript' : /\.(woff2?|ttf)$/.test(file.name) ? 'fonts' : null; if (kind) result[kind] += (await stat(next)).size; }
    }
  }
  await walk(dir); return result;
}
const baselineDirectory = process.argv[2];
const baselineCommit = process.argv[3];
if (!baselineDirectory || !baselineCommit) throw new Error('Usage: node apps/docs/scripts/measure-hig.mjs <baseline-export-directory> <baseline-commit>');
const before = await sizes(baselineDirectory);
const after = await sizes('apps/docs/out');
const report = { baselineCommit, higCommit:'1a776b9326c6ba03702894943b3edbfd178c4b40', toolchain: {node:process.version, next:'16.3.6', basePath:'/chart'}, measurement:'sum of uncompressed emitted CSS/JS/font files in static export (not transfer or per-route bundle sizes)', before, after, delta:Object.fromEntries(Object.keys(before).map(k => [k,after[k]-before[k]])), removedSource:{paletteCssBytes:execFileSync('git',['show',`${baselineCommit}:apps/docs/styles/tokens.generated.css`]).length, unusedHeadingFontBytes:116056}, notes:['No runtime dependency added; chart SDK API and engine unchanged.','OG static Bloxwap faces remain referenced; their licenses are retained.','Decorative OG spectrum colors are brand assets, not semantic UI palette; exception reviewed 2026-11-13.']};
console.log(JSON.stringify(report,null,2));
