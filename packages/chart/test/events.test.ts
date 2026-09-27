import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChart,
  Emitter,
  type Chart,
  type CrosshairMoveEvent,
  type DataLoadEvent,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { ChartEvents, MAX_EVENT_ROUNDS } from '../dist/core/chart-events.js';
import { Crosshair } from '../dist/core/crosshair.js';
import { DataStore, type Candle } from '../dist/core/data.js';
import { TimeScale } from '../dist/core/scale.js';
import { MockCanvas, MockDocument, type ChartCanvas } from '../dist/dom.js';
import { DrawingController } from '../dist/ui/index.js';

const T0 = 1700000000;
const HOUR = 3600;

/** Bar `i` (may be negative for older history). */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 5) * 10;
  return { time: T0 + i * HOUR, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
}

function bars(from: number, to: number): Candle[] {
  return Array.from({ length: to - from }, (_, k) => bar(from + k));
}

function setup(n = 200, width = 800, height = 500) {
  const canvas = new MockCanvas(width, height);
  const chart = createChart({ container: canvas, config: { wasm: false, data: bars(0, n) } });
  return { chart, canvas };
}

function record<T>(subscribe: (cb: (e: T) => void) => () => void): { events: T[]; off: () => void } {
  const events: T[] = [];
  const off = subscribe((e) => events.push(e));
  return { events, off };
}

const ranges = (chart: Chart) => record<VisibleRangeChangeEvent>((cb) => chart.subscribeVisibleRangeChange(cb));
const moves = (chart: Chart) => record<CrosshairMoveEvent>((cb) => chart.subscribeCrosshairMove(cb));
const loads = (chart: Chart) => record<DataLoadEvent>((cb) => chart.subscribeDataLoad(cb));

describe('Emitter', () => {
  it('delivers in subscription order and unsubscribes idempotently', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    const a = (n: number) => seen.push(`a${n}`);
    const offA = emitter.subscribe(a);
    const offB = emitter.subscribe((n) => seen.push(`b${n}`));
    const offA2 = emitter.subscribe(a); // the same function twice is two subscriptions
    assert.equal(emitter.size, 3);
    emitter.emit(1);
    assert.deepEqual(seen, ['a1', 'b1', 'a1']);
    offA();
    offA();
    assert.equal(emitter.size, 2);
    emitter.emit(2);
    assert.deepEqual(seen.slice(3), ['b2', 'a2']);
    offB();
    offA2();
    assert.equal(emitter.size, 0);
    emitter.emit(3);
    assert.equal(seen.length, 5);
  });

  it('walks a snapshot: late subscribers wait, removed listeners are skipped at once', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    let offC = (): void => {};
    emitter.subscribe((n) => {
      seen.push(`a${n}`);
      if (n === 1) {
        offC();
        emitter.subscribe((m) => seen.push(`late${m}`));
      }
    });
    emitter.subscribe((n) => seen.push(`b${n}`));
    offC = emitter.subscribe((n) => seen.push(`c${n}`));
    emitter.emit(1);
    assert.deepEqual(seen, ['a1', 'b1']);
    emitter.emit(2);
    assert.deepEqual(seen.slice(2), ['a2', 'b2', 'late2']);
  });

  it('stops delivering once the event is superseded', () => {
    const emitter = new Emitter<string>();
    const seen: string[] = [];
    let fresh = true;
    emitter.subscribe((e) => { seen.push(`a:${e}`); fresh = false; });
    emitter.subscribe((e) => seen.push(`b:${e}`));
    emitter.emit('x', () => fresh);
    assert.deepEqual(seen, ['a:x']);
    fresh = true;
    emitter.emit('y', () => true);
    assert.deepEqual(seen.slice(1), ['a:y', 'b:y']);
  });

  it('clear() mid-emission skips the rest and leaves old unsubscribes harmless', () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    const off = emitter.subscribe(() => emitter.clear());
    emitter.subscribe((n) => seen.push(n));
    emitter.emit(1);
    assert.deepEqual(seen, []);
    assert.equal(emitter.size, 0);
    off();
    assert.equal(emitter.size, 0);
  });
});

