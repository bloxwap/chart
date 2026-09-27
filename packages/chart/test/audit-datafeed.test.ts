/**
 * Regressions from the whole-diff datafeed audit:
 *
 * - A failing history read is retried by the left edge only after a backoff
 *   (`RETRY_BACKOFF_MS`, doubling per failure in a row up to
 *   `MAX_RETRY_BACKOFF_MS`), so a drag or fling at the edge no longer sends
 *   one request per frame to a rate-limited source. `loadMore()` still
 *   retries at once, and a successful load or a switch resets the backoff.
 * - `pageSize` set to a source's row cap pages a source that truncates a
 *   window to its earliest rows without holes (the documented contract).
 * - A host-side tick queue (the playground's, before it passed its frame
 *   scheduler to the datafeed's `scheduler` option) folds ticks as they
 *   arrive while the tab is hidden: a hidden tab gets no animation frames,
 *   and a queued tick would land in the bucket of the moment it is flushed.
 *   The playground's current path is covered in polish-scheduling.test.ts.
 *
 * Paging past holes (weekends, closed sessions, missing buckets) is covered
 * in audit-requirements.test.ts and datafeed-pagination.test.ts; the
 * crosshair's re-emit after a prepend under a still pointer in
 * audit-core.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RETRY_BACKOFF_MS,
  RETRY_BACKOFF_MS,
  bucketStartMs,
  createDatafeedChart,
  type Candle,
  type DatafeedChartOptions,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';
import { createFrameScheduler, type UIWindow } from '../dist/ui/index.js';
import { MockCanvas } from '../dist/dom.js';

const MIN = 60_000;
const M15 = 15 * MIN;
/** 7m01.234s into a 15m bucket. */
const START = bucketStartMs(1_760_000_000_000, M15) + 7 * MIN + 1_234;

const bar = (tMs: number): Candle => {
  const close = 100 + Math.sin(tMs / MIN / 7);
  return { time: tMs / 1000, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 };
};

/** Lets every settled read run to completion. */
async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** A datafeed chart over a contiguous 15m source that fails every read while `down` is set. */
function setup(options: Partial<DatafeedChartOptions> = {}) {
  let nowMs = START;
  const requests: FetchBarsRequest[] = [];
  const errors: unknown[] = [];
  const source = { down: false };
  const fetchBars: FetchBars = async (req) => {
    requests.push(req);
    if (source.down) throw new Error('429 Too Many Requests');
    const rows: Candle[] = [];
    for (let t = Math.ceil(req.fromMs / req.intervalMs) * req.intervalMs; t <= Math.min(req.toMs, nowMs); t += req.intervalMs) rows.push(bar(t));
    return rows;
  };
  const df = createDatafeedChart({
    container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars, now: () => nowMs,
    onError: (error) => errors.push(error), symbol: 'BTC', intervalMs: M15, ...options,
  });
  /** Scrolls toward history until a read starts. */
  const panToEdge = (): void => {
    const before = requests.length;
    for (let i = 0; i < 200 && requests.length === before; i++) df.chart.scale.scrollBy(50);
  };
  /** One drag frame at the edge: a visible-range change that keeps the view where it is. */
  const frame = async (): Promise<void> => {
    df.chart.scale.scrollBy(1);
    df.chart.scale.scrollBy(-1);
    await idle();
  };
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  return { ...df, requests, errors, source, panToEdge, frame, advance };
}

