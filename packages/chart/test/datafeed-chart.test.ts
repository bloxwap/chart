import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INITIAL_BARS,
  DEFAULT_PAGE_BARS,
  MIN_LAZY_LOAD_THRESHOLD,
  RETRY_BACKOFF_MS,
  attachDatafeed,
  bucketStartMs,
  createDatafeedChart,
  createLiveBarFolder,
  type Candle,
  type DatafeedChartOptions,
  type DatafeedGapRequest,
  type DatafeedState,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';
import { createChart, type Chart } from '../dist/index.js';
import type { DataStore } from '../dist/core/data.js';
import { MockCanvas } from '../dist/dom.js';

const MIN = 60_000;
const M15 = 15 * MIN;
/** 7m01.234s into a 15m (and 1.234s into a 1m) bucket. */
const START = bucketStartMs(1_760_000_000_000, M15) + 7 * MIN + 1_234;

const BASE: Readonly<Record<string, number>> = { BTC: 60_000, ETH: 3_000 };

/** Deterministic exchange candle for `symbol` opening at `tMs`. */
function candleFor(symbol: string, tMs: number): Candle {
  const open = (BASE[symbol] ?? 10) * (1 + Math.sin(tMs / M15 / 9) / 100);
  return { time: tMs / 1000, open, high: open * 1.001, low: open * 0.999, close: open * 1.0005, volume: 7 };
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

interface Held {
  readonly request: FetchBarsRequest;
  release(): void;
  fail(error: unknown): void;
}

/**
 * Hyperliquid `candleSnapshot` stand-in: inclusive `[startTime, endTime]`, at
 * most `cap` rows per request, and only the latest `keep` candles exist per
 * interval. It never looks at the abort signal. `hold` parks responses until
 * released, for controllable latency.
 */
class FakeHyperliquid {
  readonly requests: FetchBarsRequest[] = [];
  readonly held: Held[] = [];
  hold = false;
  keep = 5_000;
  cap = 5_000;
  /** Also return the bar opening at `endTime + 1` (a sloppy inclusive boundary), with a poisoned close. */
  echoBoundary = false;
  /** Fail this many upcoming requests. */
  failures = 0;

  constructor(private readonly now: () => number) {}

  readonly fetchBars: FetchBars = (request) => {
    this.requests.push(request);
    if (this.failures > 0) {
      this.failures--;
      return Promise.reject(new Error('candleSnapshot 503'));
    }
    const rows = this.snapshot(request);
    if (!this.hold) return Promise.resolve(rows);
    const d = deferred<readonly Candle[]>();
    this.held.push({ request, release: () => d.resolve(rows), fail: (error) => d.reject(error) });
    return d.promise;
  };

  snapshot({ symbol, intervalMs, fromMs, toMs }: FetchBarsRequest): Candle[] {
    const latest = bucketStartMs(this.now(), intervalMs);
    const oldest = latest - (this.keep - 1) * intervalMs;
    const rows: Candle[] = [];
    for (let t = Math.max(oldest, Math.ceil(fromMs / intervalMs) * intervalMs); t <= Math.min(latest, toMs) && rows.length < this.cap; t += intervalMs) {
      rows.push(candleFor(symbol, t));
    }
    const echo = toMs + 1;
    if (this.echoBoundary && echo % intervalMs === 0 && echo >= oldest && echo <= latest) rows.push({ ...candleFor(symbol, echo), close: -1 });
    return rows;
  }
}

/** Lets every settled read run to completion. */
async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

const candles = (chart: Chart): readonly Candle[] => (chart as unknown as { store: DataStore }).store.raw();

/** Strictly increasing opens exactly one interval apart: no duplicate or missing bucket. */
function assertBuckets(rows: readonly Candle[], intervalMs: number): void {
  for (let i = 1; i < rows.length; i++) {
    const step = Math.round((rows[i]!.time - rows[i - 1]!.time) * 1000);
    assert.equal(step, intervalMs, `bar ${i}: step ${step} ms`);
  }
}

function setup(options: Partial<DatafeedChartOptions> = {}, width = 800) {
  let nowMs = START;
  const clock = {
    now: () => nowMs,
    set: (ms: number) => {
      nowMs = ms;
    },
  };
  const hl = new FakeHyperliquid(clock.now);
  const errors: unknown[] = [];
  const canvas = new MockCanvas(width, 400);
  const df = createDatafeedChart({
    container: canvas,
    config: { wasm: false },
    fetchBars: hl.fetchBars,
    now: clock.now,
    onError: (error) => errors.push(error),
    ...options,
  });
  const states: DatafeedState[] = [];
  df.datafeed.subscribeState((s) => states.push(s));
  return { ...df, hl, clock, errors, states, canvas };
}

/** Scrolls toward history until a read starts or `limit` steps pass. */
function panToEdge(chart: Chart, hl: FakeHyperliquid, limit = 200): void {
  const before = hl.requests.length;
  for (let i = 0; i < limit && hl.requests.length === before; i++) chart.scale.scrollBy(50);
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
before(() => {
  process.on('unhandledRejection', onUnhandled);
});
after(() => {
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, [], 'no unhandled rejections');
});

describe('datafeed defaults', () => {
  it('match the app', () => {
    assert.equal(DEFAULT_INITIAL_BARS, 500);
    assert.equal(DEFAULT_PAGE_BARS, 1_000);
    assert.equal(MIN_LAZY_LOAD_THRESHOLD, 50);
  });
});

describe('acceptance: BTC 15m history by scrolling left', () => {
  it('loads 5,000 bars from a Hyperliquid-like source with no duplicate or missing buckets, then stops', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    assert.deepEqual(t.states.length, 0, 'subscribed after the synchronous start');
    assert.equal(t.datafeed.loading, true);
    await idle();

    // Initial load: HISTORY_BARS ending now, shown at the latest bar.
    assert.equal(t.hl.requests.length, 1);
    const first = t.hl.requests[0]!;
    assert.deepEqual([first.symbol, first.intervalMs, first.fromMs, first.toMs, first.countBack],
      ['BTC', M15, bucketStartMs(START, M15) - 499 * M15, START, 500]);
    assert.equal(t.chart.dataLength, 500);
    assert.equal(candles(t.chart).at(-1)!.time * 1000, bucketStartMs(START, M15));
    assert.equal(t.chart.scale.visibleRange().to, 500);
    assert.equal(t.chart.getConfig().timeScale.intervalMs, M15);
    assert.equal(t.chart.getConfig().timeAxis.intervalMs, M15);
    assert.equal(t.hl.requests.length, 1, 'the initial viewport is far from the edge');

    const lengths: number[] = [];
    for (let i = 0; i < 40 && !t.datafeed.exhausted; i++) {
      panToEdge(t.chart, t.hl);
      await idle();
      lengths.push(t.chart.dataLength);
    }
    assert.ok(t.datafeed.exhausted);
    assert.deepEqual(lengths, [1_500, 2_500, 3_500, 4_500, 5_000]);
    // The last page comes up short at the start of the source's history; three empty pages then end it.
    assert.deepEqual(t.hl.requests.map((r) => r.countBack), [500, 1_000, 1_000, 1_000, 1_000, 1_000, 500, 5_000, 5_000]);
    for (let i = 1; i < t.hl.requests.length; i++) {
      const req = t.hl.requests[i]!;
      assert.equal((req.toMs + 1) % M15, 0, 'each page ends 1 ms before a loaded bar or the empty window after it');
      if (i >= 7) assert.equal(req.toMs, t.hl.requests[i - 1]!.fromMs - 1, 'the empty pages after the first span a whole request');
    }
    assert.equal(t.hl.requests[6]!.toMs, bucketStartMs(START, M15) - 4_999 * M15 - 1, 'the short page did not end paging');

    const rows = candles(t.chart);
    assert.equal(rows.length, 5_000);
    assertBuckets(rows, M15);
    assert.equal(rows[0]!.time * 1000, bucketStartMs(START, M15) - 4_999 * M15);
    assert.deepEqual(rows.slice(0, 3), [0, 1, 2].map((k) => candleFor('BTC', rows[0]!.time * 1000 + k * M15)));

    // Exhausted: panning further never asks again.
    for (let i = 0; i < 50; i++) t.chart.scale.scrollBy(25);
    await idle();
    assert.equal(t.hl.requests.length, 9);
    assert.deepEqual(await t.datafeed.loadMore(), 0);
    assert.deepEqual(t.datafeed.state, { symbol: 'BTC', intervalMs: M15, loading: false, exhausted: true, error: null });
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('never lands an echoed inclusive boundary bar twice', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, pageBars: 300 });
    t.hl.echoBoundary = true;
    await idle();
    assert.equal(await t.datafeed.loadMore(), 300);
    assert.equal(await t.datafeed.loadMore(200), 200);
    const rows = candles(t.chart);
    assert.equal(rows.length, 1_000);
    assertBuckets(rows, M15);
    assert.ok(rows.every((c) => c.close > 0), 'the poisoned echo never replaced a loaded bar');
    t.destroy();
  });

  it('pages through a smaller request cap', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, pageSize: 300 });
    await idle();
    assert.deepEqual(t.hl.requests.map((r) => r.countBack), [300, 200]);
    assert.equal(await t.datafeed.loadMore(), 1_000);
    assert.deepEqual(t.hl.requests.slice(2).map((r) => r.countBack), [300, 300, 300, 100]);
    assertBuckets(candles(t.chart), M15);
    t.destroy();
  });
});

