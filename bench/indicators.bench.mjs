/**
 * Indicator math benchmark: SMA/EMA/MACD over 100k candles, WASM vs scalar JS.
 * Reports ops/sec (one "op" = one full indicator computation over the series).
 *
 * Includes JS→WASM marshalling in indicator timings. The minmax comparison
 * separates object-to-f32 conversion from resident-data kernel throughput;
 * the chart uses the scalar object scan to retain full price precision.
 */
import { performance } from 'node:perf_hooks';
import { initWasm } from '../dist/wasm/loader.js';
import { smaIndicator, emaIndicator, macdIndicator } from '../dist/indicators/index.js';
import { visibleMinMax } from '../dist/core/scale.js';

const N = 100_000;
const candles = Array.from({ length: N }, (_, i) => {
  const base = 100 + Math.sin(i / 50) * 20 + (i % 97) * 0.01;
  return { time: 1700000000 + i * 60, open: base, high: base + 1.5, low: base - 1.5, close: base + 0.4, volume: 1000 + (i % 500) };
});

function bench(label, fn, minMs = 600) {
  // warmup
  fn();
  const start = performance.now();
  let ops = 0;
  while (performance.now() - start < minMs) {
    fn();
    ops++;
  }
  const elapsed = performance.now() - start;
  const opsPerSec = (ops / elapsed) * 1000;
  console.log(`${label.padEnd(34)} ${opsPerSec.toFixed(1).padStart(12)} ops/sec  (${ops} ops in ${elapsed.toFixed(0)}ms)`);
  return opsPerSec;
}

const kernels = await initWasm();
console.log(`indicator bench: ${N.toLocaleString()} candles, SIMD kernels ${kernels ? 'available' : 'UNAVAILABLE (scalar only)'}\n`);

bench('sma(20) scalar', () => smaIndicator.compute(candles, { period: 20 }, [], null));
if (kernels) bench('sma(20) wasm (incl. marshal)', () => smaIndicator.compute(candles, { period: 20 }, [], kernels));
bench('ema(20) scalar', () => emaIndicator.compute(candles, { period: 20 }, [], null));
if (kernels) bench('ema(20) wasm (incl. marshal)', () => emaIndicator.compute(candles, { period: 20 }, [], kernels));
bench('macd(12,26,9) scalar', () => macdIndicator.compute(candles, {}, [], null));

if (kernels) {
  console.log('\nobject candle minmax comparison (100k candles):');
  bench('visibleMinMax scalar', () => visibleMinMax(candles, 0, N, null));
  bench('visibleMinMax wasm SIMD', () => visibleMinMax(candles, 0, N, kernels));

  // Pure kernel throughput with data already resident in wasm memory.
  const { decodeBase64 } = await import('../dist/wasm/loader.js');
  const { KERNELS_BASE64 } = await import('../dist/wasm/kernels.base64.js');
  const bytes = decodeBase64(KERNELS_BASE64);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  const raw = instance.exports;
  raw.memory.grow(Math.ceil((N * 8) / 65536) - 1);
  const buf = new Float32Array(raw.memory.buffer, 0, N * 2);
  for (let i = 0; i < N; i++) {
    buf[i] = candles[i].low;
    buf[N + i] = candles[i].high;
  }
  const jsMinmax = () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < N * 2; i++) {
      const v = buf[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  };
  console.log('\nminmax kernel only (data resident, 200k f32):');
  bench('scalar JS loop', jsMinmax);
  bench('wasm SIMD kernel', () => raw.minmax_f32(0, N * 2));
  bench('wasm scalar kernel', () => raw.minmax_f32_scalar(0, N * 2));
}
