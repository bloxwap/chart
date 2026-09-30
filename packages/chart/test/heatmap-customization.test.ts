import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bloxwapDark, createChart, presetChartTheme, resolveConfig, DEFAULT_HEATMAP_MIN_OPACITY } from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { DepthBook } from '../dist/core/depth.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';
import { attachHeatmap, createHeatmapPrimitive, heatmapRamp, heatmapRampRGBA, HEATMAP_RAMP_STEPS } from '../dist/render/heatmap.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';

const LAST = HEATMAP_RAMP_STEPS - 1;
const t = (i: number) => i / LAST;

/** RGBA floats of step `i`. */
function step(lut: Float32Array, i: number): number[] {
  return Array.from(lut.subarray(i * 4, i * 4 + 4));
}

function close(actual: number[], expected: number[], message?: string): void {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) < 1e-6, `${message ?? ''} channel ${i}: ${v} vs ${expected[i]}`));
}

/** Records the fillStyle in force at each fillRect. */
class StyleContext extends MockContext2D {
  readonly fills: string[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push(String(this.fillStyle));
    super.fillRect(x, y, w, h);
  }
}

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ time: 1700000000 + i * 60, open: 100, high: 105, low: 95, close: 100, volume: 10 }));
}

function book(time: number): DepthBook {
  return { bids: [[99, 1], [98, 2], [97, 4]], asks: [[100, 2], [101, 4], [102, 8]], time };
}

function target(data: Candle[]): PrimitiveDrawTarget {
  const priceScale = new PriceScale();
  priceScale.height = 400;
  priceScale.setRange(90, 110);
  return { width: 640, height: 400, priceScale, timeScale: new TimeScale(6, 640), range: { from: 0, to: data.length }, candles: data, pixelRatio: 1 };
}

describe('heatmap ramp shaping', () => {
  it('keeps the two-color ramp unchanged without stops', () => {
    const plain = heatmapRamp('#000000', '#ffffff', 0.5);
    assert.deepEqual(heatmapRamp('#000000', '#ffffff', 0.5, {}), plain);
    assert.deepEqual(heatmapRamp('#000000', '#ffffff', 0.5, { stops: [] }), plain);
    assert.deepEqual(Array.from(heatmapRampRGBA('#000000', '#ffffff', 0.5, { stops: [] })), Array.from(heatmapRampRGBA('#000000', '#ffffff', 0.5)));
  });

  it('spreads bare stop colors evenly and replaces colorLow → colorHigh', () => {
    const lut = heatmapRampRGBA('#123456', '#654321', 1, { stops: ['#000000', '#ff0000', '#ffffff'] });
    close(step(lut, 0), [0, 0, 0, 0], 'first');
    close(step(lut, LAST), [1, 1, 1, 1], 'last');
    // Below the middle stop the ramp runs black → red; above it red → white.
    close(step(lut, 20), [t(20) * 2, 0, 0, t(20)], 'lower half');
    close(step(lut, 50), [1, (t(50) - 0.5) * 2, (t(50) - 0.5) * 2, t(50)], 'upper half');
  });

  it('pins stops with `at`, sorts them, and holds the end colors flat', () => {
    const lut = heatmapRampRGBA('#000000', '#ffffff', 1, {
      stops: [{ color: '#ffffff', at: 1 }, { color: '#ff0000', at: 0.5 }],
    });
    close(step(lut, 10), [1, 0, 0, t(10)], 'flat before the first stop');
    close(step(lut, LAST), [1, 1, 1, 1], 'last');
    const clamped = heatmapRampRGBA('#000000', '#ffffff', 1, { stops: [{ color: '#0000ff', at: -3 }, { color: '#00ff00', at: 9 }] });
    close(step(clamped, 0), [0, 0, 1, 0], 'at clamps to 0');
    close(step(clamped, LAST), [0, 1, 0, 1], 'at clamps to 1');
    const early = heatmapRampRGBA('#000000', '#ffffff', 1, { stops: [{ color: '#000000', at: 0 }, { color: '#ff0000', at: 0.5 }] });
    close(step(early, 50), [1, 0, 0, t(50)], 'flat after the last stop');
  });

  it('paints a single bare stop as one flat color', () => {
    const lut = heatmapRampRGBA('#000000', '#ffffff', 1, { stops: ['#00ff00'] });
    close(step(lut, 0), [0, 1, 0, 0]);
    close(step(lut, LAST), [0, 1, 0, 1]);
  });

  it('spreads stops without a usable `at` by index', () => {
    const lut = heatmapRampRGBA('#000000', '#ffffff', 1, {
      stops: [{ color: '#000000' }, { color: '#ffffff', at: Number.NaN }],
    });
    close(step(lut, 21), [t(21), t(21), t(21), t(21)]);
  });

  it('scales the ramp alpha by each stop color’s own alpha', () => {
    const lut = heatmapRampRGBA('#000000', '#ffffff', 0.8, { stops: ['rgba(255, 0, 0, 0)', 'rgba(255, 0, 0, 1)'] });
    close(step(lut, 32), [1, 0, 0, 0.8 * t(32) * t(32)]);
  });

  it('lifts the zero-intensity alpha to minOpacity and clamps both alphas', () => {
    const lut = heatmapRampRGBA('#000000', '#ffffff', 0.9, { minOpacity: 0.2 });
    assert.ok(Math.abs(step(lut, 0)[3]! - 0.2) < 1e-6);
    assert.ok(Math.abs(step(lut, LAST)[3]! - 0.9) < 1e-6);
    close([step(lut, 21)[3]!], [0.2 + 0.7 * t(21)]);
    const wild = heatmapRampRGBA('#000000', '#ffffff', 7, { minOpacity: -1 });
    assert.equal(step(wild, 0)[3], 0);
    assert.equal(step(wild, LAST)[3], 1);
    assert.equal(DEFAULT_HEATMAP_MIN_OPACITY, 0);
  });

  it('skips unparseable stops, falls back to the two colors, and paints a lone stop flat', () => {
    assert.deepEqual(heatmapRamp('#000000', '#ffffff', 1, { stops: ['nope', 'also-nope'] }), heatmapRamp('#000000', '#ffffff', 1));
    const lone = heatmapRampRGBA('#000000', '#ffffff', 1, { stops: ['bad', '#00ff00'] });
    close(step(lone, 0), [0, 1, 0, 0]);
    close(step(lone, 40), [0, 1, 0, t(40)]);
  });

  it('turns Display-P3 when any stop is Display-P3', () => {
    const ramp = heatmapRamp('#000000', '#ffffff', 1, { stops: ['#000000', 'color(display-p3 0 1 0)', '#ffffff'] });
    assert.ok(ramp.every((c) => c.startsWith('color(display-p3')));
  });
});

