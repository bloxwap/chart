import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createChart, type Chart, type FrameScheduler } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import {
  attachTouchGestures,
  createDrawingToolbar,
  DrawingController,
  DrawingHistory,
  DOUBLE_TAP_MS,
  FLING_DURATION_MS,
  FLING_MIN_VELOCITY,
  GestureRecognizer,
  LONG_PRESS_MS,
  TAP_SLOP_PX,
  TOOLBAR_CSS,
  TOUCH_HIT_PX,
  TOUCH_POINTER_TYPES,
  ZOOM_TOOL,
  type DrawingToolbarOptions,
  type GestureHandlers,
  type TouchGesturesOptions,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

/** Controllable window timers: nothing fires until `tick`. */
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
  get pending(): number {
    return this.queue.size;
  }
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

const crosshair = (chart: Chart) => (chart as unknown as { crosshair: { active: boolean; x: number; y: number } }).crosshair;
const spacing = (chart: Chart) => chart.scale.indexToX(1) - chart.scale.indexToX(0);

// ------------------------------------------------------------------ recognizer

function recognize(handlers?: Partial<GestureHandlers>) {
  const timers = new FakeTimers();
  const log: string[] = [];
  const g = new GestureRecognizer(
    handlers ?? {
      pan: (dx) => log.push(`pan ${dx}`),
      pinch: (factor, anchorX) => log.push(`pinch ${factor.toFixed(3)} ${anchorX}`),
      pressStart: (x, y) => log.push(`start ${x},${y}`),
      pressMove: (x, y) => log.push(`move ${x},${y}`),
      pressEnd: () => log.push('end'),
      tap: (x, y) => log.push(`tap ${x},${y}`),
      fling: (velocity) => log.push(`fling ${velocity.toFixed(2)}`),
    },
    { timers, now: () => timers.time },
  );
  return { g, timers, log };
}

describe('GestureRecognizer', () => {
  it('pans once a finger passes the slop, then flings on a fast release', () => {
    const { g, timers, log } = recognize();
    g.down(1, 100, 100);
    assert.equal(g.active, true);
    assert.equal(g.has(1), true);
    assert.equal(timers.pending, 1, 'long-press timer armed');
    g.move(1, 100 + TAP_SLOP_PX, 100);
    assert.deepEqual(log, [], 'travel within the slop is still a tap');
    timers.time = 10;
    g.move(1, 120, 100);
    assert.equal(timers.pending, 0, 'panning cancels the long press');
    timers.time = 20;
    g.move(1, 130, 104);
    g.move(1, 130, 120); // vertical drift: nothing to pan
    g.up(1, 130, 120);
    // Velocity: 0.8·(20/10) = 1.6, then 0.8·(10/10) + 0.2·1.6 = 1.12 px/ms.
    assert.deepEqual(log, ['pan 20', 'pan 10', 'fling 1.12']);
    assert.equal(g.active, false);
    assert.ok(1.12 >= FLING_MIN_VELOCITY);
  });

  it('does not fling slow, resting or instantaneous pans', () => {
    const slow = recognize();
    slow.g.down(1, 0, 0);
    slow.timers.time = 100;
    slow.g.move(1, 20, 0); // 0.8 · 0.2 = 0.16 px/ms
    slow.g.up(1, 20, 0);
    assert.deepEqual(slow.log, ['pan 20']);

    const resting = recognize();
    resting.g.down(1, 0, 0);
    resting.timers.time = 10;
    resting.g.move(1, 40, 0);
    resting.timers.time = 200; // held still before lifting
    resting.g.up(1, 40, 0);
    assert.deepEqual(resting.log, ['pan 40']);

    const instant = recognize();
    instant.g.down(1, 0, 0);
    instant.g.move(1, 40, 0); // same timestamp: no velocity sample
    instant.g.up(1, 40, 0);
    assert.deepEqual(instant.log, ['pan 40']);
  });

  it('taps without travel; a drag that returns is still a drag', () => {
    const { g, timers, log } = recognize();
    g.down(1, 50, 50);
    g.move(1, 53, 52);
    g.up(1, 54, 52);
    assert.deepEqual(log, ['tap 54,52']);
    assert.equal(timers.pending, 0);
    g.down(2, 50, 50);
    g.move(2, 70, 50);
    g.up(2, 50, 50);
    assert.deepEqual(log.slice(1), ['pan 20', 'pan -20']);
  });

  it('long press shows the crosshair, drags it, keeps it after release and hides it on the next tap', () => {
    const { g, timers, log } = recognize();
    g.down(1, 50, 60);
    timers.tick(LONG_PRESS_MS - 1);
    assert.deepEqual(log, []);
    timers.tick(1);
    assert.deepEqual(log, ['start 50,60']);
    assert.equal(g.tracking, true);
    g.move(1, 70, 80);
    g.up(1, 70, 80);
    assert.deepEqual(log.slice(1), ['move 70,80'], 'the crosshair follows the finger; release keeps it');
    assert.equal(g.tracking, true);

    // A drag while tracking moves the crosshair by the finger's offset (it stays visible).
    g.down(2, 200, 200);
    g.move(2, 205, 203);
    g.move(2, 220, 200);
    assert.equal(timers.pending, 0, 'moving past the slop cancels the long press');
    g.up(2, 220, 200);
    assert.deepEqual(log.slice(2), ['move 75,83', 'move 90,80']);
    assert.equal(g.tracking, true);

    // The next tap hides it, and is not reported as a tap.
    g.down(3, 300, 300);
    g.up(3, 303, 300);
    assert.deepEqual(log.slice(4), ['move 93,80', 'end']);
    assert.equal(g.tracking, false);
    g.down(4, 10, 10);
    g.up(4, 10, 10);
    assert.deepEqual(log.slice(6), ['tap 10,10']);
  });

  it('holding still while tracking jumps the crosshair to the finger', () => {
    const { g, timers, log } = recognize();
    g.down(1, 5, 5);
    timers.tick(LONG_PRESS_MS);
    g.up(1, 5, 5);
    g.down(2, 100, 120);
    g.move(2, 101, 121); // jitter within the 2 px hold slop
    timers.tick(LONG_PRESS_MS);
    g.move(2, 110, 130);
    assert.deepEqual(log, ['start 5,5', 'move 6,6', 'start 101,121', 'move 110,130']);
  });

  it('a slow sub-slop nudge of the shown crosshair moves it without jumping, and keeps it', () => {
    const { g, timers, log } = recognize();
    g.down(1, 100, 100);
    timers.tick(LONG_PRESS_MS);
    g.up(1, 100, 100);
    g.down(2, 600, 300);
    for (let i = 1; i <= 6; i++) {
      timers.tick(100);
      g.move(2, 600 + i, 300);
    }
    g.up(2, 606, 300);
    assert.deepEqual(log, ['start 100,100', ...[1, 2, 3, 4, 5, 6].map((i) => `move ${100 + i},100`)], 'no jump to (60x, 300)');
    assert.equal(g.tracking, true, 'a slow nudge within the tap slop is not the tap that hides it');
    // A quick one is a (sloppy) tap: it hides the crosshair.
    g.down(3, 600, 300);
    g.move(3, 605, 300);
    g.up(3, 605, 300);
    assert.equal(g.tracking, false);
    assert.equal(log.at(-1), 'end');
  });

  it('pinches around the midpoint, pans with it, and pans on with the remaining finger', () => {
    const { g, timers, log } = recognize();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    assert.equal(timers.pending, 0, 'the second finger cancels the long press');
    g.move(2, 300, 100);
    assert.deepEqual(log, ['pan 50', 'pinch 2.000 200']);
    g.move(1, 100, 100); // unchanged
    g.move(1, 100, 150);
    assert.deepEqual(log.slice(2), [`pinch ${(Math.hypot(200, 50) / 200).toFixed(3)} 200`]);
    g.move(1, 500, 150); // mirrored about the other finger: same spread, new midpoint → pan only
    g.move(1, 100, 150);
    assert.deepEqual(log.slice(3), ['pan 200', 'pan -200']);
    // A third finger is ignored.
    g.down(3, 0, 0);
    g.move(3, 50, 50);
    g.up(3, 50, 50);
    assert.equal(g.has(3), false);
    assert.equal(log.length, 5);
    g.up(2, 300, 100);
    assert.equal(g.active, true);
    g.move(1, 130, 150);
    g.up(1, 130, 150);
    assert.deepEqual(log.slice(5), ['pan 30'], 'no tap and no fling after a pinch');
    assert.equal(g.active, false);
  });

  it('a second finger cancels a long press or a pan cleanly', () => {
    const press = recognize();
    press.g.down(1, 10, 10);
    press.timers.tick(LONG_PRESS_MS);
    press.g.down(2, 60, 10);
    assert.deepEqual(press.log, ['start 10,10', 'end']);
    assert.equal(press.g.tracking, false);

    const pending = recognize();
    pending.g.down(1, 10, 10);
    pending.g.down(2, 60, 10);
    pending.timers.tick(LONG_PRESS_MS);
    pending.g.up(2, 60, 10);
    pending.g.up(1, 10, 10);
    assert.deepEqual(pending.log, [], 'no crosshair and no tap');

    const pan = recognize();
    pan.g.down(1, 0, 0);
    pan.timers.time = 10;
    pan.g.move(1, 40, 0); // 3.2 px/ms
    pan.g.down(2, 100, 0);
    pan.g.up(2, 100, 0);
    pan.g.up(1, 40, 0);
    assert.deepEqual(pan.log, ['pan 40'], 'the fling is forgotten');
  });

  it('never pinches through a zero spread', () => {
    const { g, log } = recognize();
    g.down(1, 100, 100);
    g.down(2, 100, 100);
    g.move(2, 150, 100);
    g.move(2, 100, 100);
    assert.deepEqual(log, ['pan 25', 'pan -25']);
  });

  it('cancel aborts without a tap or fling and hides the crosshair', () => {
    const { g, timers, log } = recognize();
    g.cancel();
    g.down(1, 10, 10);
    g.down(1, 20, 20); // duplicate down
    assert.equal(timers.pending, 1);
    timers.tick(LONG_PRESS_MS);
    g.cancel();
    g.up(1, 10, 10);
    g.move(1, 30, 30);
    assert.deepEqual(log, ['start 10,10', 'end']);
    assert.equal(g.active, false);
    g.down(2, 0, 0);
    g.cancel();
    assert.equal(timers.pending, 0);
    assert.equal(log.length, 2);
  });

  it('ignores a long-press timer that fires after the finger moved on', () => {
    const timers = new FakeTimers();
    const log: string[] = [];
    // Hosts flush queued moves inside the timer callback, so a clear can come too late.
    const g = new GestureRecognizer(
      { pan: (dx) => log.push(`pan ${dx}`), pressStart: () => log.push('start') },
      { timers: { setTimeout: timers.setTimeout, clearTimeout: () => {} }, now: () => 0 },
    );
    g.down(1, 0, 0);
    g.move(1, 30, 0);
    timers.tick(LONG_PRESS_MS);
    assert.deepEqual(log, ['pan 30']);
    assert.equal(g.tracking, false);
  });

  it('defaults every handler to a no-op', () => {
    const { g, timers } = recognize({});
    g.down(1, 0, 0);
    g.up(1, 0, 0);
    g.down(1, 0, 0);
    timers.tick(LONG_PRESS_MS);
    g.move(1, 5, 5);
    assert.equal(g.tracking, true);
    g.down(2, 50, 5);
    g.move(2, 80, 5);
    g.up(2, 80, 5);
    timers.time += 10;
    g.move(1, 60, 5);
    g.up(1, 60, 5);
    assert.equal(g.tracking, false);
    assert.equal(g.active, false);
  });
});

// ------------------------------------------------------------------ attachTouchGestures

type StageOptions = Partial<Omit<TouchGesturesOptions, 'chart' | 'canvas' | 'document'>>;

function stage(options: StageOptions = {}, setup: { before?: (win: Window) => void; nativeFrames?: boolean; bars?: number } = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  setup.before?.(win);
  const doc = win.document;
  const canvas = doc.createElement('div');
  doc.body.append(canvas);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(setup.bars ?? 2000) } });
  const frames = new TestFrames();
  const gestures = attachTouchGestures({
    chart,
    canvas: canvas as unknown as UIElement,
    document: doc as unknown as UIDocument,
    ...(setup.nativeFrames === true ? {} : { scheduler: frames }),
    ...options,
  });
  const finger = (type: string, id: number, x: number, y: number, init: Record<string, unknown> = {}) => {
    const event = new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  };
  const menu = () => {
    const event = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  return { win, doc, canvas, chart, frames, timers, gestures, finger, menu };
}

