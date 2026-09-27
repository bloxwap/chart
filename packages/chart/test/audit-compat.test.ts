/**
 * Regressions from the whole-diff compatibility audit:
 *
 * - A DrawingController or DrawingHistory that a host drops without
 *   `dispose()` (new with prepend support, so hosts written before it never
 *   call it) no longer stays reachable from the chart for the chart's
 *   lifetime: the chart holds it weakly, so it can be collected, and its
 *   data-load listener leaves at the next data load.
 * - `touchGestures: false` gives existing embeds in scrolling mobile pages
 *   their old touch behaviour back (no `cts-touch` class, so the page
 *   scrolls under a finger, and fingers take the mouse paths) while mouse
 *   drag, wheel zoom and the crosshair stay on.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { createChart, MockDocument, type Candle, type Chart, type FrameScheduler } from '../dist/index.js';
import {
  createDrawingToolbar,
  DrawingController,
  DrawingHistory,
  LONG_PRESS_MS,
  type DrawingToolbarOptions,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

// The test runner gives each file its own process, so exposing gc stays local to this file.
setFlagsFromString('--expose-gc');
/** A full garbage collection. */
const gc = runInNewContext('gc') as () => void;

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const T0 = 1_700_000_000;
const HOUR = 3600;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** Hourly bar `i` (negative for older history). */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 5) * 10;
  return { time: T0 + i * HOUR, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
}
const bars = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, k) => bar(from + k));

/** Counts `chart`'s data-load listeners through its public subscribe/unsubscribe. */
function countListeners(chart: Chart): { active: number } {
  const count = { active: 0 };
  const subscribe = chart.subscribeDataLoad.bind(chart);
  Object.assign(chart, {
    subscribeDataLoad: (listener: Parameters<Chart['subscribeDataLoad']>[0]) => {
      count.active++;
      const off = subscribe(listener);
      let subscribed = true;
      return () => {
        if (subscribed) count.active--;
        subscribed = false;
        off();
      };
    },
  });
  return count;
}

describe('audit (compat): drawing state dropped without dispose()', () => {
  /** A host written before dispose() existed: it builds, uses and drops controllers and histories. */
  function abandon(chart: Chart, count: number): void {
    for (let i = 0; i < count; i++) {
      const controller = new DrawingController(chart);
      controller.history.checkpoint();
      controller.points = [{ index: 5, price: 100 }];
      new DrawingHistory(chart).checkpoint();
    }
  }

  it('is not kept alive by the chart, and its listeners leave at the next data load', async () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: bars(0, 200) } });
    const listeners = countListeners(chart);
    chart.addDrawing({ id: 'line', name: 'trendline', points: [{ index: 10, price: 100 }, { index: 20, price: 110 }] });
    const kept = new DrawingController(chart);
    kept.history.checkpoint();
    kept.points = [{ index: 5, price: 100 }];
    abandon(chart, 10);
    assert.equal(listeners.active, 2 + 10 * 3, 'a controller follows with its history; a history alone once');

    // A live bar is not a prepend: nothing shifts, and every listener is still there before a collection.
    chart.appendData({ ...bar(199), close: 105 });
    assert.equal(listeners.active, 2 + 10 * 3);
    assert.deepEqual(kept.points, [{ index: 5, price: 100 }]);

    // WeakRef targets stay alive until the job that made them ends.
    await new Promise((resolve) => setImmediate(resolve));
    gc();
    assert.equal(chart.prependData(bars(-10, 0)), 10);
    assert.equal(listeners.active, 2, 'only the kept controller and its history still follow the chart');
    assert.deepEqual(kept.points, [{ index: 15, price: 100 }], 'a live controller still follows prepends');
    chart.removeDrawing('line');
    assert.ok(kept.history.undo());
    assert.deepEqual(chart.getDrawing('line')!.points.map((p) => p.index), [20, 30], 'a live history still follows prepends');

    kept.dispose();
    assert.equal(listeners.active, 0, 'dispose() still releases at once');
    chart.destroy();
  });
});

// ------------------------------------------------------------------ touchGestures

