import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initWasm } from '../dist/wasm/loader.js';

describe('WASM moving-average precision', () => {
  it('keeps SMA and EMA within f32 output rounding throughout a long high-price walk', async () => {
    const kernels = await initWasm();
    assert.ok(kernels !== null);
    const closes = new Float32Array(1_000_000);
    let seed = 7;
    let price = 60_000;
    for (let i = 0; i < closes.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      price += (seed / 2 ** 32 - 0.5) * 4;
      closes[i] = price;
    }

    const period = 20;
    const k = 2 / (period + 1);
    const sma = kernels.sma(closes, period);
    const ema = kernels.ema(closes, period);
    assert.ok(sma instanceof Float32Array && ema instanceof Float32Array);
    for (let i = 0; i < period - 1; i++) {
      assert.ok(Number.isNaN(sma[i]));
      assert.ok(Number.isNaN(ema[i]));
    }
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i]!;
    let prev = sum / period;
    assert.equal(ema[period - 1], Math.fround(prev));

    // Check each 200k-bar segment independently, so later segments must obey
    // the same rounding bound as the beginning (no length-dependent drift).
    const smaErrors = new Float64Array(5);
    const emaErrors = new Float64Array(5);
    for (let i = period - 1; i < closes.length; i++) {
      if (i >= period) {
        sum += closes[i]! - closes[i - period]!;
        prev = closes[i]! * k + prev * (1 - k);
      }
      const segment = Math.floor(i / 200_000);
      smaErrors[segment] = Math.max(smaErrors[segment]!, Math.abs(sma[i]! - sum / period));
      emaErrors[segment] = Math.max(emaErrors[segment]!, Math.abs(ema[i]! - prev));
    }
    // The entire walk stays between 32768 and 65536, where half an f32 ULP
    // is 2^-9. Allow a tiny margin for the f64 reference arithmetic.
    for (let segment = 0; segment < 5; segment++) {
      assert.ok(smaErrors[segment]! <= 2 ** -9 + 1e-9,
        `SMA segment ${segment}: max error ${smaErrors[segment]}`);
      assert.ok(emaErrors[segment]! <= 2 ** -9 + 1e-9,
        `EMA segment ${segment}: max error ${emaErrors[segment]}`);
    }
  });
});