describe('attachTouchGestures', () => {
  it('pans with one finger (content follows it) and leaves the crosshair alone', () => {
    const s = stage();
    assert.ok(s.canvas.classList.contains('cts-touch'));
    assert.ok(s.doc.head.querySelector('style[data-chart-ts-ui]'), 'styles injected');
    assert.match(TOOLBAR_CSS, /\.cts-touch \{\s*touch-action: none; -webkit-touch-callout: none;/);
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 330, 200);
    s.finger('pointermove', 1, 360, 200);
    close(s.chart.scale.xToIndex(300), anchor); // coalesced until the frame
    s.frames.tick();
    close(s.chart.scale.xToIndex(360), anchor);
    s.finger('pointerup', 1, 360, 200);
    assert.equal(crosshair(s.chart).active, false);
    s.gestures.destroy();
  });

  it('flings after a fast release, continuing the finger speed', () => {
    const s = stage({}, { before: (win) => Object.assign(win, { matchMedia: undefined }) });
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 340, 200);
    s.frames.tick(16);
    s.finger('pointermove', 1, 380, 200);
    s.frames.tick(16);
    const anchor = s.chart.scale.xToIndex(380);
    s.finger('pointerup', 1, 380, 200);
    // Velocity 0.8·2.5 = 2, then 0.8·2.5 + 0.2·2 = 2.4 px/ms → 2.4·700/3 = 560 px.
    for (let i = 0; i < 60; i++) s.frames.tick(16);
    close(s.chart.scale.xToIndex(380 + (2.4 * FLING_DURATION_MS) / 3), anchor, 1e-3);
    assert.equal(s.frames.callbacks.size, 0, 'the fling finished');
  });

  it('respects prefers-reduced-motion: no fling', () => {
    const s = stage({}, { before: (win) => Object.assign(win, { matchMedia: () => ({ matches: true }) }) });
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 340, 200);
    s.frames.tick(16);
    const anchor = s.chart.scale.xToIndex(340);
    s.finger('pointerup', 1, 340, 200);
    assert.equal(s.frames.callbacks.size, 0);
    s.frames.tick(16);
    close(s.chart.scale.xToIndex(340), anchor);
  });

  it('pinches around the midpoint and clamps the anchor to the plot', () => {
    const s = stage();
    const before = spacing(s.chart);
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 1, 200, 200);
    s.finger('pointerdown', 2, 400, 200);
    s.finger('pointermove', 2, 600, 200);
    s.frames.tick();
    close(spacing(s.chart), before * 2);
    close(s.chart.scale.xToIndex(400), anchor, 1e-3); // the midpoint moved 300 → 400, carrying the content
    s.finger('pointerup', 1, 200, 200);
    s.finger('pointerup', 2, 600, 200);

    // A midpoint over the price axis zooms around the plot's edge.
    const plot = s.chart.plotArea;
    const edge = plot.left + plot.width;
    const anchors: (number | undefined)[] = [];
    const zoom = s.chart.scale.zoom;
    s.chart.scale.zoom = (factor, anchorX) => { anchors.push(anchorX); zoom(factor, anchorX); };
    s.finger('pointerdown', 3, edge + 10, 100);
    s.finger('pointerdown', 4, edge + 30, 100);
    s.finger('pointermove', 3, edge + 5, 100);
    s.finger('pointermove', 4, edge + 35, 100);
    s.frames.tick();
    assert.ok(spacing(s.chart) > before * 2, 'zoomed in');
    assert.deepEqual(anchors, [edge, edge]);
  });

  it('long press shows the crosshair; it follows, stays after release, and hides on the next tap', () => {
    const s = stage();
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 1, 300, 200);
    s.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(s.chart).active, true);
    assert.deepEqual([crosshair(s.chart).x, crosshair(s.chart).y], [300, 200]);
    s.finger('pointermove', 1, 340, 240);
    s.frames.tick();
    assert.deepEqual([crosshair(s.chart).x, crosshair(s.chart).y], [340, 240]);
    close(s.chart.scale.xToIndex(300), anchor, 1e-9); // no pan
    s.finger('pointerup', 1, 340, 240);
    assert.equal(crosshair(s.chart).active, true, 'the crosshair stays after release');
    // A drag nudges it by the finger's offset.
    s.finger('pointerdown', 2, 100, 100);
    s.finger('pointermove', 2, 120, 90);
    s.frames.tick();
    s.finger('pointerup', 2, 120, 90);
    assert.deepEqual([crosshair(s.chart).active, crosshair(s.chart).x, crosshair(s.chart).y], [true, 360, 230]);
    // A tap hides it.
    s.finger('pointerdown', 3, 500, 300);
    s.finger('pointerup', 3, 500, 300);
    assert.equal(crosshair(s.chart).active, false);
  });

  it('flushes queued moves before the long-press timer, so a started pan wins', () => {
    const s = stage();
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 350, 200);
    s.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(s.chart).active, false);
    close(s.chart.scale.xToIndex(350), anchor);
    assert.equal(s.frames.callbacks.size, 0, 'the queued frame was consumed');
  });

  it('pointercancel and lost capture abort cleanly', () => {
    const s = stage();
    s.finger('pointerdown', 1, 300, 200);
    s.timers.tick(LONG_PRESS_MS);
    s.finger('pointercancel', 1, 0, 0);
    assert.equal(crosshair(s.chart).active, false);
    s.finger('pointerup', 1, 300, 200);
    assert.equal(crosshair(s.chart).active, false);

    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 2, 300, 200);
    s.finger('pointermove', 2, 340, 200);
    s.finger('lostpointercapture', 9, 0, 0); // not ours
    s.finger('lostpointercapture', 2, 0, 0);
    close(s.chart.scale.xToIndex(340), anchor); // the queued move was applied first
    s.finger('pointermove', 2, 400, 200);
    s.frames.tick();
    s.finger('pointerup', 2, 400, 200);
    close(s.chart.scale.xToIndex(340), anchor);
  });

  it('default-prevents finger pointerdowns only, so browsers skip the compat mouse events', () => {
    const s = stage();
    assert.equal(s.finger('pointerdown', 1, 300, 200).defaultPrevented, true);
    assert.equal(s.finger('pointerdown', 2, 400, 200).defaultPrevented, true, 'second finger too');
    s.finger('pointerup', 1, 300, 200);
    s.finger('pointerup', 2, 400, 200);
    assert.equal(s.finger('pointerdown', 3, 300, 200, { pointerType: 'mouse' }).defaultPrevented, false);
    assert.equal(s.finger('pointerdown', 4, 300, 200, { pointerType: 'pen' }).defaultPrevented, false);
  });

  it('suppresses the long-press context menu for touch only', () => {
    const s = stage();
    s.finger('pointerdown', 1, 300, 200);
    assert.equal(s.menu().defaultPrevented, true);
    s.finger('pointerup', 1, 300, 200);
    s.finger('pointerdown', 2, 300, 200, { pointerType: 'mouse' });
    assert.equal(s.menu().defaultPrevented, false);
  });

  it('leaves mouse and pen alone unless pens are opted in', () => {
    const s = stage();
    const anchor = s.chart.scale.xToIndex(300);
    for (const pointerType of ['mouse', 'pen']) {
      s.finger('pointerdown', 1, 300, 200, { pointerType });
      s.finger('pointermove', 1, 360, 200, { pointerType });
      s.frames.tick();
      s.finger('pointerup', 1, 360, 200, { pointerType });
      s.finger('pointercancel', 1, 360, 200, { pointerType });
    }
    close(s.chart.scale.xToIndex(300), anchor);

    const pen = stage({ pointerTypes: [...TOUCH_POINTER_TYPES, 'pen'] });
    const start = pen.chart.scale.xToIndex(300);
    pen.finger('pointerdown', 1, 300, 200, { pointerType: 'pen' });
    pen.finger('pointermove', 1, 360, 200, { pointerType: 'pen' });
    pen.frames.tick();
    close(pen.chart.scale.xToIndex(360), start);
  });

  it('destroy removes listeners, timers, frames and the touch class', () => {
    const s = stage();
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 302, 200);
    assert.equal(s.timers.pending, 1);
    assert.equal(s.frames.callbacks.size, 1);
    s.gestures.destroy();
    assert.equal(s.timers.pending, 0);
    assert.equal(s.frames.callbacks.size, 0);
    assert.equal(s.canvas.classList.contains('cts-touch'), false);
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 2, 300, 200);
    s.finger('pointermove', 2, 360, 200);
    s.frames.tick();
    close(s.chart.scale.xToIndex(300), anchor);

    const shown = stage();
    shown.finger('pointerdown', 1, 300, 200);
    shown.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(shown.chart).active, true);
    shown.gestures.destroy();
    assert.equal(crosshair(shown.chart).active, false, 'a long-press crosshair hides');
  });

  it('runs on the window frame clock by default', async () => {
    const s = stage({}, { nativeFrames: true });
    const anchor = s.chart.scale.xToIndex(300);
    s.finger('pointerdown', 1, 300, 200);
    s.finger('pointermove', 1, 360, 200);
    const panned = () => Math.abs(s.chart.scale.xToIndex(360) - anchor) < 1e-6;
    assert.equal(panned(), false, 'the move waits for the frame');
    // The window frame is asynchronous; under load (coverage runs) it can land after any fixed sleep.
    for (let waited = 0; waited < 2000 && !panned(); waited += 10) await sleep(10);
    close(s.chart.scale.xToIndex(360), anchor);
    s.gestures.destroy();
  });
});

