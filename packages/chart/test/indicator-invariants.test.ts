import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, visibleMinMax, type Chart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import { normalizeIndicatorParams } from '../dist/indicators/params.js';
import { createIndicatorRegistry, type IndicatorDef } from '../dist/indicators/index.js';
import { seriesMinMax } from '../dist/core/scale.js';
import { initWasm } from '../dist/wasm/loader.js';
import { smaCandleValues } from '../dist/indicators/sma.js';
import type { Candle } from '../dist/core/data.js';

const data: Candle[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 101 + i,
  volume: 10,
}));

function chart(): Chart {
  return createChart({ document: new MockDocument(), config: { wasm: false, data } });
}

describe('indicator params', () => {
  it('drops non-finite params back to defaults and clamps to the declared range (#97)', () => {
    const normalized = normalizeIndicatorParams(
      { defaultParams: { a: 1 }, inputs: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', integer: true, min: 1, max: 4 }] },
      { a: Number.POSITIVE_INFINITY, b: 2.6 },
    );
    assert.equal(normalized.a, 1);
    assert.equal(normalized.b, 3);
    const dropped = normalizeIndicatorParams(
      { defaultParams: {}, inputs: [{ key: 'b', label: 'B' }] },
      { b: Number.NaN },
    );
    assert.equal('b' in dropped, false);

    const c = chart();
    const boll = c.addIndicator({ name: 'boll', params: { mult: Number.POSITIVE_INFINITY, period: 1.2 } });
    assert.equal(c.getIndicator(boll)?.params.mult, 2);
    assert.equal(c.getIndicator(boll)?.params.period, 1);
    c.updateIndicator(boll, { params: { mult: -2 } });
    assert.equal(c.getIndicator(boll)?.params.mult, 0.001);
    const sma = c.addIndicator({ name: 'sma', params: { period: Number.NaN } });
    assert.equal(c.getIndicator(sma)?.params.period, 20);
    assert.equal(smaCandleValues(data, Number.NaN).length, data.length);
    const y = c.scale.priceToY(data[20]!.close);
    assert.ok(y >= 0 && y <= c.plotArea.height);
    c.destroy();

    const configured = createChart({
      document: new MockDocument(),
      config: {
        wasm: false,
        data,
        indicators: [{ id: 'b', name: 'boll', params: { mult: Number.NEGATIVE_INFINITY, period: 20 }, pane: 'main', colors: [], visible: true }],
      },
    });
    assert.equal(configured.getIndicator('b')?.params.mult, 2);
    configured.updateConfig({
      indicators: [{ id: 'b', name: 'boll', params: { mult: 80, period: 20 }, pane: 'main', colors: [], visible: true }],
    });
    assert.equal(configured.getIndicator('b')?.params.mult, 50);
    configured.destroy();
  });
});

describe('indicator output bounds', () => {
  it('ignores non-finite indicator values when autoscaling (#98)', () => {
    assert.deepEqual(seriesMinMax([1, Number.POSITIVE_INFINITY, null, Number.NaN, 3], 0, 5), { min: 1, max: 3 });
    const def: IndicatorDef = {
      name: 'inf',
      defaultParams: {},
      defaultColors: ['#fff'],
      defaultPane: 'main',
      compute: (candles) => ({
        pane: 'main',
        lines: [{ key: 'v', color: '#fff', values: candles.map(() => Number.POSITIVE_INFINITY) }],
        levels: [{ value: Number.POSITIVE_INFINITY, color: '#fff' }],
      }),
    };
    const c = createChart({
      document: new MockDocument(),
      registries: { indicators: createIndicatorRegistry(false).register(def) },
      config: { wasm: false, data },
    });
    c.addIndicator({ name: 'inf' });
    const y = c.scale.priceToY(data[10]!.close);
    assert.ok(y >= 0 && y <= c.plotArea.height);
    c.destroy();
  });
});

describe('wasm kernel guards', () => {
  it('returns NaN instead of trapping when sma or ema period is below 1 (#99)', async () => {
    const kernels = await initWasm();
    assert.ok(kernels);
    assert.equal(kernels.sma(new Float32Array(0), 0).length, 0);
    assert.equal(kernels.ema(new Float32Array(0), Number.NaN).length, 0);
    const sma = kernels.sma(Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8), 0);
    const ema = kernels.ema(Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8), Number.POSITIVE_INFINITY);
    assert.ok([...sma].every(Number.isNaN));
    assert.ok([...ema].every(Number.isNaN));
    const c = createChart({ document: new MockDocument(), config: { wasm: true, data: [] } });
    await c.ready;
    assert.doesNotThrow(() => c.addIndicator({ name: 'sma', params: { period: Number.NaN } }));
    c.render();
    c.destroy();
  });

  it('keeps visibleMinMax finite when a high is NaN and documents NaN minmax (#100)', async () => {
    const kernels = await initWasm();
    assert.ok(kernels);
    const mm = kernels.minmax(Float32Array.of(1, Number.NaN, 3, 4));
    assert.ok(Number.isNaN(mm.min) && Number.isNaN(mm.max));
    const candles = data.map((candle, i) => i === 3 ? { ...candle, high: Number.NaN } : candle);
    const scalar = visibleMinMax(candles, 0, candles.length, null);
    const simd = visibleMinMax(candles, 0, candles.length, kernels);
    assert.deepEqual(simd, scalar);
    assert.ok(Number.isFinite(simd.min) && Number.isFinite(simd.max));
    const lowNaN = data.map((candle, i) => i === 1 ? { ...candle, low: Number.NaN } : candle);
    assert.deepEqual(visibleMinMax(lowNaN, 0, lowNaN.length, kernels), visibleMinMax(lowNaN, 0, lowNaN.length, null));
  });
});
