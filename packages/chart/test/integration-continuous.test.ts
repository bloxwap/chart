/**
 * Integration: the time-continuous axis (P2.15, `timeScale.continuous`)
 * against the features merged before it. On a continuous axis scroll units
 * are time slots, and the distance between two neighbouring candles spans
 * any gap between them, so everything that turns pixels into scroll amounts
 * or scroll offsets into candle indices must go through the scale.
 *
 * - Touch gestures (P0.4): a finger pan follows the finger pixel for pixel
 *   and a fling keeps the finger's speed, even when bars 0 and 1 straddle a
 *   gap (the old `indexToX(1) - indexToX(0)` spacing spanned that gap).
 * - Chart events (P0.1): `logicalFrom`/`logicalTo` stay candle indices at
 *   the plot edges (interpolated inside a gap), toggling the layout reports
 *   the moved range, crosshair events report the nearest candle inside a
 *   gap, and data-load listeners see the slot layout already updated.
 * - Heikin Ashi (P1.8), volume overlay (P1.11) and markers (P1.7): displayed
 *   bars, volume columns and marker glyphs all sit at the candles' slots.
 * - Indicator offsets (P1.6): Ichimoku's leading spans project one slot per
 *   bar past the last candle.
 * - Live bar folder (P0.3): rolling buckets extend the slots in O(1), and a
 *   missed bucket shows as an empty slot.
 * - Snapshot (P2.14): a screenshot keeps the continuous layout.
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
  type DataLoadEvent,
  type DeepPartial,
  type FrameScheduler,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { MockCanvas, MockContext2D, MockDocument, type ChartCanvas } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import { TimeSlotSync } from '../dist/core/time-slots.js';
import { createLiveBarFolder } from '../dist/datafeed/index.js';
import { createDrawingToolbar, type UIDocument, type UIElement } from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const MIN = 60;
const HOUR = 3600;

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** A wavy bar at `time`, so Heikin Ashi values differ from the real ones. */
function bar(time: number, i: number): Candle {
  const base = 100 + Math.sin(i / 4) * 8;
  return { time, open: base, high: base + 3, low: base - 2, close: base + Math.cos(i) * 1.5, volume: 10 + i };
}

/** 1m bars; bar 0 sits alone, `lead` minutes before the rest, so bars 0 and 1 straddle a gap. */
function leadGap(n = 120, lead = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => bar(T0 + (i === 0 ? 0 : lead + i - 1) * MIN, i));
}

