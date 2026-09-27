/**
 * Integration: touch gestures (P0.4) against the features merged before them.
 *
 * - Chart events (P0.1): a finger pan or pinch coalesces its moves into one
 *   frame, so listeners see one visible-range change per frame and never a
 *   crosshair move; a fling keeps reporting until it settles.
 * - Heikin Ashi (P1.8): the long-press crosshair reports, and the status line
 *   prints, the displayed Heikin Ashi bar under the finger.
 * - Countdown (P2.13) and snapshot (P2.14): the crosshair a long press leaves
 *   behind (no pointer keeps re-setting it) survives the ticker's overlay
 *   refreshes and is exported on request, until a tap hides it.
 * - Markers (P1.7): a one-finger pan carries markers with the finger, pixel
 *   for pixel.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  createChart,
  heikinAshi,
  type Chart,
  type ChartConfig,
  type CrosshairMoveEvent,
  type DeepPartial,
  type FrameScheduler,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { MockCanvas, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import { createDrawingToolbar, LONG_PRESS_MS, startCountdownTicker, type UIDocument, type UIElement } from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const MIN = 60;

/** A wavy bar, so Heikin Ashi values differ from the real ones. */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 4) * 8;
  return { time: T0 + i * MIN, open: base, high: base + 3, low: base - 2, close: base + Math.cos(i) * 1.5, volume: 10 + i };
}

const bars = (n: number): Candle[] => Array.from({ length: n }, (_, i) => bar(i));

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

/** A drawing toolbar over a recording chart; `finger` dispatches touch pointer events on its canvas. */
function mount(config: DeepPartial<ChartConfig> = {}, data = bars(120)) {
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
  const chartDoc = new MockDocument();
  const chart = createChart({ document: chartDoc, now: () => T0 * 1000, config: { wasm: false, width: 800, height: 500, data, ...config } });
  const live = chartDoc.created[0]!;
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    scheduler: frames,
  });
  const finger = (type: string, id: number, x: number, y: number) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true }));
  const tap = (id: number, x: number, y: number) => {
    finger('pointerdown', id, x, y);
    finger('pointerup', id, x, y);
    finger('pointerleave', id, x, y);
  };
  return { chart, live, frames, timers, tb, finger, tap };
}

function record<T>(subscribe: (cb: (e: T) => void) => () => void): T[] {
  const events: T[] = [];
  subscribe((e) => events.push(e));
  return events;
}

const ranges = (chart: Chart) => record<VisibleRangeChangeEvent>((cb) => chart.subscribeVisibleRangeChange(cb));
const moves = (chart: Chart) => record<CrosshairMoveEvent>((cb) => chart.subscribeCrosshairMove(cb));
const texts = (canvas: MockCanvas): string[] => canvas.context.callsNamed('fillText').map((c) => String(c[1]));
const spacing = (chart: Chart) => chart.scale.indexToX(1) - chart.scale.indexToX(0);

/** The event matches the chart's current range. */
function current(chart: Chart, e: VisibleRangeChangeEvent | undefined): void {
  assert.ok(e !== undefined, 'a range change was reported');
  const { from, to } = chart.scale.visibleRange();
  assert.deepEqual([e.from, e.to, e.length], [from, to, 120]);
}

describe('integration: touch gestures x chart events', () => {
  it('a finger pan reports one range change per frame and no crosshair moves; a fling reports until it settles', () => {
    const m = mount({}, bars(120));
    // Scroll back first, so the pan and fling have history to reveal.
    m.chart.scale.scrollBy(-60);
    const range = ranges(m.chart);
    const hover = moves(m.chart);
    const anchor = m.chart.scale.xToIndex(300);
    m.finger('pointerdown', 1, 300, 200);
    m.finger('pointermove', 1, 330, 200);
    m.finger('pointermove', 1, 360, 200);
    assert.equal(range.length, 0, 'moves wait for the frame');
    m.frames.tick();
    assert.equal(range.length, 1, 'two coalesced moves, one render, one event');
    current(m.chart, range[0]);
    assert.ok(Math.abs(m.chart.scale.xToIndex(360) - anchor) < 1e-6, 'the content followed the finger');

    m.finger('pointermove', 1, 420, 200);
    m.frames.tick();
    assert.equal(range.length, 2);
    m.finger('pointerup', 1, 420, 200);
    m.finger('pointerleave', 1, 420, 200);

    // A fast release flings: at most one event per frame, the last matching where it stopped.
    let frames = 0;
    while (m.frames.callbacks.size > 0 && frames < 200) {
      const before = range.length;
      m.frames.tick();
      frames++;
      assert.ok(range.length - before <= 1, 'one event per fling frame');
    }
    assert.equal(m.frames.callbacks.size, 0, 'the fling settled');
    assert.ok(range.length > 3, 'the fling reported its motion');
    current(m.chart, range.at(-1));
    assert.equal(hover.length, 0, 'panning never moves the crosshair');
    m.tb.destroy();
    m.chart.destroy();
  });

  it('a pinch reports the zoomed range once per frame', () => {
    const m = mount();
    const range = ranges(m.chart);
    const before = spacing(m.chart);
    m.finger('pointerdown', 1, 200, 200);
    m.finger('pointerdown', 2, 400, 200);
    m.finger('pointermove', 2, 500, 200);
    m.finger('pointermove', 1, 100, 200);
    m.frames.tick();
    assert.ok(Math.abs(spacing(m.chart) - before * 2) < 1e-6, 'spread doubled, spacing doubled');
    assert.equal(range.length, 1);
    current(m.chart, range[0]);
    m.finger('pointerup', 1, 100, 200);
    m.finger('pointerup', 2, 500, 200);
    m.tb.destroy();
    m.chart.destroy();
  });
});

