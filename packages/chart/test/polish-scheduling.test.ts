import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachDatafeed,
  bucketStartMs,
  createDatafeedChart,
  loadHistory,
  type AbortControllerLike,
  type Candle,
  type DatafeedChartOptions,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';
import { createChart, type Chart } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';
import { createFrameScheduler, startCountdownTicker, type CountdownTickerOptions, type UIWindow } from '../dist/ui/index.js';

const MIN = 60_000;
/** A 1m bucket start, and 30 s into it. */
const B = bucketStartMs(1_760_000_000_000, MIN);
const T0 = B + 30_000;

/** A frame scheduler whose frames run only when the test says so. */
function fakeFrames() {
  const tasks = new Map<number, (time: number) => void>();
  const requested: number[] = [];
  const cancelled: number[] = [];
  let seq = 0;
  return {
    tasks, requested, cancelled,
    scheduler: {
      now: () => 0,
      request(callback: (time: number) => void): number {
        tasks.set(++seq, callback);
        requested.push(seq);
        return seq;
      },
      cancel(handle: number): void {
        cancelled.push(handle);
        tasks.delete(handle);
      },
    },
    /** Runs one frame: every task requested before it. */
    frame(): void {
      const run = [...tasks.values()];
      tasks.clear();
      for (const task of run) task(16);
    },
  };
}

/** A `createFrameScheduler` batching into the chart, on a window whose animation frames run when the test says so. */
function heldFrames() {
  const raf: Array<(time: number) => void> = [];
  const win = {
    performance: { now: () => 0 },
    requestAnimationFrame: (callback: (time: number) => void) => raf.push(callback),
    cancelAnimationFrame: () => {},
  } as unknown as UIWindow;
  let chart: Chart | null = null;
  return {
    raf,
    scheduler: createFrameScheduler(win, (update) => chart!.batch(update)),
    /** The chart whose `batch` wraps each frame, as `createFrameScheduler(window, (u) => chart.batch(u))`. */
    bind(target: Chart): void {
      chart = target;
    },
  };
}

/** Manually driven window timers. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let seq = 0;
  return {
    pending,
    window: {
      setTimeout(handler: () => void): number {
        pending.set(++seq, handler);
        return seq;
      },
      clearTimeout(id: number | undefined): void {
        if (id !== undefined) pending.delete(id);
      },
    } satisfies CountdownTickerOptions['window'],
    /** Fires the only pending timer. */
    fire(): void {
      assert.equal(pending.size, 1);
      const [[id, handler]] = [...pending];
      pending.delete(id);
      handler();
    },
  };
}

/** Counts the chart's full renders (a render requested inside a batch only marks one pending). */
function countRenders(chart: Chart): { readonly count: number } {
  const target = chart as unknown as { render(): void; readonly batchDepth: number };
  const render = target.render.bind(chart);
  const counter = { count: 0 };
  target.render = () => {
    if (target.batchDepth === 0) counter.count++;
    render();
  };
  return counter;
}

