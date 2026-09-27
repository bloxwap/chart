import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createChart, type Chart, type FrameScheduler } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import {
  createDrawingToolbar,
  DrawingController,
  GestureRecognizer,
  LONG_PRESS_MS,
  TOUCH_HANDLE_HIT_PX,
  TOUCH_HIT_PX,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';
import { claimTouch } from '../dist/ui/gestures.js';

// TradingView-mobile drawing semantics: a one-finger drag pans unless it starts on the selected drawing (body or
// handle), a tap selects the drawing under it (or clears the selection), a long press is the crosshair, and an
// armed tool places points.

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

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

const crosshair = (chart: Chart) => (chart as unknown as { crosshair: { active: boolean; x: number; y: number } }).crosshair;

function mount() {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(2000) } });
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    scheduler: frames,
  });
  const pointer = (type: string, id: number, x: number, y: number) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true }));
  const tap = (id: number, x: number, y: number) => {
    pointer('pointerdown', id, x, y);
    pointer('pointerup', id, x, y);
  };
  /** One finger from `(x0, y0)` to `(x1, y1)` in four frames. */
  const drag = (id: number, x0: number, y0: number, x1: number, y1: number) => {
    pointer('pointerdown', id, x0, y0);
    for (let k = 1; k <= 4; k++) {
      pointer('pointermove', id, x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4);
      frames.tick();
    }
    pointer('pointerup', id, x1, y1);
  };
  const mouse = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: 99, clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true, cancelable: true }));
  return { chart, c: tb.controller, tb, timers, frames, pointer, tap, drag, mouse };
}

type Mounted = ReturnType<typeof mount>;

/** A long position covering x 400–520, y 150 (target) – 250 (entry) – 300 (stop). */
function position(m: Mounted): string {
  const { scale } = m.chart;
  const at = (x: number) => Math.round(scale.xToIndex(x));
  return m.chart.addDrawing({
    name: 'long-position',
    points: [{ index: at(400), price: scale.yToPrice(250) }, { index: at(520), price: scale.yToPrice(150) }],
  });
}

/** A fib retracement whose bands fill x `x0`–`x1` (150–350 by default), y 120–380. */
function fib(m: Mounted, x0 = 150, x1 = 350): string {
  const { scale } = m.chart;
  return m.chart.addDrawing({
    name: 'fib',
    points: [{ index: Math.round(scale.xToIndex(x0)), price: scale.yToPrice(380) }, { index: Math.round(scale.xToIndex(x1)), price: scale.yToPrice(120) }],
  });
}

const pointsOf = (m: Mounted, id: string) => m.chart.getDrawing(id)!.points.map((p) => ({ ...p }));

