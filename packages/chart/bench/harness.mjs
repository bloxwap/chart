import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Point at a saved build to compare the exact same workloads before/after.
const dist = process.env.CHART_BENCH_DIST
  ? pathToFileURL(`${resolve(process.env.CHART_BENCH_DIST)}/`)
  : new URL('../dist/', import.meta.url);
export const load = (path) => import(new URL(path, dist).href);

export function candles(count) {
  return Array.from({ length: count }, (_, i) => {
    const base = 100 + Math.sin(i / 25) * 20 + Math.cos(i / 7) * 3;
    return { time: 1700000000 + i * 60, open: base, high: base + 1.5, low: base - 1.5,
      close: base + (i % 2 ? -0.4 : 0.4), volume: 1000 + (i % 500) };
  });
}

export function bench(label, fn, minMs = 120) {
  for (let i = 0; i < 5; i++) fn();
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    let ops = 0;
    do { fn(); ops++; } while (performance.now() - start < minMs);
    samples.push((performance.now() - start) / ops);
  }
  samples.sort((a, b) => a - b);
  const median = samples[2];
  console.log(`${label.padEnd(43)} ${median.toFixed(4).padStart(10)} ms/op`);
  return median;
}
