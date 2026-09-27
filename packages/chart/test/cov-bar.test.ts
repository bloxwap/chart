import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { drawBars } from '../dist/series/index.js';

const candles: Candle[] = [
  { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 }, // up vs open
  { time: 1, open: 11, high: 11.5, low: 8, close: 8.5, volume: 200 }, // down vs open
  { time: 2, open: 8.5, high: 13, low: 8, close: 12 }, // up vs open
];

function makeScales(): { ts: TimeScale; ps: PriceScale } {
  const ts = new TimeScale(10, 300);
  const ps = new PriceScale();
  ps.height = 200;
  ps.setRange(8, 13);
  return { ts, ps };
}

function cfg(partial: Partial<SeriesConfig> = {}): SeriesConfig {
  return { ...DEFAULT_CONFIG.series, ...partial };
}

const FULL = { from: 0, to: 3 };
const EMPTY = { from: 0, to: 0 };

describe('drawBars coverage', () => {
  it('no-ops on an empty range (loop never entered)', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, EMPTY, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });

  it('colors by own open when colorByPreviousClose is false', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, FULL, ts, ps, cfg({ colorByPreviousClose: false }));
    assert.equal(ctx.countCalls('stroke'), 3);
    // Last candle (12 >= 8.5) uses upColor.
    assert.equal(ctx.strokeStyle, cfg().upColor);
  });

  it('uses own open for the first bar even when colorByPreviousClose is true', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    // i === 0: colorByPreviousClose truthy but i > 0 false, ref = open.
    drawBars(ctx, candles, { from: 0, to: 1 }, ts, ps, cfg({ colorByPreviousClose: true }));
    assert.equal(ctx.countCalls('stroke'), 1);
    assert.equal(ctx.strokeStyle, cfg().upColor); // close 11 >= open 10
  });

  it('colors later bars by previous close when colorByPreviousClose is true', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, FULL, ts, ps, cfg({ colorByPreviousClose: true }));
    assert.equal(ctx.countCalls('stroke'), 3);
    // Last bar: close 12 >= previous close 8.5 -> upColor.
    assert.equal(ctx.strokeStyle, cfg().upColor);
  });

  it('picks downColor when close is below the previous close', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    // Bar 1: close 8.5 < previous close 11 -> downColor.
    drawBars(ctx, candles, { from: 1, to: 2 }, ts, ps, cfg({ colorByPreviousClose: true }));
    assert.equal(ctx.countCalls('stroke'), 1);
    assert.equal(ctx.strokeStyle, cfg().downColor);
  });

  it('picks downColor when close is below the open and colorByPreviousClose is false', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, { from: 1, to: 2 }, ts, ps, cfg({ colorByPreviousClose: false }));
    assert.equal(ctx.strokeStyle, cfg().downColor);
  });

  it('uses the live candle for the last index when provided', () => {
    const ctx = new MockContext2D();
    const ref = new MockContext2D();
    const { ts, ps } = makeScales();
    const live: Candle = { time: 2, open: 9, high: 13, low: 8.5, close: 10 };
    drawBars(ctx, candles, FULL, ts, ps, cfg(), live);
    drawBars(ref, [...candles.slice(0, 2), live], FULL, ts, ps, cfg());
    assert.deepEqual(ctx.calls, ref.calls);
  });

  it('falls back to candles[i] when the live candle is undefined at the last index', () => {
    const ctx = new MockContext2D();
    const ref = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, FULL, ts, ps, cfg(), undefined);
    drawBars(ref, candles, FULL, ts, ps, cfg());
    assert.deepEqual(ctx.calls, ref.calls);
    assert.equal(ctx.countCalls('stroke'), 3);
  });

  it('clamps tick width to at least 1 for tiny bar spacing', () => {
    const ctx = new MockContext2D();
    const ps = new PriceScale();
    ps.height = 200;
    ps.setRange(8, 13);
    const ts = new TimeScale(1, 300); // barSpacing 1 -> floor(0.3) = 0 -> clamped to 1
    drawBars(ctx, candles, FULL, ts, ps, cfg());
    assert.equal(ctx.countCalls('stroke'), 3);
    assert.equal(ctx.countCalls('moveTo'), 9);
    assert.equal(ctx.countCalls('lineTo'), 9);
  });
});
