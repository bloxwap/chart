import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDependencies, checkTreeShaking, checkTsrs, checkLocks } from './invariants/checks.mjs';

const checks = { dependencies: checkDependencies, 'tree-shaking': checkTreeShaking, tsrs: checkTsrs, lockfiles: checkLocks };
// Optional root supports isolated negative fixtures without modifying the checkout.
const [name = 'all', root = fileURLToPath(new URL('..', import.meta.url))] = process.argv.slice(2);
try {
  if (name === 'all') for (const check of Object.values(checks)) check(resolve(root));
  else if (checks[name]) checks[name](resolve(root));
  else throw new Error(`chart-ts: unknown invariant check ${name}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