/** Hourly bars; bars >= `gapAt` sit `gapHours` later (a weekend). Slots 0..gapAt-1, then gapAt+gapHours.. */
function weekend(n = 200, gapAt = 100, gapHours = 48): Candle[] {
  return Array.from({ length: n }, (_, i) => bar(T0 + (i < gapAt ? i : i + gapHours) * HOUR, i));
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

/** A drawing toolbar over a continuous chart; `finger` dispatches touch pointer events on its canvas. */
function mount(data: Candle[], config: DeepPartial<ChartConfig> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const chart = createChart({
    document: new MockDocument(),
    config: { wasm: false, width: 800, height: 500, data, timeScale: { continuous: true }, ...config },
  });
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
  return { chart, frames, tb, finger };
}

/** A continuous chart on a recording canvas. */
function chartOn(data: Candle[], config: DeepPartial<ChartConfig> = {}, width = 800) {
  const canvas = new MockCanvas(width, 500);
  const chart = createChart({ container: canvas, config: { wasm: false, data, timeScale: { continuous: true }, ...config } });
  return { canvas, chart };
}

function record<T>(subscribe: (cb: (e: T) => void) => () => void): T[] {
  const events: T[] = [];
  subscribe((e) => events.push(e));
  return events;
}

const ranges = (chart: Chart) => record<VisibleRangeChangeEvent>((cb) => chart.subscribeVisibleRangeChange(cb));

/** The event matches the chart's current range and its logical edges sit at the plot edges. */
function currentRange(chart: Chart, e: VisibleRangeChangeEvent | undefined, data: readonly Candle[]): void {
  assert.ok(e !== undefined, 'a range change was reported');
  const { from, to } = chart.scale.visibleRange();
  const spacing = chart.scale.barSpacing();
  assert.deepEqual([e.from, e.to, e.length], [from, to, data.length]);
  close(chart.scale.indexToX(e.logicalTo), chart.plotArea.width - spacing / 2);
  close(chart.scale.indexToX(e.logicalFrom), spacing / 2);
  assert.equal(e.barsBefore, e.logicalFrom);
  assert.equal(e.barsAfter, data.length - 1 - e.logicalTo);
  assert.equal(e.fromTime, data[from]!.time);
  assert.equal(e.toTime, data[to - 1]!.time);
}

describe('integration: continuous axis x touch gestures', () => {
  it('a one-finger pan follows the finger pixel for pixel when bars 0 and 1 straddle a gap', () => {
    const data = leadGap();
    const m = mount(data);
    const spacing = m.chart.scale.barSpacing();
    assert.ok(m.chart.scale.indexToX(1) - m.chart.scale.indexToX(0) > 50 * spacing, 'bars 0 and 1 straddle a gap');
    const x0 = m.chart.scale.indexToX(100);
    m.finger('pointerdown', 1, 300, 200);
    m.finger('pointermove', 1, 330, 200);
    m.finger('pointermove', 1, 360, 200);
    m.frames.tick();
    close(m.chart.scale.indexToX(100), x0 + 60);
    m.frames.time += 200; // rest before lifting: no fling
    m.finger('pointerup', 1, 360, 200);
    m.finger('pointerleave', 1, 360, 200);
    assert.equal(m.frames.callbacks.size, 0);
    m.tb.destroy();
    m.chart.destroy();
  });

  it('a fling continues at the finger speed in slots and reports ranges that stay current', () => {
    const data = leadGap();
    const m = mount(data);
    const range = ranges(m.chart);
    m.finger('pointerdown', 1, 300, 200);
    for (let x = 320; x <= 420; x += 20) {
      m.finger('pointermove', 1, x, 200);
      m.frames.tick();
    }
    const released = m.chart.scale.indexToX(100);
    m.finger('pointerup', 1, 420, 200);
    m.finger('pointerleave', 1, 420, 200);
    let frames = 0;
    while (m.frames.callbacks.size > 0 && frames < 200) {
      m.frames.tick();
      frames++;
    }
    assert.equal(m.frames.callbacks.size, 0, 'the fling settled');
    // The finger moved ~20px per 16ms frame: the fling carries on for many pixels,
    // not the ~1/100 of that a gap-spanning spacing would scroll.
    assert.ok(m.chart.scale.indexToX(100) - released > 50, `the fling moved ${m.chart.scale.indexToX(100) - released}px`);
    currentRange(m.chart, range.at(-1), data);
    m.tb.destroy();
    m.chart.destroy();
  });

  it('a pinch doubles the slot spacing', () => {
    const m = mount(leadGap());
    const before = m.chart.scale.barSpacing();
    m.finger('pointerdown', 1, 200, 200);
    m.finger('pointerdown', 2, 400, 200);
    m.finger('pointermove', 2, 500, 200);
    m.finger('pointermove', 1, 100, 200);
    m.frames.tick();
    close(m.chart.scale.barSpacing(), before * 2);
    m.finger('pointerup', 1, 100, 200);
    m.finger('pointerup', 2, 500, 200);
    m.tb.destroy();
    m.chart.destroy();
  });
});

describe('integration: continuous axis x chart events', () => {
  it('reports logical edges as candle indices, interpolated while the right edge sits in a gap', () => {
    const data = weekend();
    const { chart } = chartOn(data);
    const range = ranges(chart);
    // Last slot 247; the right edge at slot 120 falls inside the gap between bars 99 (slot 99) and 100 (slot 148).
    chart.scale.scrollBy(127);
    assert.equal(range.length, 1);
    currentRange(chart, range[0], data);
    const e = range[0]!;
    assert.ok(e.logicalTo > 99 && e.logicalTo < 100, `logicalTo ${e.logicalTo} lies between bars 99 and 100`);
    close(e.logicalTo, 99 + 21 / 49);
    assert.equal(e.to, 100, 'bars past the right edge stay out of the visible range');
    chart.destroy();
  });

  it('toggling the layout reports one range change each way, with bar-indexed edges once off', () => {
    const data = weekend();
    const { chart } = chartOn(data, { timeScale: { continuous: false } });
    chart.scale.scrollBy(40); // bar 159 rightmost; the viewport spans the weekend at bar 100
    const range = ranges(chart);
    chart.updateConfig({ timeScale: { continuous: true } });
    assert.equal(range.length, 1, 'the opened gap pushes bars out on the left');
    currentRange(chart, range[0], data);
    close(range[0]!.logicalTo, 159);
    assert.ok(range[0]!.from > 60, `from ${range[0]!.from}: fewer bars fit once the gap is open`);
    chart.updateConfig({ timeScale: { continuous: true } });
    assert.equal(range.length, 1, 'an unchanged layout reports nothing');
    chart.updateConfig({ timeScale: { continuous: false } });
    assert.equal(range.length, 2);
    currentRange(chart, range[1]!, data);
    // Bar-indexed payloads keep their exact formulas.
    assert.equal(range[1]!.logicalTo, 159);
    assert.equal(range[1]!.logicalFrom, 160 - chart.plotArea.width / chart.scale.barSpacing());
    chart.destroy();
  });

  it('a crosshair inside a gap reports the nearest candle', () => {
    const data = weekend();
    const { chart } = chartOn(data);
    chart.scale.scrollBy(127);
    const moves = record<CrosshairMoveEvent>((cb) => chart.subscribeCrosshairMove(cb));
    const left = chart.scale.indexToX(99);
    const right = chart.scale.indexToX(100);
    chart.setCrosshair(left + (right - left) * 0.3, 100);
    chart.setCrosshair(left + (right - left) * 0.7, 100);
    assert.deepEqual(moves.map((e) => [e.index, e.time]), [[99, data[99]!.time], [100, data[100]!.time]]);
    chart.destroy();
  });

  it('data-load listeners see the slot layout of the new data', () => {
    const data = weekend();
    const { chart } = chartOn(data);
    const seen: [DataLoadEvent, number, number][] = [];
    chart.subscribeDataLoad((e) => seen.push([e, chart.scale.visibleSlots().length, chart.scale.indexToX(e.length - 1)]));
    // Another weekend before the next bar: 24 empty hours.
    const next = bar(data.at(-1)!.time + 25 * HOUR, data.length);
    chart.appendData(next);
    assert.equal(seen.length, 1);
    const [event, slots, lastX] = seen[0]!;
    assert.equal(event.reason, 'append');
    assert.equal(slots, 248 + 25, 'the slot span already covers the appended bar');
    close(lastX, chart.plotArea.width - chart.scale.barSpacing() / 2);
    close(chart.scale.indexToX(data.length) - chart.scale.indexToX(data.length - 1), 25 * chart.scale.barSpacing());
    chart.destroy();
  });
});

describe('integration: continuous axis x Heikin Ashi, volume overlay and markers', () => {
  it('draws Heikin Ashi bars exactly like candlesticks over HA data on the same slots', () => {
    const data = leadGap(60, 20);
    const a = chartOn(data, { series: { type: 'heikin-ashi' } });
    const b = chartOn(heikinAshi(data), { series: { type: 'candlestick' } });
    assert.deepEqual(a.canvas.context.calls, b.canvas.context.calls);
    // The gap is visible: bar 0 sits 20 slots left of bar 1.
    close(a.chart.scale.indexToX(1) - a.chart.scale.indexToX(0), 20 * a.chart.scale.barSpacing());
    a.chart.destroy();
    b.chart.destroy();
  });

  it('centers volume columns under their candles across a gap', () => {
    const data = leadGap(60, 20);
    const rects: { x: number; w: number; alpha: number }[] = [];
    class Recorder extends MockContext2D {
      override fillRect(x: number, y: number, w: number, h: number): void {
        super.fillRect(x, y, w, h);
        rects.push({ x, w, alpha: this.globalAlpha });
      }
    }
    const ctx = new Recorder();
    const canvas: ChartCanvas = { width: 800, height: 500, getContext: () => ctx };
    const chart = createChart({ container: canvas, config: { wasm: false, data, timeScale: { continuous: true }, volume: { overlay: true, opacity: 0.25 } } });
    rects.length = 0;
    chart.updateConfig({});
    const columns = rects.filter((r) => r.alpha === 0.25);
    const { from, to } = chart.scale.visibleRange();
    assert.equal(columns.length, to - from);
    const half = Math.floor(columns[0]!.w / 2);
    assert.deepEqual(
      columns.map((r) => r.x),
      Array.from({ length: to - from }, (_, k) => Math.round(chart.scale.indexToX(from + k)) - half),
    );
    assert.equal(columns[1]!.x - columns[0]!.x, Math.round(chart.scale.indexToX(1)) - Math.round(chart.scale.indexToX(0)));
    chart.destroy();
  });

  it('anchors markers on their slot; a marker inside a gap stays on the candle before it', () => {
    const data = weekend();
    const { canvas, chart } = chartOn(data);
    chart.scale.scrollBy(60);
    chart.series.setMarkers([
      { time: data[100]!.time, position: 'aboveBar', color: '#00aaff', shape: 'arrowDown', text: 'open' },
      { time: data[99]!.time + 24 * HOUR, position: 'belowBar', color: '#ffaa00', shape: 'arrowUp', text: 'weekend' },
    ]);
    const captionX = (text: string): number => {
      const calls = canvas.context.callsNamed('fillText').filter((c) => c[1] === text);
      assert.ok(calls.length > 0, `the "${text}" caption is drawn`);
      return Number(calls.at(-1)![2]);
    };
    close(captionX('open'), chart.scale.indexToX(100));
    close(captionX('weekend'), chart.scale.indexToX(99));
    chart.destroy();
  });
});

describe('integration: continuous axis x indicator offsets', () => {
  it("projects Ichimoku's leading spans one slot per bar past the last candle", () => {
    const data = weekend();
    const strokes: { color: unknown; x: number }[] = [];
    class Recorder extends MockContext2D {
      override lineTo(x: number, y: number): void {
        super.lineTo(x, y);
        strokes.push({ color: this.strokeStyle, x });
      }
    }
    const ctx = new Recorder();
    const canvas: ChartCanvas = { width: 800, height: 500, getContext: () => ctx };
    const chart = createChart({ container: canvas, config: { wasm: false, data, timeScale: { continuous: true } } });
    chart.addIndicator({ name: 'ichimoku', colors: ['#000001', '#000002', '#000003', '#000004', '#000005', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'] });
    chart.scale.scrollBy(-40); // show whitespace right of the last candle
    strokes.length = 0;
    chart.updateConfig({});
    const lastX = (color: string) => Math.max(...strokes.filter((s) => s.color === color).map((s) => s.x));
    const shift = 25; // displacement 26 plots 25 bars ahead
    close(lastX('#000004'), chart.scale.indexToX(data.length - 1 + shift));
    close(chart.scale.indexToX(data.length - 1 + shift) - chart.scale.indexToX(data.length - 1), shift * chart.scale.barSpacing());
    chart.destroy();
  });
});

describe('integration: continuous axis x live bar folder', () => {
  it('rolling buckets extend the slots without rebuilds; a missed bucket leaves an empty slot', () => {
    const MS = MIN * 1000;
    const history = Array.from({ length: 30 }, (_, i) => bar(T0 + i * MIN, i));
    const proto = TimeSlotSync.prototype as unknown as { rebuild: (...args: unknown[]) => void };
    const original = proto.rebuild;
    let rebuilds = 0;
    proto.rebuild = function (this: unknown, ...args: unknown[]) { rebuilds++; original.apply(this, args); };
    try {
      const { chart } = chartOn(history);
      assert.equal(rebuilds, 1, 'the initial layout');
      let now = (T0 + 29 * MIN) * 1000 + 500;
      const folder = createLiveBarFolder({ intervalMs: MS, seedBar: history.at(-1)!, onBar: (b) => chart.appendData(b), now: () => now });
      folder.pushTick(105); // in-bucket update
      now += MS; // next bucket
      folder.pushTick(106);
      assert.equal(chart.dataLength, 31);
      now += 2 * MS; // skips a bucket: without fetchGap it is an empty backfill
      folder.pushTick(107);
      assert.equal(chart.dataLength, 32);
      assert.equal(rebuilds, 1, 'tail appends only extend the slots');
      const spacing = chart.scale.barSpacing();
      close(chart.scale.indexToX(30) - chart.scale.indexToX(29), spacing);
      close(chart.scale.indexToX(31) - chart.scale.indexToX(30), 2 * spacing, 1e-6);
      assert.equal(chart.scale.visibleSlots().length, 33);
      folder.dispose();
      chart.destroy();
    } finally {
      proto.rebuild = original;
    }
  });
});

describe('integration: continuous axis x snapshot', () => {
  it('screenshots keep the continuous layout, including interpolated axis labels inside a gap', () => {
    const data = weekend();
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, width: 800, height: 500, data, timeScale: { continuous: true } } });
    const live = doc.created[0]!;
    chart.scale.scrollBy(127);
    live.context.calls.length = 0;
    chart.render();
    const shot = chart.takeScreenshot() as MockCanvas;
    assert.deepEqual(shot.context.calls, live.context.calls, 'the screenshot repeats the live frame');
    // The viewport sits in the weekend gap: some time labels fall between bars 99 and 100.
    const left = chart.scale.indexToX(99);
    const right = chart.scale.indexToX(100);
    const labelXs = shot.context.callsNamed('fillText').map((call) => Number(call[2]));
    assert.ok(labelXs.some((x) => x > left && x < right), 'interpolated labels inside the gap');
    chart.destroy();
  });
});