describe('audit (datafeed): the left edge backs off a failing source', () => {
  it('sends one read for a whole drag at the edge, then retries after 1 s, doubling per failure up to 30 s', async () => {
    const t = setup();
    await idle();
    assert.equal(t.chart.dataLength, 500);
    t.source.down = true;
    t.panToEdge();
    await idle();
    assert.equal(t.requests.length, 2);
    assert.equal(t.errors.length, 1);
    // Two seconds of 60 fps drag frames at a still clock: the edge waits out the backoff.
    for (let f = 0; f < 120; f++) await t.frame();
    assert.equal(t.requests.length, 2, 'no read per frame');
    assert.equal(t.errors.length, 1);

    const waits = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [i, wait] of waits.entries()) {
      assert.equal(wait, Math.min(MAX_RETRY_BACKOFF_MS, RETRY_BACKOFF_MS * 2 ** i));
      const reads: number = t.requests.length; // annotated: assert.equal narrows the length in the loop
      t.advance(wait - 1);
      await t.frame();
      assert.equal(t.requests.length, reads, `still backing off ${wait - 1} ms after failure ${i + 1}`);
      t.advance(1);
      await t.frame();
      assert.equal(t.requests.length, reads + 1, `the edge retries ${wait} ms after failure ${i + 1}`);
    }
    assert.equal(t.errors.length, 8);
    assert.match(String((t.datafeed.error as Error).message), /429/);
    assert.equal(t.datafeed.loading, false);
    assert.equal(t.datafeed.exhausted, false);
    assert.equal(t.chart.dataLength, 500);
    t.destroy();
  });

  it('retries at once through loadMore(); a success resets the backoff, and the edge resumes paging', async () => {
    const t = setup();
    await idle();
    t.source.down = true;
    t.panToEdge();
    await idle();
    for (let i = 0; i < 3; i++) {
      t.advance(MAX_RETRY_BACKOFF_MS);
      await t.frame();
    }
    assert.equal(t.requests.length, 5, 'four failures in a row: the next wait is 8 s');

    // An explicit call ignores the backoff, even while it fails.
    assert.equal(await t.datafeed.loadMore(), 0);
    assert.equal(t.requests.length, 6);
    t.source.down = false;
    assert.equal(await t.datafeed.loadMore(), 1_000);
    assert.equal(t.datafeed.error, null);
    assert.equal(t.chart.dataLength, 1_500);
    // The clock never moved: the success cleared the backoff, so the next approach reads at once.
    const afterSuccess = t.requests.length;
    t.panToEdge();
    await idle();
    assert.equal(t.requests.length, afterSuccess + 1, 'the edge reads again without waiting');
    assert.equal(t.chart.dataLength, 2_500);

    // The next failure starts over at 1 s.
    t.source.down = true;
    t.panToEdge();
    await idle();
    const failed = t.requests.length;
    t.advance(RETRY_BACKOFF_MS - 1);
    await t.frame();
    assert.equal(t.requests.length, failed);
    t.advance(1);
    await t.frame();
    assert.equal(t.requests.length, failed + 1);
    t.destroy();
  });

  it('starts a new symbol without the previous one’s backoff', async () => {
    const t = setup();
    await idle();
    t.source.down = true;
    t.panToEdge();
    await idle();
    await t.frame();
    const failed = t.requests.length;
    t.source.down = false;
    await t.datafeed.setSymbol('ETH', M15);
    assert.equal(t.requests.length, failed + 1);
    t.source.down = true;
    t.panToEdge();
    await idle();
    assert.equal(t.requests.length, failed + 2, 'ETH reads at its first approach');
    assert.equal(t.datafeed.symbol, 'ETH');
    t.destroy();
  });

  it('exports the backoff bounds', () => {
    assert.equal(RETRY_BACKOFF_MS, 1_000);
    assert.equal(MAX_RETRY_BACKOFF_MS, 30_000);
  });
});

describe('audit (datafeed): pageSize at the source’s row cap', () => {
  it('pages a source that truncates a window to its earliest rows without holes', async () => {
    const CAP = 500;
    const nowMs = START;
    const requests: FetchBarsRequest[] = [];
    // Binance klines-style: at most CAP rows, the earliest ones in the window.
    const fetchBars: FetchBars = async (req) => {
      requests.push(req);
      const rows: Candle[] = [];
      for (let t = Math.ceil(req.fromMs / req.intervalMs) * req.intervalMs; t <= Math.min(req.toMs, nowMs) && rows.length < CAP; t += req.intervalMs) rows.push(bar(t));
      return rows;
    };
    const { chart, datafeed, destroy } = createDatafeedChart({
      container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars, now: () => nowMs,
      symbol: 'BTC', intervalMs: M15, initialBars: 400, pageBars: 1_200, pageSize: CAP,
    });
    await datafeed.loadMore();
    while (chart.dataLength < 4_000) assert.ok((await datafeed.loadMore()) > 0);
    const data = chart.getData();
    for (let i = 1; i < data.length; i++) assert.equal(Math.round((data[i]!.time - data[i - 1]!.time) * 1000), M15, `bar ${i}`);
    assert.equal(data.at(-1)!.time * 1000, bucketStartMs(nowMs, M15), 'the initial load kept the newest bar');
    assert.ok(requests.every((r) => r.countBack <= CAP), 'no window holds more buckets than the cap');
    destroy();
  });
});

