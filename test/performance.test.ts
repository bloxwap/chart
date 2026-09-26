import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/core/chart.js';
import { MockCanvas } from '../dist/dom.js';
import type { Canvas2DLike, ChartCanvas } from '../dist/dom.js';
import { DataStore, type Candle } from '../dist/core/data.js';
import { stddevValues } from '../dist/indicators/boll.js';
import { kdjValues } from '../dist/indicators/kdj.js';
import { createIndicatorRegistry } from '../dist/indicators/registry.js';
import type { IndicatorDef } from '../dist/indicators/types.js';
import { drawHistogram, drawHistogramBars } from '../dist/series/histogram.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { emaValues, emaWasm, smaValues, smaWasm, macdIndicator } from '../dist/indicators/index.js';
import { initWasm } from '../dist/wasm/loader.js';

const data = (n = 50): Candle[] => Array.from({ length: n }, (_, i) => ({
  time: i, open: 100 + i, close: 100.5 + i, high: 102 + i, low: 99 + i, volume: i,
}));

function fixture(wasm = false) {
  let computes = 0;
  const def: IndicatorDef = {
    name: 'counted', defaultParams: { period: 1 }, defaultColors: ['red'], defaultPane: 'main',
    compute(candles, params, colors) {
      computes++;
      return { pane: 'main', lines: [{ key: 'value', color: colors[0] ?? 'red',
        values: candles.map((c) => c.close * (params.period ?? 1)) }] };
    },
  };
  const canvas = new MockCanvas(800, 400);
  const chart = createChart({ container: canvas, registries: { indicators: createIndicatorRegistry(false).register(def) },
    config: { wasm, data: data(), indicators: [{ id: 'a', name: 'counted', params: { period: 1 }, colors: ['red'], pane: 'main', visible: true }] } });
  return { chart, canvas, def, count: () => computes };
}