describe('subscribeVisibleRangeChange', () => {
  it('does not replay the current state on subscribe, then reports scrolls with a full payload', () => {
    const { chart, canvas } = setup(200);
    const { events } = ranges(chart);
    assert.equal(events.length, 0);
    const paintsBefore = canvas.context.calls.length;
    let paintsAtEmit = 0;
    chart.subscribeVisibleRangeChange(() => { paintsAtEmit = canvas.context.calls.length; });
    chart.scale.scrollBy(10);
    assert.equal(events.length, 1);
    assert.ok(paintsAtEmit > paintsBefore, 'listeners run after the frame is painted');
    const e = events[0]!;
    const range = chart.scale.visibleRange();
    assert.equal(e.from, range.from);
    assert.equal(e.to, range.to);
    assert.equal(e.length, 200);
    // Default 800px canvas minus the 64px price axis at 6px per bar.
    const slots = 736 / 6;
    assert.equal(e.logicalTo, 199 - 10);
    assert.ok(Math.abs(e.logicalFrom - (200 - 10 - slots)) < 1e-9);
    assert.equal(e.barsBefore, e.logicalFrom);
    assert.equal(e.barsAfter, 10);
    assert.equal(e.fromTime, T0 + e.from * HOUR);
    assert.equal(e.toTime, T0 + (e.to - 1) * HOUR);
    // The logical edges line up with bar-slot edges in pixels.
    assert.ok(Math.abs(chart.scale.indexToX(e.logicalFrom) - 3) < 1e-9);
    assert.ok(Math.abs(chart.scale.indexToX(e.logicalTo) - (736 - 3)) < 1e-9);
    chart.destroy();
  });

  it('emits for zoom, resize, data growth and layout config; not for unchanged state or crosshair repaints', () => {
    const { chart } = setup(200);
    const { events } = ranges(chart);
    chart.scale.scrollBy(0);
    chart.setCrosshair(100, 100);
    chart.clearCrosshair();
    chart.updateConfig({ theme: { background: '#101010' } });
    chart.render();
    assert.equal(events.length, 0);

    chart.scale.zoom(2);
    assert.equal(events.length, 1);
    assert.ok(Math.abs(events[0]!.logicalTo - events[0]!.logicalFrom - (736 / 12 - 1)) < 1e-9);

    chart.resize(600, 500);
    assert.equal(events.length, 2);
    assert.ok(Math.abs(events[1]!.logicalFrom - (200 - 536 / 12)) < 1e-9);

    chart.updateConfig({ priceAxis: { width: 100 } });
    assert.equal(events.length, 3);
    assert.ok(Math.abs(events[2]!.logicalFrom - (200 - 500 / 12)) < 1e-9);

    chart.appendData(bar(200));
    assert.equal(events.length, 4);
    assert.equal(events[3]!.length, 201);
    assert.equal(events[3]!.toTime, bar(200).time);

    // Replacing the live candle keeps the range.
    chart.appendData({ ...bar(200), close: 1 });
    assert.equal(events.length, 4);
    chart.destroy();
  });

  it('reports whitespace on either side as negative bars', () => {
    const { chart } = setup(50);
    const { events } = ranges(chart);
    chart.scale.scrollBy(-20);
    const future = events.at(-1)!;
    assert.equal(future.barsAfter, -20);
    assert.equal(future.to, 50);
    chart.scale.scrollBy(10_000); // clamps with only bar 0 in view
    const past = events.at(-1)!;
    assert.equal(past.logicalTo, 0);
    assert.ok(past.barsBefore < 0);
    assert.deepEqual([past.from, past.to, past.fromTime, past.toTime], [0, 1, T0, T0]);
    chart.destroy();
  });

  it('reports null times for an empty series', () => {
    const { chart } = setup(20);
    const { events } = ranges(chart);
    chart.setData([]);
    const e = events.at(-1)!;
    assert.deepEqual([e.from, e.to, e.length, e.fromTime, e.toTime], [0, 0, 0, null, null]);
    chart.destroy();
  });

  it('coalesces a batch into one emission after it flushes', () => {
    const { chart } = setup(200);
    const { events } = ranges(chart);
    chart.batch(() => {
      chart.scale.scrollBy(3);
      chart.scale.scrollBy(4);
      chart.batch(() => chart.scale.scrollBy(5));
      assert.equal(events.length, 0);
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.barsAfter, 12);
    // A batch that ends where it started emits nothing.
    chart.batch(() => {
      chart.scale.scrollBy(3);
      chart.scale.scrollBy(-3);
    });
    assert.equal(events.length, 1);
    chart.destroy();
  });

  it('stops after unsubscribe and re-seeds the baseline for a later subscriber', () => {
    const { chart } = setup(200);
    const first = ranges(chart);
    chart.scale.scrollBy(2);
    first.off();
    first.off();
    chart.scale.scrollBy(2);
    assert.equal(first.events.length, 1);
    const second = ranges(chart);
    chart.render();
    assert.equal(second.events.length, 0, 'no stale diff against the old subscriber');
    chart.scale.scrollBy(1);
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]!.barsAfter, 5);
    chart.destroy();
  });
});

