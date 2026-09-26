import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BAR_SPACING,
  MIN_BAR_SPACING,
  PriceScale,
  TimeScale,
  niceStep,
  priceTicks,
  seriesMinMax,
  visibleMinMax,
} from '../dist/core/scale.js';
import { initWasm } from '../dist/wasm/loader.js';
import type { Candle } from '../dist/core/data.js';

function candle(time: number, low: number, high: number): Candle {
  return { time, open: low, high, low, close: high };
}

describe('TimeScale', () => {
  it('visibleRange is empty without data or width', () => {
    const s = new TimeScale(6, 0);
    assert.deepEqual(s.visibleRange(100), { from: 0, to: 0 });
    s.setViewport(300);
    assert.deepEqual(s.visibleRange(0), { from: 0, to: 0 });
  });
  it('visibleRange shows the tail when scrolled to the present', () => {
    const s = new TimeScale(10, 100);
    const r = s.visibleRange(50);
    assert.equal(r.to, 50);
    assert.ok(r.from >= 38 && r.from <= 40);
  });
  it('indexToX and xToIndex round-trip', () => {
    const s = new TimeScale(8, 400);
    for (const i of [0, 10, 49]) {
      assert.equal(s.xToIndex(s.indexToX(i, 50), 50), i);
    }
  });
  it('xToFloatIndex is the exact fractional inverse of indexToX', () => {
    const s = new TimeScale(8, 400);
    for (const i of [0, 10.5, 49]) {
      assert.ok(Math.abs(s.xToFloatIndex(s.indexToX(i, 50), 50) - i) < 1e-9);
    }
    s.scroll(5, 50);
    assert.ok(Math.abs(s.xToFloatIndex(s.indexToX(20, 50), 50) - 20) < 1e-9);
  });
  it('indexToX shifts bars right (latest off-screen) when scrolled back', () => {
    const s = new TimeScale(8, 400);
    const before = s.indexToX(49, 50);
    s.scroll(5, 50);
    assert.ok(s.indexToX(49, 50) > before);
    // The newest visible bar sits at the right edge.
    assert.equal(s.indexToX(44, 50), 400 - 4);
  });
  it('zoom clamps to min and max spacing', () => {
    const s = new TimeScale(6, 400);
    s.zoom(0.0000001, 100);
    assert.equal(s.barSpacing, MIN_BAR_SPACING);
    s.zoom(10000000, 100);
    assert.equal(s.barSpacing, MAX_BAR_SPACING);
    const unchanged = s.barSpacing;
    s.zoom(10000000, 100);
    assert.equal(s.barSpacing, unchanged);
  });
  it('zoom keeps the bar under the anchor stationary', () => {
    const s = new TimeScale(10, 500);
    const anchorX = 250;
    const idxBefore = s.xToIndex(anchorX, 100);
    s.zoom(1.5, 100, anchorX);
    const xAfter = s.indexToX(idxBefore, 100);
    assert.ok(Math.abs(xAfter - anchorX) < s.barSpacing);
  });
  it('zoom without anchor keeps the right edge', () => {
    const s = new TimeScale(10, 500);
    s.zoom(2, 100);
    assert.equal(s.barSpacing, 20);
    assert.equal(s.scrollOffset, 0);
  });
  it('scroll clamps at both ends', () => {
    const s = new TimeScale(10, 100);
    s.scroll(1000, 50);
    assert.equal(s.scrollOffset, 49);
    s.scroll(-100000, 50);
    assert.ok(s.scrollOffset <= 0);
  });
  it('scrollTo positions a bar at the right edge', () => {
    const s = new TimeScale(10, 100);
    s.scrollTo(20, 50);
    assert.equal(s.visibleRange(50).to, 21);
  });
  it('setViewport rejects negative widths', () => {
    const s = new TimeScale(6, 100);
    s.setViewport(-50);
    assert.equal(s.width, 0);
  });
});