describe('touch over drawings (TradingView mobile)', () => {
  it('a one-finger drag pans across unselected filled drawings, squarely on them', () => {
    const m = mount();
    const box = position(m);
    const bands = fib(m);
    const before = [pointsOf(m, box), pointsOf(m, bands)];
    for (const [x, y] of [[430, 200], [250, 300]] as const) {
      assert.notEqual(m.chart.drawingAt(x, y), null, 'the finger lands inside a filled drawing');
      assert.equal(claimTouch(m.c, x, y), null, 'left to the gestures');
      const anchor = m.chart.scale.xToIndex(x);
      m.drag(1, x, y, x + 60, y);
      close(m.chart.scale.xToIndex(x + 60), anchor, 1e-6);
    }
    assert.deepEqual([pointsOf(m, box), pointsOf(m, bands)], before, 'no drawing moved');
    assert.equal(m.chart.selectedDrawing, null, 'nor was one selected');
    assert.equal(m.c.history.canUndo, false);
  });

  it('a tap selects a filled drawing; a drag on it then moves it as one undo step', () => {
    const m = mount();
    const box = position(m);
    m.tap(1, 430, 200);
    assert.equal(m.chart.selectedDrawing, box);
    const range = m.chart.scale.visibleRange();
    const entryY = m.chart.scale.priceToY(m.chart.getDrawing(box)!.points[0]!.price);
    m.drag(2, 430, 200, 430, 240);
    assert.deepEqual(m.chart.scale.visibleRange(), range, 'no pan');
    close(m.chart.scale.priceToY(m.chart.getDrawing(box)!.points[0]!.price), entryY + 40, 1e-6);
    assert.equal(m.chart.selectedDrawing, box);
    m.c.undo();
    close(m.chart.scale.priceToY(m.chart.getDrawing(box)!.points[0]!.price), entryY, 1e-6);
  });

  it('with one drawing selected, a finger on another pans, and a tap moves the selection to it', () => {
    const m = mount();
    const box = position(m);
    const bands = fib(m);
    m.c.select(box);
    const before = pointsOf(m, bands);
    const anchor = m.chart.scale.xToIndex(250);
    m.drag(1, 250, 300, 310, 300);
    close(m.chart.scale.xToIndex(310), anchor, 1e-6);
    assert.deepEqual(pointsOf(m, bands), before);
    assert.equal(m.chart.selectedDrawing, box, 'panning keeps the selection');
    m.tap(2, 310, 300);
    assert.equal(m.chart.selectedDrawing, bands);
  });

  it('a finger grabs a handle of the selected drawing within TOUCH_HANDLE_HIT_PX, beyond the body reach', () => {
    const m = mount();
    const { scale } = m.chart;
    const y = 200;
    const id = m.chart.addDrawing({
      name: 'trendline',
      points: [{ index: Math.round(scale.xToIndex(200)), price: scale.yToPrice(y) }, { index: Math.round(scale.xToIndex(400)), price: scale.yToPrice(y) }],
    });
    const end = scale.indexToX(m.chart.getDrawing(id)!.points[1]!.index);
    const reach = TOUCH_HIT_PX + 4;
    assert.ok(reach <= TOUCH_HANDLE_HIT_PX);
    assert.equal(m.chart.drawingAt(end + reach, y, TOUCH_HIT_PX), null, 'beyond the finger reach on the line');
    m.tap(1, 300, y);
    assert.equal(m.chart.selectedDrawing, id);
    assert.equal(claimTouch(m.c, end + reach, y), 'selected');
    const start = { ...m.chart.getDrawing(id)!.points[0]! };
    m.drag(2, end + reach, y, end + reach, y + 40);
    // A handle drag puts that anchor under the finger and leaves the other one alone.
    close(scale.priceToY(m.chart.getDrawing(id)!.points[1]!.price), y + 40, 1e-6);
    assert.deepEqual(m.chart.getDrawing(id)!.points[0], start);
    assert.equal(m.c.handleTolerance, TOUCH_HANDLE_HIT_PX, 'set for the finger press');
  });

  it('a tap on empty space deselects', () => {
    const m = mount();
    const box = position(m);
    m.tap(1, 430, 200);
    assert.equal(m.chart.selectedDrawing, box);
    m.tap(2, 100, 420);
    assert.equal(m.chart.selectedDrawing, null);
  });

  it('a long press on a drawing is still the crosshair, and an armed tool still places points over one', () => {
    const m = mount();
    const box = position(m);
    const before = pointsOf(m, box);
    m.pointer('pointerdown', 1, 430, 200);
    m.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(m.chart).active, true);
    m.pointer('pointerup', 1, 430, 200);
    assert.deepEqual(pointsOf(m, box), before);
    assert.equal(m.chart.selectedDrawing, null);

    m.c.arm('hline');
    assert.equal(claimTouch(m.c, 430, 200), 'tool');
    m.tap(2, 430, 200);
    const drawings = m.chart.getConfig().drawings;
    assert.equal(drawings.length, 2);
    assert.equal(drawings[1]!.name, 'hline');
    assert.deepEqual(pointsOf(m, box), before);
  });
});

describe('DrawingController.handleTolerance', () => {
  it('widens handle hits only, falling back to hitTolerance when unset', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(200) } });
    const c = new DrawingController(chart);
    const y = 200;
    const index = Math.round(chart.scale.xToIndex(300));
    const id = chart.addDrawing({ name: 'hline', points: [{ index, price: chart.scale.yToPrice(y) }] });
    const hx = chart.scale.indexToX(index);
    c.select(id);
    // 20 px above the line (out of the body's 16 px reach), 21.5 px from its anchor.
    const [px, py] = [hx - 8, y - 20];
    c.hitTolerance = TOUCH_HIT_PX;
    c.pointerDown(px, py);
    assert.equal(c.dragging, true, 'a pan');
    c.pointerUp(px, py);
    assert.equal(chart.selectedDrawing, null, 'the press missed the line and cleared the selection');

    c.select(id);
    c.handleTolerance = TOUCH_HANDLE_HIT_PX;
    c.pointerDown(px, py);
    c.pointerMove(px, py + 30);
    close(chart.scale.priceToY(chart.getDrawing(id)!.points[0]!.price), py + 30, 1e-6);
    c.pointerUp(px, py + 30);
    c.dispose();
  });
});