describe('subscribeCrosshairMove', () => {
  it('reports the hovered bar, price and pane', () => {
    const { chart } = setup(200);
    const { events } = moves(chart);
    const x = chart.scale.indexToX(150) + 1;
    chart.setCrosshair(x, 120);
    assert.equal(events.length, 1);
    const e = events[0]!;
    assert.deepEqual([e.active, e.x, e.y, e.index, e.time, e.paneId], [true, x, 120, 150, bar(150).time, 'main']);
    assert.deepEqual(e.candle, bar(150));
    assert.ok(Math.abs(e.price! - chart.scale.yToPrice(120)) < 1e-9);
    // Same position: nothing changed.
    chart.setCrosshair(x, 120);
    assert.equal(events.length, 1);
    chart.clearCrosshair();
    chart.clearCrosshair();
    assert.equal(events.length, 2);
    const off = events[1]!;
    assert.equal(off.active, false);
    assert.ok(Number.isNaN(off.x) && Number.isNaN(off.y));
    assert.deepEqual([off.index, off.time, off.candle, off.price, off.paneId], [null, null, null, null, null]);
    chart.destroy();
  });

  it('clamps the index into the data and resolves sub-panes and the time axis', () => {
    const { chart } = setup(200);
    const rsi = chart.addIndicator({ name: 'rsi', pane: 'sub' });
    const { events } = moves(chart);
    chart.setCrosshair(-500, 10);
    assert.equal(events.at(-1)!.index, 0);
    chart.setCrosshair(5000, 10);
    assert.equal(events.at(-1)!.index, 199);

    const mainHeight = chart.plotArea.height;
    const plotHeight = 500 - 24;
    const subMid = (mainHeight + plotHeight) / 2;
    chart.setCrosshair(300, subMid);
    const upper = events.at(-1)!;
    assert.equal(upper.paneId, rsi);
    assert.ok(upper.price! > 0 && upper.price! < 100, `rsi-scale price, got ${upper.price}`);
    chart.setCrosshair(300, subMid + 20);
    assert.ok(events.at(-1)!.price! < upper.price!, 'lower on the pane is a lower value');

    chart.setCrosshair(300, plotHeight + 10); // over the time axis
    const axis = events.at(-1)!;
    assert.deepEqual([axis.paneId, axis.price], [null, null]);
    assert.notEqual(axis.index, null);
    chart.destroy();
  });

  it('accounts for a left price axis', () => {
    const { chart } = setup(200);
    chart.updateConfig({ priceAxis: { position: 'left' } });
    const { events } = moves(chart);
    const x = chart.scale.indexToX(120);
    chart.setCrosshair(x, 50);
    assert.equal(events[0]!.index, 120);
    chart.destroy();
  });

  it('reports null bars without data', () => {
    const { chart } = setup(0);
    const { events } = moves(chart);
    chart.setCrosshair(100, 100);
    const e = events[0]!;
    assert.deepEqual([e.index, e.time, e.candle, e.paneId], [null, null, null, 'main']);
    assert.equal(typeof e.price, 'number');
    chart.destroy();
  });

  it('coalesces batches and diffs from the state at subscription', () => {
    const { chart } = setup(200);
    chart.setCrosshair(5, 5);
    const { events } = moves(chart);
    chart.batch(() => {
      chart.clearCrosshair();
      chart.setCrosshair(5, 5);
    });
    assert.equal(events.length, 0);
    chart.batch(() => {
      chart.setCrosshair(10, 10);
      chart.setCrosshair(20, 30);
      assert.equal(events.length, 0);
    });
    assert.equal(events.length, 1);
    assert.deepEqual([events[0]!.x, events[0]!.y], [20, 30]);
    chart.batch(() => chart.clearCrosshair());
    assert.equal(events.length, 2);
    assert.equal(events[1]!.active, false);
    chart.destroy();
  });

  it('still emits on a canvas without a 2D context, with no pane resolved', () => {
    const noCtx = { width: 640, height: 480, getContext: () => null } as unknown as ChartCanvas;
    const chart = createChart({ container: noCtx, config: { wasm: false, data: bars(0, 10) } });
    const crosshair = moves(chart);
    const data = loads(chart);
    chart.setCrosshair(10, 10);
    const e = crosshair.events[0]!;
    assert.deepEqual([e.active, e.index, e.paneId, e.price], [true, 9, null, null]);
    chart.setData(bars(0, 3));
    assert.deepEqual(data.events.map((d) => [d.reason, d.length]), [['set', 3]]);
    chart.destroy();
  });
});

