import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../dist/core/data.js';
import { initWasm, type WasmKernels } from '../dist/wasm/loader.js';
import {
  BUILTIN_INDICATORS,
  IndicatorRegistry,
  bollIndicator,
  createIndicatorRegistry,
  emaIndicator,
  emaValues,
  kdjIndicator,
  kdjValues,
  macdIndicator,
  rsiIndicator,
  rsiValues,
  smaIndicator,
  smaValues,
  stddevValues,
  volIndicator,
} from '../dist/indicators/index.js';

function closesToCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: i, open: c, high: c + 1, low: c - 1, close: c, volume: 100 * (i + 1) }));
}

const CLOSE_EPS = 1e-12;

function assertSeries(actual: readonly (number | null)[], expected: readonly (number | null)[], eps = 1e-6): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    const e: number | null | undefined = expected[i];
    const a: number | null | undefined = actual[i];
    if (e === null || e === undefined) {
      assert.equal(a ?? null, null, `index ${i}`);
    } else {
      assert.ok(a !== null && a !== undefined && Math.abs(a - e) < eps, `index ${i}: expected ${e}, got ${a}`);
    }
  }
}

describe('indicator registry', () => {
  it('pre-loads the built-ins', () => {
    const registry = createIndicatorRegistry();
    for (const name of ['boll', 'ema', 'kdj', 'macd', 'rsi', 'sma', 'vol']) assert.ok(registry.has(name), name);
    assert.deepEqual(registry.names(), BUILTIN_INDICATORS.map((def) => def.name));
  });
  it('can be created empty and accept custom indicators', () => {
    const registry = createIndicatorRegistry(false);
    assert.equal(registry.names().length, 0);
    registry.register(smaIndicator);
    assert.ok(registry.has('sma'));
    assert.equal(registry.get('sma'), smaIndicator);
    assert.equal(registry.unregister('sma'), true);
    assert.equal(registry.unregister('sma'), false);
  });
  it('register overwrites and chains', () => {
    const registry = new IndicatorRegistry();
    assert.equal(registry.register(smaIndicator).register(emaIndicator), registry);
    assert.equal(registry.names().length, 2);
  });
});

describe('sma', () => {
  const candles = closesToCandles([1, 2, 3, 4, 5]);
  it('scalar matches hand-computed values', () => {
    assertSeries(smaValues([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4], CLOSE_EPS);
  });
  it('handles degenerate periods and short series', () => {
    assertSeries(smaValues([1, 2], 5), [null, null]);
    assertSeries(smaValues([1, 2], 0), [null, null]);
    assertSeries(smaValues([7], 1), [7]);
  });
  it('wasm path matches scalar path', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const def = smaIndicator;
    const scalar = def.compute(candles, { period: 3 }, [], null).lines[0]?.values ?? [];
    const wasm = def.compute(candles, { period: 3 }, [], kernels).lines[0]?.values ?? [];
    assertSeries(wasm as (number | null)[], scalar as (number | null)[], 1e-6);
  });
  it('uses default period/color fallbacks and custom colors', () => {
    const out = smaIndicator.compute(candles, {}, [], null);
    assert.equal(out.pane, 'main');
    assert.equal(out.lines[0]?.color, '#2962ff');
    const custom = smaIndicator.compute(candles, { period: 2.9 }, ['#123456'], null);
    assert.equal(custom.lines[0]?.color, '#123456');
    assertSeries(custom.lines[0]?.values ?? [], [null, 1.5, 2.5, 3.5, 4.5]);
  });
});

describe('ema', () => {
  const candles = closesToCandles([1, 2, 3, 4, 5]);
  it('scalar matches hand-computed values (k=0.5, SMA seed)', () => {
    assertSeries(emaValues([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4], CLOSE_EPS);
  });
  it('handles degenerate input', () => {
    assertSeries(emaValues([1], 3), [null]);
    assertSeries(emaValues([1, 2], 0), [null, null]);
  });
  it('wasm path matches scalar path', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const scalar = emaIndicator.compute(candles, { period: 3 }, [], null).lines[0]?.values ?? [];
    const wasm = emaIndicator.compute(candles, { period: 3 }, [], kernels).lines[0]?.values ?? [];
    assertSeries(wasm as (number | null)[], scalar as (number | null)[], 1e-6);
  });
  it('applies color fallback and override', () => {
    assert.equal(emaIndicator.compute(candles, {}, [], null).lines[0]?.color, '#ff6d00');
    assert.equal(emaIndicator.compute(candles, {}, ['#abcdef'], null).lines[0]?.color, '#abcdef');
  });
});

