import { cp, mkdir, rm } from 'node:fs/promises';

const repository = new URL('../../', import.meta.url);
const output = new URL('../public/chart-demo/', import.meta.url);

// Preserve the demo's relative imports and fonts. There is only one playground
// implementation: the same HTML served by `npm run demo` is published with docs.
await rm(output, { recursive: true, force: true });
await mkdir(new URL('demo/', output), { recursive: true });
await Promise.all([
  cp(new URL('demo/index.html', repository), new URL('demo/index.html', output)),
  cp(new URL('dist/', repository), new URL('dist/', output), { recursive: true }),
  cp(new URL('assets/fonts/', repository), new URL('assets/fonts/', output), { recursive: true }),
]);
console.log('Prepared the complete chart demo for the documentation site.');