describe('lazy loading', () => {
  it('re-checks the edge after each page, filling a zoomed-out viewport without more input', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, initialBars: 100, pageBars: 100 });
    await idle();
    // ~133 bars fit; the default threshold is the visible bar count.
    assert.equal(t.chart.dataLength, 300);
    assert.equal(t.hl.requests.length, 3);
    assertBuckets(candles(t.chart), M15);
    t.destroy();
  });

  it('honours an explicit lazyLoadThreshold', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, lazyLoadThreshold: 10 });
    await idle();
    const range = () => t.chart.scale.visibleRange();
    t.chart.scale.scrollBy(range().from - 20); // 20 bars left of the edge: no load
    await idle();
    assert.equal(t.hl.requests.length, 1);
    t.chart.scale.scrollBy(15);
    await idle();
    assert.equal(t.hl.requests.length, 2);
    assert.equal(t.chart.dataLength, 1_500);
    t.destroy();
  });

  it('is single flight: edge triggers and loadMore calls share the read in flight', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    await idle();
    t.hl.hold = true;
    panToEdge(t.chart, t.hl);
    for (let i = 0; i < 20; i++) t.chart.scale.scrollBy(10);
    assert.equal(t.hl.held.length, 1);
    assert.equal(t.datafeed.loading, true);
    const a = t.datafeed.loadMore();
    const b = t.datafeed.loadMore(5);
    assert.equal(a, b);
    t.hl.hold = false;
    t.hl.held[0]!.release();
    assert.equal(await a, 1_000);
    await idle();
    assert.ok(t.hl.requests.length >= 2);
    assertBuckets(candles(t.chart), M15);
    // Loading toggled on and off around the page.
    assert.deepEqual(t.states.slice(-2).map((s) => s.loading), [true, false]);
    t.destroy();
  });

  it('reports failures through state and onError, then retries on the next edge approach after the backoff only', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    await idle();
    const base = t.states.length;
    t.hl.failures = 1;
    panToEdge(t.chart, t.hl);
    await idle();
    assert.equal(t.hl.requests.length, 2);
    assert.equal(t.datafeed.loading, false);
    assert.match(String((t.datafeed.error as Error).message), /503/);
    assert.equal(t.errors.length, 1);
    assert.equal(t.chart.dataLength, 500);
    await idle();
    assert.equal(t.hl.requests.length, 2, 'no retry loop');

    t.clock.set(START + RETRY_BACKOFF_MS);
    t.chart.scale.scrollBy(1); // the next approach
    await idle();
    assert.equal(t.hl.requests.length, 3);
    assert.equal(t.chart.dataLength, 1_500);
    assert.equal(t.datafeed.error, null);
    assert.deepEqual(t.states.slice(base).map((s) => [s.loading, s.error === null]), [[true, true], [false, false], [true, false], [false, true]]);
    t.destroy();
  });

  it('loadMore without a bar to load neither reads nor marks the history exhausted', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    await idle();
    for (const bars of [0, -5, 0.5, NaN, Infinity, -Infinity]) {
      assert.equal(await t.datafeed.loadMore(bars), 0, String(bars));
    }
    assert.equal(t.hl.requests.length, 1);
    assert.equal(t.datafeed.exhausted, false);
    assert.equal(t.datafeed.loading, false);
    // Fractions round down.
    assert.equal(await t.datafeed.loadMore(2.9), 2);
    assert.equal(t.hl.requests.at(-1)!.countBack, 2);
    assert.equal(await t.datafeed.loadMore(), 1_000);
    assertBuckets(candles(t.chart), M15);
    t.destroy();
  });

  it('with a zero threshold, waits until blank space shows before the first bar', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, lazyLoadThreshold: 0 });
    await idle();
    let before = NaN;
    t.chart.subscribeVisibleRangeChange((e) => {
      before = e.barsBefore;
    });
    t.chart.scale.scrollBy(1);
    t.chart.scale.scrollBy(before - 0.25); // a quarter bar hidden past the left edge
    await idle();
    assert.ok(Math.abs(before - 0.25) < 1e-6, String(before));
    assert.equal(t.hl.requests.length, 1);
    t.chart.scale.scrollBy(0.5); // a quarter bar of blank space
    await idle();
    assert.equal(t.hl.requests.length, 2);
    assert.equal(t.chart.dataLength, 1_500);
    t.destroy();
  });

  it('pages from now when the chart was emptied under it', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    await idle();
    t.chart.setData([]);
    assert.equal(await t.datafeed.loadMore(), 1_000);
    assert.equal(t.hl.requests.at(-1)!.toMs, START);
    assertBuckets(candles(t.chart), M15);
    t.destroy();
  });
});

