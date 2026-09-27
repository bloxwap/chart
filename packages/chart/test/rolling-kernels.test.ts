import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initWasm, type WasmKernels } from '../dist/wasm/loader.js';
import { rollingMaxValues, rollingMinValues, rollingExtremes, smaSparseValues } from '../dist/indicators/rolling.js';

/** Naive window scan: the reference both implementations must match. */
function naive(values: ArrayLike<number>, period: number, pick: (a: number, b: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (period < 1 || i < period - 1 || period > values.length) {
      out.push(NaN);
      continue;
    }
    let acc = values[i - period + 1]!;
    for (let j = i - period + 2; j <= i; j++) acc = pick(acc, values[j]!);
    out.push(acc);
  }
  return out;
}

/** Deterministic pseudo-random f32-representable prices. */
function prices(n: number, seed = 7): Float32Array {
  let s = seed;
  const out = new Float32Array(n);
  let p = 100;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    p += (s / 2147483648 - 0.5) * 4;
    out[i] = p;
  }
  return out;
}

function same(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Object.is(actual[i], expected[i]) || (Number.isNaN(actual[i]) && Number.isNaN(expected[i])),
      `index ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}

describe('rolling max/min', () => {
  it('JS helpers match a naive window scan for every period, including partial last blocks', () => {
    const data = prices(37);
    for (let period = 1; period <= 38; period++) {
      same(rollingMaxValues(data, period), naive(data, period, Math.max));
      same(rollingMinValues(data, period), naive(data, period, Math.min));
    }
  });

  it('hand-computed windows, NaN warmup and floored periods', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    same(rollingMaxValues(values, 3), [NaN, NaN, 4, 4, 5, 9, 9, 9]);
    same(rollingMinValues(values, 3), [NaN, NaN, 1, 1, 1, 1, 2, 2]);
    same(rollingMaxValues(values, 2.9), rollingMaxValues(values, 2));
    same(rollingMaxValues(values, 1), values);
  });

  it('returns all-NaN for periods below 1, above the length or non-finite', () => {
    for (const period of [0, -3, 0.5, 9, NaN, Infinity]) {
      same(rollingMaxValues([1, 2, 3, 4, 5, 6, 7, 8], period), new Array(8).fill(NaN));
      same(rollingMinValues([1, 2, 3], period), [NaN, NaN, NaN]);
    }
    assert.equal(rollingMaxValues([], 1).length, 0);
  });

  it('NaN inputs poison exactly the windows that contain them', () => {
    const values = [1, 2, NaN, 4, 5, 6, 7];
    same(rollingMaxValues(values, 2), [NaN, 2, NaN, NaN, 5, 6, 7]);
    same(rollingMinValues(values, 3), [NaN, NaN, NaN, NaN, NaN, 4, 5]);
  });

  it('WASM kernels equal the JS helpers bit-for-bit on f32 inputs (selection only)', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    assert.ok(kernels !== null);
    for (const n of [1, 3, 4, 5, 17, 64, 1000]) {
      const data = prices(n, n);
      for (const period of [1, 2, 3, 4, 5, 7, 16, 52, n]) {
        same(kernels.rollingMax(data, period), rollingMaxValues(data, period));
        same(kernels.rollingMin(data, period), rollingMinValues(data, period));
      }
    }
  });

  it('WASM kernels share the JS edge semantics: NaN windows, degenerate periods, growth', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const withNaN = Float32Array.from([1, 2, NaN, 4, 5, 6, 7, 8, 9]);
    same(kernels.rollingMax(withNaN, 2), rollingMaxValues(withNaN, 2));
    same(kernels.rollingMin(withNaN, 3), rollingMinValues(withNaN, 3));
    for (const period of [0, -1, 0.5, 10, NaN, Infinity]) {
      same(kernels.rollingMax(withNaN, period), new Array(9).fill(NaN));
      same(kernels.rollingMin(withNaN, period), new Array(9).fill(NaN));
    }
    same(kernels.rollingMax(withNaN, 2.7), rollingMaxValues(withNaN, 2));
    assert.equal(kernels.rollingMax(new Float32Array(0), 1).length, 0);
    // Three f32 buffers of 50k values exceed the initial memory and force growth.
    const big = prices(50_000, 3);
    same(kernels.rollingMin(big, 200), rollingMinValues(big, 200));
    // Other kernels still work on the grown memory.
    assert.deepEqual(kernels.minmax(Float32Array.from([2, -1, 3])), { min: -1, max: 3 });
  });

  it('rollingExtremes picks WASM when kernels are given, JS otherwise', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const high = [10.1, 11.3, 12.7, 11.2], low = [9.1, 9.9, 10.3, 8.8];
    const js = rollingExtremes(high, low, 2, null);
    assert.ok(js.max instanceof Float64Array && js.min instanceof Float64Array);
    same(js.max, [NaN, 11.3, 12.7, 12.7]);
    same(js.min, [NaN, 9.1, 9.9, 8.8]);
    const wasm = rollingExtremes(high, low, 2, kernels);
    assert.ok(wasm.max instanceof Float32Array && wasm.min instanceof Float32Array);
    same(wasm.max, [NaN, Math.fround(11.3), Math.fround(12.7), Math.fround(12.7)]);
    same(wasm.min, [NaN, Math.fround(9.1), Math.fround(9.9), Math.fround(8.8)]);
  });
});

describe('smaSparseValues', () => {
  it('averages full windows and propagates gaps like TradingView na', () => {
    assert.deepEqual(smaSparseValues([1, 2, 3, 4, 5], 2), [null, 1.5, 2.5, 3.5, 4.5]);
    assert.deepEqual(smaSparseValues([null, 2, 4, null, 6, 8, NaN, 1], 2), [null, null, 3, null, null, 7, null, null]);
    // A one-bar window passes values through exactly (no running-sum residue).
    assert.deepEqual(smaSparseValues([0.1, 0.7, 0.2], 1), [0.1, 0.7, 0.2]);
    assert.deepEqual(smaSparseValues([1, 2], 2.8), [null, 1.5]);
    for (const period of [0, NaN, -2]) assert.deepEqual(smaSparseValues([1, 2], period), [null, null]);
    assert.deepEqual(smaSparseValues([1, 2], 5), [null, null]);
  });
});
