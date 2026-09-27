/**
 * Integration: chart events (P0.1) with the features merged before them.
 *
 * - Heikin Ashi (P1.8): the crosshair event keeps `candle` as loaded and adds
 *   `displayCandle`, the bar the series draws, the status line prints and the
 *   magnet snaps to. Switching the series type from a listener supersedes the
 *   event in flight like any other payload change.
 * - Live bar folder (P0.3): a gap repair batched through `chart.batch` reports
 *   every published bar, then one range change, all after the single paint.
 * - Snapshot (P2.14): a screenshot's catch-up render delivers events, and a
 *   listener that destroys the chart there makes it throw the destroyed error.
 * - Price lines, markers (P1.7) and the countdown's overlay refresh (P2.13)
 *   repaint without range or data events, and without crosshair events
 *   unless an autoscaled line rescales the price under the pointer. When a
 *   ticker-driven refresh has to catch up with a full render, its listeners
 *   run there: one that throws must not freeze the countdown, and one that
 *   destroys the chart must not leave a timer behind.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBarFolder } from '../dist/datafeed/index.js';
import { startCountdownTicker, type CountdownTickerOptions } from '../dist/ui/index.js';
import {
  createChart,
  heikinAshi,
  type Chart,
  type CrosshairMoveEvent,
  type DataLoadEvent,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { ChartEvents } from '../dist/core/chart-events.js';
import { Crosshair } from '../dist/core/crosshair.js';
import { DataStore, type Candle } from '../dist/core/data.js';
import { TimeScale } from '../dist/core/scale.js';
import { MockCanvas } from '../dist/dom.js';
import type { ChartConfig, DeepPartial } from '../dist/config.js';

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const MIN = 60;

/** A wavy bar, so Heikin Ashi values differ from the real ones. */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 4) * 8;
  return { time: T0 + i * MIN, open: base, high: base + 3, low: base - 2, close: base + Math.cos(i) * 1.5, volume: 10 + i };
}

const bars = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, k) => bar(from + k));

function mount(config: DeepPartial<ChartConfig> = {}, data = bars(0, 120), width = 800, height = 500) {
  const canvas = new MockCanvas(width, height);
  const chart = createChart({ container: canvas, config: { wasm: false, data, ...config } });
  return { chart, canvas };
}

function record<T>(subscribe: (cb: (e: T) => void) => () => void): T[] {
  const events: T[] = [];
  subscribe((e) => events.push(e));
  return events;
}

const ranges = (chart: Chart) => record<VisibleRangeChangeEvent>((cb) => chart.subscribeVisibleRangeChange(cb));
const moves = (chart: Chart) => record<CrosshairMoveEvent>((cb) => chart.subscribeCrosshairMove(cb));
const loads = (chart: Chart) => record<DataLoadEvent>((cb) => chart.subscribeDataLoad(cb));

const texts = (canvas: MockCanvas): string[] => canvas.context.callsNamed('fillText').map((c) => String(c[1]));
const ohlc = (c: Candle): number[] => [c.open, c.high, c.low, c.close];