describe('audit (datafeed): a host-side tick queue folds ticks as they arrive in a hidden tab', () => {
  /**
   * A host that queues ticks for its own frame (the playground's former
   * `onMid` / `flushTicks`) on a window whose animation frames never fire, as
   * in a hidden tab. Mids rise steadily at 4 a second from half-way through a 1m
   * bucket for 64 s. Returns the bucket the tab hid in and the next one.
   */
  async function hiddenTab(hidden: boolean) {
    const I = MIN;
    const B = bucketStartMs(1_760_000_000_000, I);
    const T0 = B + 30_000;
    let nowMs = T0;
    const fetchBars: FetchBars = async (req) => {
      const rows: Candle[] = [];
      for (let t = Math.ceil(req.fromMs / I) * I; t <= Math.min(req.toMs, T0); t += I) rows.push({ time: t / 1000, open: 59_990, high: 60_000, low: 59_980, close: 60_000, volume: 1 });
      return rows;
    };
    const win = {
      requestAnimationFrame: () => 1, // hidden: no frame ever comes
      cancelAnimationFrame: () => {},
      performance: { now: () => nowMs },
    } as unknown as UIWindow;
    const { chart, datafeed, destroy } = createDatafeedChart({
      container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars, now: () => nowMs, symbol: 'BTC', intervalMs: I,
    });
    await idle();
    const frames = createFrameScheduler(win, (update) => chart.batch(update));
    // ---- the host's tick queue ----
    const ticks: [number, string][] = [];
    let tickFrame: number | null = null;
    function flushTicks(): void {
      if (tickFrame !== null) frames.cancel(tickFrame);
      tickFrame = null;
      for (const [price, symbol] of ticks.splice(0)) datafeed.pushTick(price, symbol);
    }
    function onMid(price: number, symbol: string): void {
      ticks.push([price, symbol]);
      if (hidden || ticks.length >= 256) chart.batch(flushTicks);
      else tickFrame ??= frames.request(flushTicks);
    }
    // ---- 64 s of mids, +1000 over 2 minutes ----
    const price = (t: number) => 60_000 + ((t - T0) / 120_000) * 1_000;
    let lastInB = 0;
    for (let k = 1; k <= 256; k++) {
      nowMs = T0 + k * 250;
      if (nowMs < B + I) lastInB = price(nowMs);
      onMid(price(nowMs), 'BTC');
    }
    await idle();
    const data = chart.getData();
    const at = (tMs: number) => data.find((c) => c.time * 1000 === tMs);
    const result = { inB: at(B), next: at(B + I), lastInB, lastPrice: price(nowMs) };
    destroy();
    return result;
  }

  it('keeps each bucket to its own ticks, where the frame queue would fold a minute of them into one bar', async () => {
    const folded = await hiddenTab(true);
    assert.ok(folded.inB && folded.next);
    assert.equal(folded.inB.close, folded.lastInB, 'the bucket the tab hid in closes on its last tick');
    assert.equal(folded.inB.high, folded.lastInB);
    assert.equal(folded.next.open, folded.lastInB, 'the next bucket opens at that close');
    assert.equal(folded.next.low, folded.lastInB, 'and never dips to a price from the bucket before');
    assert.equal(folded.next.close, folded.lastPrice);

    // The queue alone (no frame in a hidden tab) flushes everything at its 256th tick, into the bucket of that moment.
    const queued = await hiddenTab(false);
    assert.ok(queued.next);
    assert.ok(queued.next.low < queued.lastInB, `the flushed bar's low ${queued.next.low} reaches back before ${queued.lastInB}`);
  });
});
