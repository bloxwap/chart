import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAP_SILENCE_MS,
  MAX_GAP_BARS,
  MAX_PENDING_TICKS,
  ROLL_SILENCE_MS,
  bucketStartMs,
  createLiveBarFolder,
  hasMissedBucket,
  seedBarFromTick,
  type Candle,
  type FetchGap,
  type LiveBarFolder,
} from '../dist/datafeed/index.js';
import { createChart } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';

const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary
const T0S = T0 / 1000;

const candle = (tMs: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({
  time: tMs / 1000,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

const seed: Candle = { time: T0S, open: 100, high: 101, low: 99, close: 100, volume: 5 };

/** A FetchGap that records its calls. */
interface FetchSpy extends FetchGap {
  readonly calls: Array<[number, number]>;
}

function spy(impl: FetchGap): FetchSpy {
  const calls: Array<[number, number]> = [];
  const fn = (fromMs: number, toMs: number): Promise<readonly Candle[]> => {
    calls.push([fromMs, toMs]);
    return impl(fromMs, toMs);
  };
  return Object.assign(fn, { calls });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(opts: { now: () => number; fetchGap?: FetchSpy; seed?: Candle | null; intervalMs?: number }) {
  const emitted: Candle[] = [];
  const fetchGap = opts.fetchGap ?? spy(async () => []);
  const folder = createLiveBarFolder({
    intervalMs: opts.intervalMs ?? MIN,
    seedBar: opts.seed === undefined ? seed : opts.seed,
    fetchGap,
    onBar: (b) => emitted.push(b),
    now: opts.now,
  });
  return { folder, emitted, fetchGap };
}

const flush = () => new Promise<void>((r) => setImmediate(r));
const offline = () => spy(async () => {
  throw new Error('offline');
});

describe('datafeed constants', () => {
  it('match the app thresholds', () => {
    assert.equal(GAP_SILENCE_MS, 8_000);
    assert.equal(ROLL_SILENCE_MS, 2_000);
    assert.equal(MAX_GAP_BARS, 5_000);
    assert.equal(MAX_PENDING_TICKS, 2_000);
  });
});

describe('hasMissedBucket', () => {
  it('is false inside the bar and for the adjacent bucket', () => {
    assert.equal(hasMissedBucket(seed, T0 + 30_000, MIN), false);
    assert.equal(hasMissedBucket(seed, T0 + MIN, MIN), false);
    assert.equal(hasMissedBucket(seed, T0 - MIN, MIN), false);
  });
  it('is true once a whole bucket was skipped', () => {
    assert.equal(hasMissedBucket(seed, T0 + 2 * MIN, MIN), true);
  });
  it('scales with the interval', () => {
    assert.equal(hasMissedBucket(seed, T0 + 2 * MIN, 2 * MIN), false);
    assert.equal(hasMissedBucket(seed, T0 + 500, 250), true);
    assert.equal(hasMissedBucket(seed, T0 + 250, 250), false);
  });
});

describe('seedBarFromTick', () => {
  it('builds a flat zero-volume bar at the bucket open', () => {
    assert.deepEqual(seedBarFromTick(42, T0), { time: T0S, open: 42, high: 42, low: 42, close: 42, volume: 0 });
  });
});

describe('createLiveBarFolder', () => {
  it('updates the forming bar in place inside its bucket', () => {
    const { folder, emitted, fetchGap } = setup({ now: () => T0 + 10_000 });
    folder.pushTick(102);
    assert.deepEqual(emitted, [{ time: T0S, open: 100, high: 102, low: 99, close: 102, volume: 5 }]);
    assert.equal(fetchGap.calls.length, 0);
  });

  it('rolls the adjacent bucket at the previous close without a backfill', () => {
    const { folder, emitted, fetchGap } = setup({ now: () => T0 + MIN + 1_000 });
    folder.pushTick(98);
    assert.deepEqual(emitted, [{ time: T0S + 60, open: 100, high: 100, low: 98, close: 98, volume: 0 }]);
    assert.equal(fetchGap.calls.length, 0);
  });

  it('backfills a missed gap from history before folding the tick', async () => {
    let now = T0 + 3 * MIN + 5_000;
    const fetchGap = spy(async () => [
      candle(T0, 100, 103, 99, 103, 7),
      candle(T0 + MIN, 103, 111, 103, 110),
      candle(T0 + 2 * MIN, 110, 110, 96, 97),
      candle(T0 + 3 * MIN, 97, 97, 95, 95, 2),
    ]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(94.5);
    // Ticks arriving while the read is in flight are all kept, in order.
    folder.pushTick(90);
    folder.pushTick(110);
    folder.pushTick(94);
    assert.equal(emitted.length, 0);
    await flush();

    assert.deepEqual(fetchGap.calls, [[T0, now]]);
    assert.deepEqual(emitted.map((e) => [e.time - T0S, e.open, e.close, e.volume]), [
      [0, 100, 103, 7], // stale bar corrected in place
      [60, 103, 110, 1],
      [120, 110, 97, 1],
      [180, 97, 95, 2],
      [180, 97, 94.5, 2], // pending ticks folded in order
      [180, 97, 90, 2],
      [180, 97, 110, 2],
      [180, 97, 94, 2],
    ]);
    const last = emitted[emitted.length - 1]!;
    assert.deepEqual([last.high, last.low, last.close], [110, 90, 94]);
    assert.equal(emitted.every((e) => e.open !== 100 || e.time === T0S), true);
    assert.equal(folder.bar?.close, 94);
    now += 1_000;
    folder.pushTick(93);
    assert.deepEqual(emitted[emitted.length - 1], { time: T0S + 180, open: 97, high: 110, low: 90, close: 93, volume: 2 });
    assert.equal(fetchGap.calls.length, 1);
  });

  it('backfills an adjacent-bucket roll after tick silence (outage inside one boundary)', async () => {
    let now = T0 + 10_000;
    const fetchGap = spy(async () => [candle(T0, 100, 108, 99, 108, 9), candle(T0 + MIN, 108, 108, 104, 105, 3)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(101);
    assert.equal(fetchGap.calls.length, 0);
    now = T0 + MIN + 50_000;
    folder.pushTick(104);
    await flush();
    assert.deepEqual(fetchGap.calls, [[T0, now]]);
    assert.deepEqual(emitted.slice(1).map((e) => [e.time - T0S, e.open, e.high, e.close]), [
      [0, 100, 108, 108], // N corrected in place
      [60, 108, 108, 105], // N+1 opens at N's real close, not the stale 101
      [60, 108, 108, 104],
    ]);
  });

  it('backfills in place after tick silence inside the same bucket', async () => {
    let now = T0 + 1_000;
    const fetchGap = spy(async () => [candle(T0, 100, 120, 80, 101, 4)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(100.5);
    now += GAP_SILENCE_MS + 1;
    folder.pushTick(102);
    await flush();
    assert.deepEqual(emitted[emitted.length - 1], { time: T0S, open: 100, high: 120, low: 80, close: 102, volume: 4 });
  });

  it('does not spend a read on a normal adjacent roll with live ticks', () => {
    let now = T0 + 59_000;
    const { folder, fetchGap } = setup({ now: () => now });
    folder.pushTick(100);
    now = T0 + MIN + 500;
    folder.pushTick(101);
    assert.equal(fetchGap.calls.length, 0);
  });

  it('repairs a short hide that straddles a boundary (roll after brief silence, inclusive)', async () => {
    let now = T0 + 59_000;
    const fetchGap = spy(async () => [candle(T0, 100, 100, 97, 97, 3), candle(T0 + MIN, 97, 97, 96, 96.5, 1)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(100);
    now = T0 + 59_000 + ROLL_SILENCE_MS;
    folder.pushTick(96);
    await flush();
    assert.equal(fetchGap.calls.length, 1);
    const last = emitted[emitted.length - 1]!;
    assert.deepEqual([last.time, last.open, last.close], [T0S + 60, 97, 96]);
  });

  it('opens an adjacent roll at the tick when the silence backfill fails', async () => {
    let now = T0 + 55_000;
    const { folder, emitted } = setup({ now: () => now, fetchGap: offline() });
    folder.pushTick(100);
    now = T0 + MIN + 5_000;
    folder.pushTick(93);
    folder.pushTick(92.5); // buffered during the read
    await flush();
    assert.deepEqual(emitted.slice(1), [
      seedBarFromTick(93, T0 + MIN),
      { time: T0S + 60, open: 93, high: 93, low: 92.5, close: 92.5, volume: 0 },
    ]);
  });

  it('keeps the in-place update when the backfill returns nothing inside the same bucket', async () => {
    let now = T0 + 1_000;
    const { folder, emitted } = setup({ now: () => now });
    now += GAP_SILENCE_MS;
    folder.pushTick(102);
    await flush();
    assert.deepEqual(emitted, [{ time: T0S, open: 100, high: 102, low: 99, close: 102, volume: 5 }]);
  });

  it("measures silence from creation, so a stale seed's first tick is repaired", async () => {
    let now = T0 + 5_000;
    const fetchGap = spy(async () => [candle(T0, 100, 100, 90, 90, 2)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    now += GAP_SILENCE_MS; // inclusive threshold
    folder.pushTick(91);
    await flush();
    assert.equal(fetchGap.calls.length, 1);
    const last = emitted[emitted.length - 1]!;
    assert.deepEqual([last.open, last.low, last.close], [100, 90, 91]);
  });

  it('opens at the tick, not the stale close, when the backfill fails', async () => {
    const now = T0 + 5 * MIN + 500;
    const { folder, emitted } = setup({ now: () => now, fetchGap: offline() });
    folder.pushTick(80);
    await flush();
    assert.deepEqual(emitted, [seedBarFromTick(80, T0 + 5 * MIN)]);
  });

  it('opens at the tick when the backfill returns nothing new', async () => {
    const now = T0 + 5 * MIN + 500;
    for (const rows of [[], [candle(T0 - MIN, 90, 90, 90, 90)]]) {
      const { folder, emitted } = setup({ now: () => now, fetchGap: spy(async () => rows) });
      folder.pushTick(80);
      await flush();
      assert.deepEqual(emitted, [seedBarFromTick(80, T0 + 5 * MIN)]);
    }
  });

  it('keeps pre-boundary ticks in the earlier bar when the read straddles a bucket', async () => {
    let now = T0 + 5 * MIN + 59_500;
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => now, fetchGap: spy(() => read.promise) });
    folder.pushTick(80);
    folder.pushTick(82);
    now = T0 + 6 * MIN + 200; // boundary crossed while the read is in flight
    folder.pushTick(79);
    read.resolve([candle(T0 + 5 * MIN, 81, 81, 81, 81, 1)]);
    await flush();
    assert.deepEqual(emitted.map((e) => [e.time - T0S, e.open, e.high, e.low, e.close]), [
      [300, 81, 81, 81, 81],
      [300, 81, 81, 80, 80], // pre-boundary ticks fold into +5
      [300, 81, 82, 80, 82],
      [360, 82, 82, 79, 79], // post-boundary tick rolls +6
    ]);
  });

  it('stops folding pending ticks when onBar disposes the folder', async () => {
    const now = T0 + 5 * MIN;
    const emitted: Candle[] = [];
    const folder: LiveBarFolder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      fetchGap: async () => [],
      onBar: (b) => {
        emitted.push(b);
        folder.dispose();
      },
      now: () => now,
    });
    folder.pushTick(80);
    folder.pushTick(81);
    folder.pushTick(82);
    await flush();
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], seedBarFromTick(80, T0 + 5 * MIN));
  });

  it('stops applying history when onBar disposes the folder mid-backfill', async () => {
    const now = T0 + 5 * MIN;
    const emitted: Candle[] = [];
    const folder: LiveBarFolder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      fetchGap: async () => [candle(T0 + MIN, 1, 1, 1, 1), candle(T0 + 2 * MIN, 2, 2, 2, 2), candle(T0 + 3 * MIN, 3, 3, 3, 3)],
      onBar: (b) => {
        emitted.push(b);
        folder.dispose();
      },
      now: () => now,
    });
    folder.pushTick(80);
    folder.pushTick(81);
    await flush();
    assert.deepEqual(emitted.map((e) => e.close), [1]);
    folder.pushTick(82);
    assert.equal(emitted.length, 1);
    assert.equal(folder.filling, false);
  });

  it('caps the backfill window at the row cap', async () => {
    const now = T0 + 10_000 * MIN;
    const { folder, fetchGap } = setup({ now: () => now });
    folder.pushTick(80);
    await flush();
    assert.deepEqual(fetchGap.calls, [[now - (MAX_GAP_BARS - 1) * MIN, now]]);
  });

  it('seeds from the tick when no history landed', () => {
    const { folder, emitted } = setup({ now: () => T0 + 10, seed: null });
    assert.equal(folder.bar, null);
    folder.pushTick(50);
    assert.deepEqual(emitted, [seedBarFromTick(50, T0)]);
    assert.deepEqual(folder.bar, seedBarFromTick(50, T0));
  });

  it('emits nothing after dispose, including a backfill that lands late', async () => {
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => T0 + 5 * MIN, fetchGap: spy(() => read.promise) });
    folder.pushTick(80);
    folder.dispose();
    read.resolve([candle(T0 + 5 * MIN, 80, 80, 80, 80)]);
    await flush();
    folder.pushTick(81);
    assert.equal(emitted.length, 0);
    assert.equal(folder.filling, false);
  });

  it('ignores non-finite and non-positive prices, which do not count as activity', () => {
    let now = T0 + 1_000;
    const { folder, emitted, fetchGap } = setup({ now: () => now });
    now += GAP_SILENCE_MS - 1;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5]) folder.pushTick(bad);
    assert.equal(emitted.length, 0);
    assert.equal(fetchGap.calls.length, 0);
    now += 1;
    // Silence is still measured from creation, not from the ignored ticks.
    folder.pushTick(102);
    assert.equal(fetchGap.calls.length, 1);
  });

  it('exposes onPrice as an alias of pushTick', () => {
    const { folder, emitted } = setup({ now: () => T0 + 10_000 });
    assert.equal(folder.onPrice, folder.pushTick);
    folder.onPrice(102);
    folder.pushTick(98);
    assert.deepEqual(emitted.map((e) => e.close), [102, 98]);
  });

  it('reports the held bar and whether a backfill is in flight', async () => {
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => T0 + 5 * MIN, fetchGap: spy(() => read.promise) });
    assert.equal(folder.bar, seed);
    assert.equal(folder.filling, false);
    folder.pushTick(80);
    assert.equal(folder.filling, true);
    assert.equal(folder.bar, seed);
    read.resolve([]);
    await flush();
    assert.equal(folder.filling, false);
    assert.equal(folder.bar, emitted[emitted.length - 1]);
  });

  it('applies only normalized history bars at or after the last published time', async () => {
    const now = T0 + 3 * MIN + 5_000;
    const fetchGap = spy(async () => [
      candle(T0 + 2 * MIN, 110, 112, 108, 109, 4),
      candle(T0 - MIN, 90, 90, 90, 90), // older than the held bar: skipped
      { time: Number.NaN, open: 1, high: 1, low: 1, close: 1 }, // invalid: dropped
      candle(T0 + MIN, 103, 111, 103, 110, 1),
      { time: (T0 + MIN) / 1000, open: 104, high: 111, low: 103, close: 110 }, // duplicate: last wins
    ]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(107);
    await flush();
    assert.deepEqual(emitted, [
      { time: T0S + 60, open: 104, high: 111, low: 103, close: 110, volume: 0 },
      { time: T0S + 120, open: 110, high: 112, low: 108, close: 109, volume: 4 },
      { time: T0S + 180, open: 109, high: 109, low: 107, close: 107, volume: 0 }, // rolls at the real close
    ]);
  });

  it('evicts the oldest buffered tick beyond MAX_PENDING_TICKS', async () => {
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => T0 + 5 * MIN, fetchGap: spy(() => read.promise) });
    for (let price = 1; price <= MAX_PENDING_TICKS + 1; price++) folder.pushTick(price);
    read.resolve([]);
    await flush();
    assert.equal(emitted.length, MAX_PENDING_TICKS);
    // Tick 1 (the trigger) was evicted, so tick 2 gets the open-at-tick fallback.
    assert.deepEqual(emitted[0], seedBarFromTick(2, T0 + 5 * MIN));
    assert.deepEqual(emitted[emitted.length - 1], {
      time: T0S + 300,
      open: 2,
      high: MAX_PENDING_TICKS + 1,
      low: 2,
      close: MAX_PENDING_TICKS + 1,
      volume: 0,
    });
  });

  it('keeps every buffered tick at exactly MAX_PENDING_TICKS', async () => {
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => T0 + 5 * MIN, fetchGap: spy(() => read.promise) });
    for (let price = 1; price <= MAX_PENDING_TICKS; price++) folder.pushTick(price);
    read.resolve([]);
    await flush();
    assert.equal(emitted.length, MAX_PENDING_TICKS);
    assert.deepEqual(emitted[0], seedBarFromTick(1, T0 + 5 * MIN));
  });

  it('replays ticks buffered during a pending read in order after it resolves', async () => {
    let now = T0 + 4 * MIN + 1_000;
    const read = deferred<readonly Candle[]>();
    const fetchGap = spy(() => read.promise);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(50);
    now += 100;
    folder.pushTick(55);
    now += 100;
    folder.pushTick(45);
    await flush();
    assert.equal(emitted.length, 0);
    assert.equal(folder.filling, true);
    assert.equal(fetchGap.calls.length, 1);
    read.resolve([candle(T0 + 4 * MIN, 48, 49, 47, 49, 3)]);
    await flush();
    assert.deepEqual(emitted.map((e) => e.close), [49, 50, 55, 45]);
    assert.deepEqual(emitted[emitted.length - 1], { time: T0S + 240, open: 48, high: 55, low: 45, close: 45, volume: 3 });
    now += 100;
    folder.pushTick(46);
    assert.equal(fetchGap.calls.length, 1);
    assert.equal(emitted[emitted.length - 1]!.close, 46);
  });

  it('replays ticks buffered during a pending read in order after it rejects', async () => {
    let now = T0 + 4 * MIN + 1_000;
    const read = deferred<readonly Candle[]>();
    const { folder, emitted } = setup({ now: () => now, fetchGap: spy(() => read.promise) });
    folder.pushTick(50);
    folder.pushTick(55);
    folder.pushTick(45);
    await flush();
    assert.equal(emitted.length, 0);
    read.reject(new Error('offline'));
    await flush();
    assert.equal(folder.filling, false);
    assert.deepEqual(emitted, [
      seedBarFromTick(50, T0 + 4 * MIN),
      { time: T0S + 240, open: 50, high: 55, low: 50, close: 55, volume: 0 },
      { time: T0S + 240, open: 50, high: 55, low: 45, close: 45, volume: 0 },
    ]);
  });

  it('replays buffered ticks when fetchGap throws synchronously', async () => {
    const fetchGap: FetchGap = () => {
      throw new Error('boom');
    };
    const { folder, emitted } = setup({ now: () => T0 + 5 * MIN, fetchGap: spy(fetchGap) });
    folder.pushTick(80);
    folder.pushTick(81);
    await flush();
    assert.deepEqual(emitted.map((e) => [e.open, e.close]), [[80, 80], [80, 81]]);
  });

  it('repairs again when a later gap opens', async () => {
    let now = T0 + 3 * MIN;
    const fetchGap = spy(async (fromMs) => [candle(fromMs, 1, 1, 1, 1)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(10);
    await flush();
    // History stops at the held bucket, so the tick three buckets on is seeded.
    assert.deepEqual(emitted, [candle(T0, 1, 1, 1, 1), seedBarFromTick(10, T0 + 3 * MIN)]);
    now = T0 + 9 * MIN;
    folder.pushTick(11);
    await flush();
    assert.deepEqual(fetchGap.calls, [[T0, T0 + 3 * MIN], [T0 + 3 * MIN, T0 + 9 * MIN]]);
    assert.deepEqual(emitted.slice(2), [candle(T0 + 3 * MIN, 1, 1, 1, 1), seedBarFromTick(11, T0 + 9 * MIN)]);
  });

  it('seeds from the tick when a gap remains after history was applied', async () => {
    const now = T0 + 5 * MIN + 500;
    const fetchGap = spy(async () => [candle(T0, 100, 103, 99, 103, 7), candle(T0 + MIN, 103, 104, 102, 103.5, 2)]);
    const { folder, emitted } = setup({ now: () => now, fetchGap });
    folder.pushTick(80);
    folder.pushTick(82);
    await flush();
    assert.deepEqual(emitted, [
      candle(T0, 100, 103, 99, 103, 7),
      candle(T0 + MIN, 103, 104, 102, 103.5, 2),
      // History ends at +1 while the tick is at +5: no stale 103.5 bridges the hole.
      seedBarFromTick(80, T0 + 5 * MIN),
      { time: T0S + 300, open: 80, high: 82, low: 80, close: 82, volume: 0 },
    ]);
  });

  it('gives only the first replayed tick the open-at-tick fallback', async () => {
    for (const outcome of ['reject', 'empty'] as const) {
      let now = T0 + 5 * MIN + 59_000;
      const read = deferred<readonly Candle[]>();
      const { folder, emitted } = setup({ now: () => now, fetchGap: spy(() => read.promise) });
      folder.pushTick(80);
      now = T0 + 6 * MIN + 100; // boundary crossed while the read is in flight
      folder.pushTick(85);
      if (outcome === 'reject') read.reject(new Error('offline'));
      else read.resolve([]);
      await flush();
      assert.deepEqual(emitted, [
        seedBarFromTick(80, T0 + 5 * MIN),
        // The second bucket rolls at the previous close, not at its own tick.
        { time: T0S + 360, open: 80, high: 85, low: 80, close: 85, volume: 0 },
      ], outcome);
    }
  });

  it('still replays buffered ticks when onBar throws on a history bar', async () => {
    let now = T0 + 55_000;
    const emitted: Candle[] = [];
    let fail = true;
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      fetchGap: async () => [candle(T0, 100, 105, 99, 104, 3), candle(T0 + MIN, 104, 104, 102, 103)],
      onBar: (b) => {
        emitted.push(b);
        if (fail) {
          fail = false;
          throw new Error('consumer');
        }
      },
      now: () => now,
    });
    now = T0 + MIN + 5_000; // silent roll: repair
    folder.pushTick(97);
    await flush();
    // As in the app, the throw ends the history loop; nothing counted as
    // applied, so the replayed roll opens at its own price.
    assert.deepEqual(emitted, [candle(T0, 100, 105, 99, 104, 3), seedBarFromTick(97, T0 + MIN)]);
    assert.equal(folder.filling, false);
    now += 1_000;
    folder.pushTick(98);
    assert.deepEqual(emitted[2], { time: T0S + 60, open: 97, high: 98, low: 97, close: 98, volume: 0 });
  });

  it('rejects an intervalMs that is not a positive safe integer', () => {
    const bad = [0, -MIN, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, 60_000.3, 1_000 / 3, 2 ** 53];
    for (const intervalMs of bad) {
      assert.throws(
        () => createLiveBarFolder({ intervalMs, seedBar: null, onBar: () => {} }),
        /^Error: chart-ts: intervalMs must be a positive integer number of ms, got /,
      );
    }
    assert.doesNotThrow(() => createLiveBarFolder({ intervalMs: 1, seedBar: null, onBar: () => {} }));
  });

  it('honours custom silence thresholds', async () => {
    let now = T0 + 1_000;
    const fetchGap = spy(async () => []);
    const emitted: Candle[] = [];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      fetchGap,
      onBar: (b) => emitted.push(b),
      now: () => now,
      gapSilenceMs: 1_000,
      rollSilenceMs: Number.POSITIVE_INFINITY,
    });
    now += 999;
    folder.pushTick(101);
    assert.equal(fetchGap.calls.length, 0);
    now += 1_000;
    folder.pushTick(102);
    assert.equal(fetchGap.calls.length, 1);
    await flush();
    now = T0 + MIN + 30_000; // a long-silent roll, but roll repair is disabled
    folder.pushTick(103);
    assert.equal(fetchGap.calls.length, 1);
    assert.deepEqual(emitted[emitted.length - 1], { time: T0S + 60, open: 102, high: 103, low: 102, close: 103, volume: 0 });
  });

  it('defaults the clock to Date.now', () => {
    const intervalMs = 3_600_000;
    const emitted: Candle[] = [];
    const before = Date.now();
    const folder = createLiveBarFolder({ intervalMs, seedBar: null, onBar: (b) => emitted.push(b) });
    folder.pushTick(10);
    const after = Date.now();
    assert.equal(emitted.length, 1);
    const openMs = emitted[0]!.time * 1000;
    assert.ok(openMs >= bucketStartMs(before, intervalMs) && openMs <= bucketStartMs(after, intervalMs));
    assert.equal(openMs % intervalMs, 0);
  });
});

