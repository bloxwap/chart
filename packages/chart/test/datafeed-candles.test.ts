import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTick,
  bucketStartMs,
  candleTimeMs,
  normalizeCandles,
  type Candle,
} from '../dist/datafeed/index.js';

describe('bucketStartMs', () => {
  it('floors to the interval boundary', () => {
    const now = 1_700_000_123_456;
    assert.equal(bucketStartMs(now, 60_000), 1_700_000_100_000);
    assert.equal(bucketStartMs(now, 900_000), Math.floor(now / 900_000) * 900_000);
    assert.equal(bucketStartMs(now, 900_000), 1_700_000_100_000);
    assert.equal(bucketStartMs(now, 14_400_000), Math.floor(now / 14_400_000) * 14_400_000);
    assert.equal(bucketStartMs(now, 86_400_000), Math.floor(now / 86_400_000) * 86_400_000);
  });

  it('floors epoch-aligned multi-day buckets the same way', () => {
    // 3d opens 2026-09-01Z, 1w 2026-08-27Z (a Thursday, epoch day 0), 30d 2026-08-05Z.
    const now = Date.parse('2026-09-02T18:00:00Z');
    assert.equal(bucketStartMs(now, 259_200_000), Date.parse('2026-09-01T00:00:00Z'));
    assert.equal(bucketStartMs(now, 604_800_000), Date.parse('2026-08-27T00:00:00Z'));
    assert.equal(bucketStartMs(now, 2_592_000_000), Date.parse('2026-08-05T00:00:00Z'));
  });

  it('handles arbitrary and sub-second intervals', () => {
    assert.equal(bucketStartMs(20_999, 7_000), 14_000);
    assert.equal(bucketStartMs(21_000, 7_000), 21_000);
    assert.equal(bucketStartMs(1_700_000_000_999, 250), 1_700_000_000_750);
    assert.equal(bucketStartMs(1_700_000_000_750, 250), 1_700_000_000_750);
    assert.equal(bucketStartMs(179_999, 90_000), 90_000);
  });
});

describe('candleTimeMs', () => {
  it('converts whole seconds to milliseconds', () => {
    assert.equal(candleTimeMs({ time: 1_700_000_040, open: 1, high: 1, low: 1, close: 1 }), 1_700_000_040_000);
  });

  it('round-trips any integer-millisecond time exactly', () => {
    for (let k = 0; k < 2_000; k++) {
      const ms = 1_700_000_000_000 + k * 37 + 1;
      assert.equal(candleTimeMs({ time: ms / 1000, open: 1, high: 1, low: 1, close: 1 }), ms);
    }
  });
});

describe('applyTick', () => {
  const bar: Candle = { time: 1000, open: 100, high: 110, low: 95, close: 105, volume: 4 };

  it('updates high/low/close inside the current bucket, keeping open and volume', () => {
    assert.deepEqual(applyTick(bar, 112, 1_000_000), { time: 1000, open: 100, high: 112, low: 95, close: 112, volume: 4 });
    assert.deepEqual(applyTick(bar, 90, 1_000_000), { time: 1000, open: 100, high: 110, low: 90, close: 90, volume: 4 });
    assert.deepEqual(applyTick(bar, 100, 1_000_000), { time: 1000, open: 100, high: 110, low: 95, close: 100, volume: 4 });
  });

  it('folds a tick stamped with an earlier bucket into the held bar', () => {
    assert.deepEqual(applyTick(bar, 111, 940_000), { time: 1000, open: 100, high: 111, low: 95, close: 111, volume: 4 });
  });

  it('keeps a volumeless bar volumeless when updating in place', () => {
    const plain: Candle = { time: 1000, open: 100, high: 110, low: 95, close: 105 };
    const next = applyTick(plain, 101, 1_000_000);
    assert.deepEqual(next, { time: 1000, open: 100, high: 110, low: 95, close: 101 });
    assert.equal('volume' in next, false);
  });

  it('rolls a new bar at the previous close with zero volume when the bucket advances', () => {
    assert.deepEqual(applyTick(bar, 108, 1_060_000), { time: 1060, open: 105, high: 108, low: 105, close: 108, volume: 0 });
    assert.deepEqual(applyTick(bar, 101, 1_060_000), { time: 1060, open: 105, high: 105, low: 101, close: 101, volume: 0 });
  });

  it('rolls into a sub-second bucket with a fractional time', () => {
    assert.deepEqual(applyTick(bar, 106, 1_000_250), { time: 1000.25, open: 105, high: 106, low: 105, close: 106, volume: 0 });
  });

  it('never mutates the input bar', () => {
    applyTick(bar, 200, 1_000_000);
    applyTick(bar, 200, 1_060_000);
    assert.deepEqual(bar, { time: 1000, open: 100, high: 110, low: 95, close: 105, volume: 4 });
  });
});

describe('normalizeCandles', () => {
  const row = (time: number, close: number, volume?: number): Candle =>
    volume === undefined
      ? { time, open: 100, high: 110, low: 95, close }
      : { time, open: 100, high: 110, low: 95, close, volume };

  it('returns fresh OHLCV candles', () => {
    const input = [row(1_700_000_000, 105, 12.5)];
    const out = normalizeCandles(input);
    assert.deepEqual(out, [{ time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12.5 }]);
    assert.notEqual(out[0], input[0]);
  });

  it('sorts ascending and dedupes on time, last row winning', () => {
    const out = normalizeCandles([row(1_700_000_060, 106, 3), row(1_700_000_000, 105, 1), row(1_700_000_000, 109, 9)]);
    assert.deepEqual(out.map((c) => c.time), [1_700_000_000, 1_700_000_060]);
    assert.equal(out[0]!.close, 109);
    assert.equal(out[0]!.volume, 9);
  });

  it('drops rows with non-finite OHLC or a non-finite / non-positive time', () => {
    const good = row(1_700_000_060, 105, 1);
    const out = normalizeCandles([
      { ...good, open: Number.NaN },
      { ...good, high: Number.POSITIVE_INFINITY },
      { ...good, low: Number.NEGATIVE_INFINITY },
      { ...good, close: Number.NaN },
      { ...good, time: Number.NaN },
      { ...good, time: Number.POSITIVE_INFINITY },
      { ...good, time: 0 },
      { ...good, time: -60 },
      good,
    ]);
    assert.deepEqual(out, [good]);
  });

  it('zeroes a missing or non-finite volume', () => {
    const out = normalizeCandles([row(1, 1), row(2, 2, Number.NaN), row(3, 3, Number.POSITIVE_INFINITY), row(4, 4, 0), row(5, 5, 7)]);
    assert.deepEqual(out.map((c) => c.volume), [0, 0, 0, 0, 7]);
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(normalizeCandles([]), []);
  });
});