describe('integration: long-press crosshair x Heikin Ashi, countdown and snapshot', () => {
  it('reports and prints the displayed bar; the crosshair left behind survives ticks and screenshots until a tap', () => {
    const data = bars(120);
    const ha = heikinAshi(data);
    const m = mount({ series: { type: 'heikin-ashi' }, statusLine: { visible: true }, priceAxis: { precision: 4 } }, data);
    const hover = moves(m.chart);
    const printed = (canvas: MockCanvas, c: Candle) => texts(canvas).includes(`O ${c.open.toFixed(4)}`);

    m.finger('pointerdown', 1, m.chart.scale.indexToX(100), 150);
    assert.equal(hover.length, 0, 'no crosshair before the long press');
    m.timers.tick(LONG_PRESS_MS);
    assert.equal(hover.length, 1);
    assert.equal(hover[0]!.active, true);
    assert.equal(hover[0]!.index, 100);
    assert.deepEqual(hover[0]!.candle, data[100]);
    assert.deepEqual(hover[0]!.displayCandle, ha[100]);

    m.finger('pointermove', 1, m.chart.scale.indexToX(101), 160);
    m.frames.tick();
    assert.equal(hover.length, 2);
    assert.equal(hover[1]!.index, 101);
    assert.deepEqual(hover[1]!.displayCandle, ha[101]);
    m.finger('pointerup', 1, m.chart.scale.indexToX(101), 160);
    m.finger('pointerleave', 1, m.chart.scale.indexToX(101), 160);
    assert.equal(hover.length, 2, 'lifting the finger keeps the crosshair');

    // The countdown ticker's overlay refresh repaints the kept crosshair's bar.
    const ticker = startCountdownTicker({ chart: m.chart, window: m.timers });
    m.live.context.calls.length = 0;
    m.timers.tick(1000);
    assert.ok(m.live.context.calls.length > 0, 'the ticker refreshed the overlay');
    assert.ok(printed(m.live, ha[101]!), 'the status line still shows the Heikin Ashi bar under the crosshair');

    // Screenshots export it on request only.
    assert.ok(printed(m.chart.takeScreenshot({ crosshair: true }) as MockCanvas, ha[101]!));
    assert.ok(!printed(m.chart.takeScreenshot() as MockCanvas, ha[101]!));

    // A tap hides it: one inactive event, and the next refresh drops it.
    m.tap(2, 500, 300);
    assert.equal(hover.length, 3);
    assert.equal(hover[2]!.active, false);
    assert.equal(hover[2]!.displayCandle, null);
    m.live.context.calls.length = 0;
    m.timers.tick(1000);
    assert.ok(m.live.context.calls.length > 0);
    assert.ok(!printed(m.live, ha[101]!));
    ticker.stop();
    m.tb.destroy();
    m.chart.destroy();
  });
});

describe('integration: touch pan x markers', () => {
  it('carries markers with the finger, pixel for pixel', () => {
    const data = bars(120);
    const m = mount({}, data);
    m.chart.series.setMarkers([{ time: data[90]!.time, position: 'aboveBar', color: '#00aaff', shape: 'arrowDown', text: 'sell' }]);
    const captionX = (): number => {
      const calls = m.live.context.callsNamed('fillText').filter((c) => c[1] === 'sell');
      assert.ok(calls.length > 0, 'the marker caption is drawn');
      return Number(calls.at(-1)![2]);
    };
    const before = captionX();
    m.live.context.calls.length = 0;
    m.finger('pointerdown', 1, 300, 200);
    m.finger('pointermove', 1, 360, 200);
    m.frames.tick();
    assert.ok(Math.abs(captionX() - (before + 60)) < 1e-6, `${captionX()} ≉ ${before + 60}`);
    m.frames.time += 200; // rest before lifting: no fling
    m.finger('pointerup', 1, 360, 200);
    assert.equal(m.frames.callbacks.size, 0);
    m.tb.destroy();
    m.chart.destroy();
  });
});