describe('integration: crosshair events x Heikin Ashi', () => {
  it('reports the loaded candle and the displayed HA bar the status line and magnet use', () => {
    const data = bars(0, 120);
    const { chart, canvas } = mount({ series: { type: 'heikin-ashi' }, statusLine: { visible: true }, priceAxis: { precision: 4 } }, data);
    const ha = heikinAshi(data);
    const events = moves(chart);
    const x = chart.scale.indexToX(100);
    canvas.context.calls.length = 0;
    chart.setCrosshair(x, 100);
    const e = events[0]!;
    assert.equal(e.index, 100);
    assert.deepEqual(e.candle, data[100]);
    assert.deepEqual(e.displayCandle, ha[100]);
    assert.notDeepEqual(ohlc(e.displayCandle!), ohlc(e.candle!));
    // The status line prints the displayed bar, and the magnet snaps to it.
    const printed = texts(canvas);
    for (const [label, value] of [['O', ha[100]!.open], ['H', ha[100]!.high], ['L', ha[100]!.low], ['C', ha[100]!.close]] as const) {
      assert.ok(printed.includes(`${label} ${value.toFixed(4)}`), `status line shows ${label} ${value.toFixed(4)}`);
    }
    assert.ok(ohlc(e.displayCandle!).includes(chart.snapPoint(x, 100, 'strong').price));

    // A streamed update re-derives the HA tail, and the next move reports it.
    const tick = { ...data.at(-1)!, high: 130, close: 128 };
    chart.appendData(tick);
    chart.setCrosshair(chart.scale.indexToX(119), 100);
    const live = events.at(-1)!;
    assert.deepEqual(live.candle, tick);
    assert.deepEqual(live.displayCandle, heikinAshi([...data.slice(0, -1), tick])[119]);

    // Other series types draw the loaded candles: both fields are one object.
    chart.updateConfig({ series: { type: 'candlestick' } });
    chart.setCrosshair(chart.scale.indexToX(100), 101);
    const plain = events.at(-1)!;
    assert.strictEqual(plain.displayCandle, plain.candle);
    assert.deepEqual(plain.candle, data[100]);
    chart.clearCrosshair();
    assert.equal(events.at(-1)!.displayCandle, null);
    chart.destroy();
  });

  it('a listener switching to Heikin Ashi supersedes the event in flight, even at the same price', () => {
    const data = bars(0, 120);
    // A fixed scale keeps the price under the pointer: only the displayed bar changes.
    const { chart } = mount({ priceAxis: { autoScale: false } }, data);
    const x = chart.scale.indexToX(100);
    const first: CrosshairMoveEvent[] = [];
    const second: CrosshairMoveEvent[] = [];
    chart.subscribeCrosshairMove((e) => {
      first.push(e);
      if (first.length === 1) chart.updateConfig({ series: { type: 'heikin-ashi' } });
    });
    chart.subscribeCrosshairMove((e) => second.push(e));
    chart.setCrosshair(x, 100);
    assert.equal(first.length, 2);
    assert.strictEqual(first[0]!.displayCandle, first[0]!.candle);
    assert.equal(second.length, 1, 'the stale payload never reaches the second listener');
    assert.deepEqual(second[0]!.displayCandle, heikinAshi(data)[100]);
    assert.deepEqual(second[0]!.candle, data[100]);
    assert.equal(second[0]!.price, first[0]!.price);
    assert.strictEqual(first[1], second[0]);
    chart.destroy();
  });

  it('a host without displayed bars reports the store candle for both fields', () => {
    const store = new DataStore();
    store.setData(bars(0, 50));
    const timeScale = new TimeScale(10, 300);
    const crosshair = new Crosshair();
    const events = new ChartEvents({ store, timeScale, crosshair, plotLeft: () => 0, panes: () => [] });
    const seen = record<CrosshairMoveEvent>((cb) => events.subscribeCrosshairMove(cb));
    crosshair.update(timeScale.indexToX(45, store.length), 20);
    events.flush();
    const e = seen[0]!;
    assert.equal(e.index, 45);
    assert.strictEqual(e.candle, store.at(45));
    assert.strictEqual(e.displayCandle, e.candle);
    assert.equal(e.price, null);
    events.dispose();
  });
});

describe('integration: chart events x live bar folder', () => {
  it('a batched gap repair reports each bar, then one range change, after the single paint', async () => {
    const data = bars(0, 20);
    const { chart } = mount({}, data, 640, 400);
    const order: string[] = [];
    const lengthsSeen: number[] = [];
    chart.subscribeDataLoad((e) => {
      order.push(`${e.reason}:${e.length}:${e.added}:${e.lastTime}`);
      lengthsSeen.push(chart.dataLength);
    });
    chart.subscribeVisibleRangeChange((e) => order.push(`range:${e.length}:${e.toTime}:${e.barsAfter}`));
    const gap = bars(20, 24);
    let now = (T0 + 24 * MIN) * 1000 + 60_000 + 500; // one bucket after the last gap bar
    const folder = createLiveBarFolder({
      intervalMs: MIN * 1000,
      seedBar: data.at(-1)!,
      fetchGap: async () => gap,
      onBar: (b) => chart.appendData(b),
      batch: (run) => chart.batch(run),
      now: () => now,
    });
    folder.pushTick(101); // several buckets late: repair, then replay this tick
    assert.equal(folder.filling, true);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(folder.filling, false);
    const last = folder.bar!;
    assert.equal(last.time, T0 + 25 * MIN, 'the replayed tick rolled a fresh bucket');
    assert.deepEqual(order, [
      ...gap.map((c, k) => `append:${21 + k}:1:${c.time}`),
      `append:25:1:${last.time}`,
      `range:25:${last.time}:0`,
    ]);
    assert.deepEqual(lengthsSeen, [25, 25, 25, 25, 25], 'delivered once the whole batch has painted');

    // An in-bucket tick replaces the forming bar: a data update, same range.
    order.length = 0;
    now += 1000;
    folder.pushTick(102);
    assert.deepEqual(order, [`update:25:0:${last.time}`]);
    folder.dispose();
    chart.destroy();
  });
});

describe('integration: chart events x snapshot', () => {
  it("a screenshot's catch-up render delivers events and snapshots what listeners left", () => {
    const data = bars(0, 120);
    const canvas = new MockCanvas(800, 500);
    Object.assign(canvas, { ownerDocument: { createElement: () => new MockCanvas(300, 150) } });
    const chart = createChart({ container: canvas, config: { wasm: false, data, statusLine: { visible: true }, priceAxis: { precision: 2 } } });
    const seen: VisibleRangeChangeEvent[] = [];
    const replacement = bars(0, 60).map((c, i) => (i === 59 ? { ...c, close: 555 } : c));
    chart.subscribeVisibleRangeChange((e) => {
      seen.push(e);
      if (seen.length === 1) chart.setData(replacement);
    });
    const before = chart.scale.visibleRange();
    canvas.width = 600; // the host resized the backing store without telling the chart
    const shot = chart.takeScreenshot() as MockCanvas;
    assert.equal(shot.width, 600);
    assert.equal(seen.length, 2, 'the narrower viewport, then the listener\'s new data');
    assert.ok(seen[0]!.to - seen[0]!.from < before.to - before.from);
    assert.equal(seen[1]!.length, 60);
    assert.ok(texts(shot).includes('C 555.00'), 'the snapshot shows the data a listener loaded');
    chart.destroy();
  });

  it('a listener that destroys the chart during that render makes the screenshot throw', () => {
    const canvas = new MockCanvas(800, 500);
    Object.assign(canvas, { ownerDocument: { createElement: () => new MockCanvas(300, 150) } });
    const chart = createChart({ container: canvas, config: { wasm: false, data: bars(0, 120) } });
    chart.subscribeVisibleRangeChange(() => chart.destroy());
    canvas.width = 500;
    assert.throws(() => chart.takeScreenshot(), /^Error: chart-ts: cannot take a screenshot of a destroyed chart$/);
    assert.equal(chart.isDestroyed(), true);
  });
});

