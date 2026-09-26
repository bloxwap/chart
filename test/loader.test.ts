import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64, detectSimd, initWasm } from '../dist/wasm/loader.js';

describe('decodeBase64', () => {
  it('decodes without padding', () => {
    assert.deepEqual([...decodeBase64('aGVsbG8')], [...Buffer.from('hello')]);
  });
  it('decodes with = and == padding and whitespace', () => {
    assert.deepEqual([...decodeBase64('aGVsbG8=')], [...Buffer.from('hello')]);
    assert.deepEqual([...decodeBase64('aGVsbG93b3JsZA==')], [...Buffer.from('helloworld')]);
    assert.deepEqual([...decodeBase64('aGVs\nbG8=\t')], [...Buffer.from('hello')]);
  });
  it('decodes empty input', () => {
    assert.equal(decodeBase64('').length, 0);
  });
  it('throws on invalid characters', () => {
    assert.throws(() => decodeBase64('a!b'), /invalid base64 character/);
  });
});

describe('detectSimd', () => {
  it('detects SIMD support in the test engine', () => {
    assert.equal(detectSimd(), true);
  });
  it('rejects an invalid probe module', () => {
    assert.equal(detectSimd(new Uint8Array([1, 2, 3])), false);
  });
});

describe('initWasm', () => {
  it('returns working SIMD kernels', async () => {
    const k = await initWasm();
    assert.ok(k !== null);
    assert.equal(k.usingSimd, true);
  });
  it('minmax reduces over f32 arrays', async () => {
    const k = await initWasm();
    assert.ok(k !== null);
    assert.deepEqual(k.minmax(Float32Array.from([3, 1, 4, 1, 5, 9, 2, 6])), { min: 1, max: 9 });
    // Exercise the scalar tail (length not divisible by 4).
    assert.deepEqual(k.minmax(Float32Array.from([7, -2, 10])), { min: -2, max: 10 });
    // Empty input yields NaN pair.
    const empty = k.minmax(new Float32Array(0));
    assert.ok(Number.isNaN(empty.min) && Number.isNaN(empty.max));
    // Single element.
    assert.deepEqual(k.minmax(Float32Array.from([42])), { min: 42, max: 42 });
  });
  it('grows memory for large inputs', async () => {
    const k = await initWasm();
    assert.ok(k !== null);
    const big = new Float32Array(100_000);
    big[50_000] = -1;
    big[99_999] = 999;
    assert.deepEqual(k.minmax(big), { min: -1, max: 999 });
  });
  it('sma matches the textbook sliding average', async () => {
    const k = await initWasm();
    assert.ok(k !== null);
    const out = k.sma(Float32Array.from([1, 2, 3, 4, 5]), 3);
    assert.ok(Number.isNaN(out[0] ?? 0));
    assert.ok(Number.isNaN(out[1] ?? 0));
    assert.ok(Math.abs((out[2] ?? 0) - 2) < 1e-6);
    assert.ok(Math.abs((out[4] ?? 0) - 4) < 1e-6);
    // len < period: all NaN.
    const short = k.sma(Float32Array.from([1, 2]), 5);
    assert.ok([...short].every((v) => Number.isNaN(v)));
  });
  it('ema matches SMA-seeded exponential smoothing', async () => {
    const k = await initWasm();
    assert.ok(k !== null);
    const out = k.ema(Float32Array.from([1, 2, 3, 4, 5]), 3);
    assert.ok(Number.isNaN(out[1] ?? 0));
    assert.ok(Math.abs((out[2] ?? 0) - 2) < 1e-6); // SMA(1,2,3) = 2
    assert.ok(Math.abs((out[3] ?? 0) - 3) < 1e-6); // 4*0.5 + 2*0.5
    assert.ok(Math.abs((out[4] ?? 0) - 4) < 1e-6);
    const short = k.ema(Float32Array.from([1]), 4);
    assert.ok(Number.isNaN(short[0] ?? 0));
  });
  it('returns null when SIMD is forced off (JS fallback path)', async () => {
    assert.equal(await initWasm({ forceNoSimd: true }), null);
  });
  it('returns null when the SIMD probe fails (simulated legacy engine)', async () => {
    assert.equal(await initWasm({ probeBytes: new Uint8Array([9, 9, 9]) }), null);
  });
  it('returns null for a corrupt module', async () => {
    assert.equal(await initWasm({ moduleBytes: new Uint8Array([0, 1, 2, 3]) }), null);
  });
});