describe('PriceScale', () => {
  it('priceToY/yToPrice round-trip', () => {
    const s = new PriceScale();
    s.height = 200;
    s.setRange(10, 20);
    for (const p of [10, 15, 20]) {
      assert.ok(Math.abs(s.yToPrice(s.priceToY(p)) - p) < 1e-9);
    }
    assert.ok(s.priceToY(20) < s.priceToY(10));
  });
  it('pads a degenerate range', () => {
    const s = new PriceScale();
    s.setRange(100, 100);
    assert.ok(s.minPrice < 100 && s.maxPrice > 100);
  });
  it('pads a degenerate zero range', () => {
    const s = new PriceScale();
    s.setRange(0, 0);
    assert.deepEqual([s.minPrice, s.maxPrice], [-1, 1]);
  });
  it('handles inverted and non-finite ranges', () => {
    const s = new PriceScale();
    s.setRange(20, 10);
    assert.equal(s.minPrice, 10);
    assert.equal(s.maxPrice, 20);
    s.setRange(NaN, 5);
    assert.deepEqual([s.minPrice, s.maxPrice], [0, 1]);
    s.setRange(0, Infinity);
    assert.deepEqual([s.minPrice, s.maxPrice], [0, 1]);
  });
  it('ticks returns values inside the range', () => {
    const s = new PriceScale();
    s.setRange(3, 97);
    const ticks = s.ticks(6);
    assert.ok(ticks.length >= 2);
    assert.ok(ticks.every((t) => t >= 3 && t <= 97.0001));
  });
});

describe('niceStep / priceTicks', () => {
  it('picks 1/2/5 steps', () => {
    assert.equal(niceStep(0.09), 0.05);
    assert.equal(niceStep(0.15), 0.1);
    assert.equal(niceStep(3), 2);
    assert.equal(niceStep(9), 5);
    assert.equal(niceStep(50), 50);
  });
  it('handles invalid input', () => {
    assert.equal(niceStep(0), 1);
    assert.equal(niceStep(NaN), 1);
  });
  it('generates nice ticks and normalizes -0', () => {
    const ticks = priceTicks(-0.5, 0.5, 4);
    assert.ok(ticks.includes(0));
    assert.ok(!Object.is(ticks.find((t) => t === 0), -0));
  });
  it('edge cases return degenerate results', () => {
    assert.deepEqual(priceTicks(5, 5, 6), [5]);
    assert.deepEqual(priceTicks(5, 1, 6), []);
    assert.deepEqual(priceTicks(0, 10, 0), []);
    assert.deepEqual(priceTicks(NaN, 10, 5), []);
  });
});

describe('visibleMinMax', () => {
  const candles = [candle(1, 10, 20), candle(2, 5, 15), candle(3, 8, 25)];
  it('scalar path finds low/high over the window', () => {
    assert.deepEqual(visibleMinMax(candles, 0, 3, null), { min: 5, max: 25 });
    assert.deepEqual(visibleMinMax(candles, 1, 2, null), { min: 5, max: 15 });
  });
  it('clamps the window to the array', () => {
    assert.deepEqual(visibleMinMax(candles, -5, 99, null), { min: 5, max: 25 });
  });
  it('returns a default range for an empty window', () => {
    assert.deepEqual(visibleMinMax(candles, 2, 2, null), { min: 0, max: 1 });
    assert.deepEqual(visibleMinMax([], 0, 10, null), { min: 0, max: 1 });
  });
  it('wasm path matches the scalar path', async () => {
    const kernels = await initWasm();
    assert.ok(kernels !== null);
    assert.deepEqual(visibleMinMax(candles, 0, 3, kernels), { min: 5, max: 25 });
    assert.deepEqual(visibleMinMax(candles, 0, 0, kernels), { min: 0, max: 1 });
  });
});

describe('seriesMinMax', () => {
  it('finds extrema skipping nulls and NaNs', () => {
    assert.deepEqual(seriesMinMax([null, 3, NaN, -2, null], 0, 5), { min: -2, max: 3 });
  });
  it('returns null when nothing is defined', () => {
    assert.equal(seriesMinMax([null, null], 0, 2), null);
    assert.equal(seriesMinMax([], 0, 0), null);
  });
  it('clamps the window', () => {
    assert.deepEqual(seriesMinMax([100, 3, -2, 1000], 1, 3), { min: -2, max: 3 });
  });
});