describe('symbol switching', () => {
  it('aborts the superseded load; its late result never touches the chart, even when the source ignores the signal', async () => {
    const t = setup();
    assert.deepEqual(t.datafeed.state, { symbol: null, intervalMs: null, loading: false, exhausted: false, error: null });
    t.hl.hold = true;
    const btc = t.datafeed.setSymbol('BTC', M15);
    const eth = t.datafeed.setSymbol('ETH', MIN);
    const [b, e] = t.hl.held;
    assert.equal(b!.request.signal.aborted, true);
    assert.equal(e!.request.signal.aborted, false);
    assert.equal(t.datafeed.symbol, 'ETH');
    assert.equal(t.datafeed.intervalMs, MIN);

    e!.release();
    await eth;
    b!.release();
    await btc;
    await idle();
    assert.equal(t.chart.dataLength, 500);
    assert.ok(candles(t.chart).every((c) => c.close < 10_000), 'only ETH bars');
    assertBuckets(candles(t.chart), MIN);
    assert.equal(t.chart.getConfig().timeScale.intervalMs, MIN);
    assert.deepEqual(t.errors, [], 'an abort is not an error');

    // A history page in flight is superseded the same way.
    const page = t.datafeed.loadMore();
    const next = t.datafeed.setSymbol('BTC', M15);
    const [, , p, n] = t.hl.held;
    assert.equal(p!.request.signal.aborted, true);
    p!.release();
    assert.equal(await page, 0);
    assert.equal(t.chart.dataLength, 500, 'the stale ETH page was not prepended');
    n!.release();
    await next;
    assert.ok(candles(t.chart).every((c) => c.close > 10_000), 'only BTC bars');
    assertBuckets(candles(t.chart), M15);
    t.destroy();
  });

  it('drops a result whose symbol was switched after the read finished but before it applied', async () => {
    let nowMs = START;
    const hl = new FakeHyperliquid(() => nowMs);
    let race: (() => void) | null = null;
    // One microtask after the read settles: past loadHistory's abort check, before the datafeed applies it.
    const fetchBars: FetchBars = (request) => {
      const rows = hl.fetchBars(request);
      const run = race;
      race = null;
      if (run !== null) void rows.then(() => undefined).then(run);
      return rows;
    };
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false }, now: () => nowMs });
    const datafeed = attachDatafeed(chart, { fetchBars });
    const landed: string[] = [];
    chart.subscribeDataLoad((e) => {
      landed.push(`${e.reason}:${candles(chart).some((c) => c.close > 10_000) ? 'BTC' : 'ETH'}:${e.length}`);
    });

    race = () => void datafeed.setSymbol('ETH', M15);
    await datafeed.setSymbol('BTC', M15);
    await idle();
    assert.equal(datafeed.symbol, 'ETH');
    assert.deepEqual(landed, ['set:ETH:500'], 'the BTC bars never landed');

    race = () => void datafeed.setSymbol('BTC', M15);
    assert.equal(await datafeed.loadMore(), 0);
    await idle();
    assert.deepEqual(landed, ['set:ETH:500', 'set:BTC:500'], 'the ETH page never landed');
    assert.equal(chart.dataLength, 500);
    assertBuckets(candles(chart), M15);
    datafeed.destroy();
    chart.destroy();
  });

  it('scrolls to the latest bar so a shorter dataset never leaves an empty viewport', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15, initialBars: 3_000 });
    await idle();
    t.chart.scale.scrollBy(2_500);
    t.hl.keep = 120;
    await t.datafeed.setSymbol('ETH', M15);
    const range = t.chart.scale.visibleRange();
    assert.equal(t.chart.dataLength, 120);
    assert.equal(range.to, 120);
    assert.ok(range.from < range.to);
    t.destroy();
  });

  it('clears the previous symbol when a switch fails, and retries through loadMore', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    await idle();
    t.hl.failures = 1;
    await t.datafeed.setSymbol('ETH', M15);
    assert.equal(t.chart.dataLength, 0);
    assert.equal(t.datafeed.symbol, 'ETH');
    assert.match(String(t.datafeed.error), /503/);
    t.datafeed.pushTick(3_000); // no history yet: ignored
    assert.equal(t.chart.dataLength, 0);

    assert.equal(await t.datafeed.loadMore(), 500);
    assert.equal(t.datafeed.error, null);
    assert.ok(candles(t.chart).every((c) => c.close < 10_000));
    t.destroy();
  });

  it('survives a switch made from inside a chart listener during the load', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: M15 });
    let switched = false;
    t.chart.subscribeDataLoad(() => {
      if (switched) return;
      switched = true;
      void t.datafeed.setSymbol('ETH', M15);
    });
    await idle();
    assert.equal(t.datafeed.symbol, 'ETH');
    assert.equal(t.chart.dataLength, 500);
    assert.ok(candles(t.chart).every((c) => c.close < 10_000));
    t.destroy();
  });

  it('marks an empty history exhausted at once; ticks then start the series', async () => {
    const t = setup();
    t.hl.keep = 0;
    await t.datafeed.setSymbol('NEW', MIN);
    assert.equal(t.chart.dataLength, 0);
    assert.equal(t.datafeed.exhausted, true);
    assert.equal(await t.datafeed.loadMore(), 0);
    assert.deepEqual(t.hl.requests.map((r) => r.countBack), [500, 5_000, 5_000], 'maxEmptyPages empty pages, then no more reads');
    t.datafeed.pushTick(12.5);
    assert.deepEqual(candles(t.chart), [{ time: bucketStartMs(START, MIN) / 1000, open: 12.5, high: 12.5, low: 12.5, close: 12.5, volume: 0 }]);
    t.destroy();
  });
});