class FakeTimers {
  time = 0;
  private seq = 0;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms = 0): number => {
    const id = ++this.seq;
    this.queue.set(id, { at: this.time + ms, fn });
    return id;
  };
  clearTimeout = (id: number | undefined): void => {
    this.queue.delete(id!);
  };
  setInterval = (): number => 0;
  clearInterval = (): void => {};
  tick(ms: number): void {
    this.time += ms;
    for (const [id, t] of [...this.queue]) if (t.at <= this.time && this.queue.delete(id)) t.fn();
  }
}

class TestFrames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => { const id = ++this.seq; this.callbacks.set(id, callback); return id; };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
}

type Extra = Partial<Omit<DrawingToolbarOptions, 'chart' | 'document' | 'canvas' | 'rail' | 'overlay'>>;

/** A drawing toolbar on a phone-like window (`(pointer: coarse)` matches); `finger` dispatches touch pointer events. */
function mount(extra: Extra = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, {
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }),
  });
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: bars(0, 2000) } });
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    scheduler: frames,
    ...extra,
  });
  const finger = (type: string, x: number, y: number) => {
    const event = new win.PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  const compat = (type: string) => {
    const event = new win.MouseEvent(type, { clientX: 360, clientY: 200, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  const wheel = () => canvas.dispatchEvent(Object.assign(new win.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }), { clientX: 300 }));
  return { win, canvas, chart, frames, timers, tb, finger, compat, wheel };
}

const crosshair = (chart: Chart) => (chart as unknown as { crosshair: { active: boolean; x: number; y: number } }).crosshair;
const spacing = (chart: Chart) => chart.scale.indexToX(1) - chart.scale.indexToX(0);

describe('audit (compat): the toolbar touchGestures option', () => {
  it('defaults on: fingers pan through the gestures and the page stops scrolling under the chart', () => {
    for (const extra of [{}, { touchGestures: true }]) {
      const m = mount(extra);
      assert.ok(m.canvas.classList.contains('cts-touch'));
      assert.equal(m.tb.controller.touch, true, 'a coarse pointer opens with the touch hint');
      assert.equal(m.finger('pointerdown', 300, 200).defaultPrevented, true, 'the gestures take the finger');
      m.timers.tick(LONG_PRESS_MS);
      assert.equal(crosshair(m.chart).active, true, 'a long press shows the crosshair');
      m.finger('pointerup', 300, 200);
      m.tb.destroy();
    }
  });

  it('false keeps the page scrolling under a finger, and mouse and wheel navigation', () => {
    const m = mount({ touchGestures: false });
    assert.equal(m.canvas.classList.contains('cts-touch'), false, 'no touch-action: none');
    assert.equal(m.tb.controller.touch, false, 'the idle hint names mouse navigation');

    // A finger takes the mouse path, as it did before touch gestures: a drag pans, with the crosshair under it.
    const anchor = m.chart.scale.xToIndex(300);
    assert.equal(m.finger('pointerdown', 300, 200).defaultPrevented, false, 'the browser keeps the finger');
    m.finger('pointermove', 360, 200);
    m.frames.tick();
    close(m.chart.scale.xToIndex(360), anchor);
    assert.deepEqual([crosshair(m.chart).active, crosshair(m.chart).x], [true, 360]);
    m.finger('pointerup', 360, 200);
    assert.equal(m.compat('contextmenu').defaultPrevented, false, 'compat events after a finger pass through');

    // The wheel still zooms.
    const before = spacing(m.chart);
    m.wheel();
    for (let i = 0; i < 40; i++) m.frames.tick();
    assert.ok(spacing(m.chart) > before, `${spacing(m.chart)} > ${before}`);
    m.tb.destroy();
  });

  it('needs navigation: without it fingers are never routed as gestures', () => {
    const m = mount({ navigation: false, touchGestures: true });
    assert.equal(m.canvas.classList.contains('cts-touch'), false);
    assert.equal(m.tb.controller.touch, false);
    assert.equal(m.finger('pointerdown', 300, 200).defaultPrevented, false);
    m.tb.destroy();
  });
});
