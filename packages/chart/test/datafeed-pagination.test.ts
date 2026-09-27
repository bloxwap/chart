import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_EMPTY_PAGES,
  DEFAULT_PAGE_SIZE,
  barsInWindow,
  bucketStartMs,
  loadHistory,
  mergeCandles,
  pageWindow,
  type Candle,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';

const MIN = 60_000;
const M15 = 15 * MIN;
const NOW = 1_700_000_123_456; // mid-bucket on purpose

const candleAt = (tMs: number, close = 100 + (tMs / M15) % 7): Candle => ({
  time: tMs / 1000, open: close - 1, high: close + 1, low: close - 2, close, volume: 3,
});

/** An inclusive-window source holding the latest `keep` buckets, capped at `cap` rows per call. */
function source(opts: { intervalMs?: number; keep?: number; cap?: number; now?: number; tweak?: (rows: Candle[], req: FetchBarsRequest) => Candle[] } = {}) {
  const intervalMs = opts.intervalMs ?? M15;
  const keep = opts.keep ?? 5_000;
  const cap = opts.cap ?? 5_000;
  const latest = bucketStartMs(opts.now ?? NOW, intervalMs);
  const oldest = latest - (keep - 1) * intervalMs;
  const requests: FetchBarsRequest[] = [];
  const fetchBars: FetchBars = async (req) => {
    requests.push(req);
    const rows: Candle[] = [];
    const start = Math.max(oldest, Math.ceil(req.fromMs / intervalMs) * intervalMs);
    for (let t = start; t <= Math.min(latest, req.toMs) && rows.length < cap; t += intervalMs) rows.push(candleAt(t));
    return opts.tweak ? opts.tweak(rows, req) : rows;
  };
  return { fetchBars, requests, latest, oldest, intervalMs };
}

function assertContiguous(rows: readonly Candle[], intervalMs: number): void {
  for (let i = 1; i < rows.length; i++) {
    assert.equal(Math.round((rows[i]!.time - rows[i - 1]!.time) * 1000), intervalMs, `gap or duplicate at ${i}`);
  }
}

describe('barsInWindow', () => {
  it('counts epoch-aligned bucket opens in an inclusive window', () => {
    assert.equal(barsInWindow(M15, 0, M15 * 9), 10);
    assert.equal(barsInWindow(M15, 1, M15 * 9), 9, 'bucket 0 opens before the window');
    assert.equal(barsInWindow(M15, M15, M15 * 2 - 1), 1);
    assert.equal(barsInWindow(M15, M15 + 1, M15 * 2 - 1), 0);
    assert.equal(barsInWindow(M15, M15 * 5, M15 * 2), 0, 'reversed windows hold nothing');
  });
});

describe('pageWindow', () => {
  it('spans pageSize buckets ending with the bucket containing toMs', () => {
    const w = pageWindow(M15, 0, NOW, 500);
    assert.deepEqual(w, { fromMs: bucketStartMs(NOW, M15) - 499 * M15, toMs: NOW });
    assert.equal(barsInWindow(M15, w.fromMs, w.toMs), 500);
  });

  it('clamps to fromMs', () => {
    assert.deepEqual(pageWindow(M15, NOW - M15 * 3, NOW, 500), { fromMs: NOW - M15 * 3, toMs: NOW });
  });
});

describe('mergeCandles', () => {
  it('dedupes by time with b winning, sorts, and normalizes', () => {
    const t = (k: number) => NOW - (NOW % M15) + k * M15;
    const a = [candleAt(t(2), 1), candleAt(t(0), 2), { ...candleAt(t(1)), close: NaN }];
    const { time, open, high, low, close } = candleAt(t(3));
    const b = [candleAt(t(2), 9), { time, open, high, low, close }];
    const merged = mergeCandles(a, b);
    assert.deepEqual(merged.map((c) => [c.time * 1000, c.close]), [[t(0), 2], [t(2), 9], [t(3), close]]);
    assert.equal(merged.at(-1)!.volume, 0);
  });
});

