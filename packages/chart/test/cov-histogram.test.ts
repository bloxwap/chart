import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { drawHistogram, drawHistogramBars } from '../dist/series/index.js';

function makeScales(): { ts: TimeScale; ps: PriceScale } {
  const ts = new TimeScale(10, 300);
  const ps = new PriceScale();
  ps.height = 200;
  ps.setRange(0, 300);
  return { ts, ps };
}

function cfg(partial: Partial<SeriesConfig> = {}): SeriesConfig {
  return { ...DEFAULT_CONFIG.series, ...partial };
}

describe('drawHistogram coverage gaps', () => {
  it('skips candles whose volume is NaN', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    const candles: Candle[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: NaN },
      { time: 1, open: 11, high: 12, low: 10, close: 11.5, volume: 100 },
    ];
    drawHistogram(ctx, candles, { from: 0, to: 2 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillRect'), 1);
  });

  it('colors bars by previous close when colorByPreviousClose is enabled', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    const candles: Candle[] = [
      // i = 0: colorByPreviousClose true but no previous candle, falls back to open
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      // close < previous close -> downColor
      { time: 1, open: 11, high: 11.5, low: 10, close: 10.5, volume: 100 },
      // close >= previous close -> upColor
      { time: 2, open: 10.5, high: 12, low: 10, close: 11.5, volume: 100 },
    ];
    drawHistogram(ctx, candles, { from: 0, to: 3 }, ts, ps, cfg({ colorByPreviousClose: true }));
    assert.equal(ctx.countCalls('fillRect'), 3);
  });

  it('combines histogramColor fallback with previous-close coloring', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    const candles: Candle[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 1, open: 11, high: 11.5, low: 9, close: 9.5, volume: 100 },
    ];
    drawHistogram(ctx, candles, { from: 0, to: 2 }, ts, ps, cfg({ colorByPreviousClose: true, downColor: '', histogramColor: '#123123' }));
    assert.equal(ctx.countCalls('fillRect'), 2);
  });
});

describe('drawHistogramBars coverage gaps', () => {
  it('draws only up-colored bars when all values are positive and up', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    ps.setRange(-10, 10);
    drawHistogramBars(ctx, [5, 3], [true, true], { from: 0, to: 2 }, ts, ps, '#0f0', '#f00');
    assert.equal(ctx.countCalls('fillRect'), 2);
  });

  it('draws nothing for an empty range', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales();
    drawHistogramBars(ctx, [5, null], [true, false], { from: 0, to: 0 }, ts, ps, '#0f0', '#f00');
    assert.equal(ctx.countCalls('fillRect'), 0);
  });
});