describe('subscribeDataLoad', () => {
  it('reports set, append, update and config data after the render', () => {
    const { chart, canvas } = setup(10);
    const { events } = loads(chart);
    let paintedFirst = false;
    const before = canvas.context.calls.length;
    const off = chart.subscribeDataLoad((e) => { paintedFirst = canvas.context.calls.length > before && chart.dataLength === e.length; });
    chart.setData(bars(0, 20));
    assert.equal(paintedFirst, true);
    off();
    chart.appendData(bar(20));
    chart.appendData({ ...bar(20), close: 5 });
    chart.appendData({ ...bar(5), close: 5 }); // replaces an existing candle
    chart.appendData({ ...bar(4), time: bar(4).time + 60 }); // out-of-order insert grows the series
    chart.updateConfig({ data: bars(-5, 5) });
    chart.updateConfig({ series: { type: 'line' } });
    chart.setData([]);
    assert.deepEqual(events, [
      { reason: 'set', length: 20, added: 20, firstTime: T0, lastTime: bar(19).time },
      { reason: 'append', length: 21, added: 1, firstTime: T0, lastTime: bar(20).time },
      { reason: 'update', length: 21, added: 0, firstTime: T0, lastTime: bar(20).time },
      { reason: 'update', length: 21, added: 0, firstTime: T0, lastTime: bar(20).time },
      { reason: 'append', length: 22, added: 1, firstTime: T0, lastTime: bar(20).time },
      { reason: 'set', length: 10, added: 10, firstTime: bar(-5).time, lastTime: bar(4).time },
      { reason: 'set', length: 0, added: 0, firstTime: null, lastTime: null },
    ]);
    chart.destroy();
  });

  it('delivers every change of a batch in order once it flushes, before the range', () => {
    const { chart } = setup(10);
    const order: string[] = [];
    chart.subscribeDataLoad((e) => order.push(`${e.reason}:${e.length}`));
    chart.subscribeVisibleRangeChange((e) => order.push(`range:${e.length}`));
    chart.batch(() => {
      chart.setData(bars(0, 30));
      chart.appendData(bar(30));
      assert.deepEqual(order, []);
    });
    assert.deepEqual(order, ['set:30', 'append:31', 'range:31']);
    chart.destroy();
  });
});