// ------------------------------------------------------------------ drawing toolbar

function mount(extra: Partial<Omit<DrawingToolbarOptions, 'chart' | 'document' | 'canvas' | 'rail' | 'overlay'>> = {}, chartConfig: Record<string, unknown> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  const doc = win.document;
  const rail = doc.createElement('div');
  const stageEl = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stageEl.append(canvas);
  doc.body.append(rail, stageEl);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(2000), ...chartConfig } });
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stageEl as unknown as UIElement,
    scheduler: frames,
    ...extra,
  });
  const pointer = (type: string, id: number, x: number, y: number, init: Record<string, unknown> = {}) => {
    const event = new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  };
  const tap = (id: number, x: number, y: number) => {
    pointer('pointerdown', id, x, y);
    pointer('pointerup', id, x, y);
    pointer('pointerleave', id, x, y);
  };
  const mouse = (type: string, x: number, y: number, init: Record<string, unknown> = {}) => pointer(type, 99, x, y, { pointerType: 'mouse', ...init });
  const compat = (type: string) => {
    const event = new win.MouseEvent(type, { clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  const overlayLeave = (pointerType: string) => stageEl.dispatchEvent(new win.PointerEvent('pointerleave', { pointerId: 1, pointerType }));
  return { win, doc, canvas, chart, frames, timers, tb, c: tb.controller, pointer, tap, mouse, compat, overlayLeave };
}

const priceAt = (m: ReturnType<typeof mount>, id: string) => m.chart.getDrawing(id)!.points[0]!.price;
const draft = (chart: Chart) => (chart as unknown as { draft: { points: unknown[] } | null }).draft;

describe('drawing toolbar touch routing', () => {
  it('touch pans without a crosshair and closes menus; the mouse path is unchanged', () => {
    const m = mount();
    assert.ok(m.canvas.classList.contains('cts-touch'));
    (m.doc.querySelector('.cts-more') as unknown as { click(): void }).click();
    assert.equal(m.doc.querySelectorAll('.cts-menu.cts-open').length, 1);
    const anchor = m.chart.scale.xToIndex(300);
    m.pointer('pointerdown', 1, 300, 200);
    assert.equal(m.doc.querySelectorAll('.cts-menu.cts-open').length, 0, 'a touch closes flyouts');
    m.pointer('pointermove', 1, 360, 200);
    m.frames.tick();
    m.pointer('pointerup', 1, 360, 200);
    m.pointer('pointerleave', 1, 360, 200);
    close(m.chart.scale.xToIndex(360), anchor);
    assert.equal(crosshair(m.chart).active, false);

    // Mouse: drag pans with the crosshair under the pointer, exactly as before.
    const again = m.chart.scale.xToIndex(360);
    m.mouse('pointermove', 360, 200);
    m.mouse('pointerdown', 360, 200);
    m.mouse('pointermove', 400, 210);
    m.frames.tick();
    assert.deepEqual([crosshair(m.chart).active, crosshair(m.chart).x, crosshair(m.chart).y], [true, 400, 210]);
    close(m.chart.scale.xToIndex(400), again);
    m.mouse('pointerup', 400, 210);
    m.mouse('pointercancel', 400, 210);
    m.mouse('lostpointercapture', 400, 210);
    m.mouse('pointerleave', 400, 210);
    assert.equal(crosshair(m.chart).active, false);
  });

  it('a tap deselects; pinching in refreshes the scroll arrows', () => {
    const m = mount();
    const price = m.chart.scale.yToPrice(100);
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }] });
    m.c.select(id);
    assert.equal(m.chart.selectedDrawing, id);
    m.tap(1, 300, 300);
    assert.equal(m.chart.selectedDrawing, null);

    const arrow = m.doc.querySelector('.cts-scroll') as unknown as HTMLElementLike;
    assert.equal(arrow.classList.contains('cts-visible'), false);
    m.pointer('pointerdown', 1, 100, 300);
    m.pointer('pointerdown', 2, 700, 300);
    m.pointer('pointermove', 1, 395, 300);
    m.pointer('pointermove', 2, 405, 300);
    m.frames.tick();
    assert.ok(spacing(m.chart) < 4);
    assert.equal(arrow.classList.contains('cts-visible'), true, 'the viewport hook re-evaluated the arrows');
  });

  it('an armed tool takes touch: press-drag places both ends; extra fingers are ignored', () => {
    const m = mount();
    const range = m.chart.scale.visibleRange();
    m.c.arm('trendline');
    m.pointer('pointerdown', 1, 200, 200);
    m.pointer('pointermove', 1, 300, 150);
    m.pointer('pointerdown', 2, 500, 300); // ignored: no pinch while placing
    m.pointer('pointermove', 2, 700, 300);
    m.frames.tick();
    assert.equal(crosshair(m.chart).active, true, 'the crosshair tracks the finger while placing');
    m.pointer('pointerup', 1, 300, 150);
    m.pointer('pointerup', 2, 700, 300);
    const drawings = m.chart.getConfig().drawings;
    assert.equal(drawings.length, 1);
    assert.equal(drawings[0]!.name, 'trendline');
    assert.deepEqual(drawings[0]!.points.map((p) => p.index), [Math.round(m.chart.scale.xToIndex(200)), Math.round(m.chart.scale.xToIndex(300))]);
    assert.deepEqual(m.chart.scale.visibleRange(), range, 'no pan or zoom');
    assert.equal(m.c.tool, null);
    assert.equal(crosshair(m.chart).active, false, 'the crosshair hides on release');
  });

  it('double tap finishes an open-ended tool; the compat dblclick is swallowed', () => {
    const m = mount();
    m.c.arm('path');
    m.tap(1, 200, 200);
    m.frames.time += DOUBLE_TAP_MS + 1;
    m.tap(2, 202, 201); // too slow for a double tap
    m.tap(3, 300, 150); // too far
    assert.equal(m.c.points.length, 3);
    const dbl = m.compat('dblclick');
    assert.equal(dbl.defaultPrevented, true);
    assert.equal(m.c.tool, 'path', 'the compat dblclick did not finish the path');
    m.tap(4, 302, 151);
    assert.equal(m.c.tool, null);
    assert.deepEqual(m.chart.getConfig().drawings[0]!.points.length, 3, 'the double tap dropped its duplicate point');

    // Mouse double clicks still reach the controller.
    m.c.arm('path');
    m.mouse('pointerdown', 100, 100);
    m.mouse('pointerup', 100, 100);
    m.mouse('pointerdown', 150, 120);
    m.mouse('pointerup', 150, 120);
    m.mouse('pointerdown', 150, 120);
    m.mouse('pointerup', 150, 120);
    assert.equal(m.compat('dblclick').defaultPrevented, false);
    assert.equal(m.c.tool, null);
    assert.equal(m.chart.getConfig().drawings.length, 2);
  });

  it('touch drags drawings and handles; pointercancel snaps the drag back', () => {
    const m = mount();
    const range = m.chart.scale.visibleRange();
    const y = m.chart.scale.priceToY(m.chart.scale.yToPrice(200));
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price: m.chart.scale.yToPrice(200) }] });
    // Only the selected drawing takes a finger (an unselected one pans, see polish-touch): a tap selects it first.
    m.tap(9, 300, y);
    assert.equal(m.chart.selectedDrawing, id);
    // Body drag.
    m.pointer('pointerdown', 1, 300, y);
    assert.equal(m.chart.selectedDrawing, id);
    m.pointer('pointermove', 1, 300, y + 30);
    m.frames.tick();
    m.pointer('pointerup', 1, 300, y + 30);
    close(m.chart.scale.priceToY(m.chart.getDrawing(id)!.points[0]!.price), y + 30, 1e-6);
    assert.deepEqual(m.chart.scale.visibleRange(), range);
    assert.equal(crosshair(m.chart).active, false);

    // Handle drag (the drawing is selected).
    const hx = m.chart.scale.indexToX(1990);
    m.pointer('pointerdown', 2, hx, y + 30);
    m.pointer('pointermove', 2, hx, y + 60);
    m.frames.tick();
    close(m.chart.scale.priceToY(m.chart.getDrawing(id)!.points[0]!.price), y + 60, 1e-6);
    // Cancel (the system took the touch) undoes the unfinished drag; later moves go nowhere.
    m.pointer('pointercancel', 2, 0, 0);
    assert.equal(m.canvas.classList.contains('cts-dragging'), false);
    close(m.chart.scale.priceToY(m.chart.getDrawing(id)!.points[0]!.price), y + 30, 1e-6);
    assert.equal(m.chart.selectedDrawing, id);
    m.pointer('pointermove', 2, hx, y + 90);
    m.frames.tick();
    close(m.chart.scale.priceToY(m.chart.getDrawing(id)!.points[0]!.price), y + 30, 1e-6);
    assert.deepEqual(m.chart.scale.visibleRange(), range);
    // The finished body drag is still one undo step.
    m.c.undo();
    close(m.chart.scale.priceToY(m.chart.getDrawing(id)!.points[0]!.price), y, 1e-6);
    assert.equal(m.c.history.canUndo, false);
  });

  it('the eraser takes touch; locked drawings pan instead', () => {
    const m = mount();
    const y = 200;
    const price = m.chart.scale.yToPrice(y);
    const a = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }] });
    m.c.setLocked(true);
    const anchor = m.chart.scale.xToIndex(300);
    m.pointer('pointerdown', 1, 300, y);
    m.pointer('pointermove', 1, 340, y);
    m.frames.tick();
    m.pointer('pointerup', 1, 340, y);
    close(m.chart.scale.xToIndex(340), anchor);
    assert.equal(m.chart.getDrawing(a)!.points[0]!.price, price);
    m.c.setLocked(false);
    m.c.setCursor('eraser');
    m.tap(2, 300, m.chart.scale.priceToY(price));
    assert.equal(m.chart.getDrawing(a), undefined);
  });

  it('keeps a long-press crosshair through touch pointerleave and swallows the touch context menu', () => {
    const m = mount();
    m.pointer('pointerdown', 1, 300, 200);
    m.timers.tick(LONG_PRESS_MS);
    m.pointer('pointerup', 1, 300, 200);
    m.pointer('pointerleave', 1, 300, 200);
    assert.equal(crosshair(m.chart).active, true);

    m.c.arm('trendline');
    m.pointer('pointerdown', 2, 100, 100);
    assert.equal(crosshair(m.chart).active, false, 'handing a touch to the controller drops the crosshair');
    const menu = m.compat('contextmenu');
    assert.equal(menu.defaultPrevented, true);
    assert.equal(m.c.tool, 'trendline', 'a long press does not disarm the tool');
    m.pointer('pointercancel', 2, 0, 0);
    assert.equal(m.c.points.length, 0, 'cancel aborts the press: no point is placed');
    assert.equal(m.c.tool, 'trendline');
    m.mouse('pointerdown', 100, 100, { button: 2 });
    const right = m.compat('contextmenu');
    assert.equal(right.defaultPrevented, true);
    assert.equal(m.c.tool, null, 'a right click still disarms');
  });

  it('cancelNavigation stops a touch fling', () => {
    const m = mount();
    m.pointer('pointerdown', 1, 300, 200);
    m.pointer('pointermove', 1, 340, 200);
    m.frames.tick(16);
    m.pointer('pointermove', 1, 380, 200);
    m.frames.tick(16);
    m.pointer('pointerup', 1, 380, 200);
    assert.equal(m.frames.callbacks.size, 1, 'fling running');
    const anchor = m.chart.scale.xToIndex(380);
    m.tb.cancelNavigation();
    m.frames.tick(16);
    close(m.chart.scale.xToIndex(380), anchor);
  });

  it('navigation off hands touch to the controller untouched; destroy removes the class', () => {
    const off = mount({ navigation: false });
    assert.equal(off.canvas.classList.contains('cts-touch'), false);
    const anchor = off.chart.scale.xToIndex(300);
    off.pointer('pointerdown', 1, 300, 200);
    off.pointer('pointermove', 1, 360, 200);
    off.frames.tick();
    off.pointer('pointerup', 1, 360, 200);
    close(off.chart.scale.xToIndex(300), anchor);
    off.c.arm('hline');
    off.tap(2, 300, 200);
    assert.equal(off.chart.getConfig().drawings.length, 1, 'touch still places drawings');

    const m = mount();
    m.pointer('pointerdown', 1, 300, 200);
    m.timers.tick(LONG_PRESS_MS);
    m.tb.destroy();
    assert.equal(m.canvas.classList.contains('cts-touch'), false);
    assert.equal(crosshair(m.chart).active, false);
  });
});

