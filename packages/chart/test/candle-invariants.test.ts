import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, type Chart } from '../dist/index.js';
import { DataStore, finiteCandle, noteCandleTime, repairCandle, resetCandleTimeWarning, type Candle } from '../dist/core/data.js';
import { olderCandles } from '../dist/core/prepend.js';
import { normalizeCandles } from '../dist/datafeed/index.js';
import { MockDocument } from '../dist/dom.js';
import { mfiValues } from '../dist/indicators/index.js';
import { smaCandleValues } from '../dist/indicators/sma.js';

const T0 = 1_700_000_000;

function candle(time: number, close = 10, volume?: number): Candle {
  const row: Candle = { time, open: close, high: close + 1, low: close - 1, close };
  if (volume !== undefined) return { ...row, volume };
  return row;
}

function chartWith(data: readonly Candle[]): Chart {
  return createChart({ document: new MockDocument(), config: { wasm: false, data: data.slice() } });
}

function warns(fn: () => void): unknown[][] {
  const seen: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { seen.push(args); };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

describe('candle ingestion invariants', () => {
  it('drops non-finite OHLC on setData, appendData, config.data and updateConfig (#88)', () => {
    const good = candle(T0, 10);
    const fields = ['time', 'open', 'high', 'low', 'close'] as const;
    const bad: Candle[] = [];
    for (const field of fields) {
      bad.push({ ...good, time: T0 + bad.length + 1, [field]: Number.NaN });
      bad.push({ ...good, time: T0 + bad.length + 1, [field]: Number.POSITIVE_INFINITY });
      bad.push({ ...good, time: T0 + bad.length + 1, [field]: Number.NEGATIVE_INFINITY });
    }
    const store = new DataStore();
    store.setData([candle(300), candle(Number.NaN), candle(100), candle(200), ...bad]);
    assert.deepEqual(store.all().map((row) => row.time), [100, 200, 300]);

    const chart = chartWith([good]);
    const seen: string[] = [];
    chart.subscribeDataLoad((event) => seen.push(event.reason));
    for (const row of bad) chart.appendData(row);
    chart.appendData({ time: T0 - 60, open: 1, high: 2, low: 0, close: Number.NaN });
    assert.equal(chart.dataLength, 1);
    assert.deepEqual(chart.getData().map((row) => row.time), [good.time]);
    assert.deepEqual(seen, []);
    assert.equal(store.append(bad[0]!), false);
    const empty = chartWith([]);
    empty.appendData({ time: Number.NaN, open: 1, high: 1, low: 1, close: 1 });
    assert.equal(empty.dataLength, 0);
    empty.appendData(candle(T0, 3));
    assert.equal(empty.getData()[0]?.close, 3);
    empty.destroy();

    const constructed = chartWith([bad[1]!, good, bad[2]!]);
    assert.deepEqual(constructed.getData(), [good]);
    constructed.updateConfig({ data: [candle(T0 + 60, Number.NaN), candle(T0 + 120, 12)] });
    assert.deepEqual(constructed.getData().map((row) => row.close), [12]);

    const poisoned = [candle(T0, 10), candle(T0 + 60, 11), { ...candle(T0 + 120, 12), close: Number.NaN }, candle(T0 + 180, 13)];
    const cleaned = chartWith(poisoned);
    const sma = smaCandleValues(cleaned.getData(), 3);
    assert.ok(sma.every((value) => value === null || Number.isFinite(value)));
    assert.equal(cleaned.dataLength, 3);
    chart.destroy();
    constructed.destroy();
    cleaned.destroy();
  });

  it('keeps one candle per time, and a later append replaces that bar (#89)', () => {
    const rows = [candle(T0, 1), candle(T0 + 60, 2), candle(T0 + 120, 3)];
    const duplicate = { ...rows[2]!, close: 999, high: 1000 };
    const chart = chartWith([...rows, duplicate]);
    assert.equal(chart.dataLength, 3);
    assert.equal(chart.getData()[2]!.close, 999);
    chart.appendData({ ...rows[2]!, close: 5 });
    assert.equal(chart.dataLength, 3);
    assert.equal(chart.getData()[2]!.close, 5);
    assert.deepEqual(chart.getData().map((row) => row.time), [T0, T0 + 60, T0 + 120]);

    const store = new DataStore();
    store.setData([candle(T0 + 120, 3), candle(T0, 1), { ...candle(T0, 8), close: 4 }, candle(T0 + 60, 2)]);
    assert.deepEqual(store.all().map((row) => [row.time, row.close]), [[T0, 4], [T0 + 60, 2], [T0 + 120, 3]]);
    chart.destroy();
  });

  it('repairs OHLC at ingestion so autoscale includes the body (#90)', () => {
    const rows = Array.from({ length: 50 }, (_, i) => candle(T0 + i * 60, 100 + i));
    rows[49] = { ...rows[49]!, close: 400 };
    const inputHigh = rows[49]!.high;
    const chart = chartWith(rows);
    const last = chart.getData()[49]!;
    assert.equal(rows[49]!.high, inputHigh, 'input candles are not mutated');
    assert.equal(last.high, 400);
    assert.ok(last.low <= Math.min(last.open, last.close));
    const y = chart.scale.priceToY(last.close);
    assert.ok(y >= 0 && y <= chart.plotArea.height, `close y ${y}`);

    const swapped = { time: T0, open: 10, high: 4, low: 12, close: 8 };
    chart.setData([swapped]);
    assert.deepEqual(chart.getData()[0], { time: T0, open: 10, high: 10, low: 8, close: 8 });
    chart.appendData({ time: T0 + 60, open: 3, high: 4, low: 5, close: 1 });
    assert.deepEqual(chart.getData()[1], { time: T0 + 60, open: 3, high: 4, low: 1, close: 1 });
    chart.prependData([{ time: T0 - 60, open: 7, high: 6, low: 9, close: 8, volume: 1 }]);
    assert.equal(chart.getData()[0]!.high, 8);
    assert.equal(chart.getData()[0]!.low, 7);
    chart.destroy();

    const store = new DataStore();
    const bare = { time: T0, open: 5, high: 4, low: 3, close: 6 };
    store.append(bare);
    assert.equal(bare.high, 4);
    assert.deepEqual(store.at(0), { time: T0, open: 5, high: 6, low: 3, close: 6 });
    const openAbove = { time: T0 + 60, open: 9, high: 8, low: 7, close: 7.5 };
    store.append(openAbove);
    assert.equal(store.at(1)?.high, 9);
    assert.equal(store.at(1)?.volume, undefined);
    const closeBelow = { time: T0 + 120, open: 5, high: 10, low: 4, close: 2, volume: 3 };
    store.append(closeBelow);
    assert.equal(store.at(2)?.low, 2);
    assert.equal(store.at(2)?.volume, 3);
    store.setData([candle(T0, 1), { time: T0 + 60, open: 10, high: 9, low: 8, close: 8.5 }]);
    assert.equal(store.at(1)?.high, 10);
    store.setData([candle(T0, 1), { time: T0 + 60, open: 10, high: 12, low: 8, close: 7 }]);
    assert.equal(store.at(1)?.low, 7);
    store.setData([candle(T0, 1, 4), candle(T0 + 60, 2, Number.POSITIVE_INFINITY)]);
    assert.deepEqual(store.all().map((row) => row.volume), [4, 0]);
  });

  it('clamps negative and non-finite volume to 0 and leaves MFI inside 0..100 (#91)', () => {
    const rows = Array.from({ length: 30 }, (_, i) => candle(T0 + i * 60, 100 + (i % 5), i % 3 === 0 ? -50 : 20));
    rows[1] = { ...rows[1]!, volume: Number.NaN };
    rows[2] = { ...rows[2]!, volume: Number.POSITIVE_INFINITY };
    const chart = chartWith(rows);
    assert.ok(chart.getData().every((row) => row.volume !== undefined && row.volume >= 0 && Number.isFinite(row.volume)));
    const mfi = mfiValues(chart.getData(), 14);
    assert.ok(mfi.every((value) => value === null || (value >= 0 && value <= 100)));
    chart.appendData(candle(T0 + 30 * 60, 110, -8));
    assert.equal(chart.getData().at(-1)?.volume, 0);
    chart.updateConfig({ data: [candle(T0, 10, -1), candle(T0 + 60, 11)] });
    assert.deepEqual(chart.getData().map((row) => row.volume), [0, undefined]);
    chart.destroy();

    const older = olderCandles([candle(T0 - 60, 9, -4), candle(T0 - 120, 8)], undefined);
    assert.equal(older[1]!.volume, 0);
    assert.equal(older[0]!.volume, undefined);
  });

  it('warns once in development when time looks like milliseconds and does not rescale (#92)', () => {
    resetCandleTimeWarning();
    const ms = 1_700_000_000_000;
    const boundary = warns(() => {
      const store = new DataStore();
      store.setData([candle(1e11 - 60), candle(1e11)]);
      assert.deepEqual(store.all().map((row) => row.time), [1e11 - 60, 1e11]);
    });
    assert.deepEqual(boundary, []);

    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const quiet = warns(() => {
        assert.deepEqual(normalizeCandles([candle(ms, 10, 1)]).map((row) => row.time), [ms]);
      });
      assert.deepEqual(quiet, []);
    } finally {
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
    }

    const runtime = globalThis as { process: NodeJS.Process | { env?: { NODE_ENV?: string } } | undefined };
    const savedProcess = runtime.process;
    const missing = warns(() => {
      runtime.process = undefined;
      try {
        noteCandleTime(ms);
      } finally {
        runtime.process = savedProcess;
      }
    });
    assert.equal(missing.length, 1);
    resetCandleTimeWarning();

    const noEnv = warns(() => {
      runtime.process = {};
      try {
        noteCandleTime(ms + 60_000);
      } finally {
        runtime.process = savedProcess;
      }
    });
    assert.equal(noEnv.length, 1);
    assert.match(String(noEnv[0]?.[0]), /UNIX seconds/);
    resetCandleTimeWarning();

    const chart = chartWith([candle(T0)]);
    const first = warns(() => {
      chart.setData([candle(ms), candle(ms + 60_000)]);
      chart.appendData(candle(ms + 120_000));
      chart.prependData([candle(ms - 60_000)]);
    });
    assert.equal(first.length, 1);
    assert.deepEqual(chart.getData().map((row) => row.time), [ms - 60_000, ms, ms + 60_000, ms + 120_000]);
    chart.destroy();

    const again = warns(() => noteCandleTime(ms + 1));
    assert.deepEqual(again, []);
    const finite = repairCandle(candle(T0));
    assert.equal(finite, repairCandle(finite));
    assert.equal(finiteCandle(candle(T0)), true);
    assert.equal(finiteCandle({ ...candle(T0), close: Number.NaN }), false);
  });

  it('dedupes DataStore.prepend against the candles already stored', () => {
    const store = new DataStore();
    const kept = candle(T0, 1);
    store.setData([kept, candle(T0 + 60, 2)]);
    const earlier = candle(T0 - 120, 6);
    store.prepend([earlier]);
    assert.equal(store.at(0), earlier);
    assert.equal(store.at(1), kept);
    store.prepend([]);
    assert.equal(store.at(1), kept);
    store.prepend([candle(T0 - 180, 4), candle(T0, 9), candle(T0 + 120, 8)]);
    assert.deepEqual(store.all().map((row) => row.time), [T0 - 180, T0 - 120, T0, T0 + 60]);
    assert.equal(store.at(2), kept);
    const length = store.length;
    store.prepend([candle(T0 + 900)]);
    assert.equal(store.length, length);
    store.prepend([
      candle(T0 + 500),
      { time: Number.NaN, open: 1, high: 2, low: 0, close: 1 },
      candle(T0 - 240, 3, -5),
    ]);
    assert.equal(store.at(0)?.time, T0 - 240);
    assert.equal(store.at(0)?.volume, 0);
    assert.equal(store.at(1)?.time, T0 - 180);
    const empty = new DataStore();
    empty.prepend([candle(20), candle(10), candle(10, 4)]);
    assert.deepEqual(empty.all().map((row) => [row.time, row.close]), [[10, 4], [20, 10]]);
  });
});
