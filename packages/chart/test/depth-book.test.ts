import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPTH_MAX_RETRY_BACKOFF_MS,
  DEPTH_RETRY_BACKOFF_MS,
  MAX_BUFFERED_DELTAS,
  MAX_RETRY_BACKOFF_MS,
  RETRY_BACKOFF_MS,
  applyDepthLevels,
  createDatafeedChart,
  createDepthBookManager,
  normalizeDepthSide,
  type Candle,
  type DatafeedChartOptions,
  type DatafeedDepthRequest,
  type DepthBook,
  type DepthDelta,
  type DepthLevel,
  type DepthSnapshot,
} from '../dist/datafeed/index.js';
import { createChart } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';

const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary

const bar = (tMs: number): Candle => ({ time: tMs / 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 });

function snap(lastUpdateId: number, bids: DepthLevel[] = [], asks: DepthLevel[] = [], time?: number): DepthSnapshot {
  return { lastUpdateId, bids, asks, ...(time === undefined ? {} : { time }) };
}

function delta(firstUpdateId: number, finalUpdateId: number, bids: DepthLevel[] = [], asks: DepthLevel[] = [], time?: number): DepthDelta {
  return { firstUpdateId, finalUpdateId, bids, asks, ...(time === undefined ? {} : { time }) };
}

interface Clock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