describe('drawing toolbar touch: drawings, pinches and aborts', () => {
  it('a second finger turns a drawing grab into a pinch, undoing a grab that went nowhere', () => {
    const m = mount();
    const price = m.chart.scale.yToPrice(200);
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }] });
    const before = spacing(m.chart);
    // Only the selected drawing takes a finger: select it (a tap) so the first finger grabs it.
    m.c.select(id);
    m.pointer('pointerdown', 1, 300, 200);
    assert.equal(m.chart.selectedDrawing, id, 'the first finger grabbed the line');
    m.pointer('pointermove', 1, 300, 203); // inside the tap slop, but the line already follows
    m.frames.tick();
    assert.notEqual(priceAt(m, id), price);
    m.pointer('pointerdown', 2, 500, 203);
    assert.equal(priceAt(m, id), price, 'the grab is undone');
    assert.equal(m.chart.selectedDrawing, id, 'keeping the selection from before the press');
    assert.equal(m.c.history.canUndo, false, 'without leaving an undo step');
    m.pointer('pointermove', 1, 200, 203);
    m.pointer('pointermove', 2, 600, 203);
    m.frames.tick();
    close(spacing(m.chart), before * 2);
    assert.equal(priceAt(m, id), price);
    m.pointer('pointerup', 1, 200, 203);
    m.pointer('pointerup', 2, 600, 203);
    assert.equal(m.chart.selectedDrawing, id);
    assert.equal(m.canvas.classList.contains('cts-dragging'), false);
  });

  it('a second finger keeps a drawing drag that went somewhere, then pinches', () => {
    const m = mount();
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price: m.chart.scale.yToPrice(200) }] });
    const before = spacing(m.chart);
    m.tap(9, 300, 200); // select it: only the selected drawing takes a finger
    m.pointer('pointerdown', 1, 300, 200);
    m.pointer('pointermove', 1, 300, 240);
    m.frames.tick();
    const moved = priceAt(m, id);
    close(m.chart.scale.priceToY(moved), 240, 1e-6);
    m.pointer('pointerdown', 2, 500, 240);
    assert.equal(priceAt(m, id), moved);
    assert.equal(m.chart.selectedDrawing, id);
    assert.equal(m.c.history.canUndo, true, 'the move is an undo step');
    m.pointer('pointermove', 1, 200, 240);
    m.pointer('pointermove', 2, 600, 240);
    m.frames.tick();
    close(spacing(m.chart), before * 2);
    assert.equal(priceAt(m, id), moved);
  });

  it('in eraser mode a second finger pinches: an erase on landing is undone, a sweep is kept', () => {
    const m = mount();
    const price = m.chart.scale.yToPrice(200);
    const a = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }] });
    m.c.setCursor('eraser');
    const before = spacing(m.chart);
    m.pointer('pointerdown', 1, 300, 210); // within finger reach of the line
    assert.equal(m.chart.getDrawing(a), undefined, 'the finger erased it on landing');
    m.pointer('pointerdown', 2, 500, 210);
    assert.equal(priceAt(m, a), price, 'restored when the touch became a pinch');
    assert.equal(m.c.history.canUndo, false);
    m.pointer('pointermove', 2, 700, 210);
    m.frames.tick();
    close(spacing(m.chart), before * 2);
    m.pointer('pointerup', 1, 300, 210);
    m.pointer('pointerup', 2, 700, 210);
    assert.equal(m.c.cursor, 'eraser');

    const s = mount();
    const b = s.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price: s.chart.scale.yToPrice(300) }] });
    s.c.setCursor('eraser');
    const start = spacing(s.chart);
    s.pointer('pointerdown', 1, 100, 100);
    s.pointer('pointermove', 1, 100, 300);
    s.frames.tick();
    assert.equal(s.chart.getDrawing(b), undefined, 'the sweep erased it');
    s.pointer('pointerdown', 2, 300, 300);
    assert.equal(s.chart.getDrawing(b), undefined, 'a sweep that went somewhere is kept');
    assert.equal(s.c.history.canUndo, true);
    s.pointer('pointermove', 2, 500, 300);
    s.frames.tick();
    close(spacing(s.chart), start * 2);
  });

  it('fingers reach the selected drawing within TOUCH_HIT_PX, never unselected ones; taps select within reach', () => {
    const m = mount();
    const price = m.chart.scale.yToPrice(200);
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }] });
    assert.equal(m.chart.drawingAt(300, 212), null, 'beyond the mouse reach');
    assert.equal(m.chart.drawingAt(300, 212, TOUCH_HIT_PX), id);
    // Unselected and 12 px off: the finger pans.
    const anchor = m.chart.scale.xToIndex(300);
    m.pointer('pointerdown', 1, 300, 212);
    m.pointer('pointermove', 1, 340, 212);
    m.frames.tick();
    m.pointer('pointerup', 1, 340, 212);
    close(m.chart.scale.xToIndex(340), anchor);
    assert.equal(priceAt(m, id), price);
    assert.equal(m.chart.selectedDrawing, null);
    // A tap within reach selects it.
    m.tap(2, 300, 212);
    assert.equal(m.chart.selectedDrawing, id);
    // Selected, the same off-center finger drags it.
    const range = m.chart.scale.visibleRange();
    m.pointer('pointerdown', 3, 300, 212);
    assert.equal(m.c.hitTolerance, TOUCH_HIT_PX);
    m.pointer('pointermove', 3, 300, 242);
    m.frames.tick();
    m.pointer('pointerup', 3, 300, 242);
    close(m.chart.scale.priceToY(priceAt(m, id)), 230, 1e-6);
    assert.deepEqual(m.chart.scale.visibleRange(), range);
    // A tap on empty space deselects; mouse presses go back to the mouse reach.
    m.tap(4, 300, 400);
    assert.equal(m.chart.selectedDrawing, null);
    m.mouse('pointerdown', 300, 400);
    m.mouse('pointerup', 300, 400);
    assert.equal(m.c.hitTolerance, undefined);
  });

  it('a finger grabs a handle of the selected drawing within TOUCH_HIT_PX', () => {
    const m = mount();
    const y = 200;
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1900, price: m.chart.scale.yToPrice(y) }] });
    m.c.select(id);
    const hx = m.chart.scale.indexToX(1900);
    assert.equal(m.chart.handleAt(hx + 10, y + 5), -1, 'beyond the mouse reach');
    m.pointer('pointerdown', 1, hx + 10, y + 5);
    m.pointer('pointermove', 1, hx + 10, y + 45);
    m.frames.tick();
    m.pointer('pointerup', 1, hx + 10, y + 45);
    // A handle drag puts the anchor under the finger (a body move would have shifted it by 40).
    close(m.chart.scale.priceToY(priceAt(m, id)), y + 45, 1e-6);
  });

  it('locked drawings pan instead of grabbing the finger, but a tap still selects one', () => {
    const m = mount();
    const price = m.chart.scale.yToPrice(200);
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 1990, price }], locked: true });
    for (const select of [false, true]) {
      if (select) m.c.select(id);
      const anchor = m.chart.scale.xToIndex(300);
      m.pointer('pointerdown', 1, 300, 200);
      m.pointer('pointermove', 1, 340, 200);
      m.frames.tick();
      m.pointer('pointerup', 1, 340, 200);
      close(m.chart.scale.xToIndex(340), anchor);
      assert.equal(priceAt(m, id), price);
    }
    m.c.select(null);
    m.tap(2, 300, 200);
    assert.equal(m.chart.selectedDrawing, id, 'selectable, so it can be unlocked from the style bar');
    // With every drawing locked, a tap selects nothing.
    m.c.setLocked(true);
    m.tap(3, 300, 200);
    assert.equal(m.chart.selectedDrawing, null);
  });

  it('pointercancel aborts an armed tool press: nothing is placed or zoomed, and the tool stays armed', () => {
    const m = mount();
    m.c.arm('trendline');
    m.pointer('pointerdown', 1, 200, 200);
    m.pointer('pointermove', 1, 320, 150);
    m.frames.tick();
    assert.equal(draft(m.chart)!.points.length, 1);
    m.pointer('pointercancel', 1, 0, 0);
    assert.equal(m.chart.getConfig().drawings.length, 0);
    assert.equal(m.c.tool, 'trendline');
    assert.equal(draft(m.chart), null);
    assert.equal(crosshair(m.chart).active, false);
    // A cancel from an ignored extra finger leaves the press alone.
    m.pointer('pointerdown', 2, 200, 200);
    m.pointer('pointerdown', 3, 400, 200);
    m.pointer('pointercancel', 3, 0, 0);
    m.pointer('pointerup', 2, 200, 200);
    assert.equal(m.c.points.length, 1);

    // An open-ended path keeps the points placed before the cancelled press.
    m.c.arm('path');
    m.tap(4, 100, 100);
    assert.equal(m.c.points.length, 1);
    m.pointer('pointerdown', 5, 200, 150);
    m.pointer('pointermove', 5, 260, 150);
    m.frames.tick();
    m.pointer('lostpointercapture', 5, 0, 0);
    assert.equal(m.c.points.length, 1);
    assert.equal(draft(m.chart)!.points.length, 1, 'the preview shows the placed points');

    // Box zoom.
    m.c.arm(ZOOM_TOOL);
    const range = m.chart.scale.visibleRange();
    const box = m.doc.querySelector('.cts-zoom-box') as unknown as { style: { display: string } };
    m.pointer('pointerdown', 6, 200, 200);
    m.pointer('pointermove', 6, 400, 200);
    m.frames.tick();
    assert.equal(box.style.display, 'block');
    m.pointer('pointercancel', 6, 0, 0);
    assert.deepEqual(m.chart.scale.visibleRange(), range);
    assert.equal(box.style.display, 'none');
    assert.equal(m.c.tool, ZOOM_TOOL);

    // Freehand.
    m.c.arm('brush');
    m.pointer('pointerdown', 7, 200, 200);
    m.pointer('pointermove', 7, 260, 240);
    m.frames.tick();
    m.pointer('pointercancel', 7, 0, 0);
    assert.equal(m.chart.getConfig().drawings.length, 0);
    assert.equal(draft(m.chart), null);
    assert.equal(m.c.tool, 'brush');
  });

  it('double tap edits a text drawing: a tap near it selects it, the next opens the editor', () => {
    const m = mount();
    const id = m.chart.addDrawing({ name: 'text', points: [{ index: 1950, price: m.chart.scale.yToPrice(200) }], text: 'Hi' });
    const x = m.chart.scale.indexToX(1950) + 10;
    assert.equal(m.chart.drawingAt(x, 224), null);
    assert.equal(m.chart.drawingAt(x, 224, TOUCH_HIT_PX), id);
    const editor = m.doc.querySelector('.cts-editor') as unknown as { style: { display: string }; value: string };
    m.pointer('pointerdown', 1, x, 224);
    m.pointer('pointerup', 1, x, 224);
    assert.equal(m.chart.selectedDrawing, id, 'the gesture tap selected it');
    assert.notEqual(editor.style.display, 'block');
    const second = m.pointer('pointerdown', 2, x + 2, 222);
    m.pointer('pointerup', 2, x + 2, 222);
    assert.equal(editor.style.display, 'block');
    assert.equal(editor.value, 'Hi');
    assert.equal(second.defaultPrevented, true, 'no compat mousedown follows to blur the editor');
    assert.equal(m.mouse('pointerdown', 700, 400).defaultPrevented, false);
  });

  it('the long-press crosshair shows the price-axis plus beside it until a tap hides it', () => {
    const m = mount({}, { priceAxis: { plusButton: true } });
    const plus = m.doc.querySelector('.cts-price-plus') as unknown as { style: { display: string; top: string }; click(): void };
    m.pointer('pointerdown', 1, 300, 200);
    m.timers.tick(LONG_PRESS_MS);
    assert.equal(plus.style.display, 'block');
    assert.equal(plus.style.top, '188px');
    m.pointer('pointermove', 1, 320, 240);
    m.frames.tick();
    assert.equal(plus.style.top, '228px');
    m.pointer('pointerup', 1, 320, 240);
    m.overlayLeave('touch');
    assert.equal(plus.style.display, 'block', 'lifting the finger keeps it tappable');
    plus.click();
    const lines = m.chart.getConfig().drawings;
    assert.equal(lines.length, 1);
    close(m.chart.scale.priceToY(lines[0]!.points[0]!.price), 240, 1e-6);
    m.tap(2, 500, 400);
    assert.equal(crosshair(m.chart).active, false);
    assert.equal(plus.style.display, 'none');
    // The mouse leaving the chart still hides it.
    m.pointer('pointerdown', 3, 300, 200);
    m.timers.tick(LONG_PRESS_MS);
    m.pointer('pointerup', 3, 300, 200);
    assert.equal(plus.style.display, 'block');
    m.overlayLeave('mouse');
    assert.equal(plus.style.display, 'none');
  });
});