describe('createLiveBarFolder without fetchGap', () => {
  function bare(now: () => number, seedBar: Candle | null = seed) {
    const emitted: Candle[] = [];
    const folder = createLiveBarFolder({ intervalMs: MIN, seedBar, onBar: (b) => emitted.push(b), now });
    return { folder, emitted };
  }

  it('seeds a missed bucket from the tick synchronously', () => {
    const { folder, emitted } = bare(() => T0 + 5 * MIN + 500);
    folder.pushTick(80);
    assert.equal(folder.filling, false);
    assert.deepEqual(emitted, [seedBarFromTick(80, T0 + 5 * MIN)]);
  });

  it('updates in place after silence inside the same bucket', () => {
    let now = T0 + 1_000;
    const { folder, emitted } = bare(() => now);
    now += GAP_SILENCE_MS;
    folder.pushTick(102);
    assert.deepEqual(emitted, [{ time: T0S, open: 100, high: 102, low: 99, close: 102, volume: 5 }]);
  });

  it('opens a silent adjacent roll at the tick, not the stale close', () => {
    let now = T0 + 55_000;
    const { folder, emitted } = bare(() => now);
    folder.pushTick(100);
    now = T0 + MIN + 5_000;
    folder.pushTick(93);
    folder.pushTick(92.5);
    assert.deepEqual(emitted.slice(1), [
      seedBarFromTick(93, T0 + MIN),
      { time: T0S + 60, open: 93, high: 93, low: 92.5, close: 92.5, volume: 0 },
    ]);
  });

  it('folds live ticks normally', () => {
    let now = T0 + 59_000;
    const { folder, emitted } = bare(() => now);
    folder.pushTick(101);
    now = T0 + MIN + 500;
    folder.pushTick(99);
    assert.deepEqual(emitted, [
      { time: T0S, open: 100, high: 101, low: 99, close: 101, volume: 5 },
      { time: T0S + 60, open: 101, high: 101, low: 99, close: 99, volume: 0 },
    ]);
  });
});