describe('boll', () => {
  it('matches hand-computed mid/upper/lower', () => {
    const out = bollIndicator.compute(closesToCandles([1, 2, 3, 4, 5]), { period: 3, mult: 2 }, [], null);
    const std = Math.sqrt(2 / 3);
    const mid = out.lines.find((l) => l.key === 'mid');
    const upper = out.lines.find((l) => l.key === 'upper');
    const lower = out.lines.find((l) => l.key === 'lower');
    assertSeries(mid?.values ?? [], [null, null, 2, 3, 4]);
    assertSeries(upper?.values ?? [], [null, null, 2 + 2 * std, 3 + 2 * std, 4 + 2 * std]);
    assertSeries(lower?.values ?? [], [null, null, 2 - 2 * std, 3 - 2 * std, 4 - 2 * std]);
  });
  it('stddevValues handles degenerate input and constant windows', () => {
    assertSeries(stddevValues([1, 2], 5), [null, null]);
    assertSeries(stddevValues([1, 2], 0), [null, null]);
    assertSeries(stddevValues([7, 7, 7], 2), [null, 0, 0], CLOSE_EPS);
  });
  it('uses default params and colors', () => {
    const out = bollIndicator.compute(closesToCandles([1, 2, 3]), {}, [], null);
    assert.equal(out.lines.length, 3);
    assert.deepEqual(
      out.lines.map((l) => l.color),
      ['#2962ff', '#ab47bc', '#ab47bc'],
    );
    const custom = bollIndicator.compute(closesToCandles([1, 2, 3]), {}, ['#1', '#2', '#3'], null);
    assert.deepEqual(
      custom.lines.map((l) => l.color),
      ['#1', '#2', '#3'],
    );
  });
});