describe('aborting a press (DOM-free)', () => {
  const chartOf = () => createChart({ document: new MockDocument(), config: { wasm: false, data: candles(100) } });

  it('cancelDrag without a press changes nothing', () => {
    const c = new DrawingController(chartOf());
    let changes = 0;
    c.on('change', () => changes++);
    c.cancelDrag();
    assert.equal(changes, 0);
  });

  it('rollback reverts and forgets the last checkpoints, keeping nothing for redo', () => {
    const chart = chartOf();
    const h = new DrawingHistory(chart);
    h.rollback(1); // nothing recorded: no-op
    const a = chart.addDrawing({ name: 'hline', points: [{ index: 10, price: 100 }], color: '#00ff00' });
    h.checkpoint();
    chart.updateDrawing(a, { color: '#ff0000' });
    h.checkpoint();
    chart.removeDrawing(a);
    h.rollback(0);
    assert.equal(chart.getDrawing(a), undefined, 'rolling back nothing changes nothing');
    h.rollback(5); // more than recorded: back to the oldest
    assert.equal(chart.getDrawing(a)!.color, '#00ff00');
    assert.equal(h.canUndo, false);
    assert.equal(h.canRedo, false);
  });
});

interface HTMLElementLike {
  classList: { contains(token: string): boolean };
}