describe('createLiveBarFolder with arbitrary intervals', () => {
  it('folds and rolls 5-second buckets and sizes the gap window by the interval', async () => {
    const I = 5_000;
    let now = T0 + 4_000;
    const fetchGap = spy(async () => []);
    const { folder, emitted } = setup({ now: () => now, fetchGap, intervalMs: I });
    folder.pushTick(101);
    now = T0 + I + 200;
    folder.pushTick(103);
    assert.deepEqual(emitted, [
      { time: T0S, open: 100, high: 101, low: 99, close: 101, volume: 5 },
      { time: T0S + 5, open: 101, high: 103, low: 101, close: 103, volume: 0 },
    ]);
    now = T0 + 3 * I + 400; // skipped T0 + 2I
    folder.pushTick(104);
    await flush();
    assert.deepEqual(fetchGap.calls, [[T0 + I, now]]);
    assert.deepEqual(emitted[emitted.length - 1], seedBarFromTick(104, T0 + 3 * I));
    now = T0 + 100_000 * I;
    folder.pushTick(105);
    await flush();
    assert.deepEqual(fetchGap.calls[1], [now - (MAX_GAP_BARS - 1) * I, now]);
  });

  it('aligns a 90-second interval to the epoch', () => {
    const I = 90_000;
    const start = bucketStartMs(T0, I);
    let now = start + I - 500;
    const { folder, emitted } = setup({ now: () => now, seed: null, intervalMs: I });
    folder.pushTick(10);
    now = start + I + 10;
    folder.pushTick(12);
    assert.deepEqual(emitted.map((e) => [e.time * 1000 - start, e.open, e.close]), [
      [0, 10, 10],
      [I, 10, 12],
    ]);
  });

  it('keeps distinct sub-second buckets with fractional times', async () => {
    const I = 250;
    let now = T0 + 10;
    const fetchGap = spy(async () => []);
    const { folder, emitted } = setup({ now: () => now, seed: null, fetchGap, intervalMs: I });
    folder.pushTick(10);
    now = T0 + 100;
    folder.pushTick(11);
    now = T0 + 260;
    folder.pushTick(9);
    assert.equal(fetchGap.calls.length, 0);
    assert.deepEqual(emitted.map((e) => [e.time, e.open, e.high, e.low, e.close]), [
      [T0S, 10, 10, 10, 10],
      [T0S, 10, 11, 10, 11],
      [T0S + 0.25, 11, 11, 9, 9],
    ]);
    now = T0 + 1_000; // skipped T0+500 and T0+750
    folder.pushTick(8);
    assert.equal(folder.filling, true);
    assert.deepEqual(fetchGap.calls, [[T0 + 250, T0 + 1_000]]);
    await flush();
    assert.deepEqual(emitted[emitted.length - 1], seedBarFromTick(8, T0 + 1_000));
    assert.equal(emitted[emitted.length - 1]!.time, T0S + 1);
  });
});