describe('live ticks', () => {
  it('ignores ticks before history lands, updates the forming bar, rolls buckets and backfills gaps via fetchBars', async () => {
    const t = setup();
    t.hl.hold = true;
    const loading = t.datafeed.setSymbol('BTC', MIN);
    t.datafeed.pushTick(61_000);
    assert.equal(t.chart.dataLength, 0);
    t.hl.hold = false;
    t.hl.held[0]!.release();
    await loading;
    assert.equal(t.chart.dataLength, 500);
    const forming = candles(t.chart).at(-1)!;

    // Same bucket: the forming bar updates in place.
    t.clock.set(START + 1_000);
    t.datafeed.pushTick(forming.high + 10);
    let last = candles(t.chart).at(-1)!;
    assert.equal(t.chart.dataLength, 500);
    assert.deepEqual(last, { ...forming, high: forming.high + 10, close: forming.high + 10 });

    // Ticks every second across the boundary: one roll into a bar opening at the previous close.
    const next = bucketStartMs(START, MIN) + MIN;
    let now = START + 1_000;
    while (now < next + 500) {
      now += 1_000;
      t.clock.set(now);
      t.datafeed.pushTick(61_234);
      t.datafeed.pushTick(99_999, 'ETH'); // another symbol's tick: ignored
    }
    last = candles(t.chart).at(-1)!;
    assert.equal(t.chart.dataLength, 501);
    assert.deepEqual(last, { time: next / 1000, open: 61_234, high: 61_234, low: 61_234, close: 61_234, volume: 0 });
    assert.equal(t.hl.requests.length, 1, 'steady ticks need no backfill');

    // Three buckets of silence: the missed bars are read back through fetchBars before the tick replays.
    t.clock.set(next + 3 * MIN + 2_000);
    t.datafeed.pushTick(62_000, 'BTC');
    await idle();
    const gap = t.hl.requests[1]!;
    assert.deepEqual([gap.symbol, gap.intervalMs, gap.fromMs, gap.toMs, gap.signal.aborted], ['BTC', MIN, next, next + 3 * MIN + 2_000, false]);
    const rows = candles(t.chart);
    assert.equal(rows.length, 504);
    assertBuckets(rows, MIN);
    assert.equal(rows.at(-1)!.close, 62_000);
    assert.deepEqual(rows.at(-2), candleFor('BTC', next + 2 * MIN));
    t.destroy();
  });

  it('reports a failed gap read and still folds the tick; a superseded gap read stays quiet', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: MIN });
    await idle();
    t.hl.failures = 1;
    t.clock.set(START + 3 * MIN);
    t.datafeed.pushTick(60_100);
    await idle();
    assert.deepEqual(t.errors.map((e) => (e as Error).message), ['candleSnapshot 503']);
    assert.equal(t.chart.dataLength, 501, 'the tick opened its own bucket');
    assert.equal(candles(t.chart).at(-1)!.close, 60_100);

    t.hl.hold = true;
    t.clock.set(START + 6 * MIN);
    t.datafeed.pushTick(60_200); // gap read held
    const switching = t.datafeed.setSymbol('ETH', MIN);
    const [gapRead, eth] = t.hl.held;
    assert.equal(gapRead!.request.signal.aborted, true);
    gapRead!.release(); // the source ignored the abort
    eth!.release();
    await switching;
    await idle();
    assert.equal(t.errors.length, 1);
    assert.ok(candles(t.chart).every((c) => c.close < 10_000));
    t.destroy();
  });

  it('routes gap repair through a custom fetchGap with the current symbol', async () => {
    let nowMs = START;
    const hl = new FakeHyperliquid(() => nowMs);
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false }, now: () => nowMs });
    const calls: Array<[number, number, DatafeedGapRequest]> = [];
    const datafeed = attachDatafeed(chart, {
      fetchBars: hl.fetchBars,
      fetchGap: async (fromMs, toMs, request) => {
        calls.push([fromMs, toMs, request]);
        return [];
      },
    });
    await datafeed.setSymbol('ETH', MIN);
    nowMs = START + 5 * MIN; // the datafeed follows the chart's clock
    datafeed.pushTick(3_100);
    await idle();
    assert.equal(calls.length, 1);
    const [fromMs, toMs, request] = calls[0]!;
    assert.deepEqual([fromMs, toMs, request.symbol, request.intervalMs, request.signal.aborted],
      [bucketStartMs(START, MIN), START + 5 * MIN, 'ETH', MIN, false]);
    // Nothing came back: the tick opens its own bucket.
    assert.deepEqual(candles(chart).at(-1), { time: bucketStartMs(START + 5 * MIN, MIN) / 1000, open: 3_100, high: 3_100, low: 3_100, close: 3_100, volume: 0 });
    datafeed.destroy();
    assert.equal(request.signal.aborted, true);
    assert.equal(chart.isDestroyed(), false, 'detaching leaves the chart alive');
    chart.destroy();
  });

  it('reports errors thrown while a repair publishes, without unhandled rejections', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: MIN });
    await idle();
    let armed = true;
    t.chart.subscribeDataLoad(() => {
      if (armed) throw new Error('listener failed');
    });
    t.clock.set(START + 3 * MIN);
    t.datafeed.pushTick(60_500);
    await idle();
    armed = false;
    assert.ok(t.errors.length > 0);
    assert.ok(t.errors.every((e) => (e as Error).message === 'listener failed'));
    t.destroy();
  });
});