function clock(start = T0): Clock {
  let t = start;
  return {
    now: () => t,
    set: (ms) => {
      t = ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

interface HeldRead {
  readonly item: DepthSnapshot | Error;
  resolve(snapshot: DepthSnapshot): void;
  reject(error: unknown): void;
}

/** A snapshot source reading planned items in order (the fallback when the plan runs out), optionally held until settled. */
class FakeSnapshotSource {
  reads = 0;
  hold = false;
  private queue: Array<DepthSnapshot | Error> = [];
  private held: HeldRead[] = [];

  constructor(private readonly fallback: DepthSnapshot) {}

  plan(...items: Array<DepthSnapshot | Error>): void {
    this.queue.push(...items);
  }

  readonly fetch = (): Promise<DepthSnapshot> => {
    this.reads++;
    const item = this.queue.length > 0 ? this.queue.shift()! : this.fallback;
    if (!this.hold) return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
    let resolve!: (snapshot: DepthSnapshot) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<DepthSnapshot>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.held.push({ item, resolve, reject });
    return promise;
  };

  get pending(): number {
    return this.held.length;
  }

  /** Settles the oldest held read with its planned item. */
  settleNext(): void {
    const read = this.held.shift();
    if (read === undefined) throw new Error('no held snapshot read');
    if (read.item instanceof Error) read.reject(read.item);
    else read.resolve(read.item);
  }
}

/** Lets every settled read run to completion. */
async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function setup(opts: {
  src: FakeSnapshotSource;
  clock?: Clock;
  onBook?: (book: DepthBook) => void;
  maxBufferedDeltas?: number;
}) {
  const clk = opts.clock ?? clock();
  const books: DepthBook[] = [];
  const errors: unknown[] = [];
  const manager = createDepthBookManager({
    fetchSnapshot: opts.src.fetch,
    onBook: (book) => {
      books.push(book);
      opts.onBook?.(book);
    },
    now: clk.now,
    onError: (error) => errors.push(error),
    ...(opts.maxBufferedDeltas === undefined ? {} : { maxBufferedDeltas: opts.maxBufferedDeltas }),
  });
  return { manager, books, errors, clock: clk };
}

function setupFeed(opts: {
  src: FakeSnapshotSource | null;
  clock?: Clock;
  options?: Partial<DatafeedChartOptions>;
}): ReturnType<typeof createDatafeedChart> & {
  src: FakeSnapshotSource | null;
  requests: DatafeedDepthRequest[];
  errors: unknown[];
  canvas: MockCanvas;
  clock: Clock;
} {
  const clk = opts.clock ?? clock();
  const src = opts.src;
  const requests: DatafeedDepthRequest[] = [];
  const errors: unknown[] = [];
  const canvas = new MockCanvas(800, 400);
  const options: DatafeedChartOptions = {
    container: canvas,
    config: { wasm: false },
    fetchBars: async ({ toMs }) => (toMs >= T0 - MIN ? [bar(T0 - MIN), bar(T0)] : []),
    symbol: 'BTC',
    intervalMs: MIN,
    now: clk.now,
    onError: (error) => errors.push(error),
  };
  if (src !== null) {
    options.fetchDepthSnapshot = (request) => {
      requests.push(request);
      return src.fetch();
    };
  }
  const df = createDatafeedChart({ ...options, ...opts.options });
  return { ...df, src, requests, errors, canvas, clock: clk };
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

describe('depth constants', () => {
  it('mirror the datafeed retry backoff', () => {
    assert.equal(MAX_BUFFERED_DELTAS, 2_000);
    assert.equal(DEPTH_RETRY_BACKOFF_MS, RETRY_BACKOFF_MS);
    assert.equal(DEPTH_MAX_RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS);
  });
});

describe('normalizeDepthSide', () => {
  it('sorts bids descending and asks ascending', () => {
    assert.deepEqual(normalizeDepthSide([[99, 1], [101, 2], [100, 3]], true), [[101, 2], [100, 3], [99, 1]]);
    assert.deepEqual(normalizeDepthSide([[99, 1], [101, 2], [100, 3]], false), [[99, 1], [100, 3], [101, 2]]);
  });
  it('drops zero, negative and non-finite sizes and resolves duplicates last-wins', () => {
    assert.deepEqual(normalizeDepthSide([[100, 1], [100, 5], [99, 0], [101, Number.NaN]], true), [[100, 5]]);
    assert.deepEqual(normalizeDepthSide([[100, 0]], false), []);
  });
});

describe('applyDepthLevels', () => {
  it('upserts, inserts in order and removes at size 0', () => {
    const bids: DepthLevel[] = [[100, 1], [98, 1]];
    applyDepthLevels(bids, [[100, 5], [99, 2], [101, 1], [98, 0], [97, 0]], true);
    assert.deepEqual(bids, [[101, 1], [100, 5], [99, 2]]);
  });
  it('ignores levels with a non-finite or negative size or price', () => {
    const asks: DepthLevel[] = [[101, 1]];
    applyDepthLevels(asks, [[Number.NaN, 1], [102, -1], [101, Number.POSITIVE_INFINITY], [102, 3]], false);
    assert.deepEqual(asks, [[101, 1], [102, 3]]);
  });
});

describe('createDepthBookManager', () => {
  it('loads the snapshot and publishes a sorted book', async () => {
    const src = new FakeSnapshotSource(snap(100, [[99, 1], [100, 2]], [[102, 3], [101, 4]]));
    const t = setup({ src });
    assert.equal(t.manager.syncing, true);
    assert.equal(t.manager.book, null);
    await idle();
    assert.equal(src.reads, 1);
    assert.equal(t.manager.syncing, false);
    assert.deepEqual(t.books.length, 1);
    assert.deepEqual(t.books[0]!.bids, [[100, 2], [99, 1]]);
    assert.deepEqual(t.books[0]!.asks, [[101, 4], [102, 3]]);
    assert.equal(t.manager.book, t.books[0]);
    assert.deepEqual(t.errors, []);
  });

  it('buffers deltas until the snapshot lands, then drains them in order', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2], [99, 1]], [[101, 4], [102, 3]]));
    src.hold = true;
    const t = setup({ src });
    t.manager.pushDelta(delta(90, 100, [[100, 9]])); // covered by the snapshot: dropped
    t.manager.pushDelta(delta(101, 101, [[100, 5]], [[101, 0]], T0 + 1));
    assert.equal(t.books.length, 0);
    src.settleNext();
    await idle();
    assert.deepEqual(t.books.length, 2);
    assert.deepEqual(t.books[1]!.bids, [[100, 5], [99, 1]]);
    assert.deepEqual(t.books[1]!.asks, [[102, 3]]);
    assert.equal(t.books[1]!.time, T0 + 1);
    assert.deepEqual(t.errors, []);
  });

  it('applies live deltas and drops stale ones without publishing', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], [[101, 4]]));
    const t = setup({ src });
    await idle();
    t.manager.pushDelta(delta(101, 102, [[100, 5]], [[101, 0]]));
    t.manager.pushDelta(delta(50, 99, [[100, 9]])); // stale
    t.manager.pushDelta(delta(101, 102, [[100, 9]])); // already applied
    assert.deepEqual(t.books.length, 2);
    assert.deepEqual(t.books[1]!.bids, [[100, 5]]);
    assert.deepEqual(t.books[1]!.asks, []);
    assert.equal(src.reads, 1, 'stale deltas never resync');
  });

  it('resyncs from a fresh snapshot on a sequence gap', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], [[101, 4]]));
    const t = setup({ src });
    await idle();
    t.manager.pushDelta(delta(101, 101, [[100, 3]]));
    assert.deepEqual(t.books.length, 2);
    src.plan(snap(200, [[50, 1]], [[60, 1]]));
    t.manager.pushDelta(delta(105, 105, [[100, 7]]));
    assert.equal(t.manager.syncing, true);
    await idle();
    assert.equal(src.reads, 2);
    assert.equal(t.manager.syncing, false);
    // The gapped delta is stale against the new snapshot: the book never shows bid 100 @ 7.
    assert.deepEqual(t.books.length, 3);
    assert.deepEqual(t.books[2]!.bids, [[50, 1]]);
    assert.deepEqual(t.books[2]!.asks, [[60, 1]]);
    assert.deepEqual(t.errors, []);
  });

  it('a gap inside the drain resyncs after the backoff and keeps the remaining deltas', async () => {
    const clk = clock();
    const src = new FakeSnapshotSource(snap(10, [[10, 1]], [[20, 1]]));
    src.hold = true;
    src.plan(snap(10, [[10, 1]], [[20, 1]]), snap(14, [[11, 1]], [[21, 1]]));
    const t = setup({ src, clock: clk });
    t.manager.pushDelta(delta(11, 11, [[10, 2]]));
    t.manager.pushDelta(delta(15, 15, [[11, 5]]));
    t.manager.pushDelta(delta(16, 16, [], [[21, 0]]));
    src.settleNext();
    await idle();
    assert.deepEqual(t.books.length, 2, 'the drain stops at the gap');
    assert.deepEqual(t.books[1]!.bids, [[10, 2]]);
    assert.equal(t.manager.syncing, true);
    // The stream made no progress since the settle, so the resync waits out the backoff instead of hammering the source.
    assert.equal(src.reads, 1, 'no immediate re-read');
    t.manager.pushDelta(delta(17, 17, [[12, 1]]));
    assert.equal(src.reads, 1, 'the backoff has not elapsed');
    clk.advance(DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(18, 18, [[12, 2]]));
    assert.equal(src.reads, 2, 'the first delta after the backoff drives the resync');
    src.settleNext();
    await idle();
    assert.equal(t.manager.syncing, false);
    assert.deepEqual(t.books.length, 7);
    const last = t.books.at(-1)!;
    assert.deepEqual(last.bids, [[12, 2], [11, 5]]);
    assert.deepEqual(last.asks, [], 'the ask added by the second snapshot is removed again');
    assert.deepEqual(t.errors, []);
  });

  it('retries a failed snapshot read with doubling backoff, driven by arriving deltas', async () => {
    const clk = clock();
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.plan(new Error('offline'), new Error('offline'));
    const t = setup({ src, clock: clk });
    await idle();
    assert.equal(src.reads, 1);
    assert.deepEqual(t.errors.length, 1);
    assert.equal(t.manager.syncing, true);
    t.manager.pushDelta(delta(101, 101, [[100, 5]]));
    assert.equal(src.reads, 1, 'the backoff has not elapsed');
    clk.advance(DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(102, 102, [[100, 6]]));
    await idle();
    assert.equal(src.reads, 2);
    assert.deepEqual(t.errors.length, 2);
    clk.advance(DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(103, 103, [[100, 7]]));
    assert.equal(src.reads, 2, 'the doubled backoff has not elapsed');
    clk.advance(DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(104, 104, [[100, 8]]));
    await idle();
    assert.equal(src.reads, 3, 'retried once the doubled backoff elapsed');
    assert.equal(t.manager.syncing, false);
    const last = t.books.at(-1)!;
    assert.deepEqual(last.bids, [[100, 8]], 'every buffered delta drained in order after the retry');
    assert.deepEqual(t.errors.length, 2, 'a success reports nothing');
  });

  it('ignores deltas with invalid update ids', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    const t = setup({ src });
    await idle();
    t.manager.pushDelta(delta(Number.NaN, 101));
    t.manager.pushDelta(delta(105, 101));
    t.manager.pushDelta(delta(101.5, 101));
    assert.equal(t.books.length, 1);
    assert.equal(src.reads, 1, 'an invalid delta is neither applied nor a gap');
  });

  it('stops publishing after dispose, including a snapshot that lands later', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const t = setup({ src });
    t.manager.dispose();
    src.settleNext();
    await idle();
    t.manager.pushDelta(delta(101, 101, [[100, 5]]));
    assert.deepEqual(t.books, []);
    assert.equal(t.manager.book, null);
    assert.deepEqual(t.errors, []);
  });

  it('caps the deltas buffered while the snapshot is in flight, evicting the oldest', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const t = setup({ src, maxBufferedDeltas: 2 });
    t.manager.pushDelta(delta(99, 99, [[100, 9]]));
    t.manager.pushDelta(delta(100, 100, [[100, 8]]));
    t.manager.pushDelta(delta(101, 101, [[100, 5]]));
    src.settleNext();
    await idle();
    const last = t.books.at(-1)!;
    assert.deepEqual(last.bids, [[100, 5]], 'the evicted delta never applies');
  });

  it('an onBook throw in a live push reaches the caller', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    const clk = clock();
    const errors: unknown[] = [];
    let fail = false;
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: () => {
        if (fail) throw new Error('boom');
      },
      now: clk.now,
      onError: (error) => errors.push(error),
    });
    await idle();
    fail = true;
    assert.throws(() => manager.pushDelta(delta(101, 101, [[100, 5]])));
    assert.deepEqual(errors, []);
  });

  it('an onBook throw while the snapshot settles is reported, and the drain still applies', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], [[101, 4]]));
    src.hold = true;
    const clk = clock();
    const books: DepthBook[] = [];
    const errors: unknown[] = [];
    let fail = true;
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: (book) => {
        if (fail) {
          fail = false;
          throw new Error('boom');
        }
        books.push(book);
      },
      now: clk.now,
      onError: (error) => errors.push(error),
    });
    manager.pushDelta(delta(101, 101, [[100, 5]], [[101, 0]]));
    src.settleNext();
    await idle();
    assert.deepEqual(errors.length, 1, "the snapshot publish's error is reported");
    assert.deepEqual(books.length, 1, 'the buffered delta still published');
    assert.deepEqual(books[0]!.bids, [[100, 5]]);
    assert.deepEqual(books[0]!.asks, []);
  });

  it('an onBook throw on a drained delta is reported, and the deltas behind it still apply', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const books: DepthBook[] = [];
    const errors: unknown[] = [];
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: (book) => {
        books.push(book);
        if (books.length === 2) throw new Error('boom');
      },
      now: clock().now,
      onError: (error) => errors.push(error),
    });
    manager.pushDelta(delta(101, 101, [[100, 5]]));
    manager.pushDelta(delta(102, 102, [[100, 6]]));
    manager.pushDelta(delta(103, 103, [[100, 7]]));
    src.settleNext();
    await idle();
    assert.deepEqual(errors.length, 1, "the drained delta's publish error is reported");
    assert.deepEqual(books.length, 4, 'the drain continued past the throw');
    assert.deepEqual(manager.book!.bids, [[100, 7]]);
    manager.pushDelta(delta(104, 104, [[100, 8]]));
    assert.deepEqual(manager.book!.bids, [[100, 8]], 'the sequence continues live');
    assert.equal(src.reads, 1, 'no resync');
  });

  it('a drain that both throws and gaps reports the throw and resyncs after the backoff', async () => {
    const clk = clock();
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const errors: unknown[] = [];
    let publishes = 0;
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: () => {
        if (++publishes === 2) throw new Error('boom');
      },
      now: clk.now,
      onError: (error) => errors.push(error),
    });
    manager.pushDelta(delta(101, 101, [[100, 5]]));
    manager.pushDelta(delta(105, 105, [[100, 6]]));
    src.settleNext();
    await idle();
    assert.equal(errors.length, 1);
    assert.equal(manager.syncing, true, 'the gap resyncs');
    assert.equal(src.reads, 1, 'after the backoff');
  });

  it('dispose from onBook mid-drain stops the remaining deltas', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const books: DepthBook[] = [];
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: (book) => {
        books.push(book);
        if (books.length === 2) manager.dispose();
      },
      now: clock().now,
    });
    manager.pushDelta(delta(101, 101, [[100, 5]]));
    manager.pushDelta(delta(102, 102, [[100, 6]]));
    src.settleNext();
    await idle();
    assert.deepEqual(books.length, 2, 'the second buffered delta never publishes');
    assert.deepEqual(books[1]!.bids, [[100, 5]]);
  });

  it('a snapshot read failing after dispose is neither reported nor retried', async () => {
    const src = new FakeSnapshotSource(snap(100));
    src.hold = true;
    src.plan(new Error('offline'));
    const t = setup({ src });
    t.manager.dispose();
    src.settleNext();
    await idle();
    t.manager.pushDelta(delta(101, 101));
    assert.deepEqual(t.errors, []);
    assert.equal(src.reads, 1);
  });

  it('rejects a snapshot with an invalid lastUpdateId and retries it after the backoff', async () => {
    const clk = clock();
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.plan(snap(-1), snap(1.5));
    const t = setup({ src, clock: clk });
    await idle();
    assert.equal(t.errors.length, 1);
    assert.match(String(t.errors[0]), /lastUpdateId must be a nonnegative safe integer, got -1/);
    assert.deepEqual(t.books, []);
    assert.equal(t.manager.syncing, true);
    t.manager.pushDelta(delta(101, 101));
    assert.equal(src.reads, 1, 'the backoff has not elapsed');
    clk.advance(DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(102, 102));
    await idle();
    assert.equal(src.reads, 2);
    assert.match(String(t.errors[1]), /got 1\.5/);
    clk.advance(2 * DEPTH_RETRY_BACKOFF_MS);
    t.manager.pushDelta(delta(103, 103, [[100, 5]]));
    await idle();
    assert.equal(src.reads, 3);
    assert.equal(t.manager.syncing, false);
    assert.deepEqual(t.manager.book!.bids, [[100, 5]]);
  });

  it('drops errors thrown by onError itself, and defaults the clock to Date.now', async () => {
    const src = new FakeSnapshotSource(snap(100));
    src.plan(new Error('offline'));
    let calls = 0;
    const manager = createDepthBookManager({
      fetchSnapshot: src.fetch,
      onBook: () => {},
      onError: () => {
        calls++;
        throw new Error('handler failed');
      },
    });
    await idle();
    assert.equal(calls, 1);
    manager.pushDelta(delta(101, 101));
    assert.equal(src.reads, 1, 'Date.now has not moved past the default backoff');
    manager.dispose();
  });
});