describe('re-entrancy', () => {
  it('a listener that scrolls supersedes the event in flight; others only see the fresh state', () => {
    const { chart } = setup(200);
    const a: VisibleRangeChangeEvent[] = [];
    const b: VisibleRangeChangeEvent[] = [];
    chart.subscribeVisibleRangeChange((e) => {
      a.push(e);
      if (e.barsAfter > 0 && e.barsAfter < 20) chart.scale.scrollTo(150); // snap once
    });
    chart.subscribeVisibleRangeChange((e) => b.push(e));
    chart.scale.scrollBy(5);
    assert.deepEqual(a.map((e) => e.barsAfter), [5, 49]);
    assert.deepEqual(b.map((e) => e.barsAfter), [49]);
    assert.equal(b[0]!.to, chart.scale.visibleRange().to);
    chart.destroy();
  });

  it('a listener may unsubscribe itself or others mid-emission', () => {
    const { chart } = setup(200);
    const seen: string[] = [];
    let offC = (): void => {};
    const offA = chart.subscribeCrosshairMove(() => { seen.push('a'); offA(); offC(); });
    chart.subscribeCrosshairMove(() => seen.push('b'));
    offC = chart.subscribeCrosshairMove(() => seen.push('c'));
    chart.setCrosshair(10, 10);
    chart.setCrosshair(20, 20);
    assert.deepEqual(seen, ['a', 'b', 'b']);
    offA();
    chart.destroy();
  });

  it('a listener may destroy the chart mid-emission', () => {
    const { chart } = setup(200);
    const seen: string[] = [];
    chart.subscribeDataLoad(() => { seen.push('a'); chart.destroy(); });
    chart.subscribeDataLoad(() => seen.push('b'));
    chart.subscribeVisibleRangeChange(() => seen.push('range'));
    chart.setData(bars(0, 300));
    assert.deepEqual(seen, ['a']);
  });

  it('cuts off a feedback loop and drops its backlog', () => {
    const { chart } = setup(20);
    let loop = true;
    let calls = 0;
    chart.subscribeDataLoad(() => {
      calls++;
      if (loop) chart.appendData({ ...bar(19), close: calls });
    });
    const crosshair = moves(chart);
    chart.appendData(bar(20));
    assert.equal(calls, MAX_EVENT_ROUNDS);
    loop = false;
    chart.setData(bars(0, 5));
    assert.equal(calls, MAX_EVENT_ROUNDS + 1, 'the dropped update is never delivered');
    // A ping-pong between two states is cut off too.
    const unstable = chart.subscribeCrosshairMove((e) => {
      if (e.active) chart.clearCrosshair();
      else chart.setCrosshair(1, 1);
    });
    chart.setCrosshair(1, 1);
    assert.equal(crosshair.events.length, MAX_EVENT_ROUNDS);
    unstable();
    chart.render();
    assert.equal(crosshair.events.length, MAX_EVENT_ROUNDS, 'the baseline was resynced, nothing stale is pending');
    chart.setCrosshair(1, 1);
    chart.clearCrosshair();
    assert.equal(crosshair.events.at(-1)!.active, false);
    chart.destroy();
  });

  it('a throwing listener propagates and leaves delivery working', () => {
    const { chart } = setup(10);
    let fail = true;
    const seen: string[] = [];
    chart.subscribeDataLoad((e) => {
      if (fail) {
        fail = false;
        throw new Error('boom');
      }
      seen.push(e.reason);
    });
    assert.throws(() => chart.setData(bars(0, 12)), /boom/);
    chart.appendData(bar(12));
    assert.deepEqual(seen, ['append']);
    chart.destroy();
  });

  it('destroy() drops listeners and later subscriptions stay silent', () => {
    const { chart } = setup(10);
    const before = moves(chart);
    chart.destroy();
    const after = moves(chart);
    chart.setCrosshair(10, 10);
    chart.scale.scrollBy(3);
    assert.equal(before.events.length + after.events.length, 0);
    before.off();
    after.off();
  });
});

describe('ChartEvents', () => {
  it('supports prepend as a one-line emission', () => {
    const store = new DataStore();
    const timeScale = new TimeScale(6, 600);
    const events = new ChartEvents({ store, timeScale, crosshair: new Crosshair(), plotLeft: () => 0, panes: () => [] });
    const { events: seen } = record<DataLoadEvent>((cb) => events.subscribeDataLoad(cb));
    store.setData(bars(-10, 5));
    events.dataLoaded('prepend', 10);
    events.flush();
    assert.deepEqual(seen, [{ reason: 'prepend', length: 15, added: 10, firstTime: bar(-10).time, lastTime: bar(4).time }]);
    events.dispose();
    events.dataLoaded('prepend', 1);
    events.flush();
    assert.equal(seen.length, 1);
  });
});