describe('integration: chart events x price lines, markers and the countdown', () => {
  it('markers and overlay refreshes emit nothing; an autoscaled price line re-reports the price under a still pointer', () => {
    const data = bars(0, 120);
    const { chart } = mount({ statusLine: { visible: true, countdown: true }, timeAxis: { intervalMs: MIN * 1000 } }, data);
    const range = ranges(chart);
    const data$ = loads(chart);
    const move = moves(chart);
    const x = chart.scale.indexToX(100);
    chart.setCrosshair(x, 200);
    const priceBefore = move[0]!.price!;
    chart.series.setMarkers([{ time: data[100]!.time, position: 'aboveBar', color: '#f00', shape: 'arrowDown' }]);
    chart.refreshOverlay();
    chart.refreshOverlay();
    const plain = chart.series.createPriceLine({ price: 110 });
    assert.deepEqual([range.length, data$.length, move.length], [0, 0, 1], 'nothing under the pointer changed');
    // The autoscaled line stretches the axis: the same pixel is now a higher price.
    const line = chart.series.createPriceLine({ price: 400, autoscale: true });
    assert.deepEqual([range.length, data$.length, move.length], [0, 0, 2]);
    const stretched = move.at(-1)!;
    assert.deepEqual([stretched.x, stretched.y, stretched.index, stretched.candle], [x, 200, 100, data[100]]);
    assert.ok(Math.abs(stretched.price! - chart.scale.yToPrice(200)) < 1e-9);
    assert.ok(stretched.price! > priceBefore);
    chart.setCrosshair(x, 201);
    assert.ok(Math.abs(move.at(-1)!.price! - chart.scale.yToPrice(201)) < 1e-9);
    line.remove();
    plain.remove();
    assert.deepEqual([range.length, data$.length, move.length], [0, 0, 4]);
    assert.ok(Math.abs(move.at(-1)!.price! - chart.scale.yToPrice(201)) < 1e-9);
    assert.ok(move.at(-1)!.price! < stretched.price!, 'the axis shrank back');
    chart.destroy();
  });
});

/** Manually fired timers. */
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

describe('integration: chart events x countdown ticker', () => {
  function countdownChart() {
    const canvas = new MockCanvas(800, 400);
    const t0 = 1_700_000_100;
    const clock = { now: t0 * 1000 + 400 };
    const chart = createChart({ container: canvas, now: () => clock.now, config: { wasm: false, statusLine: { visible: true, countdown: true },
      data: [0, 1, 2].map((i) => ({ time: t0 - (2 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 })) } });
    const texts = () => canvas.context.callsNamed('fillText').map((c) => c[1]);
    return { canvas, chart, clock, texts };
  }

  it('a listener throwing in a catch-up render surfaces its error but keeps the countdown ticking', () => {
    const { canvas, chart, clock, texts } = countdownChart();
    const seen: VisibleRangeChangeEvent[] = [];
    chart.subscribeVisibleRangeChange((e) => {
      seen.push(e);
      if (seen.length === 1) throw new Error('listener failed');
    });
    const timers = fakeTimers();
    const ticker = startCountdownTicker({ chart, window: timers.window });
    canvas.width = 700; // stale view: the next refresh re-renders and emits
    clock.now += 600;
    assert.throws(() => timers.fire(), /^Error: listener failed$/);
    assert.equal(seen.length, 1);
    assert.ok(texts().includes('00:59'), 'the frame painted before the listener ran');
    assert.equal(timers.pending.size, 1, 're-armed despite the error');
    canvas.context.calls.length = 0;
    clock.now += 1000;
    timers.fire();
    assert.ok(texts().includes('00:58'));
    assert.equal(seen.length, 1, 'an overlay-only refresh emits nothing');
    ticker.stop();
    chart.destroy();
  });

  it('a listener destroying the chart in a catch-up render leaves no timer behind', () => {
    const { canvas, chart, clock } = countdownChart();
    chart.subscribeVisibleRangeChange(() => chart.destroy());
    const timers = fakeTimers();
    startCountdownTicker({ chart, window: timers.window });
    canvas.width = 700;
    clock.now += 600;
    timers.fire();
    assert.equal(chart.isDestroyed(), true);
    assert.equal(timers.pending.size, 0);
  });
});