describe('chart depth channel', () => {
  it('stores the book outside the candle store and re-renders on every update', () => {
    const canvas = new MockCanvas(800, 400);
    const chart = createChart({ container: canvas, config: { wasm: false } });
    assert.equal(chart.depth, null);
    const book: DepthBook = { bids: [[100, 1]], asks: [[101, 1]], time: T0 };
    const before = canvas.context.calls.length;
    chart.setDepth(book);
    assert.equal(chart.depth, book);
    assert.ok(canvas.context.calls.length > before, 'a book update re-renders');
    chart.setDepth(null);
    assert.equal(chart.depth, null);
    chart.destroy();
    assert.equal(chart.depth, null);
  });
});

describe('datafeed depth channel', () => {
  it('maintains a book for the current symbol, delivers it to subscribeDepth and re-renders on every update', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2], [99, 1]], [[101, 4]])) });
    const books: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    assert.equal(t.requests.length, 1);
    assert.equal(t.requests[0]!.symbol, 'BTC');
    assert.deepEqual(books.length, 1);
    assert.equal(t.chart.depth, books[0]);
    t.datafeed.pushDepth(delta(101, 101, [[100, 5]]));
    assert.deepEqual(books.length, 2);
    assert.deepEqual(books[1]!.bids, [[100, 5], [99, 1]]);
    assert.equal(t.chart.depth, books[1]);
    const before = t.canvas.context.calls.length;
    t.datafeed.pushDepth(delta(102, 102, [[99, 0]]));
    assert.ok(t.canvas.context.calls.length > before, 'every L2 update re-renders');
    assert.deepEqual(t.chart.depth!.bids, [[100, 5]]);
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('ignores depth events tagged with another symbol', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2]], [])) });
    const books: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    t.datafeed.pushDepth(delta(101, 101, [[100, 9]]), 'ETH');
    assert.deepEqual(books.length, 1);
    assert.deepEqual(t.chart.depth!.bids, [[100, 2]]);
    t.destroy();
  });

  it('resyncs through the datafeed after a sequence gap', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2]], [[101, 4]])) });
    const books: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    t.datafeed.pushDepth(delta(105, 105, [[100, 9]]));
    await idle();
    assert.equal(t.requests.length, 2, 'the gap re-read the snapshot');
    const last = books.at(-1)!;
    assert.deepEqual(last.bids, [[100, 2]], 'the gapped delta never reached the book');
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('a symbol switch clears the book and restarts depth for the new symbol', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2]], [[101, 4]])) });
    const btc: DepthBook[] = [];
    const eth: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => btc.push(book));
    t.datafeed.subscribeDepth('ETH', (book) => eth.push(book));
    await idle();
    assert.deepEqual(btc.length, 1);
    const switching = t.datafeed.setSymbol('ETH', MIN);
    assert.equal(t.chart.depth, null, 'the previous book leaves the chart at once');
    await switching;
    await idle();
    assert.equal(t.requests.length, 2);
    assert.equal(t.requests[1]!.symbol, 'ETH');
    assert.deepEqual(btc.length, 1, "the old symbol's listener hears nothing more");
    assert.deepEqual(eth.length, 1);
    assert.equal(t.chart.depth, eth[0]);
    t.destroy();
  });

  it('unsubscribe stops delivery but not the chart channel', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2]], [])) });
    const books: DepthBook[] = [];
    const off = t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    off();
    t.datafeed.pushDepth(delta(101, 101, [[100, 5]]));
    assert.deepEqual(books.length, 1);
    assert.deepEqual(t.chart.depth!.bids, [[100, 5]]);
    t.destroy();
  });

  it('destroy aborts the snapshot read and stops the depth channel', async () => {
    const src = new FakeSnapshotSource(snap(100, [[100, 2]], []));
    src.hold = true;
    const t = setupFeed({ src });
    const books: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    assert.equal(src.pending, 1);
    t.datafeed.destroy();
    assert.equal(t.requests[0]!.signal.aborted, true);
    assert.equal(t.chart.depth, null);
    src.settleNext();
    await idle();
    assert.deepEqual(books, [], 'a late snapshot never publishes');
    assert.deepEqual(t.errors, []);
    t.chart.destroy();
  });

  it('reports a depth listener failure instead of throwing into the feed callback', async () => {
    const t = setupFeed({ src: new FakeSnapshotSource(snap(100, [[100, 2]], [])) });
    let fail = false;
    t.datafeed.subscribeDepth('BTC', () => {
      if (fail) throw new Error('listener failed');
    });
    await idle();
    fail = true;
    assert.doesNotThrow(() => t.datafeed.pushDepth(delta(101, 101, [[100, 5]])));
    assert.equal(t.errors.length, 1);
    assert.match(String(t.errors[0]), /listener failed/);
    assert.deepEqual(t.chart.depth!.bids, [[100, 5]], 'the chart still received the book');
    t.destroy();
  });

  it('without fetchDepthSnapshot, pushDepth is ignored and subscribeDepth never fires', async () => {
    const t = setupFeed({ src: null });
    const books: DepthBook[] = [];
    t.datafeed.subscribeDepth('BTC', (book) => books.push(book));
    await idle();
    t.datafeed.pushDepth(delta(1, 1, [[100, 2]]));
    await idle();
    assert.deepEqual(books, []);
    assert.equal(t.chart.depth, null);
    assert.deepEqual(t.errors, []);
    t.destroy();
  });
});