describe('acceptance: lazy-load history near the left edge', () => {
  const THRESHOLD = 40;
  const PAGE = 200;

  function lazyChart(maxPages: number) {
    let data = bars(0, 300);
    let oldest = 0;
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data } });
    const seen: VisibleRangeChangeEvent[] = [];
    const pages: { trigger: VisibleRangeChangeEvent; x: number; afterX: number; after: { from: number; to: number } }[] = [];
    const dataEvents = loads(chart);
    chart.subscribeVisibleRangeChange((e) => {
      seen.push(e);
      if (e.barsBefore >= THRESHOLD) return;
      if (pages.length >= maxPages) {
        chart.setData(data); // a naive loader re-sets the same data: must not loop
        return;
      }
      const x = chart.scale.indexToX(e.from);
      data = [...bars(oldest - PAGE, oldest), ...data];
      oldest -= PAGE;
      chart.setData(data);
      pages.push({ trigger: e, x, afterX: chart.scale.indexToX(e.from + PAGE), after: chart.scale.visibleRange() });
    });
    return { chart, seen, pages, dataEvents: dataEvents.events };
  }

  function assertPages(pages: ReturnType<typeof lazyChart>['pages'], seen: VisibleRangeChangeEvent[], chart: Chart) {
    for (const page of pages) {
      assert.ok(page.trigger.barsBefore < THRESHOLD);
      // Right-anchored scale: the same candles stay at the same pixels.
      assert.deepEqual(page.after, { from: page.trigger.from + PAGE, to: page.trigger.to + PAGE });
      assert.ok(Math.abs(page.afterX - page.x) < 1e-9);
      const next = seen[seen.indexOf(page.trigger) + 1]!;
      assert.equal(next.length, page.trigger.length + PAGE);
      assert.equal(next.fromTime, page.trigger.fromTime);
      assert.equal(next.toTime, page.trigger.toTime);
      assert.ok(Math.abs(next.barsBefore - (page.trigger.barsBefore + PAGE)) < 1e-9);
      assert.equal(next.barsAfter, page.trigger.barsAfter);
    }
    assert.equal(chart.dataLength, 300 + pages.length * PAGE);
  }

  it('pointer-driven panning prepends pages and keeps the viewport on the same candles', () => {
    const { chart, seen, pages, dataEvents } = lazyChart(2);
    const controller = new DrawingController(chart);
    let x = 100;
    controller.pointerDown(x, 200);
    let movesMade = 0;
    for (; movesMade < 200; movesMade++) controller.pointerMove((x += 30), 200); // 5 bars per move
    controller.pointerUp(x, 200);

    assert.equal(pages.length, 2);
    assertPages(pages, seen, chart);
    assert.deepEqual(dataEvents.slice(0, 2).map((e) => [e.reason, e.added]), [['set', 500], ['set', 700]]);
    // Past the last page the naive loader re-sets identical data on every emission; each ends quietly.
    assert.ok(dataEvents.length > 2);
    assert.ok(dataEvents.slice(2).every((e) => e.reason === 'set' && e.length === 700));
    // Panned into the leading whitespace once history ran out; no feedback loop.
    assert.ok(seen.at(-1)!.barsBefore < 0);
    assert.ok(seen.length <= movesMade + pages.length, `emissions ${seen.length} bounded by input`);
    chart.destroy();
  });

  it('scale.scrollBy panning does the same', () => {
    const { chart, seen, pages } = lazyChart(3);
    for (let i = 0; i < 100; i++) chart.scale.scrollBy(10);
    assert.equal(pages.length, 3);
    assertPages(pages, seen, chart);
    assert.equal(seen.at(-1)!.fromTime, bar(-600).time);
    chart.destroy();
  });
});

