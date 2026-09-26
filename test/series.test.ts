import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import {
  SERIES_RENDERERS,
  drawArea,
  drawBars,
  drawCandlesticks,
  drawHistogram,
  drawHistogramBars,
  drawLine,
} from '../dist/series/index.js';

const candles: Candle[] = [
  { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 }, // up
  { time: 1, open: 11, high: 11.5, low: 8, close: 8.5, volume: 200 }, // down
  { time: 2, open: 8.5, high: 13, low: 8, close: 12 }, // up, no volume
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

describe('SERIES_RENDERERS', () => {
  it('registers all five types', () => {
    assert.deepEqual(Object.keys(SERIES_RENDERERS).sort(), ['area', 'bar', 'candlestick', 'histogram', 'line']);
  });
});

describe('drawCandlesticks', () => {
  it('draws a wick and body per candle, colored by direction', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawCandlesticks(ctx, candles, FULL, ts, ps, cfg());
    // 3 candles × 2 fillRect (wick + body).
    assert.equal(ctx.countCalls('fillRect'), 6);
    const styles = ctx.calls.filter((c) => c[0] === 'fillRect').map(() => ctx.fillStyle);
    assert.ok(styles.length > 0);
  });
  it('honors wick color overrides', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawCandlesticks(ctx, candles, FULL, ts, ps, cfg({ wickUpColor: '#0f0', wickDownColor: '#f00' }));
    const fills = ctx.callsNamed('fillRect');
    assert.ok(fills.length === 6);
  });
  it('skips an empty range', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawCandlesticks(ctx, candles, EMPTY, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillRect'), 0);
  });
});

describe('drawLine', () => {
  it('strokes one polyline through closes', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawLine(ctx, candles, FULL, ts, ps, cfg({ lineColor: '#123456', lineWidth: 3 }));
    assert.equal(ctx.countCalls('beginPath'), 1);
    assert.equal(ctx.countCalls('moveTo'), 1);
    assert.equal(ctx.countCalls('lineTo'), 2);
    assert.equal(ctx.countCalls('stroke'), 1);
  });
  it('no-ops on an empty range', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawLine(ctx, candles, EMPTY, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });
});

describe('drawArea', () => {
  it('fills to the baseline and strokes the line', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawArea(ctx, candles, FULL, ts, ps, cfg({ areaFillColor: '#2962ff', areaFillOpacity: 0.5 }));
    assert.equal(ctx.countCalls('fill'), 1);
    assert.equal(ctx.countCalls('stroke'), 1);
    assert.equal(ctx.countCalls('closePath'), 1);
  });
  it('no-ops on an empty range', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawArea(ctx, candles, EMPTY, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });
});

describe('drawBars', () => {
  it('strokes one path per candle', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, FULL, ts, ps, cfg());
    assert.equal(ctx.countCalls('stroke'), 3);
    assert.equal(ctx.countCalls('moveTo'), 9);
    assert.equal(ctx.countCalls('lineTo'), 9);
  });
  it('skips an empty range', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawBars(ctx, candles, EMPTY, ts, ps, cfg());
    assert.equal(ctx.countCalls('stroke'), 0);
  });
});

describe('drawHistogram / drawHistogramBars', () => {
  it('draws volume bars colored by direction', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    ps.setRange(0, 300);
    drawHistogram(ctx, candles, FULL, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillRect'), 3);
  });
  it('falls back to histogramColor when downColor is empty', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    ps.setRange(0, 300);
    drawHistogram(ctx, candles, FULL, ts, ps, cfg({ downColor: '', histogramColor: '#abcabc' }));
    assert.equal(ctx.countCalls('fillRect'), 3);
  });
  it('skips null/NaN bars and picks down color', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    ps.setRange(-10, 10);
    drawHistogramBars(ctx, [5, null, NaN, -3], [true, true, true, false], { from: 0, to: 4 }, ts, ps, '#0f0', '#f00');
    assert.equal(ctx.countCalls('fillRect'), 2);
  });
});

describe('animated live price geometry', () => {
  it('uses the visual last price across price series while keeping earlier bars unchanged', () => {
    const { ts, ps } = makeScales();
    const visual = { ...candles[2], open: 8.75, high: 12, low: 8.25, close: 10 };
    const expected = [...candles.slice(0, 2), visual];
    for (const draw of [drawCandlesticks, drawBars, drawLine, drawArea]) {
      const animated = new MockContext2D(), reference = new MockContext2D();
      draw(animated, candles, FULL, ts, ps, cfg(), visual);
      draw(reference, expected, FULL, ts, ps, cfg());
      assert.deepEqual(animated.calls, reference.calls);
      animated.calls.length = 0; reference.calls.length = 0;
      const history = { from: 0, to: 2 };
      draw(animated, candles, history, ts, ps, cfg(), visual);
      draw(reference, candles, history, ts, ps, cfg());
      assert.deepEqual(animated.calls, reference.calls);
    }
    assert.equal(candles[2].close, 12);
  });
});