describe('loadHistory', () => {
  it('reads the latest countBack bars in one page, ending now', async () => {
    const src = source();
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 500 });
    assert.equal(src.requests.length, 1);
    const [req] = src.requests;
    assert.deepEqual({ ...req, signal: undefined }, {
      symbol: 'BTC', intervalMs: M15, fromMs: src.latest - 499 * M15, toMs: NOW, countBack: 500, signal: undefined,
    });
    assert.equal(req!.signal.aborted, false, 'a default signal is supplied');
    assert.equal(rows.length, 500);
    assert.equal(rows.at(-1)!.time * 1000, src.latest, 'includes the forming bar');
    assertContiguous(rows, M15);
  });

  it('pages backwards with inclusive windows, each ending 1 ms before the earliest bar', async () => {
    const src = source({ keep: 20_000, cap: 5_000 });
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 12_000 });
    assert.deepEqual(src.requests.map((r) => r.countBack), [5_000, 5_000, 2_000]);
    for (let i = 1; i < src.requests.length; i++) {
      const earliest = src.latest - (5_000 * i - 1) * M15;
      assert.equal(src.requests[i]!.toMs, earliest - 1);
      assert.equal(src.requests[i]!.fromMs, earliest - src.requests[i]!.countBack * M15);
    }
    assert.equal(rows.length, 12_000);
    assert.equal(rows[0]!.time * 1000, src.latest - 11_999 * M15);
    assertContiguous(rows, M15);
  });

  it('honours a smaller pageSize and uses the default page size otherwise', async () => {
    assert.equal(DEFAULT_PAGE_SIZE, 5_000);
    const src = source();
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 1_000, pageSize: 300 });
    assert.deepEqual(src.requests.map((r) => r.countBack), [300, 300, 300, 100]);
    assert.equal(rows.length, 1_000);
    assertContiguous(rows, M15);
  });

  it('stops once the window reaches fromMs', async () => {
    const src = source();
    const fromMs = src.latest - 99 * M15;
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, fromMs, toMs: NOW, countBack: 5_000 });
    assert.equal(src.requests.length, 1);
    assert.equal(src.requests[0]!.fromMs, fromMs);
    assert.equal(src.requests[0]!.countBack, 100);
    assert.equal(rows.length, 100);
  });

  it('stops cleanly at exhausted history: maxEmptyPages empty pages, even after a short one', async () => {
    assert.equal(DEFAULT_MAX_EMPTY_PAGES, 3);
    const short = source({ keep: 3_000 });
    const a = await loadHistory({ fetchBars: short.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 8_000 });
    assert.deepEqual(short.requests.map((r) => r.countBack), [5_000, 5_000, 5_000, 5_000], 'a short page may be a gap: it keeps paging');
    assert.equal(short.requests[1]!.toMs, short.oldest - 1);
    for (let i = 2; i < short.requests.length; i++) assert.equal(short.requests[i]!.toMs, short.requests[i - 1]!.fromMs - 1);
    assert.equal(a.length, 3_000);
    assertContiguous(a, M15);

    const exact = source({ keep: 5_000 });
    const b = await loadHistory({ fetchBars: exact.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 8_000 });
    assert.deepEqual(exact.requests.map((r) => r.countBack), [5_000, 3_000, 5_000, 5_000], 'the full first page cannot tell; three empty pages do');
    for (let i = 2; i < exact.requests.length; i++) assert.equal(exact.requests[i]!.toMs, exact.requests[i - 1]!.fromMs - 1);
    assert.equal(b.length, 5_000);
    assert.equal(b[0]!.time * 1000, exact.oldest);
    assertContiguous(b, M15);

    const once = source({ keep: 5_000 });
    const c = await loadHistory({ fetchBars: once.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 8_000, maxEmptyPages: 1 });
    assert.equal(once.requests.length, 2, 'maxEmptyPages 1 stops at the first empty page');
    assert.deepEqual(c, b);
  });

  it('pages past missing buckets until countBack is covered', async () => {
    // One bucket missing inside the first page: that page comes up short, and paging goes on.
    const missing = bucketStartMs(NOW, M15) - 200 * M15;
    const src = source({ keep: 20_000, tweak: (rows) => rows.filter((c) => c.time * 1000 !== missing) });
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 1_200, pageSize: 500 });
    assert.equal(rows.length, 1_200);
    assert.equal(rows[0]!.time * 1000, src.latest - 1_200 * M15, 'the 1,200 latest bars the source has');
    assert.ok(rows.every((c) => c.time * 1000 !== missing));
    assert.deepEqual(src.requests.map((r) => r.countBack), [500, 500, 201]);
    assert.equal(src.requests[1]!.toMs, src.latest - 499 * M15 - 1, 'each page ends 1 ms before the earliest bar');
  });

  it('steps over a hole wider than a page: the empty pages after the first span a whole pageSize', async () => {
    // A weekend: 1,500 recent 1m bars, a 2,880-bucket hole, then 1,620 older bars.
    const latest = bucketStartMs(NOW, MIN);
    const opens: number[] = [];
    for (let back = 0; back < 1_500 + 2_880 + 1_620; back++) if (back < 1_500 || back >= 4_380) opens.unshift(latest - back * MIN);
    const requests: FetchBarsRequest[] = [];
    const fetchBars: FetchBars = async (req) => {
      requests.push(req);
      return opens.filter((t) => t >= req.fromMs && t <= req.toMs).map((t) => candleAt(t));
    };
    const rows = await loadHistory({ fetchBars, symbol: 'SPX', intervalMs: MIN, toMs: NOW, countBack: 3_000, pageSize: 1_000 });
    assert.equal(rows.length, 3_000);
    assert.deepEqual(rows.map((c) => c.time * 1000), opens.slice(-3_000));
    // A full page, a short one ending at the hole, two empty ones inside it, then pages past it.
    assert.deepEqual(requests.map((r) => r.countBack), [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 380]);
    assert.equal(requests[2]!.toMs, latest - 1_500 * MIN + MIN - 1, 'the short page did not end paging');
    assert.equal(requests[3]!.toMs, requests[2]!.fromMs - 1, 'the empty page stepped a window back');

    // A hole as long as maxEmptyPages windows ends the read; a larger maxEmptyPages steps over it.
    requests.length = 0;
    const cut = await loadHistory({ fetchBars, symbol: 'SPX', intervalMs: MIN, toMs: NOW, countBack: 3_000, pageSize: 500, maxEmptyPages: 2 });
    assert.equal(cut.length, 1_500);
    assert.deepEqual(requests.map((r) => r.countBack), [500, 500, 500, 500, 500]);
    const far = await loadHistory({ fetchBars, symbol: 'SPX', intervalMs: MIN, toMs: NOW, countBack: 3_000, pageSize: 500, maxEmptyPages: 7 });
    assert.deepEqual(far, rows);
  });

  it('asks for the buckets a window clamped at fromMs holds', async () => {
    const missing = bucketStartMs(NOW, M15) - 30 * M15;
    const src = source({ tweak: (rows) => rows.filter((c) => c.time * 1000 !== missing) });
    const fromMs = src.latest - 99 * M15;
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, fromMs, toMs: NOW, countBack: 5_000, pageSize: 60 });
    assert.equal(rows.length, 99);
    assert.deepEqual(src.requests.map((r) => [r.fromMs, r.countBack]), [[src.latest - 59 * M15, 60], [fromMs, 40]]);
  });

  it('drops an echoed inclusive boundary bar and rows outside the window', async () => {
    // A source that also returns the bar at toMs + 1 (the previous page's earliest) and a stray future bar.
    const src = source({
      keep: 20_000,
      tweak: (rows, req) => [candleAt(req.toMs + 1, 999), ...rows, candleAt(NOW + 10 * M15, 999)],
    });
    const rows = await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 2_500, pageSize: 1_000 });
    assert.equal(src.requests.length, 3);
    assert.equal(rows.length, 2_500);
    assert.ok(rows.every((c) => c.close !== 999));
    assertContiguous(rows, M15);
  });

  it('always progresses, even against a source that ignores the window', async () => {
    const all: Candle[] = Array.from({ length: 50 }, (_, i) => candleAt(bucketStartMs(NOW, M15) - i * M15));
    let calls = 0;
    const rows = await loadHistory({
      fetchBars: async () => {
        calls++;
        return all;
      },
      symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 45, pageSize: 10,
    });
    assert.equal(calls, 5);
    assert.equal(rows.length, 45);
    assertContiguous(rows, M15);
  });

  it('keeps only the latest countBack rows when a source packs more rows than buckets', async () => {
    const half = M15 / 2; // two rows per bucket: misaligned candles
    const rows = await loadHistory({
      fetchBars: async (req) => Array.from({ length: 20 }, (_, i) => candleAt(req.toMs - (req.toMs % half) - i * half)),
      symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 6,
    });
    assert.equal(rows.length, 6);
    assert.equal(rows.at(-1)!.time * 1000, NOW - (NOW % half));
  });

  it('reads nothing for an empty window or no bars wanted', async () => {
    const src = source();
    assert.deepEqual(await loadHistory({ fetchBars: src.fetchBars, symbol: 'X', intervalMs: M15, toMs: NOW, countBack: 0 }), []);
    assert.deepEqual(await loadHistory({ fetchBars: src.fetchBars, symbol: 'X', intervalMs: M15, fromMs: NOW + M15, toMs: NOW, countBack: 9 }), []);
    assert.deepEqual(await loadHistory({ fetchBars: src.fetchBars, symbol: 'X', intervalMs: M15, toMs: NOW, countBack: 0.9 }), []);
    assert.equal(src.requests.length, 0);
  });

  it('returns nothing when history ends long before the window', async () => {
    const src = source({ now: NOW - 1e12 });
    assert.deepEqual(await loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 10 }), []);
    assert.deepEqual(src.requests.map((r) => r.countBack), [10, 5_000, 5_000]);
  });

  it('validates intervalMs, pageSize and maxEmptyPages', async () => {
    const src = source();
    const base = { fetchBars: src.fetchBars, symbol: 'BTC', toMs: NOW, countBack: 10 };
    await assert.rejects(loadHistory({ ...base, intervalMs: 0 }), /intervalMs must be a positive integer/);
    await assert.rejects(loadHistory({ ...base, intervalMs: 1.5 }), /intervalMs must be a positive integer/);
    await assert.rejects(loadHistory({ ...base, intervalMs: M15, pageSize: 0 }), /pageSize must be a positive integer/);
    await assert.rejects(loadHistory({ ...base, intervalMs: M15, pageSize: 2.5 }), /pageSize must be a positive integer/);
    await assert.rejects(loadHistory({ ...base, intervalMs: M15, maxEmptyPages: 0 }), /maxEmptyPages must be a positive integer, got 0/);
    await assert.rejects(loadHistory({ ...base, intervalMs: M15, maxEmptyPages: 1.5 }), /maxEmptyPages must be a positive integer/);
    assert.equal(src.requests.length, 0);
  });

  it('propagates aborts, even when fetchBars ignores the signal', async () => {
    const src = source({ keep: 20_000 });
    const pre = new AbortController();
    pre.abort(new Error('gone'));
    await assert.rejects(loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 10, signal: pre.signal }), /gone/);
    assert.equal(src.requests.length, 0, 'an aborted read never starts');

    const mid = new AbortController();
    let resolvePage!: (rows: Candle[]) => void;
    const pending = loadHistory({
      fetchBars: (req) => {
        assert.equal(req.signal, mid.signal);
        return new Promise((resolve) => {
          resolvePage = resolve;
        });
      },
      symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 10,
      signal: mid.signal,
    });
    mid.abort();
    resolvePage([candleAt(bucketStartMs(NOW, M15))]); // the source ignored the signal
    await assert.rejects(pending, (error: unknown) => (error as Error).name === 'AbortError');

    // A signal without a reason still rejects.
    const bare = { aborted: true, reason: undefined } as unknown as AbortSignal;
    await assert.rejects(loadHistory({ fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: M15, toMs: NOW, countBack: 10, signal: bare }), /history read aborted/);
  });
});