describe('render work reuse', () => {
  it('reuses indicators across redraws, viewport, drawing and theme changes', () => {
    const { chart, canvas, count } = fixture();
    const originalData = chart.getConfig().data;
    assert.equal(chart.scale, chart.scale);
    chart.render();
    chart.setCrosshair(1, 2);
    chart.setCrosshair(1, 3);
    const before = canvas.context.calls.length;
    chart.setCrosshair(1, 3);
    assert.equal(canvas.context.calls.length, before);
    chart.clearCrosshair();
    const cleared = canvas.context.calls.length;
    chart.clearCrosshair();
    assert.equal(canvas.context.calls.length, cleared);
    chart.scale.zoom(1.1);
    chart.scale.scrollBy(5);
    chart.resize(600, 300);
    chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 120 }] });
    chart.updateConfig({ theme: { background: 'black' } });
    chart.updateConfig({ theme: undefined } as unknown as Parameters<typeof chart.updateConfig>[0]);
    assert.equal(chart.getConfig().data, originalData);
    assert.equal(count(), 1);
    chart.destroy();
    chart.setCrosshair(50, 20);
  });

  it('invalidates after replacement, insertion, historical correction and config data changes', () => {
    const { chart, count } = fixture();
    const input = data();
    chart.setData(input);
    chart.appendData({ ...input[49]!, close: 500 });
    chart.appendData({ ...input[20]!, close: 50 });
    chart.appendData({ ...input[20]!, time: 20.5 });
    chart.appendData({ ...input[49]!, time: 50 });
    chart.updateConfig({ data: data(20) });
    assert.equal(count(), 7);
    chart.render();
    assert.equal(count(), 7);
    chart.destroy();
  });

  it('invalidates changed parameters/colors, including in-place edits and nonfinite values', () => {
    const { chart, count } = fixture();
    const cfg = chart.getConfig().indicators[0]!;
    cfg.params.period = 2;
    chart.render();
    cfg.colors[0] = 'blue';
    chart.render();
    cfg.colors.push('green');
    chart.render();
    cfg.params.extra = 1;
    chart.render();
    delete cfg.params.extra;
    cfg.params.other = 1;
    chart.render();
    cfg.params.period = NaN;
    chart.render();
    chart.render(); // Object.is(NaN, NaN) must hit the cache.
    assert.equal(count(), 7);
    cfg.params.period = Infinity;
    chart.render();
    assert.equal(count(), 8);
    chart.destroy();
  });

  it('invalidates replaced definitions and compute functions and drops removed/hidden entries', () => {
    const { chart, def, count } = fixture();
    chart.indicators.register({ ...def });
    chart.render();
    chart.indicators.register(def);
    chart.render();
    const original = def.compute;
    def.compute = (...args) => original(...args);
    chart.render();
    assert.equal(count(), 4);
    chart.indicators.unregister(def.name);
    chart.render();
    chart.indicators.register(def);
    chart.render();
    const cfg = chart.getConfig().indicators[0]!;
    cfg.visible = false;
    chart.render();
    cfg.visible = true;
    chart.render();
    assert.equal(count(), 6);
    chart.removeIndicator('a');
    chart.addIndicator({ id: 'a', name: def.name });
    assert.equal(count(), 7);
    chart.destroy();
  });

  it('recomputes when WASM initialization finishes', async () => {
    const { chart, count } = fixture(true);
    assert.equal(count(), 1);
    await chart.ready;
    assert.equal(count(), 2);
    chart.render();
    assert.equal(count(), 2);
    chart.destroy();
  });

  it('keeps double-precision candle bounds after WASM initialization', async () => {
    const canvas = new MockCanvas(800, 400);
    const price = 1e12;
    const chart = createChart({ container: canvas, config: { wasm: true, data: [
      { time: 0, open: price, close: price + 0.1, high: price + 0.2, low: price - 0.2 },
    ] } });
    await chart.ready;
    assert.ok(chart.scale.priceToY(price - 0.2) - chart.scale.priceToY(price + 0.2) > 300);
    chart.destroy();
  });

  it('cached pointer frames exactly match a fresh full render, including drawing geometry', () => {
    const { chart, canvas } = fixture();
    let geometries = 0;
    chart.drawings.register({ name: 'expensive', minPoints: 1, geometry: (points, view) => {
      geometries++;
      return [{ type: 'text', text: 'marker', x: view.indexToX(points[0]!.index), y: view.priceToY(points[0]!.price) }];
    } });
    chart.addDrawing({ name: 'expensive', points: [{ index: 20, price: 120 }] });
    canvas.context.calls.length = 0;
    chart.setCrosshair(100, 120);
    const cachedCalls = [...canvas.context.calls];
    assert.equal(geometries, 1);
    canvas.context.calls.length = 0;
    chart.render();
    assert.deepEqual(canvas.context.calls, cachedCalls);
    assert.equal(geometries, 2);
    canvas.context.calls.length = 0;
    chart.batch(() => {
      chart.setCrosshair(101, 120);
      chart.setCrosshair(102, 120);
    });
    assert.equal(geometries, 2);
    assert.equal(canvas.context.countCalls('scale'), 1);
    canvas.width = 700;
    chart.setCrosshair(110, 120);
    canvas.height = 350;
    chart.setCrosshair(110, 130);
    assert.equal(geometries, 4);
    chart.destroy();
  });

  it('handles missing/restored contexts and invalidates prepared views when painting is unavailable', () => {
    const mock = new MockCanvas(800, 400);
    let context: Canvas2DLike | null = null;
    const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => context };
    const chart = createChart({ container: canvas, config: { wasm: false } });
    chart.setCrosshair(1, 1);
    context = mock.context;
    chart.setCrosshair(2, 1);
    context = null;
    chart.setCrosshair(3, 1);
    chart.setData(data());
    context = mock.context;
    chart.setCrosshair(4, 1);
    assert.ok(Number.isFinite(chart.scale.priceToY(120)));
    chart.destroy();
  });

  it('batches updates once, nests, returns values, and flushes even when the callback throws', () => {
    const { chart, canvas, count } = fixture();
    canvas.context.calls.length = 0;
    const answer = chart.batch(() => {
      chart.setCrosshair(5, 5);
      chart.batch(() => { chart.setData(data(5)); chart.appendData(data(6)[5]!); });
      chart.updateConfig({ series: { type: 'line' } });
      assert.equal(canvas.context.calls.length, 0);
      return 42;
    });
    assert.equal(answer, 42);
    assert.equal(canvas.context.countCalls('scale'), 1);
    assert.equal(count(), 2);
    const rendered = canvas.context.calls.length;
    chart.batch(() => {});
    assert.equal(canvas.context.calls.length, rendered);
    assert.throws(() => chart.batch(() => { chart.setData(data(3)); throw new Error('failure'); }), /failure/);
    assert.equal(chart.dataLength, 3);
    assert.equal(count(), 3);
    assert.equal(canvas.context.countCalls('scale'), 2);
    chart.destroy();
  });
});

