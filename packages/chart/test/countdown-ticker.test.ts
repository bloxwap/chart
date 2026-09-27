import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { startCountdownTicker, type CountdownTickerOptions } from '../dist/ui/index.js';
import { createChart } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';

/** Manually driven timers that record every call. */
function fakeTimers() {
  const pending = new Map<number, { handler: () => void; delay: number }>();
  const delays: number[] = [];
  const cleared: (number | undefined)[] = [];
  let seq = 0;
  return {
    pending, delays, cleared,
    window: {
      setTimeout(handler: () => void, delay = 0): number {
        pending.set(++seq, { handler, delay });
        delays.push(delay);
        return seq;
      },
      clearTimeout(id: number | undefined): void {
        cleared.push(id);
        if (id !== undefined) pending.delete(id);
      },
    } satisfies CountdownTickerOptions['window'],
    /** Fires the only pending timer. */
    fire(): void {
      assert.equal(pending.size, 1);
      const [[id, timer]] = [...pending];
      pending.delete(id);
      timer.handler();
    },
  };
}

describe('startCountdownTicker', () => {
  it('repaints the overlay just after each second of the chart clock, re-aligning every tick', () => {
    const timers = fakeTimers();
    let now = 1_700_000_000_250;
    let refreshes = 0;
    const ticker = startCountdownTicker({ window: timers.window, chart: { now: () => now, refreshOverlay: () => { refreshes++; }, isDestroyed: () => false } });
    assert.deepEqual(timers.delays, [750]);
    assert.equal(refreshes, 0);
    now += 753; // timers fire late
    timers.fire();
    assert.equal(refreshes, 1);
    assert.deepEqual(timers.delays, [750, 997]);
    now += 1000; // exactly on the boundary: wait a full second
    now -= now % 1000;
    timers.fire();
    assert.equal(refreshes, 2);
    assert.equal(timers.delays.at(-1), 1000);
    ticker.stop();
    assert.equal(timers.pending.size, 0);
    assert.equal(timers.cleared.length, 1);
    ticker.stop();
    assert.equal(refreshes, 2);
  });

  it('never reschedules once stopped from inside a repaint, and aligns negative clocks', () => {
    const timers = fakeTimers();
    let ticker: ReturnType<typeof startCountdownTicker> | undefined;
    ticker = startCountdownTicker({ window: timers.window, chart: { now: () => -250, refreshOverlay: () => ticker!.stop(), isDestroyed: () => false } });
    assert.deepEqual(timers.delays, [250]);
    timers.fire();
    assert.equal(timers.pending.size, 0);
    assert.deepEqual(timers.delays, [250]);
  });

  it('drives a real chart overlay from its injected clock', () => {
    const timers = fakeTimers();
    const canvas = new MockCanvas(800, 400);
    const t0 = 1_700_000_100;
    let now = t0 * 1000 + 400;
    const chart = createChart({ container: canvas, now: () => now, config: { wasm: false, statusLine: { visible: true, countdown: true },
      data: [0, 1, 2].map((i) => ({ time: t0 - (2 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 })) } });
    const texts = () => canvas.context.callsNamed('fillText').map((c) => c[1]);
    assert.ok(texts().includes('01:00'));
    const ticker = startCountdownTicker({ chart, window: timers.window });
    assert.deepEqual(timers.delays, [600]);
    now += 600;
    timers.fire();
    assert.ok(texts().includes('00:59'));
    ticker.stop();
    chart.destroy();
  });

  it('stops re-arming once the chart is destroyed, without an explicit stop', () => {
    const timers = fakeTimers();
    const canvas = new MockCanvas(800, 400);
    const now = 1_700_000_100_000;
    const chart = createChart({ container: canvas, now: () => now, config: { wasm: false, statusLine: { visible: true, countdown: true },
      data: [0, 1].map((i) => ({ time: 1_700_000_100 - (1 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 })) } });
    startCountdownTicker({ chart, window: timers.window });
    timers.fire();
    assert.equal(timers.pending.size, 1);
    assert.equal(chart.isDestroyed(), false);
    chart.destroy();
    assert.equal(chart.isDestroyed(), true);
    const calls = canvas.context.calls.length;
    timers.fire();
    // No repaint and no timer left holding the destroyed chart.
    assert.equal(timers.pending.size, 0);
    assert.equal(timers.delays.length, 2);
    assert.equal(canvas.context.calls.length, calls);
  });

  it('waits a full second when the clock is not finite instead of spinning', () => {
    const timers = fakeTimers();
    let now = Number.NaN, refreshes = 0;
    const ticker = startCountdownTicker({ window: timers.window,
      chart: { now: () => now, refreshOverlay: () => { refreshes++; }, isDestroyed: () => false } });
    assert.deepEqual(timers.delays, [1000]);
    now = Number.POSITIVE_INFINITY;
    timers.fire();
    assert.deepEqual(timers.delays, [1000, 1000]);
    now = 5_400; // a synced clock re-aligns on the next tick
    timers.fire();
    assert.deepEqual(timers.delays, [1000, 1000, 600]);
    assert.equal(refreshes, 2);
    ticker.stop();
  });
});

describe('startCountdownTicker with a DOM window', () => {
  const win = new Window();
  after(() => { void win.happyDOM.close(); });
  it('accepts the page window as its timer source', async () => {
    let refreshes = 0, now = 999; // 1 ms to the next second, then 200 ms
    const ticker = startCountdownTicker({ window: win as unknown as CountdownTickerOptions['window'],
      chart: { now: () => now, refreshOverlay: () => { refreshes++; now = 800; }, isDestroyed: () => false } });
    await new Promise((resolve) => win.setTimeout(resolve, 60));
    assert.equal(refreshes, 1);
    ticker.stop();
    await new Promise((resolve) => win.setTimeout(resolve, 300));
    assert.equal(refreshes, 1);
  });
});