describe('heatmap customization through config and attach', () => {
  const stops = ['#000000', '#ff0000'];

  it('defaults to no stops and a transparent floor', () => {
    const { heatmap } = resolveConfig();
    assert.deepEqual(heatmap.stops, []);
    assert.equal(heatmap.minOpacity, 0);
  });

  it('paints primitive cells from the custom ramp', () => {
    const data = candles(10);
    const ctx = new StyleContext();
    createHeatmapPrimitive(() => book(data[0]!.time * 1000), { stops, minOpacity: 0.1, opacity: 1, gamma: 1 }).draw(ctx, target(data));
    const ramp = heatmapRamp('#2962ff', '#ffd54f', 1, { stops, minOpacity: 0.1 });
    assert.ok(ctx.fills.length > 0);
    assert.ok(ctx.fills.every((fill) => ramp.includes(fill)), 'every cell uses a step of the custom ramp');
    // The largest level (the 8-lot ask) reaches the top step.
    assert.ok(ctx.fills.includes(ramp[LAST]!));
  });

  it('follows config stops while attached through the chart', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(50), width: 640, height: 400 } });
    const ctx = new StyleContext();
    const canvas = doc.created[0]!;
    (canvas as unknown as { getContext: () => StyleContext }).getContext = () => ctx;
    const api = attachHeatmap(chart);
    const time = chart.getData().at(-1)!.time * 1000;
    chart.updateConfig({ heatmap: { stops, gamma: 1, opacity: 1 } });
    ctx.fills.length = 0;
    chart.setDepth(book(time));
    const ramp = heatmapRamp('#2962ff', '#ffd54f', 1, { stops });
    assert.ok(ctx.fills.includes(ramp[LAST]!), 'the heaviest level paints the custom top color');
    chart.updateConfig({ heatmap: { stops: [] } });
    ctx.fills.length = 0;
    chart.setDepth(book(time + 1000));
    assert.ok(ctx.fills.includes(heatmapRamp('#2962ff', '#ffd54f', 1)[LAST]!), 'clearing stops restores the two-color ramp');
    api.remove();
    chart.destroy();
  });
});

describe('bloxwapDark heatmap palette', () => {
  it('ships brand stops without enabling the heatmap', () => {
    assert.deepEqual(bloxwapDark.heatmap?.stops, [
      { color: '#404040', at: 0 },
      { color: '#737373', at: 0.4 },
      { color: '#ffc83d', at: 0.85 },
      { color: '#fffb38', at: 1 },
    ]);
    assert.equal(bloxwapDark.heatmap?.gamma, 1);
    const chart = createChart({ document: new MockDocument(), preset: 'bloxwapDark', config: { wasm: false } });
    assert.equal(chart.getConfig().heatmap.enabled, false);
    assert.equal(chart.getConfig().heatmap.stops.length, 4);
    chart.destroy();
  });

  it('keeps the palette on the preset theme and resets it on the other theme', () => {
    const chartTheme = presetChartTheme('bloxwapDark');
    assert.deepEqual(chartTheme('dark').heatmap, { stops: bloxwapDark.heatmap!.stops });
    assert.deepEqual(chartTheme('light').heatmap, { stops: [] });
  });
});