describe('live tick errors', () => {
  it('reports a chart listener failure from a tick to onError instead of throwing into the price feed', async () => {
    const t = setup({ symbol: 'BTC', intervalMs: MIN });
    await idle();
    let armed = true;
    t.chart.subscribeDataLoad(() => {
      if (armed) throw new Error('host listener');
    });
    const before = candles(t.chart).at(-1)!;
    t.clock.set(START + 1_000);
    assert.doesNotThrow(() => t.datafeed.pushTick(before.high + 5));
    assert.deepEqual(t.errors.map((e) => (e as Error).message), ['host listener']);
    // The tick still landed.
    assert.equal(candles(t.chart).at(-1)!.close, before.high + 5);
    armed = false;
    t.datafeed.pushTick(before.high + 6);
    assert.equal(t.errors.length, 1);
    assert.equal(candles(t.chart).at(-1)!.close, before.high + 6);
    t.destroy();
  });
});

describe('createLiveBarFolder onError', () => {
  const seed: Candle = { time: bucketStartMs(START, MIN) / 1000, open: 1, high: 1, low: 1, close: 1, volume: 0 };

  it('receives an onBar failure during the history replay and during the tick replay', async () => {
    const errors: unknown[] = [];
    let nowMs = START;
    let failOn: 'history' | 'tick' | null = 'history';
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      now: () => nowMs,
      fetchGap: async (fromMs) => [{ ...seed, time: fromMs / 1000 + 60, volume: 5 }],
      onBar: (bar) => {
        if (failOn === 'history' && bar.volume !== 0) throw new Error('history bar');
        if (failOn === 'tick' && bar.volume === 0) throw new Error('tick bar');
      },
      onError: (error) => errors.push(error),
    });
    nowMs += 3 * MIN;
    folder.pushTick(2); // gap: repair, whose history bar fails
    await idle();
    assert.deepEqual(errors.map((e) => (e as Error).message), ['history bar']);
    assert.equal(folder.bar!.close, 2, 'the buffered tick still replayed');

    failOn = 'tick';
    nowMs += 3 * MIN;
    folder.pushTick(3); // the replayed tick fails
    await idle();
    assert.deepEqual(errors.map((e) => (e as Error).message), ['history bar', 'tick bar']);
    assert.equal(folder.filling, false);
    folder.dispose();
  });

  it('contains an onError that throws, so a repair never rejects unhandled', async () => {
    let nowMs = START;
    const reported: string[] = [];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      now: () => nowMs,
      fetchGap: async (fromMs) => [{ ...seed, time: fromMs / 1000 + 60, volume: 5 }],
      onBar: (bar) => {
        throw new Error(bar.volume === 0 ? 'tick bar' : 'history bar');
      },
      onError: (error) => {
        reported.push((error as Error).message);
        throw new Error('onError also failed');
      },
    });
    nowMs += 3 * MIN;
    folder.pushTick(2); // the history bar and then the replayed tick both fail
    await idle();
    assert.deepEqual(reported, ['history bar', 'tick bar']);
    assert.equal(folder.filling, false);
    folder.dispose();
    // The file-level hook asserts no unhandled rejection surfaced.
  });

  it('swallows a replay failure when no onError is given', async () => {
    let nowMs = START;
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: seed,
      now: () => nowMs,
      fetchGap: async () => [],
      onBar: () => {
        throw new Error('ignored');
      },
    });
    nowMs += 3 * MIN;
    folder.pushTick(2);
    await idle();
    assert.equal(folder.filling, false);
  });
});

