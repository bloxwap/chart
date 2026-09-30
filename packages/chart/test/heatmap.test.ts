import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { DepthBook, DepthLevel } from '../dist/core/depth.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';
import {
  DepthHistory,
  heatmapIntensity,
  heatPosition,
  DEFAULT_HEATMAP_BUCKET_MS,
  DEFAULT_HEATMAP_MAX_BUCKETS,
  DEFAULT_HEATMAP_MAX_LEVELS,
} from '../dist/core/heatmap.js';
import { resolveConfig } from '../dist/config.js';
import {
  attachHeatmap,
  createHeatmapPrimitive,
  heatmapRamp,
  HEATMAP_RAMP_STEPS,
} from '../dist/render/heatmap.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';

function book(time: number, overrides: Partial<DepthBook> = {}): DepthBook {
  return {
    bids: [[99, 1], [98, 2], [97, 4]],
    asks: [[100, 2], [101, 4], [102, 8]],
    time,
    ...overrides,
  };
}

describe('DepthHistory', () => {
  it('buckets books by wall clock and keeps the newest book of a bucket', () => {
    const history = new DepthHistory({ bucketMs: 1000 });
    assert.ok(history.record(book(1000)));
    assert.ok(history.record(book(1400, { bids: [[99, 9]] })));
    assert.equal(history.length, 1);
    assert.deepEqual(history.at(0)!.time, 1000);
    assert.deepEqual(history.at(0)!.bids, [[99, 9]]);
    assert.ok(history.record(book(2000)));
    assert.equal(history.length, 2);
  });

  it('ignores repeat deliveries of one book and out-of-order books', () => {
    const history = new DepthHistory({ bucketMs: 1000 });
    assert.ok(history.record(book(2000)));
    assert.equal(history.record(book(2000, { bids: [[99, 9]] })), false);
    assert.equal(history.record(book(1500)), false);
    assert.equal(history.length, 1);
    assert.equal(history.record(null), false);
  });

  it('evicts the oldest bucket past maxBuckets', () => {
    const history = new DepthHistory({ bucketMs: 1000, maxBuckets: 3 });
    for (let t = 1000; t <= 5000; t += 1000) history.record(book(t));
    assert.equal(history.length, 3);
    assert.deepEqual([0, 1, 2].map((i) => history.at(i)!.time), [3000, 4000, 5000]);
  });

  it('trims levels to maxLevels and drops invalid ones, copying the arrays', () => {
    const bids: DepthLevel[] = [[99, 1], [98, 0], [NaN, 2], [97, 3], [96, 4]];
    const history = new DepthHistory({ bucketMs: 1000, maxLevels: 2 });
    history.record(book(1000, { bids }));
    assert.deepEqual(history.at(0)!.bids, [[99, 1], [97, 3]]);
    bids.push([95, 5]);
    assert.equal(history.at(0)!.bids.length, 2);
  });

  it('finds the first bucket at or after a time', () => {
    const history = new DepthHistory({ bucketMs: 1000 });
    for (let t = 1000; t <= 5000; t += 1000) history.record(book(t));
    assert.equal(history.firstAtOrAfter(0), 0);
    assert.equal(history.firstAtOrAfter(2500), 2);
    assert.equal(history.firstAtOrAfter(3000), 2);
    assert.equal(history.firstAtOrAfter(9000), 5);
  });

  it('re-grids future records and evicts on configure', () => {
    const history = new DepthHistory({ bucketMs: 1000, maxBuckets: 4 });
    for (let t = 1000; t <= 4000; t += 1000) history.record(book(t));
    history.configure({ maxBuckets: 2 });
    assert.equal(history.length, 2);
    history.configure({ bucketMs: 500 });
    assert.ok(history.record(book(4300)));
    assert.equal(history.at(history.length - 1)!.time, 4000);
    assert.equal(history.bucketStart(4300), 4000);
  });

  it('ignores a newer book that a coarser grid would bucket before the last bucket', () => {
    const history = new DepthHistory({ bucketMs: 500 });
    assert.ok(history.record(book(1700))); // bucket 1500
    history.configure({ bucketMs: 1000 });
    assert.equal(history.record(book(1800)), false); // bucket 1000 < 1500
    assert.equal(history.length, 1);
    assert.equal(history.at(0)!.time, 1500);
  });

  it('clears the window', () => {
    const history = new DepthHistory();
    history.record(book(1000));
    history.clear();
    assert.equal(history.length, 0);
    assert.ok(history.record(book(500))); // lastBookTime resets too
  });
});