describe('createLiveBarFolder batch hook', () => {
  function batched(opts: { now: () => number; fetchGap?: FetchGap }) {
    const log: string[] = [];
    let depth = 0;
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      now: opts.now,
      ...(opts.fetchGap === undefined ? {} : { fetchGap: opts.fetchGap }),
      onBar: (b) => log.push(`${depth > 0 ? 'in' : 'out'}:${b.close}`),
      batch: (run) => {
        log.push('begin');
        depth++;
        run();
        depth--;
        log.push('end');
      },
    });
    return { folder, log };
  }

  it('wraps each repair burst, history then replayed ticks, in one batch call', async () => {
    let now = T0 + 3 * MIN + 5_000;
    const { folder, log } = batched({
      now: () => now,
      fetchGap: async () => [candle(T0, 100, 103, 99, 103), candle(T0 + MIN, 103, 104, 102, 104)],
    });
    folder.pushTick(90);
    folder.pushTick(91);
    assert.deepEqual(log, []);
    await flush();
    assert.deepEqual(log, ['begin', 'in:103', 'in:104', 'in:90', 'in:91', 'end']);
    now += 1_000;
    folder.pushTick(92); // live ticks are not wrapped
    assert.deepEqual(log.slice(6), ['out:92']);
  });

  it('wraps the replay after a failed read', async () => {
    const { folder, log } = batched({
      now: () => T0 + 5 * MIN,
      fetchGap: async () => {
        throw new Error('offline');
      },
    });
    folder.pushTick(80);
    folder.pushTick(81);
    await flush();
    assert.deepEqual(log, ['begin', 'in:80', 'in:81', 'end']);
  });

  it('is not called after dispose or for a synchronous gap without fetchGap', async () => {
    const read = deferred<readonly Candle[]>();
    const disposed = batched({ now: () => T0 + 5 * MIN, fetchGap: () => read.promise });
    disposed.folder.pushTick(80);
    disposed.folder.dispose();
    read.resolve([candle(T0 + 5 * MIN, 80, 80, 80, 80)]);
    await flush();
    assert.deepEqual(disposed.log, []);
    assert.equal(disposed.folder.filling, false);

    const bare = batched({ now: () => T0 + 5 * MIN });
    bare.folder.pushTick(80);
    assert.deepEqual(bare.log, ['out:80']);
  });

  it('redraws a chart once per repair with batch: chart.batch', async () => {
    const canvas = new MockCanvas(640, 400);
    const history = Array.from({ length: 50 }, (_, i) => candle(T0 - (49 - i) * MIN, 100, 101, 99, 100));
    const chart = createChart({ container: canvas, config: { data: history } });
    await chart.ready;
    // renderChart scales the context once per full redraw.
    const renders = () => canvas.context.countCalls('scale');
    let before = renders();
    chart.appendData(candle(T0, 100, 102, 99, 101));
    const perRender = renders() - before;
    assert.ok(perRender > 0);

    let now = T0 + 30 * MIN + 500;
    // History covers +1..+29; the ticks at +30 roll one new bucket.
    const gap = Array.from({ length: 29 }, (_, i) => candle(T0 + (i + 1) * MIN, 101, 102, 100, 101));
    const published: Candle[] = [];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: history[history.length - 1]!,
      fetchGap: async () => gap,
      onBar: (b) => {
        published.push(b);
        chart.appendData(b);
      },
      batch: (run) => chart.batch(run),
      now: () => now,
    });
    before = renders();
    folder.pushTick(101.5);
    folder.pushTick(101.25);
    await flush();
    assert.equal(published.length, 31); // 29 history bars + 2 replayed ticks
    assert.equal(renders() - before, perRender);
    assert.equal(chart.dataLength, 80); // 50 + 29 history + 1 rolled bucket
    assert.deepEqual(published.at(-1), { time: T0S + 1800, open: 101, high: 101.5, low: 101, close: 101.25, volume: 0 });
    chart.destroy();
  });
});