function referenceStd(values: number[], period: number) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const window = values.slice(i - period + 1, i + 1);
    const origin = window[0]!;
    const shifted = window.map((v) => v - origin);
    const mean = shifted.reduce((sum, v) => sum + v, 0) / period;
    return Math.sqrt(shifted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
  });
}
function closeSeries(actual: readonly (number | null)[], expected: readonly (number | null)[]) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]!, b = expected[i]!;
    if (b === null || Number.isNaN(b)) assert.ok(Object.is(a, b), `index ${i}: ${a} vs ${b}`);
    else assert.ok(a !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `index ${i}: ${a} vs ${b}`);
  }
}

describe('linear rolling indicator accuracy', () => {
  it('preserves plain-array WASM helper inputs and detached results', async () => {
    const kernels = await initWasm();
    assert.ok(kernels);
    const closes = [1, 2, 3, 4, 5];
    const sma = smaWasm(closes, 3, kernels);
    const ema = emaWasm(closes, 3, kernels);
    closeSeries(sma, smaValues(closes, 3));
    closeSeries(ema, emaValues(closes, 3));
    kernels.sma(new Float32Array([10, 20, 30]), 1);
    closeSeries(sma, smaValues(closes, 3));
    closeSeries(ema, emaValues(closes, 3));
  });

  it('fused MACD matches separately computed fast, slow and signal EMAs', () => {
    const candles = data(1000).map((c, i) => ({ ...c, close: 100 + Math.sin(i * 0.1) * 50 }));
    const closes = candles.map((c) => c.close);
    for (const [fast, slow, signal] of [[1, 2, 1], [12, 26, 9], [30, 80, 20], [12, 26, 2000]]) {
      const f = emaValues(closes, fast!), s = emaValues(closes, slow!);
      const dif = f.map((v, i) => v === null || s[i] === null ? null : v - s[i]!);
      const tail = emaValues(dif.slice(slow! - 1) as number[], signal!);
      const dea = [...Array<null>(slow! - 1).fill(null), ...tail];
      const hist = dif.map((v, i) => v === null || dea[i] === null ? null : v - dea[i]!);
      const out = macdIndicator.compute(candles, { fast: fast!, slow: slow!, signal: signal! }, [], null);
      closeSeries(out.lines[0]!.values, dif);
      closeSeries(out.lines[1]!.values, dea);
      closeSeries(out.bars!.values, hist);
      assert.deepEqual(out.bars!.up, hist.map((v) => (v ?? 0) >= 0));
    }
  });

  it('matches independent window calculations across periods, high prices and flat/outlier transitions', () => {
    for (const base of [0, 1e12]) {
      const values = Array.from({ length: 1300 }, (_, i) => base + Math.sin(i * 0.13) * 0.03);
      for (const period of [1, 2, 3, 20, 127, 500]) closeSeries(stddevValues(values, period), referenceStd(values, period));
    }
    const transitions = [...Array<number>(100).fill(1e12), ...Array<number>(100).fill(1), ...Array<number>(100).fill(-1e12), ...Array<number>(100).fill(0)];
    for (const period of [3, 20, 127]) closeSeries(stddevValues(transitions, period), referenceStd(transitions, period));
  });

  it('limits nonfinite contamination to windows containing those values', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      for (const at of [0, 1, 3, 4, 8]) {
        const values = Array.from({ length: 30 }, (_, i) => i);
        values[at] = invalid;
        closeSeries(stddevValues(values, 4), referenceStd(values, 4));
      }
    }
    for (const p of [NaN, 1.5, -1, 0, Infinity, 4]) assert.deepEqual(stddevValues([1, 2, 3], p), [null, null, null]);
  });

  it('KDJ matches window scans for random, monotone, tied, missing and expiring extremes', () => {
    const inputs = [data(600), data(600).reverse(), data(600).map((c, i) => ({ ...c,
      low: Math.sin(i * 0.3), high: 2 + Math.cos(i * 0.7), close: 1 + Math.sin(i * 0.2) })),
      data(50).map((c, i) => ({ ...c, low: i % 3 ? 1 : NaN, high: i % 4 ? 3 : NaN, close: 2 })),
      data(20).map((c) => ({ ...c, low: NaN, high: NaN })),
    ];
    for (const candles of inputs) for (const n of [1, 2, 9, 40, 500]) {
      const expected = { k: Array<number | null>(candles.length).fill(null), d: Array<number | null>(candles.length).fill(null), j: Array<number | null>(candles.length).fill(null) };
      let pk = 50, pd = 50;
      for (let i = n - 1; i < candles.length; i++) {
        let low = Infinity, high = -Infinity;
        for (let j = i - n + 1; j <= i; j++) {
          if (candles[j]!.low < low) low = candles[j]!.low;
          if (candles[j]!.high > high) high = candles[j]!.high;
        }
        const rsv = high === low ? 50 : (candles[i]!.close - low) / (high - low) * 100;
        pk = 2 / 3 * pk + 1 / 3 * rsv;
        pd = 2 / 3 * pd + 1 / 3 * pk;
        expected.k[i] = pk; expected.d[i] = pd; expected.j[i] = 3 * pk - 2 * pd;
      }
      const actual = kdjValues(candles, n);
      for (const key of ['k', 'd', 'j'] as const) closeSeries(actual[key], expected[key]);
    }
    assert.deepEqual(kdjValues(data(2), 1.5).k, [null, null]);
  });
});