// Review follow-ups: the selected drawing wins under another one, a tap near a handle is a tap, and holding still
// on the selected drawing is the crosshair like anywhere else.

const trendline = (m: Mounted, y = 200) => {
  const { scale } = m.chart;
  const id = m.chart.addDrawing({
    name: 'trendline',
    points: [{ index: Math.round(scale.xToIndex(200)), price: scale.yToPrice(y) }, { index: Math.round(scale.xToIndex(400)), price: scale.yToPrice(y) }],
  });
  return { id, end: scale.indexToX(m.chart.getDrawing(id)!.points[1]!.index) };
};

describe('touch over drawings: review follow-ups', () => {
  it('the selected drawing is dragged by its body even where another drawing lies on top (touch only)', () => {
    const m = mount();
    const bands = fib(m, 350, 480); // underneath
    const box = position(m); // on top, x 400–520
    m.tap(1, 370, 200); // the bands alone
    assert.equal(m.chart.selectedDrawing, bands);
    assert.equal(m.chart.drawingAt(440, 200), box, 'the box is on top there');
    assert.equal(m.chart.drawingAt(440, 200, TOUCH_HIT_PX, bands), bands, 'but the preferred selection wins');
    assert.equal(m.chart.drawingAt(500, 200, TOUCH_HIT_PX, bands), box, 'where it misses, the topmost does');
    assert.equal(claimTouch(m.c, 440, 200), 'selected');
    const [boxBefore, bandsBefore] = [pointsOf(m, box), pointsOf(m, bands)];
    const range = m.chart.scale.visibleRange();
    m.drag(2, 440, 200, 440, 240);
    assert.deepEqual(m.chart.scale.visibleRange(), range, 'no pan');
    assert.deepEqual(pointsOf(m, box), boxBefore);
    close(m.chart.scale.priceToY(m.chart.getDrawing(bands)!.points[0]!.price), m.chart.scale.priceToY(bandsBefore[0]!.price) + 40, 1e-6);
    assert.equal(m.chart.selectedDrawing, bands);
    // A tap there keeps the selection, as the drag would have taken it.
    m.tap(3, 440, 200);
    assert.equal(m.chart.selectedDrawing, bands);
    // The mouse keeps its topmost-first press.
    m.mouse('pointerdown', 440, 200);
    m.mouse('pointerup', 440, 200);
    assert.equal(m.c.touch, false);
    assert.equal(m.chart.selectedDrawing, box, 'a mouse press selects the drawing on top');
  });

  it('a tap within a handle\'s reach but off the drawing deselects, without moving it or leaving an undo step', () => {
    const m = mount();
    const y = 200;
    const { id, end } = trendline(m, y);
    m.tap(1, 300, y);
    assert.equal(m.chart.selectedDrawing, id);
    const before = pointsOf(m, id);
    const [x, reach] = [end + 20, 20];
    assert.ok(reach <= TOUCH_HANDLE_HIT_PX && reach > TOUCH_HIT_PX);
    assert.equal(m.chart.drawingAt(x, y, TOUCH_HIT_PX), null, 'empty space for a tap');
    assert.equal(claimTouch(m.c, x, y), 'selected', 'though a drag from here would take the handle');
    // A jittery tap: the handle follows the finger until the release shows it was a tap.
    m.pointer('pointerdown', 2, x, y);
    m.pointer('pointermove', 2, x + 3, y + 2);
    m.frames.tick();
    assert.notDeepEqual(pointsOf(m, id), before);
    m.pointer('pointerup', 2, x + 3, y + 2);
    assert.deepEqual(pointsOf(m, id), before, 'the nudge is undone');
    assert.equal(m.chart.selectedDrawing, null, 'and the tap on empty space deselected');
    assert.equal(m.c.history.canUndo, false);
  });

  it('a tap on the selected drawing keeps it selected and undoes a nudge; a tap on another one selects that', () => {
    const m = mount();
    const box = position(m);
    const bands = fib(m);
    m.tap(1, 430, 200);
    const before = pointsOf(m, box);
    m.pointer('pointerdown', 2, 430, 200);
    m.pointer('pointermove', 2, 433, 204);
    m.frames.tick();
    m.pointer('pointerup', 2, 433, 204);
    assert.deepEqual(pointsOf(m, box), before);
    assert.equal(m.chart.selectedDrawing, box);
    assert.equal(m.c.history.canUndo, false);
    // A tap on another drawing moves the selection to it.
    m.tap(3, 250, 300);
    assert.equal(m.chart.selectedDrawing, bands);
  });

  it('holding still on the selected drawing shows the crosshair instead of grabbing it', () => {
    const m = mount();
    const box = position(m);
    m.tap(1, 430, 200);
    const before = pointsOf(m, box);
    m.pointer('pointerdown', 2, 430, 200);
    m.pointer('pointermove', 2, 432, 203); // inside the slop: still a hold
    m.frames.tick();
    m.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(m.chart).active, true);
    assert.deepEqual(pointsOf(m, box), before, 'the press is undone');
    assert.equal(m.chart.selectedDrawing, box, 'the selection stays');
    assert.equal(m.c.history.canUndo, false);
    // The finger now drives the crosshair, not the drawing.
    m.pointer('pointermove', 2, 470, 250);
    m.frames.tick();
    assert.deepEqual([crosshair(m.chart).x, crosshair(m.chart).y], [470, 250]);
    m.pointer('pointerup', 2, 470, 250);
    assert.deepEqual(pointsOf(m, box), before);
    assert.equal(crosshair(m.chart).active, true, 'the crosshair stays after release, as after any long press');
  });

  it('a drag of the selected drawing that set off before the long press keeps it through a pause', () => {
    const m = mount();
    const box = position(m);
    m.tap(1, 430, 200);
    const entryY = m.chart.scale.priceToY(m.chart.getDrawing(box)!.points[0]!.price);
    m.pointer('pointerdown', 2, 430, 200);
    m.pointer('pointermove', 2, 430, 220);
    m.frames.tick();
    m.timers.tick(LONG_PRESS_MS * 2);
    m.pointer('pointermove', 2, 430, 240);
    m.frames.tick();
    m.pointer('pointerup', 2, 430, 240);
    close(m.chart.scale.priceToY(m.chart.getDrawing(box)!.points[0]!.price), entryY + 40, 1e-6);
    // A long press would have left the crosshair up after release; the drag's pointer crosshair goes with it.
    assert.equal(crosshair(m.chart).active, false);
    assert.equal(m.c.history.canUndo, true);
  });

  it('destroying the toolbar during a hold on the selected drawing drops the pending crosshair', () => {
    const m = mount();
    position(m);
    m.tap(1, 430, 200);
    m.pointer('pointerdown', 2, 430, 200);
    m.tb.destroy();
    m.timers.tick(LONG_PRESS_MS);
    assert.equal(crosshair(m.chart).active, false);
  });
});

