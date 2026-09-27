/**
 * Regressions from the whole-diff requirements audit:
 *
 * - P0.2 history paging on gappy sources: a hole wider than a page (a
 *   weekend, a closed session) or a single missing bucket no longer ends
 *   paging. Only `maxEmptyPages` empty reads in a row mark the history
 *   exhausted, so older bars stay reachable.
 * - P2.14 snapshot export: `toBlob` resolves to the host's `Blob` type, so a
 *   TypeScript host hands it to `URL.createObjectURL` without a cast.
 *
 * The context menu's controller disposal is covered in context-menu.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketStartMs,
  createDatafeedChart,
  type Candle,
  type DatafeedChartOptions,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';
import { canvasToBlob, createChart, snapshotToBlob, type SnapshotBlob } from '../dist/index.js';
import { MockCanvas, MockDocument, type MockBlob } from '../dist/dom.js';

const MIN = 60_000;
const DAY = 1_440;
/** The latest regular session's first 1m bucket. */
const SESSION = bucketStartMs(1_760_000_000_000, DAY * MIN) + 810 * MIN;

const bar = (tMs: number): Candle => {
  const close = 100 + Math.sin(tMs / MIN / 7);
  return { time: tMs / 1000, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 };
};

/** Bucket opens `latest - back * MIN` for each `back` in `[0, span)` that `has(back)` keeps, oldest first. */
function opens(latest: number, span: number, has: (back: number) => boolean): number[] {
  const out: number[] = [];
  for (let back = span - 1; back >= 0; back--) if (has(back)) out.push(latest - back * MIN);
  return out;
}

/**
 * Loads a datafeed chart over a 1m source holding bars at `times`, then pages
 * until exhausted. Returns the bars the initial load landed and every read.
 */
async function drain(times: readonly number[], nowMs: number, options: Partial<DatafeedChartOptions> = {}) {
  const requests: FetchBarsRequest[] = [];
  const fetchBars: FetchBars = async (req) => {
    requests.push(req);
    return times.filter((t) => t >= req.fromMs && t <= req.toMs).map(bar);
  };
  const df = createDatafeedChart({
    container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars, now: () => nowMs, symbol: 'SPX', intervalMs: MIN, ...options,
  });
  const initial = await df.datafeed.loadMore(); // the initial load's flight
  const exhaustedAtOnce = df.datafeed.exhausted;
  for (let i = 0; i < 100 && !df.datafeed.exhausted; i++) await df.datafeed.loadMore();
  const loaded = df.chart.getData().map((c) => c.time * 1000);
  const { exhausted, error } = df.datafeed;
  df.destroy();
  return { initial, exhaustedAtOnce, loaded, exhausted, error, requests, countBacks: requests.map((r) => r.countBack) };
}

describe('audit (requirements): history paging reaches past holes in the source', () => {
  it('pages across a weekend hole wider than a page to the oldest bar', async () => {
    // 1,500 recent 1m bars, a 2,880-bucket hole, then 1,620 older bars: paging used to stop at 1,500.
    const latest = SESSION + 1_499 * MIN;
    const times = opens(latest, 6_000, (back) => back < 1_500 || back >= 4_380);
    const r = await drain(times, latest + 30_000);
    assert.equal(r.initial, 500);
    assert.deepEqual(r.loaded, times, 'every bar, in order, none twice');
    assert.equal(r.exhausted, true);
    assert.equal(r.error, null);
    // The hole: an empty page, then a whole-page read past it. The end: a short page, then three empty ones.
    assert.deepEqual(r.countBacks, [500, 1_000, 1_000, 5_000, 1_000, 380, 5_000, 5_000]);
    assert.equal(r.requests[3]!.toMs, r.requests[2]!.fromMs - 1);
  });

  it('loads a closed session market: the initial load steps over the overnight hole, and paging reaches every session', async () => {
    // 20 regular sessions of 390 1m bars, 1,050 closed buckets between them; now is 10 hours after the close.
    const times = opens(SESSION + 389 * MIN, 20 * DAY, (back) => (back % DAY) < 390);
    const nowMs = SESSION + 990 * MIN + 30_000;
    const r = await drain(times, nowMs);
    assert.equal(r.initial, 500, 'the last session and the end of the one before, not an empty chart');
    assert.equal(r.exhaustedAtOnce, false);
    assert.deepEqual(r.countBacks.slice(0, 2), [500, 5_000]);
    assert.deepEqual(r.loaded, times);
    assert.equal(r.loaded.length, 7_800);
    assert.equal(r.exhausted, true);
    for (let i = 1; i < r.requests.length; i++) {
      assert.ok(r.requests[i]!.toMs < r.requests[i - 1]!.toMs, `read ${i} moves back in time`);
    }
  });

  it('ends at a hole longer than maxEmptyPages windows, which a larger maxEmptyPages steps over', async () => {
    // pageSize 300: three empty reads reach 900 buckets into a 1,000-bucket hole.
    const latest = SESSION + 599 * MIN;
    const times = opens(latest, 3_600, (back) => back < 600 || back >= 1_600);
    const cut = await drain(times, latest, { pageSize: 300 });
    assert.deepEqual([cut.loaded.length, cut.exhausted], [600, true]);
    assert.deepEqual(cut.countBacks, [300, 200, 300, 300, 300, 300]);
    const far = await drain(times, latest, { pageSize: 300, maxEmptyPages: 4 });
    assert.deepEqual(far.loaded, times);
  });

  it('marks history exhausted during the initial load when it finds the first bar', async () => {
    const latest = SESSION + 299 * MIN;
    const r = await drain(opens(latest, 300, () => true), latest);
    assert.deepEqual([r.initial, r.exhaustedAtOnce], [300, true]);
    assert.deepEqual(r.countBacks, [500, 200, 5_000, 5_000], 'no lazy read after the initial load');
  });
});

describe('audit (requirements): snapshot blobs carry the host Blob type', () => {
  it('toBlob, canvasToBlob and snapshotToBlob resolve to Blob where the typings declare one', async () => {
    // Compile-time: the test build has Node's typings, so SnapshotBlob is Node's Blob rather than unknown.
    type IsUnknown<T> = unknown extends T ? true : false;
    const typed: IsUnknown<SnapshotBlob> = false;
    assert.equal(typed, false);
    const chart = createChart({ document: new MockDocument(), pixelRatio: 1, config: { wasm: false, width: 30, height: 20 } });
    const blob: Blob = await chart.toBlob(); // no cast
    const direct: Blob = await canvasToBlob(new MockCanvas(2, 1));
    const released: Blob = await snapshotToBlob(new MockCanvas(1, 1), {});
    // At runtime a MockCanvas still yields its MockBlob stand-in.
    const mocks: readonly unknown[] = [blob, direct, released];
    assert.deepEqual(mocks as readonly MockBlob[], [
      { size: 30 * 20 * 4, type: 'image/png' },
      { size: 2 * 1 * 4, type: 'image/png' },
      { size: 1 * 1 * 4, type: 'image/png' },
    ]);
    chart.destroy();
  });
});