describe('bounded data and histogram work', () => {
  it('preserves duplicate-time first replacement and isolates sorted input arrays', () => {
    const store = new DataStore();
    const input = [data(1)[0]!, data(1)[0]!];
    store.setData(input);
    store.append({ ...input[0]!, close: 42 });
    assert.equal(store.at(0)!.close, 42);
    assert.equal(store.at(1)!.close, 100.5);
    assert.equal(input[0]!.close, 100.5);
    store.append({ ...input[0]!, time: 1 });
    store.append({ ...input[0]!, time: 1, close: 43 });
    assert.equal(store.length, 3);
    assert.equal(store.last()!.close, 43);
  });

  it('volume series only reads visible candles and matches histogram output', () => {
    const values = data(100);
    values[95] = { ...values[95]!, volume: NaN };
    values[96] = { ...values[96]!, open: 200 };
    const range = { from: 90, to: 100 };
    const ts = new TimeScale(6, 600), ps = new PriceScale();
    ps.height = 300; ps.setRange(0, 100);
    const actual = new MockCanvas(600, 300).context;
    const expected = new MockCanvas(600, 300).context;
    drawHistogramBars(expected, values.map((c) => c.volume ?? 0), values.map((c) => c.close >= c.open), range, ts, ps, DEFAULT_CONFIG.series.upColor, DEFAULT_CONFIG.series.downColor);
    const bounded = new Proxy(values, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) assert.ok(Number(key) >= range.from);
      return Reflect.get(target, key, receiver);
    } });
    drawHistogram(actual, bounded, range, ts, ps, DEFAULT_CONFIG.series);
    assert.deepEqual(actual.calls, expected.calls);
  });
});