describe('GestureRecognizer.hold', () => {
  it('takes a finger already held still and shows the crosshair at once, once', () => {
    const timers = new FakeTimers();
    const log: string[] = [];
    const g = new GestureRecognizer(
      { pressStart: (x, y) => log.push(`start ${x},${y}`), pressMove: (x, y) => log.push(`move ${x},${y}`), tap: () => log.push('tap') },
      { timers, now: () => timers.time },
    );
    g.hold(1, 50, 60);
    assert.deepEqual(log, ['start 50,60']);
    assert.equal(g.tracking, true);
    timers.tick(LONG_PRESS_MS);
    assert.deepEqual(log, ['start 50,60'], 'its own long-press timer was stopped');
    g.move(1, 70, 60);
    g.up(1, 70, 60);
    assert.deepEqual(log, ['start 50,60', 'move 70,60'], 'then it tracks like any long press, keeping the crosshair');
    assert.equal(g.tracking, true);
  });
});

describe('DrawingController handle checkpoints', () => {
  it('a handle press that goes nowhere leaves no undo step; a handle drag is one', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(200) } });
    const c = new DrawingController(chart);
    const index = Math.round(chart.scale.xToIndex(300));
    const id = chart.addDrawing({ name: 'hline', points: [{ index, price: chart.scale.yToPrice(200) }] });
    const hx = chart.scale.indexToX(index);
    c.select(id);
    c.pointerDown(hx, 200);
    c.pointerUp(hx, 200);
    assert.equal(c.history.canUndo, false);
    assert.equal(chart.selectedDrawing, id);
    c.pointerDown(hx, 200);
    c.pointerMove(hx, 220);
    c.pointerMove(hx, 240);
    c.pointerUp(hx, 240);
    close(chart.scale.priceToY(chart.getDrawing(id)!.points[0]!.price), 240, 1e-6);
    c.undo();
    close(chart.scale.priceToY(chart.getDrawing(id)!.points[0]!.price), 200, 1e-6);
    assert.equal(c.history.canUndo, false, 'one step for the whole drag');
    c.dispose();
  });
});