describe('state, errors and teardown', () => {
  it('reports state listener failures, and survives a throwing onError', async () => {
    const t = setup({
      onError: () => {
        throw new Error('handler failed');
      },
    });
    const errors: unknown[] = [];
    const t2 = setup({ onError: (error) => errors.push(error) });
    for (const x of [t, t2]) {
      x.datafeed.subscribeState(() => {
        throw new Error('listener failed');
      });
      await x.datafeed.setSymbol('BTC', M15);
      assert.equal(x.chart.dataLength, 500);
    }
    assert.deepEqual(errors.map((e) => (e as Error).message), ['listener failed', 'listener failed']);
    t.hl.failures = 1;
    await t.datafeed.setSymbol('ETH', M15); // the load failure reaches the throwing handler too
    assert.match(String(t.datafeed.error), /503/);
    t.destroy();
    t2.destroy();
  });

  it('unsubscribes state listeners', async () => {
    const t = setup();
    const seen: DatafeedState[] = [];
    const off = t.datafeed.subscribeState((s) => seen.push(s));
    off();
    await t.datafeed.setSymbol('BTC', M15);
    assert.deepEqual(seen, []);
    assert.equal(t.states.length, 2);
    t.destroy();
  });

  it('destroy aborts reads, ignores their results, detaches and destroys the chart', async () => {
    const t = setup();
    t.hl.hold = true;
    const loading = t.datafeed.setSymbol('BTC', M15);
    const [held] = t.hl.held;
    t.destroy();
    assert.equal(held!.request.signal.aborted, true);
    assert.equal(t.chart.isDestroyed(), true);
    held!.release();
    await loading;
    assert.equal(t.chart.dataLength, 0);
    assert.deepEqual(t.datafeed.state, { symbol: null, intervalMs: null, loading: false, exhausted: false, error: null });

    await t.datafeed.setSymbol('ETH', M15);
    assert.equal(await t.datafeed.loadMore(), 0);
    t.datafeed.pushTick(1);
    t.datafeed.destroy();
    assert.equal(t.hl.requests.length, 1);
    assert.equal(t.states.length, 1, 'nothing after destroy');
  });

  it('stops lazy loading once detached, leaving the chart usable', async () => {
    let nowMs = START;
    const hl = new FakeHyperliquid(() => nowMs);
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false } });
    const datafeed = attachDatafeed(chart, { fetchBars: hl.fetchBars, now: () => nowMs, symbol: 'BTC', intervalMs: M15 });
    for (let i = 0; i < 10; i++) chart.scale.scrollBy(50); // before history lands: no page reads
    await idle();
    assert.equal(hl.requests.length, 1);
    datafeed.destroy();
    for (let i = 0; i < 50; i++) chart.scale.scrollBy(50);
    await idle();
    assert.equal(hl.requests.length, 1);
    assert.equal(chart.dataLength, 500);
    chart.destroy();
  });

  it('validates bar counts and the lazy-load threshold', () => {
    const hl = new FakeHyperliquid(() => START);
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false } });
    const attach = (options: Partial<DatafeedChartOptions>) => () => attachDatafeed(chart, { fetchBars: hl.fetchBars, symbol: 'BTC', intervalMs: M15, ...options });
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(attach({ initialBars: bad }), /chart-ts: initialBars must be a positive integer/);
      assert.throws(attach({ pageBars: bad }), /chart-ts: pageBars must be a positive integer/);
      assert.throws(attach({ pageSize: bad }), /chart-ts: pageSize must be a positive integer/);
      assert.throws(attach({ maxEmptyPages: bad }), /chart-ts: maxEmptyPages must be a positive integer/);
    }
    for (const bad of [-1, NaN, Infinity]) {
      assert.throws(attach({ lazyLoadThreshold: bad }), /chart-ts: lazyLoadThreshold must be finite and nonnegative/);
    }
    assert.throws(() => createDatafeedChart({ container: new MockCanvas(10, 10), fetchBars: hl.fetchBars, initialBars: 0 }), /initialBars/);
    assert.equal(hl.requests.length, 0, 'nothing was read');
    const datafeed = attachDatafeed(chart, { fetchBars: hl.fetchBars, initialBars: 1, pageBars: 1, pageSize: 1, maxEmptyPages: 1, lazyLoadThreshold: 0.5 });
    datafeed.destroy();
    chart.destroy();
  });

  it('validates the symbol and interval', () => {
    const hl = new FakeHyperliquid(() => START);
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false } });
    assert.throws(() => attachDatafeed(chart, { fetchBars: hl.fetchBars, symbol: 'BTC' }), /symbol and intervalMs together/);
    assert.throws(() => attachDatafeed(chart, { fetchBars: hl.fetchBars, intervalMs: M15 }), /symbol and intervalMs together/);
    assert.throws(() => attachDatafeed(chart, { fetchBars: hl.fetchBars, symbol: 'BTC', intervalMs: 0 }), /positive integer/);
    assert.throws(() => createDatafeedChart({ container: new MockCanvas(10, 10), fetchBars: hl.fetchBars, symbol: 'BTC' }), /together/);
    const datafeed = attachDatafeed(chart, { fetchBars: hl.fetchBars, now: () => START });
    assert.throws(() => datafeed.setSymbol('BTC', 1.5), /positive integer/);
    // The failed attachments left no listeners behind.
    for (let i = 0; i < 20; i++) chart.scale.scrollBy(-5);
    assert.equal(hl.requests.length, 0);
    datafeed.destroy();
    chart.destroy();
  });
});