describe('heatmapIntensity', () => {
  it('is the size over the max, curved by gamma and clamped to 1', () => {
    assert.equal(heatmapIntensity(5, 10, 1), 0.5);
    assert.equal(heatmapIntensity(10, 10, 0.5), 1);
    assert.ok(Math.abs(heatmapIntensity(5, 10, 0.5) - Math.sqrt(0.5)) < 1e-12);
    assert.equal(heatmapIntensity(20, 10, 1), 1);
  });

  it('is zero without a positive size or normalizer', () => {
    assert.equal(heatmapIntensity(0, 10, 1), 0);
    assert.equal(heatmapIntensity(5, 0, 1), 0);
    assert.equal(heatmapIntensity(5, NaN, 1), 0);
  });
});

describe('heatPosition', () => {
  const data: Candle[] = [100, 160, 220].map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

  it('interpolates linearly in candle time between neighbors', () => {
    assert.equal(heatPosition(data, null, 100_000), 0);
    assert.equal(heatPosition(data, null, 130_000), 0.5);
    assert.equal(heatPosition(data, null, 220_000), 2);
  });

  it('extrapolates past the last candle along the last interval and is null before the first', () => {
    assert.equal(heatPosition(data, null, 280_000), 3);
    assert.equal(heatPosition(data, null, 99_000), null);
    assert.equal(heatPosition([], null, 100_000), null);
  });

  it('maps to slots on a continuous axis, so a gap spans its full slot count', () => {
    const slots = [0, 1, 4]; // one bar, then a three-slot gap
    assert.equal(heatPosition(data, slots, 190_000), 2.5);
    assert.equal(heatPosition(data, slots, 100_000), 0);
    assert.equal(heatPosition(data, slots, 280_000), 5); // one slot per interval past the data
  });

  it('does not extrapolate past a lone candle, which has no interval', () => {
    assert.equal(heatPosition(data.slice(0, 1), null, 190_000), 0);
  });

  it('pins to the left candle when its neighbor has no usable time', () => {
    const ragged = [data[0]!, { ...data[1]!, time: NaN }, data[2]!];
    assert.equal(heatPosition(ragged, null, 150_000), 0);
  });
});

describe('heatmapRamp', () => {
  it('ramps alpha 0 → opacity over the color lerp', () => {
    const ramp = heatmapRamp('#000000', '#ffffff', 0.5);
    assert.equal(ramp.length, HEATMAP_RAMP_STEPS);
    assert.equal(ramp[0], 'rgba(0, 0, 0, 0)');
    assert.equal(ramp[HEATMAP_RAMP_STEPS - 1], 'rgba(255, 255, 255, 0.5)');
  });

  it('falls back to the defaults for unparseable colors', () => {
    const ramp = heatmapRamp('nope', '#ffffff', 1);
    assert.equal(ramp[0], 'rgba(41, 98, 255, 0)');
    const high = heatmapRamp('#000000', 'nope', 1);
    assert.equal(high[HEATMAP_RAMP_STEPS - 1], 'rgb(255, 213, 79)');
  });

  it('turns Display-P3 when either endpoint is Display-P3', () => {
    const ramp = heatmapRamp('#000000', 'color(display-p3 1 1 1)', 1);
    assert.ok(ramp.every((step) => step.startsWith('color(display-p3')));
    assert.equal(ramp[HEATMAP_RAMP_STEPS - 1], heatmapRamp('color(display-p3 0 0 0)', 'color(display-p3 1 1 1)', 1)[HEATMAP_RAMP_STEPS - 1]);
  });
});

function candles(n: number, start = 1700000000, step = 60): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 10,
  }));
}