describe('batched input is not a feedback loop', () => {
  it('delivers every load of a batch far above MAX_EVENT_ROUNDS, then the range once', () => {
    const { chart } = setup(200);
    const data = loads(chart);
    const range = ranges(chart);
    const n = MAX_EVENT_ROUNDS * 3;
    // e.g. a reconnect gap backfill replaying hundreds of missed bars
    chart.batch(() => {
      for (let i = 0; i < n; i++) chart.appendData(bar(200 + i));
    });
    assert.deepEqual(data.events.map((e) => e.length), Array.from({ length: n }, (_, k) => 201 + k));
    assert.ok(data.events.every((e) => e.reason === 'append' && e.added === 1));
    assert.equal(range.events.length, 1);
    assert.deepEqual([range.events[0]!.length, range.events[0]!.toTime], [200 + n, bar(199 + n).time]);

    // A live-candle burst: one new bar plus many ticks folded into it.
    const ticks = MAX_EVENT_ROUNDS * 2;
    chart.batch(() => {
      chart.appendData(bar(200 + n));
      for (let k = 0; k < ticks; k++) chart.appendData({ ...bar(200 + n), close: 100 + k });
    });
    assert.deepEqual(data.events.slice(n).map((e) => e.reason), ['append', ...Array<string>(ticks).fill('update')]);
    assert.equal(data.events.at(-1)!.length, 201 + n);
    assert.equal(range.events.length, 2);
    assert.equal(range.events[1]!.length, 201 + n);
    // Nothing was dropped or left pending.
    chart.render();
    assert.equal(range.events.length, 2);
    chart.destroy();
  });
});

describe('no stale payloads under re-entrancy', () => {
  it('a crosshair listener that scrolls, swaps data or re-renders: later listeners only see the bar under the pointer', () => {
    const { chart } = setup(200);
    const a: CrosshairMoveEvent[] = [];
    const b: CrosshairMoveEvent[] = [];
    let act: (() => void) | null = () => chart.scale.scrollBy(20);
    chart.subscribeCrosshairMove((e) => {
      a.push(e);
      const run = act;
      act = null;
      run?.();
    });
    chart.subscribeCrosshairMove((e) => b.push(e));

    const x = chart.scale.indexToX(150);
    chart.setCrosshair(x, 100);
    // A saw the superseded event, then the fresh one; B only the fresh one.
    assert.deepEqual(a.map((e) => e.index), [150, 130]);
    assert.deepEqual(b.map((e) => e.index), [130]);
    assert.equal(b[0]!.index, Math.round(chart.scale.xToIndex(x)));
    assert.deepEqual(b[0]!.candle, bar(130));
    assert.equal(b[0]!.time, bar(130).time);
    assert.ok(Math.abs(b[0]!.price! - chart.scale.yToPrice(100)) < 1e-9);

    // New prices under a still pointer.
    act = () => chart.setData(bars(0, 200).map((c) => ({ ...c, close: 5 })));
    chart.setCrosshair(x, 101);
    assert.equal(a.length, 4);
    assert.equal(b.length, 2);
    assert.equal(a[2]!.candle!.close, bar(130).close);
    assert.equal(b[1]!.candle!.close, 5);
    assert.equal(b[1]!.index, 130);

    // A change that leaves the payload intact does not supersede it.
    act = () => chart.render();
    chart.setCrosshair(x, 102);
    assert.equal(a.length, 5);
    assert.equal(b.length, 3);
    assert.deepEqual(b[2], a[4]);
    chart.destroy();
  });

  it('a range listener that swaps in same-length data: later listeners get the new candle times', () => {
    const { chart } = setup(200);
    const a: VisibleRangeChangeEvent[] = [];
    const b: VisibleRangeChangeEvent[] = [];
    const next = bars(1000, 1200);
    let swap = true;
    chart.subscribeVisibleRangeChange((e) => {
      a.push(e);
      if (swap) {
        swap = false;
        chart.setData(next);
      }
    });
    chart.subscribeVisibleRangeChange((e) => b.push(e));
    chart.scale.scrollBy(5);
    assert.equal(a.length, 2);
    assert.equal(a[0]!.fromTime, bar(a[0]!.from).time);
    assert.equal(b.length, 1);
    const e = b[0]!;
    assert.deepEqual([e.from, e.to, e.length, e.barsAfter], [a[0]!.from, a[0]!.to, 200, 5]);
    assert.equal(e.fromTime, next[e.from]!.time);
    assert.equal(e.toTime, next[e.to - 1]!.time);
    assert.deepEqual(a[1], e);

    // Outside re-entrancy too: a same-length symbol switch reports its new
    // times, while re-setting identical data stays quiet.
    chart.setData(bars(0, 200));
    assert.equal(b.length, 2);
    assert.equal(b[1]!.fromTime, bar(b[1]!.from).time);
    chart.setData(bars(0, 200));
    assert.equal(b.length, 2);
    chart.destroy();
  });
});

