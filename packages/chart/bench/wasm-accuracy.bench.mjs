// Run after build:ts: node packages/chart/bench/wasm-accuracy.bench.mjs
// Period 20, f32-rounded random walk; references use f64 arithmetic.
import { initWasm } from '../dist/wasm/loader.js';
const kernels = await initWasm();
if (kernels === null) throw new Error('WASM SIMD kernels unavailable');
console.log({ node: process.version, bars: 1_000_000, period: 20, seed: 7 });
const data = new Float32Array(1_000_000);
let seed = 7, price = 60_000;
for (let i = 0; i < data.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  price += (seed / 2 ** 32 - 0.5) * 4;
  data[i] = price;
}
const period = 20, k = 2 / (period + 1);
for (const name of ['sma', 'ema']) {
  const out = kernels[name](data, period);
  let sum = 0, prev = 0, error = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) sum += data[i];
    else sum += data[i] - data[i - period];
    if (i < period - 1) continue;
    prev = i === period - 1 ? sum / period : data[i] * k + prev * (1 - k);
    error = Math.max(error, Math.abs(out[i] - (name === 'sma' ? sum / period : prev)));
  }
  for (let i = 0; i < 10; i++) kernels[name](data, period);
  const batches = [];
  for (let batch = 0; batch < 5; batch++) {
    const start = performance.now();
    for (let i = 0; i < 20; i++) kernels[name](data, period);
    batches.push(performance.now() - start);
  }
  console.log(name, { error, median20RunsMs: batches.sort((a, b) => a - b)[2], batches });
}