function fakeTarget(data: Candle[], width = 640, height = 400, min = 90, max = 110): PrimitiveDrawTarget {
  const priceScale = new PriceScale();
  priceScale.height = height;
  priceScale.setRange(min, max);
  const timeScale = new TimeScale(6, width);
  return {
    width,
    height,
    priceScale,
    timeScale,
    range: { from: 0, to: data.length },
    candles: data,
    pixelRatio: 1,
  };
}

describe('createHeatmapPrimitive', () => {
  it('records the book into time buckets on draw and paints cells behind the series', () => {
    const data = candles(10);
    const current = book(data[0]!.time * 1000);
    const ctx = new MockContext2D();
    const primitive = createHeatmapPrimitive(() => current);
    assert.equal(primitive.zOrder, 'behind');
    primitive.draw(ctx, fakeTarget(data));
    assert.equal(primitive.history.length, 1);
    assert.equal(primitive.visibleMax, 8);
    const fills = ctx.callsNamed('fillRect');
    assert.ok(fills.length > 0);
    // The one bucket sits at bar 0: x = 640 - (10 - 1 - 0) * 6 - 3 = 583.
    assert.ok(fills.every((c) => c[1] === 583));
    assert.ok(fills.every((c) => (c[2] as number) >= 0 && (c[2] as number) < 400));
  });

  it('paints one column per bucket at bar-indexed x positions', () => {
    const data = candles(10);
    const t0 = data[0]!.time * 1000;
    let current = book(t0);
    const primitive = createHeatmapPrimitive(() => current);
    const ctx = new MockContext2D();
    primitive.draw(ctx, fakeTarget(data));
    current = book(t0 + 60_000); // bar 1's bucket
    primitive.draw(ctx, fakeTarget(data));
    assert.equal(primitive.history.length, 2);
    const xs = new Set(ctx.callsNamed('fillRect').map((c) => c[1]));
    assert.ok(xs.has(583));
    assert.ok(xs.has(589)); // 583 + 6px of bar spacing
  });

  it('dedupes repeat renders of one book and replaces within a bucket', () => {
    const data = candles(10);
    const t0 = data[0]!.time * 1000;
    let current = book(t0);
    const primitive = createHeatmapPrimitive(() => current);
    primitive.draw(new MockContext2D(), fakeTarget(data));
    primitive.draw(new MockContext2D(), fakeTarget(data));
    assert.equal(primitive.history.length, 1);
    current = book(t0 + 100, { bids: [[99, 9]] });
    primitive.draw(new MockContext2D(), fakeTarget(data));
    assert.equal(primitive.history.length, 1);
    assert.equal(primitive.visibleMax, 9);
  });

  it('draws nothing without a book or outside the visible price range', () => {
    const data = candles(10);
    const t0 = data[0]!.time * 1000;
    const empty = createHeatmapPrimitive(() => null);
    const ctx = new MockContext2D();
    empty.draw(ctx, fakeTarget(data));
    assert.equal(ctx.countCalls('fillRect'), 0);
    assert.equal(empty.visibleMax, 0);
    const far = createHeatmapPrimitive(() => book(t0, { bids: [[50, 5]], asks: [[150, 5]] }));
    const ctx2 = new MockContext2D();
    far.draw(ctx2, fakeTarget(data));
    assert.equal(ctx2.countCalls('fillRect'), 0);
    assert.equal(far.visibleMax, 0);
  });

  it('aggregates sub-pixel buckets per pixel column instead of overpainting', () => {
    const data = candles(10);
    const t0 = data[0]!.time * 1000;
    let current = book(t0);
    // 100ms buckets: 60 of them share bar 0's 6px column span.
    const primitive = createHeatmapPrimitive(() => current, { bucketMs: 100 });
    const target = fakeTarget(data);
    primitive.draw(new MockContext2D(), target);
    for (let t = 100; t < 1000; t += 100) {
      current = book(t0 + t);
      primitive.draw(new MockContext2D(), target);
    }
    assert.equal(primitive.history.length, 10);
    const ctx = new MockContext2D();
    primitive.draw(ctx, target);
    const xs = new Set(ctx.callsNamed('fillRect').map((c) => c[1]));
    assert.ok(xs.size <= 6, `expected ≤6 pixel columns, got ${xs.size}`);
  });

  it('respects a caller-supplied history', () => {
    const data = candles(10);
    const history = new DepthHistory({ bucketMs: 1000, maxBuckets: 2 });
    const t0 = data[0]!.time * 1000;
    let current = book(t0);
    const primitive = createHeatmapPrimitive(() => current, { history });
    primitive.draw(new MockContext2D(), fakeTarget(data));
    current = book(t0 + 1000);
    primitive.draw(new MockContext2D(), fakeTarget(data));
    current = book(t0 + 2000);
    primitive.draw(new MockContext2D(), fakeTarget(data));
    assert.equal(history.length, 2);
    assert.equal(history.at(0)!.time, t0 + 1000);
  });

  it('places buckets by slot on a continuous axis, and by bar index when the slots do not fit the data', () => {
    const data = candles(10);
    const current = book(data[0]!.time * 1000);
    const continuous = fakeTarget(data);
    continuous.timeScale.setSlots(data.map((_, i) => i * 2));
    const ctx = new MockContext2D();
    createHeatmapPrimitive(() => current).draw(ctx, continuous);
    // Bar 0 at slot 0 of 18: x = 640 - (18 - 0) * 6 - 3 = 529.
    assert.ok(ctx.callsNamed('fillRect').every((c) => c[1] === 529));
    const stale = fakeTarget(data);
    stale.timeScale.setSlots([0, 2, 4]);
    const ctx2 = new MockContext2D();
    createHeatmapPrimitive(() => current).draw(ctx2, stale);
    assert.ok(ctx2.callsNamed('fillRect').every((c) => c[1] === 583));
  });

  it('skips buckets before the first candle and stops at the first one past the right edge', () => {
    const data = candles(10);
    const t0 = data[0]!.time * 1000;
    const history = new DepthHistory({ bucketMs: 1000 });
    history.record(book(t0 - 500)); // left of the data: no position
    history.record(book(t0));
    history.record(book(t0 + 20 * 60_000)); // bar 20: x = 640 + 11 * 6 - 3, off the right edge
    const primitive = createHeatmapPrimitive(() => null, { history });
    const ctx = new MockContext2D();
    primitive.draw(ctx, fakeTarget(data));
    const fills = ctx.callsNamed('fillRect');
    assert.ok(fills.length > 0);
    assert.ok(fills.every((c) => c[1] === 583), 'only the bar-0 bucket paints');
  });

  it('uses the bar spacing as the column width for a lone candle', () => {
    const data = candles(1);
    const ctx = new MockContext2D();
    createHeatmapPrimitive(() => book(data[0]!.time * 1000)).draw(ctx, fakeTarget(data));
    const fills = ctx.callsNamed('fillRect');
    assert.ok(fills.length > 0);
    // x = 640 - 0 - 3 = 637, flushed with the 6px bar spacing.
    assert.ok(fills.every((c) => c[1] === 637 && c[3] === 6));
  });

  it('leaves levels too small to reach the first ramp step unpainted', () => {
    const data = candles(10);
    const ctx = new MockContext2D();
    const primitive = createHeatmapPrimitive(() => book(data[0]!.time * 1000, { bids: [[99, 1e-6]], asks: [[100, 8]] }));
    primitive.draw(ctx, fakeTarget(data));
    const bidY = fakeTarget(data).priceScale.priceToY(99);
    const fills = ctx.callsNamed('fillRect');
    assert.ok(fills.length > 0);
    assert.ok(fills.every((c) => !((c[2] as number) <= bidY && bidY < (c[2] as number) + (c[4] as number))), 'the bid band stays empty');
  });

  it('paints a zero-height band as one pixel row', () => {
    const data = candles(10);
    const flat = { ...fakeTarget(data), priceScale: { priceToY: () => 200 } as unknown as PriceScale };
    const ctx = new MockContext2D();
    createHeatmapPrimitive(() => book(data[0]!.time * 1000)).draw(ctx, flat);
    const fills = ctx.callsNamed('fillRect');
    assert.equal(fills.length, 1);
    assert.deepEqual(fills[0]!.slice(1), [583, 200, 1, 1]);
  });
});