describe('listener errors', () => {
  it('Emitter calls every listener and rethrows the first error afterwards', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    emitter.subscribe((n) => {
      seen.push(`a${n}`);
      throw new Error('first');
    });
    emitter.subscribe((n) => {
      seen.push(`b${n}`);
      throw new Error('second');
    });
    emitter.subscribe((n) => seen.push(`c${n}`));
    assert.throws(() => emitter.emit(1), { message: 'first' });
    assert.deepEqual(seen, ['a1', 'b1', 'c1']);
    // A listener that throws and supersedes the event still stops delivery.
    assert.throws(() => emitter.emit(2, () => false), { message: 'first' });
    assert.deepEqual(seen.slice(3), ['a2']);
  });

  it('a throwing listener does not starve the listeners after it', () => {
    const { chart } = setup(200);
    chart.subscribeVisibleRangeChange(() => {
      throw new Error('analytics bug');
    });
    const range = ranges(chart);
    chart.subscribeCrosshairMove(() => {
      throw new Error('legend bug');
    });
    const crosshair = moves(chart);
    for (let i = 0; i < 3; i++) assert.throws(() => chart.scale.scrollBy(10), { message: 'analytics bug' });
    assert.deepEqual(range.events.map((e) => e.barsAfter), [10, 20, 30]);
    assert.throws(() => chart.setCrosshair(100, 100), { message: 'legend bug' });
    assert.deepEqual(crosshair.events.map((e) => [e.x, e.y]), [[100, 100]]);
    chart.destroy();
  });

  it('finishes the whole flush before rethrowing the first error', () => {
    const { chart } = setup(10);
    const seen: string[] = [];
    chart.subscribeDataLoad((e) => {
      if (e.length === 11) throw new Error('load');
    });
    chart.subscribeDataLoad((e) => seen.push(`load:${e.length}`));
    chart.subscribeVisibleRangeChange((e) => {
      seen.push(`range:${e.length}`);
      throw new Error('range');
    });
    assert.throws(() => chart.batch(() => {
      for (let i = 10; i < 13; i++) chart.appendData(bar(i));
    }), { message: 'load' });
    assert.deepEqual(seen, ['load:11', 'load:12', 'load:13', 'range:13']);
    chart.render();
    assert.equal(seen.length, 4, 'nothing was left pending');
    chart.destroy();
  });

  it('batch() never lets a listener error mask its own', () => {
    const { chart } = setup(200);
    const range = ranges(chart);
    chart.subscribeVisibleRangeChange(() => {
      throw new Error('listener');
    });
    assert.throws(() => chart.batch(() => {
      chart.scale.scrollBy(5);
      throw new Error('original');
    }), { message: 'original' });
    assert.deepEqual(range.events.map((e) => e.barsAfter), [5], 'the batch still painted and delivered');
    assert.throws(() => chart.batch(() => chart.scale.scrollBy(5)), { message: 'listener' });
    assert.deepEqual(range.events.map((e) => e.barsAfter), [5, 10]);
    assert.equal(chart.batch(() => 42), 42);
    chart.destroy();
  });
});

describe('non-finite crosshair coordinates', () => {
  it('a NaN x has no bar, a NaN y is off the panes, and neither throws', () => {
    const { chart } = setup(200);
    const { events } = moves(chart);
    chart.setCrosshair(NaN, 100);
    const e = events[0]!;
    assert.deepEqual([e.active, e.index, e.time, e.candle, e.paneId], [true, null, null, null, 'main']);
    assert.ok(Number.isNaN(e.x));
    assert.ok(Math.abs(e.price! - chart.scale.yToPrice(100)) < 1e-9);
    chart.setCrosshair(NaN, 100);
    assert.equal(events.length, 1, 'the same NaN position is not a move');

    chart.setCrosshair(300, NaN);
    const f = events[1]!;
    assert.deepEqual([f.index, f.paneId, f.price], [Math.round(chart.scale.xToIndex(300)), null, null]);
    chart.setCrosshair(Infinity, 10);
    assert.equal(events[2]!.index, 199, 'infinite x clamps like any off-plot x');
    chart.destroy();
  });
});