/** Lets every settled read run to completion. */
async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Flat history through the bucket holding T0, for any symbol. */
const history: FetchBars = async ({ fromMs, toMs }) => {
  const rows: Candle[] = [];
  for (let t = Math.ceil(fromMs / MIN) * MIN; t <= Math.min(toMs, T0); t += MIN) rows.push({ time: t / 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  return rows;
};

/** A datafeed chart on 1m BTC bars with history loaded, at T0 on a settable clock. */
async function liveChart(options: Partial<DatafeedChartOptions> = {}) {
  let nowMs = T0;
  const errors: unknown[] = [];
  const df = createDatafeedChart({
    container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars: history, now: () => nowMs,
    symbol: 'BTC', intervalMs: MIN, onError: (error) => errors.push(error), ...options,
  });
  await idle();
  assert.equal(df.chart.dataLength, 500);
  return { ...df, errors, setNow: (ms: number) => { nowMs = ms; } };
}

/** A tick at each second `from`..`to` after T0, priced 200 + the second, on the clock the datafeed reads. */
function tickEverySecond(t: { datafeed: { pushTick(price: number, symbol?: string): void }; setNow(ms: number): void }, from: number, to: number, symbol = 'BTC'): void {
  for (let s = from; s <= to; s++) {
    t.setNow(T0 + s * 1000);
    t.datafeed.pushTick(200 + s, symbol);
  }
}

describe('startCountdownTicker with a frame scheduler', () => {
  it('requests the repaint on the next frame instead of painting in the timer, one frame at most', () => {
    const timers = fakeTimers();
    const frames = fakeFrames();
    let refreshes = 0;
    const ticker = startCountdownTicker({ window: timers.window, scheduler: frames.scheduler,
      chart: { now: () => 1_000_250, refreshOverlay: () => { refreshes++; }, isDestroyed: () => false } });
    timers.fire();
    assert.equal(refreshes, 0, 'nothing paints in the timer callback');
    assert.deepEqual(frames.requested, [1]);
    assert.equal(timers.pending.size, 1, 'the next second is armed regardless');
    timers.fire(); // no frame came in between (a hidden tab): coalesced
    assert.deepEqual(frames.requested, [1]);
    frames.frame();
    assert.equal(refreshes, 1);
    timers.fire();
    frames.frame();
    assert.equal(refreshes, 2);
    assert.deepEqual(frames.requested, [1, 2]);

    timers.fire();
    ticker.stop();
    assert.deepEqual(frames.cancelled, [3], 'stop cancels the pending frame');
    assert.equal(timers.pending.size, 0);
    frames.frame();
    assert.equal(refreshes, 2);
    ticker.stop();
    assert.deepEqual(frames.cancelled, [3], 'nothing left to cancel');
  });

  it('skips a frame that lands after the chart is destroyed, and cancels one still pending then', () => {
    const timers = fakeTimers();
    const frames = fakeFrames();
    let refreshes = 0, destroyed = false;
    startCountdownTicker({ window: timers.window, scheduler: frames.scheduler,
      chart: { now: () => 0, refreshOverlay: () => { refreshes++; }, isDestroyed: () => destroyed } });
    timers.fire();
    destroyed = true;
    frames.frame();
    assert.equal(refreshes, 0, 'a destroyed chart is not painted');
    timers.fire();
    assert.equal(timers.pending.size, 0, 'nor re-armed');
    assert.deepEqual(frames.cancelled, []);

    const later = fakeTimers();
    let gone = false;
    startCountdownTicker({ window: later.window, scheduler: frames.scheduler,
      chart: { now: () => 0, refreshOverlay: () => { refreshes++; }, isDestroyed: () => gone } });
    later.fire();
    const pending = frames.requested.at(-1)!;
    gone = true;
    later.fire(); // the timer armed before the destroy: drops the frame too
    assert.deepEqual(frames.cancelled, [pending]);
    assert.equal(frames.tasks.size, 0);
    assert.equal(later.pending.size, 0);
  });

  it('keeps requesting when the scheduler runs a callback synchronously', () => {
    const timers = fakeTimers();
    let refreshes = 0, requests = 0;
    const ticker = startCountdownTicker({ window: timers.window,
      scheduler: { request: (callback) => { requests++; callback(0); return requests; }, cancel: () => assert.fail('nothing pending') },
      chart: { now: () => 0, refreshOverlay: () => { refreshes++; }, isDestroyed: () => false } });
    timers.fire();
    timers.fire();
    assert.deepEqual([requests, refreshes], [2, 2]);
    ticker.stop();
  });
});

describe('createDatafeedChart with a frame scheduler', () => {
  it('folds each tick at once but applies them once per frame, in one render', async () => {
    const frames = fakeFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    const renders = countRenders(t.chart);
    const before = t.chart.getData().at(-1)!;
    tickEverySecond(t, 1, 10);
    assert.deepEqual(t.chart.getData().at(-1), before, 'nothing applied before the frame');
    assert.equal(renders.count, 0);
    assert.deepEqual(frames.requested, [1], 'one frame for ten ticks');
    frames.frame();
    assert.equal(renders.count, 1);
    assert.deepEqual(t.chart.getData().at(-1), { ...before, high: 210, close: 210 });
    assert.equal(t.chart.dataLength, 500);

    t.setNow(T0 + 11_000);
    t.datafeed.pushTick(150, 'BTC');
    assert.deepEqual(frames.requested, [1, 2], 'the next tick asks for the next frame');
    frames.frame();
    assert.deepEqual(t.chart.getData().at(-1), { ...before, high: 210, low: 99, close: 150 });
    assert.equal(renders.count, 2);
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('keeps every bucket roll between frames: closed bars first, then the forming one', async () => {
    const frames = fakeFrames();
    const scheduled = await liveChart({ scheduler: frames.scheduler });
    const direct = await liveChart();
    const loads: string[] = [];
    scheduled.chart.subscribeDataLoad((e) => loads.push(e.reason));
    const renders = countRenders(scheduled.chart);

    // Two and a half minutes of ticks without a frame (a hidden tab): two rolls queue up.
    tickEverySecond(scheduled, 1, 149);
    tickEverySecond(direct, 1, 149);
    assert.equal(scheduled.chart.dataLength, 500);
    frames.frame();
    assert.equal(renders.count, 1);
    assert.deepEqual(loads, ['update', 'append', 'append'], 'held bar, then each new bucket, in order');
    assert.deepEqual(scheduled.chart.getData(), direct.chart.getData(), 'the same bars as applying every tick at once');
    const rows = scheduled.chart.getData().slice(-3);
    assert.deepEqual(rows.map((c) => c.time * 1000), [B, B + MIN, B + 2 * MIN]);
    assert.equal(rows[1]!.open, rows[0]!.close, 'each bucket opens at the close before it');
    assert.equal(rows[2]!.open, rows[1]!.close);

    // A roll straddling frames lands as well.
    tickEverySecond(scheduled, 150, 160);
    tickEverySecond(direct, 150, 160);
    frames.frame();
    tickEverySecond(scheduled, 161, 215);
    tickEverySecond(direct, 161, 215);
    frames.frame();
    assert.deepEqual(scheduled.chart.getData(), direct.chart.getData());
    assert.equal(scheduled.chart.dataLength, 504);
    scheduled.destroy();
    direct.destroy();
  });

  it('drops queued bars and cancels their frame on a switch and on destroy', async () => {
    const frames = fakeFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    tickEverySecond(t, 1, 3);
    assert.equal(frames.tasks.size, 1);
    await t.datafeed.setSymbol('ETH', MIN);
    assert.deepEqual(frames.cancelled, [1], 'the old symbol\'s bars never reach the new chart');
    frames.frame();
    assert.equal(t.chart.getData().at(-1)!.close, 100);

    tickEverySecond(t, 4, 5, 'ETH');
    assert.equal(frames.tasks.size, 1);
    t.destroy();
    assert.deepEqual(frames.cancelled, [1, 2]);
    assert.equal(frames.tasks.size, 0);
  });

  it('reports a chart listener failure to onError when the scheduler\'s frame is not a chart batch', async () => {
    const frames = fakeFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    let armed = true;
    t.chart.subscribeDataLoad(() => {
      if (armed) throw new Error('host listener');
    });
    tickEverySecond(t, 1, 1);
    assert.doesNotThrow(() => frames.frame());
    assert.deepEqual(t.errors.map((e) => (e as Error).message), ['host listener']);
    assert.equal(t.chart.getData().at(-1)!.close, 201, 'the bar still landed');
    armed = false;
    tickEverySecond(t, 2, 2);
    frames.frame();
    assert.equal(t.chart.getData().at(-1)!.close, 202);
    assert.equal(t.errors.length, 1);
    t.destroy();
  });

  it('lets a chart listener\'s error leave a createFrameScheduler frame batched into the chart, and applies on after it', async () => {
    const held = heldFrames();
    const t = await liveChart({ scheduler: held.scheduler });
    held.bind(t.chart);
    let armed = true;
    t.chart.subscribeDataLoad(() => {
      if (armed) throw new Error('host listener');
    });
    tickEverySecond(t, 1, 1);
    // The chart delivers events as the frame's own batch ends, outside the datafeed.
    assert.throws(() => held.raf.shift()!(16), /host listener/);
    assert.deepEqual(t.errors, [], 'so onError never sees it');
    assert.equal(t.chart.getData().at(-1)!.close, 201, 'the bar still landed');
    armed = false;
    tickEverySecond(t, 2, 2);
    assert.equal(held.raf.length, 1, 'the next tick asks for a new frame');
    held.raf.shift()!(32);
    assert.equal(t.chart.getData().at(-1)!.close, 202);
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('catches a hidden tab up in one frame on the playground\'s path, each bucket keeping its own ticks', async () => {
    // Mids rise steadily at 4 a second from half-way through a 1m bucket for 64 s; no frame comes until the tab shows.
    const held = heldFrames();
    const t = await liveChart({ scheduler: held.scheduler });
    held.bind(t.chart);
    const renders = countRenders(t.chart);
    const price = (ms: number) => 100 + ((ms - T0) / 120_000) * 10;
    let lastInB = 0, lastMs = T0;
    for (let k = 1; k <= 256; k++) {
      lastMs = T0 + k * 250;
      t.setNow(lastMs);
      if (lastMs < B + MIN) lastInB = price(lastMs);
      t.datafeed.pushTick(price(lastMs), 'BTC');
    }
    await idle();
    assert.equal(held.raf.length, 1, 'one frame asked for');
    assert.equal(t.chart.dataLength, 500);
    assert.equal(t.chart.getData().at(-1)!.close, 100, 'nothing applied while hidden');
    assert.equal(renders.count, 0);

    held.raf.shift()!(16); // the tab shows
    assert.equal(renders.count, 1);
    const at = (ms: number) => t.chart.getData().find((c) => c.time * 1000 === ms)!;
    const inB = at(B), next = at(B + MIN);
    assert.equal(inB.close, lastInB, 'the bucket the tab hid in closes on its last tick');
    assert.equal(inB.high, lastInB);
    assert.equal(next.open, lastInB, 'the next bucket opens at that close');
    assert.equal(next.low, lastInB, 'and never dips to a price from the bucket before');
    assert.equal(next.close, price(lastMs));
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('shares one createFrameScheduler frame and render with the countdown ticker', async () => {
    const held = heldFrames();
    const raf = held.raf, frames = held.scheduler;
    const t = await liveChart({ scheduler: frames, config: { wasm: false, statusLine: { visible: true, countdown: true } } });
    held.bind(t.chart);
    const timers = fakeTimers();
    const ticker = startCountdownTicker({ chart: t.chart, window: timers.window, scheduler: frames });
    const renders = countRenders(t.chart);
    tickEverySecond(t, 1, 5);
    timers.fire();
    assert.equal(raf.length, 1, 'one animation frame for the ticks and the countdown');
    assert.equal(renders.count, 0);
    raf.shift()!(16);
    assert.equal(renders.count, 1);
    assert.equal(t.chart.getData().at(-1)!.close, 205);
    ticker.stop();
    t.destroy();
  });
});

/** A structural controller that owes nothing to the global `AbortController`. */
function plainController(): AbortControllerLike & { readonly reasons: unknown[] } {
  const signal = { aborted: false, reason: undefined as unknown };
  const reasons: unknown[] = [];
  return {
    signal: signal as unknown as AbortControllerLike['signal'],
    reasons,
    abort(reason?: unknown) {
      reasons.push(reason);
      signal.aborted = true;
      signal.reason = reason ?? new Error('plain abort');
    },
  };
}

describe('injectable AbortController', () => {
  it('makes every read\'s signal from the factory, and aborts through it on a switch and on destroy', async () => {
    const made: ReturnType<typeof plainController>[] = [];
    const requests: FetchBarsRequest[] = [];
    const releases: Array<() => void> = [];
    let hold = false;
    let nowMs = T0;
    const fetchBars: FetchBars = (request) => {
      requests.push(request);
      if (!hold) return history(request);
      return new Promise((resolve) => releases.push(() => resolve(history(request))));
    };
    const { chart, datafeed, destroy } = createDatafeedChart({
      container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars, now: () => nowMs, symbol: 'BTC', intervalMs: MIN,
      createAbortController: () => {
        const controller = plainController();
        made.push(controller);
        return controller;
      },
    });
    await idle();
    assert.equal(made.length, 1);
    assert.equal(requests[0]!.signal, made[0]!.signal);

    // A gap read shares the symbol's signal.
    nowMs = T0 + 3 * MIN;
    datafeed.pushTick(150, 'BTC');
    await idle();
    assert.equal(requests.length, 2);
    assert.equal(requests[1]!.signal, made[0]!.signal);

    // A switch aborts the held read through the injected controller; its late result never lands.
    hold = true;
    const eth = datafeed.setSymbol('ETH', MIN);
    assert.equal(made.length, 2);
    assert.equal(made[0]!.signal.aborted, true);
    assert.equal(requests.at(-1)!.signal, made[1]!.signal);
    const sol = datafeed.setSymbol('SOL', MIN);
    assert.equal(made[1]!.signal.aborted, true);
    hold = false;
    releases[0]!(); // the source ignored the abort
    releases[1]!();
    await Promise.all([eth, sol]);
    assert.equal(datafeed.symbol, 'SOL');
    assert.equal(datafeed.error, null, 'a superseded read is not a failure');
    assert.equal(chart.dataLength, 500);
    assert.ok(requests.every((r) => made.some((c) => c.signal === r.signal)), 'no read got a global controller');

    destroy();
    assert.equal(made[2]!.signal.aborted, true);
    assert.equal(made.length, 3);
  });

  it('attachDatafeed takes the factory too', async () => {
    const chart = createChart({ container: new MockCanvas(600, 300), config: { wasm: false }, now: () => T0 });
    let calls = 0;
    const datafeed = attachDatafeed(chart, { fetchBars: history, createAbortController: () => { calls++; return plainController(); } });
    await datafeed.setSymbol('BTC', MIN);
    assert.equal(calls, 1);
    assert.equal(chart.dataLength, 500);
    datafeed.destroy();
    chart.destroy();
  });

  it('loadHistory uses the factory only when no signal is given, and rejects with its abort', async () => {
    let calls = 0;
    const controller = plainController();
    const seen: FetchBarsRequest['signal'][] = [];
    const fetchBars: FetchBars = async (request) => {
      seen.push(request.signal);
      if (seen.length === 1) controller.abort(new Error('stop'));
      return history(request);
    };
    const factory = (): AbortControllerLike => {
      calls++;
      return controller;
    };
    // 7000 bars need two pages; the injected signal aborts during the first.
    await assert.rejects(loadHistory({ fetchBars, symbol: 'BTC', intervalMs: MIN, toMs: T0, countBack: 7_000, createAbortController: factory }), /stop/);
    assert.equal(calls, 1);
    assert.deepEqual(seen, [controller.signal]);

    const own = new AbortController();
    const bars = await loadHistory({ fetchBars: history, symbol: 'BTC', intervalMs: MIN, toMs: T0, countBack: 3, signal: own.signal, createAbortController: factory });
    assert.equal(bars.length, 3);
    assert.equal(calls, 1, 'a given signal needs no controller');
  });
});