describe('attachHeatmap', () => {
  function chartWith(config: Record<string, unknown> = {}) {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(50), width: 640, height: 400, ...config } });
    return { doc, chart };
  }

  function liveBook(chart: ReturnType<typeof createChart>): DepthBook {
    const last = chart.getData().at(-1)!;
    return book(last.time * 1000);
  }

  it('attaches a behind primitive painting depth history on setDepth', () => {
    const { doc, chart } = chartWith();
    const api = attachHeatmap(chart);
    assert.equal(api.primitive.zOrder, 'behind');
    const ctx = doc.created[0]!.context;
    const before = ctx.countCalls('fillRect');
    chart.setDepth(liveBook(chart));
    assert.ok(ctx.countCalls('fillRect') > before);
    assert.equal(api.history.length, 1);
    api.remove();
    chart.destroy();
  });

  it('follows config heatmap writes while attached', () => {
    const { chart } = chartWith();
    const api = attachHeatmap(chart);
    chart.setDepth(liveBook(chart));
    assert.equal(api.history.length, 1);
    assert.doesNotThrow(() => chart.updateConfig({ heatmap: { opacity: 0.3, gamma: 1, colorHigh: '#ff0000' } }));
    chart.updateConfig({ heatmap: { maxBuckets: 1 } });
    assert.equal(api.history.maxBuckets, 1);
    api.update({ bucketMs: 60_000 });
    assert.equal(api.history.bucketMs, 60_000);
    api.remove();
    chart.destroy();
  });

  it('attaches and removes with the config heatmap.enabled flag', () => {
    const { doc, chart } = chartWith({ heatmap: { enabled: true } });
    const ctx = doc.created[0]!.context;
    chart.setDepth(liveBook(chart));
    const drawn = ctx.countCalls('fillRect');
    assert.ok(drawn > 0);
    // While disabled a setDepth render adds only the candle redraw, no cells.
    chart.updateConfig({ heatmap: { enabled: false } });
    let base = ctx.countCalls('fillRect');
    chart.setDepth({ ...liveBook(chart), time: liveBook(chart).time + 1000 });
    const disabledDelta = ctx.countCalls('fillRect') - base;
    chart.updateConfig({ heatmap: { enabled: true } });
    base = ctx.countCalls('fillRect');
    chart.setDepth({ ...liveBook(chart), time: liveBook(chart).time + 2000 });
    const enabledDelta = ctx.countCalls('fillRect') - base;
    assert.ok(enabledDelta > disabledDelta);
    chart.destroy();
  });

  it('re-enabling starts a fresh history', () => {
    const { chart } = chartWith({ heatmap: { enabled: true } });
    chart.setDepth(liveBook(chart));
    chart.updateConfig({ heatmap: { enabled: false } });
    chart.updateConfig({ heatmap: { enabled: true } });
    chart.setDepth({ ...liveBook(chart), time: liveBook(chart).time + 1000 });
    chart.destroy();
  });

  it('destroys cleanly', () => {
    const { chart } = chartWith({ heatmap: { enabled: true } });
    chart.setDepth(liveBook(chart));
    assert.doesNotThrow(() => chart.destroy());
  });
});

describe('heatmap config', () => {
  it('defaults to disabled with the documented grid and ramp knobs', () => {
    const heatmap = resolveConfig().heatmap;
    assert.equal(heatmap.enabled, false);
    assert.equal(heatmap.bucketMs, DEFAULT_HEATMAP_BUCKET_MS);
    assert.equal(heatmap.maxBuckets, DEFAULT_HEATMAP_MAX_BUCKETS);
    assert.equal(heatmap.maxLevels, DEFAULT_HEATMAP_MAX_LEVELS);
    assert.ok(heatmap.opacity > 0 && heatmap.opacity <= 1);
    assert.ok(heatmap.gamma > 0);
  });
});