describe('macd', () => {
  // For closes 1..10 with fast=2, slow=3, signal=2:
  //   emaFast[i] = i + 0.5 (i >= 1), emaSlow[i] = i (i >= 2)
  //   dif[i] = 0.5 (i >= 2); dea[i] = 0.5 (i >= 3); hist[i] = 0 (i >= 3)
  const candles = closesToCandles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  it('matches hand-computed DIF/DEA/histogram', () => {
    const out = macdIndicator.compute(candles, { fast: 2, slow: 3, signal: 2 }, [], null);
    const dif = out.lines.find((l) => l.key === 'dif');
    const dea = out.lines.find((l) => l.key === 'dea');
    assertSeries(dif?.values ?? [], [null, null, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    assertSeries(dea?.values ?? [], [null, null, null, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    assertSeries(out.bars?.values ?? [], [null, null, null, 0, 0, 0, 0, 0, 0, 0], CLOSE_EPS);
    assert.equal(out.pane, 'sub');
    assert.ok((out.bars?.up ?? []).every(Boolean));
  });
  it('handles series shorter than the slow period', () => {
    const out = macdIndicator.compute(closesToCandles([1, 2]), { fast: 2, slow: 3, signal: 2 }, [], null);
    assert.ok((out.lines[0]?.values ?? []).every((v) => v === null));
  });
  it('histogram direction flips with sign', () => {
    // Falling closes make DIF negative once established.
    const out = macdIndicator.compute(closesToCandles([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), {}, [], null);
    const hist = out.bars?.values ?? [];
    const up = out.bars?.up ?? [];
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      if (h != null && h !== 0) assert.equal(up[i], h > 0);
    }
  });
  it('clamps slow > fast and applies color fallbacks', () => {
    const out = macdIndicator.compute(candles, { fast: 5, slow: 2 }, [], null);
    assert.ok(out.lines[0] !== undefined);
    assert.equal(out.bars?.upColor, '#26a69a');
    assert.equal(out.bars?.downColor, '#ef5350');
    const custom = macdIndicator.compute(candles, {}, ['#1', '#2', '#3', '#4'], null);
    assert.equal(custom.lines[0]?.color, '#1');
    assert.equal(custom.lines[1]?.color, '#2');
    assert.equal(custom.bars?.upColor, '#3');
    assert.equal(custom.bars?.downColor, '#4');
  });
});

describe('rsi', () => {
  it('matches hand-computed Wilder smoothing', () => {
    // changes: +2,-1,+2,-1  period=2
    assertSeries(
      rsiValues([1, 3, 2, 4, 3], 2),
      [null, null, 100 - 100 / 3, 100 - 100 / 7, 100 - 100 / 2.2],
    );
  });
  it('is 100 for strictly rising and 0 for strictly falling series', () => {
    assertSeries(rsiValues([1, 2, 3, 4], 2), [null, null, 100, 100]);
    assertSeries(rsiValues([4, 3, 2, 1], 2), [null, null, 0, 0]);
  });
  it('handles degenerate input', () => {
    assertSeries(rsiValues([1, 2], 5), [null, null]);
    assertSeries(rsiValues([1], 0), [null]);
  });
  it('computes via the indicator definition with colors', () => {
    const out = rsiIndicator.compute(closesToCandles([1, 2, 3, 4]), { period: 2 }, [], null);
    assert.equal(out.pane, 'sub');
    assert.equal(out.lines[0]?.color, '#7e57c2');
    assertSeries(out.lines[0]?.values ?? [], [null, null, 100, 100]);
    assert.equal(rsiIndicator.compute(closesToCandles([1]), {}, ['#999'], null).lines[0]?.color, '#999');
  });
});

describe('kdj', () => {
  // n=2; c0: h2 l1 close1.5; c1: h3 l1 close3; c2: h4 l2 close2
  const candles: Candle[] = [
    { time: 0, open: 1.5, high: 2, low: 1, close: 1.5 },
    { time: 1, open: 3, high: 3, low: 1, close: 3 },
    { time: 2, open: 2, high: 4, low: 2, close: 2 },
  ];
  it('matches hand-computed K/D/J', () => {
    const { k, d, j } = kdjValues(candles, 2);
    const k1 = (2 / 3) * 50 + (1 / 3) * 100; // rsv = 100
    const d1 = (2 / 3) * 50 + (1 / 3) * k1;
    const rsv2 = ((2 - 1) / (4 - 1)) * 100;
    const k2 = (2 / 3) * k1 + (1 / 3) * rsv2;
    const d2 = (2 / 3) * d1 + (1 / 3) * k2;
    assertSeries(k, [null, k1, k2]);
    assertSeries(d, [null, d1, d2]);
    assertSeries(j, [null, 3 * k1 - 2 * d1, 3 * k2 - 2 * d2]);
  });
  it('rsv is 50 on flat windows', () => {
    const flat: Candle[] = [0, 1, 2].map((t) => ({ time: t, open: 5, high: 5, low: 5, close: 5 }));
    const { k } = kdjValues(flat, 2);
    assertSeries(k, [null, 50, 50]);
  });
  it('handles degenerate input', () => {
    const { k, d, j } = kdjValues(candles.slice(0, 1), 5);
    assertSeries(k, [null]);
    assertSeries(d, [null]);
    assertSeries(j, [null]);
    assertSeries(kdjValues(candles, 0).k, [null, null, null]);
  });
  it('computes via the definition with color fallbacks and overrides', () => {
    const out = kdjIndicator.compute(candles, { period: 2 }, [], null);
    assert.deepEqual(
      out.lines.map((l) => l.key),
      ['k', 'd', 'j'],
    );
    assert.deepEqual(
      out.lines.map((l) => l.color),
      ['#2962ff', '#ff6d00', '#ab47bc'],
    );
    const custom = kdjIndicator.compute(candles, {}, ['#a', '#b', '#c'], null);
    assert.deepEqual(
      custom.lines.map((l) => l.color),
      ['#a', '#b', '#c'],
    );
  });
});

describe('vol', () => {
  it('maps volumes with direction colors', () => {
    const candles: Candle[] = [
      { time: 0, open: 1, high: 2, low: 0.5, close: 2, volume: 10 },
      { time: 1, open: 2, high: 2.5, low: 1, close: 1.5, volume: 20 },
      { time: 2, open: 1, high: 1.5, low: 0.5, close: 1 },
    ];
    const out = volIndicator.compute(candles, {}, [], null);
    assert.equal(out.pane, 'sub');
    assert.deepEqual(out.bars?.values, [10, 20, 0]);
    assert.deepEqual(out.bars?.up, [true, false, true]);
    assert.equal(out.bars?.upColor, '#26a69a');
    assert.equal(out.bars?.downColor, '#ef5350');
    assert.equal(out.lines.length, 0);
    const custom = volIndicator.compute(candles, {}, ['#0f0', '#f00'], null);
    assert.equal(custom.bars?.upColor, '#0f0');
    assert.equal(custom.bars?.downColor, '#f00');
  });
});
