import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  computeTimeSlots,
  createChart,
  inferIntervalMs,
  SmoothScroll,
  SmoothZoom,
  TimeScale,
  timeTickIndices,
  drawTimeAxis,
  DEFAULT_CONFIG,
  type Candle,
  type DeepPartial,
  type ChartConfig,
  type FrameScheduler,
} from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';
import { MAX_BAR_SPACING } from '../dist/core/scale.js';
import { Crosshair } from '../dist/core/crosshair.js';
import { TimeSlotSync } from '../dist/core/time-slots.js';
import { createDrawingToolbar, DrawingController, ZOOM_TOOL, type UIDocument, type UIElement } from '../dist/ui/index.js';

const HOUR = 3600;
const BASE = 1_700_000_000;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

function candleAt(time: number, i: number): Candle {
  return { time, open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i, volume: 10 + i };
}
/** Hourly candles; indices >= `gapAt` sit `gapHours` later (e.g. a weekend). */
function gapped(n = 20, gapAt = 10, gapHours = 48): Candle[] {
  return Array.from({ length: n }, (_, i) => candleAt(BASE + (i < gapAt ? i : i + gapHours) * HOUR, i));
}
const hourly = (n: number): Candle[] => Array.from({ length: n }, (_, i) => candleAt(BASE + i * HOUR, i));
/** Slots of `gapped()`: 0..9 then 58..67. */
const GAPPED_SLOTS = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 58 + i)];

function chartFor(data: Candle[], config: DeepPartial<ChartConfig> = {}, width = 800) {
  const canvas = new MockCanvas(width, 500);
  const chart = createChart({ container: canvas, config: { wasm: false, data, timeScale: { continuous: true }, ...config } });
  return { canvas, chart, plotWidth: chart.plotArea.width };
}

class Frames implements FrameScheduler {
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
  settle() {
    for (let i = 0; i < 200 && this.callbacks.size; i++) this.tick();
    assert.equal(this.callbacks.size, 0);
  }
}

describe('continuous time: interval inference and slots', () => {
  it('infers the most common positive delta in ms, preferring the smaller on ties', () => {
    assert.equal(inferIntervalMs([]), null);
    assert.equal(inferIntervalMs([candleAt(BASE, 0)]), null);
    assert.equal(inferIntervalMs([candleAt(BASE, 0), candleAt(BASE, 1)]), null);
    assert.equal(inferIntervalMs(gapped()), HOUR * 1000);
    assert.equal(inferIntervalMs([0, 60, 180].map(candleAt)), 60_000);
    assert.equal(inferIntervalMs([0, 120, 180].map(candleAt)), 60_000);
    assert.equal(inferIntervalMs([0, 120, 240, 300, 300].map(candleAt)), 120_000);
  });

  it('places candles at their time slot so weekend gaps stay open', () => {
    assert.deepEqual([...computeTimeSlots(gapped())], GAPPED_SLOTS);
    // Explicit two-hour slots: hourly candles are bumped so each keeps its own slot.
    assert.deepEqual([...computeTimeSlots(hourly(4), 2 * HOUR * 1000)], [0, 1, 2, 3]);
    // Invalid intervals fall back to inference.
    for (const bad of [0, -5, NaN, Infinity]) assert.deepEqual([...computeTimeSlots(gapped(), bad)], GAPPED_SLOTS);
    assert.deepEqual([...computeTimeSlots([candleAt(BASE, 0)])], [0]);
    assert.equal(computeTimeSlots([]).length, 0);
  });

  it('handles irregular data: sub-interval deltas, duplicates and explicit intervals', () => {
    const irregular = [0, 3600, 5400, 7200, 10800].map((t, i) => candleAt(BASE + t, i));
    // Deltas 3600, 1800, 1800, 3600 tie; the smaller (30 min) wins.
    assert.equal(inferIntervalMs(irregular), 1_800_000);
    assert.deepEqual([...computeTimeSlots(irregular)], [0, 2, 3, 4, 6]);
    assert.deepEqual([...computeTimeSlots(irregular, 3_600_000)], [0, 1, 2, 3, 4]);
    const duplicates = [0, 0, 3600].map((t, i) => candleAt(BASE + t, i));
    assert.deepEqual([...computeTimeSlots(duplicates)], [0, 1, 2]);
  });
});

describe('continuous time: TimeScale slot math', () => {
  const slotted = (barSpacing = 10, width = 1000) => {
    const s = new TimeScale(barSpacing, width);
    s.setSlots(Float64Array.from(GAPPED_SLOTS));
    return s;
  };

  it('normalizes empty slots to bar indexing', () => {
    const s = new TimeScale(10, 100);
    assert.equal(s.slots, null);
    s.setSlots([]);
    assert.equal(s.slots, null);
    s.setSlots([0, 5]);
    assert.deepEqual(s.slots, [0, 5]);
    s.setSlots(null);
    assert.equal(s.slots, null);
  });

  it('positions candles by slot, leaving the gap empty', () => {
    const s = slotted();
    assert.equal(s.indexToX(19, 20), 995);
    assert.equal(s.indexToX(10, 20), 905);
    assert.equal(s.indexToX(9, 20), 415);
    assert.equal(s.indexToX(10, 20) - s.indexToX(9, 20), 49 * s.barSpacing);
    assert.equal(s.indexToX(1, 20) - s.indexToX(0, 20), s.barSpacing);
    // Fractional indices interpolate across the gap; beyond the data, one slot per bar.
    assert.equal(s.indexToX(9.5, 20), (s.indexToX(9, 20) + s.indexToX(10, 20)) / 2);
    assert.equal(s.indexToX(21, 20) - s.indexToX(19, 20), 2 * s.barSpacing);
    assert.equal(s.indexToX(0, 20) - s.indexToX(-3, 20), 3 * s.barSpacing);
  });

  it('round-trips indexToX and xToFloatIndex on both sides of and inside the gap', () => {
    const s = slotted();
    s.scroll(3.25, 20);
    for (const i of [-2, 0, 4.5, 9, 9.5, 9.99, 10, 15.25, 19, 21.5]) {
      close(s.xToFloatIndex(s.indexToX(i, 20), 20), i);
    }
    // Inside the gap the nearest candle by x wins.
    const x9 = s.indexToX(9, 20);
    assert.equal(s.xToIndex(x9 + 20 * s.barSpacing, 20), 9);
    assert.equal(s.xToIndex(x9 + 30 * s.barSpacing, 20), 10);
    close(s.xToFloatIndex(x9 + 11 * s.barSpacing, 20), 9 + 11 / 49);
  });

  it('keeps the same fractional index under a zoom anchor', () => {
    const s = slotted(10, 400);
    s.scroll(20, 20);
    const anchor = 150;
    const index = s.xToFloatIndex(anchor, 20);
    assert.ok(index > 9 && index < 10, 'anchor sits inside the gap');
    assert.ok(s.zoom(1.7, 20, anchor));
    close(s.indexToX(index, 20), anchor);
  });

  it('keeps visible ranges to candles inside the viewport, with the gap neighbours only in the draw range', () => {
    const s = slotted(10, 400);
    // Right edge at the live candle; the left edge (slot 27) is inside the gap. Candle 9
    // (x = -185) stays out, so it cannot pull autoscale or the high/low references.
    assert.deepEqual(s.visibleRange(20), { from: 10, to: 20 });
    assert.equal(s.indexToX(9, 20), -185);
    assert.deepEqual(s.visibleSlots(20), { from: 27, to: 68, length: 68 });
    // Lines still enter from candle 9 across the gap.
    assert.deepEqual(s.drawRange(s.visibleRange(20), 20), { from: 9, to: 20 });
    // Right edge inside the gap: the first candle after it is not visible, but is drawn.
    s.scroll(20, 20);
    assert.deepEqual(s.visibleRange(20), { from: 7, to: 10 });
    assert.ok(s.indexToX(10, 20) > 400 && s.indexToX(9, 20) < 400);
    assert.deepEqual(s.drawRange(s.visibleRange(20), 20), { from: 7, to: 11 });
    // Viewport entirely inside the gap: the two candles around it frame the line crossing it.
    s.scrollTo(9, 20);
    s.scroll(-46, 20);
    assert.ok(s.indexToX(9, 20) < 0 && s.indexToX(10, 20) > 400);
    assert.deepEqual(s.visibleRange(20), { from: 9, to: 11 });
    assert.deepEqual(s.visibleSlots(20), { from: 15, to: 56, length: 68 });
    const inGap = s.visibleRange(20);
    assert.equal(s.drawRange(inGap, 20), inGap);
    const wide = slotted(10, 1000);
    assert.deepEqual(wide.visibleRange(20), { from: 0, to: 20 });
    assert.deepEqual(wide.visibleSlots(20), { from: 0, to: 68, length: 68 });
    // Out-of-range offsets (scrollOffset is public) and empty viewports stay empty.
    s.scrollOffset = 1e9;
    assert.deepEqual(s.visibleRange(20), { from: 0, to: 0 });
    s.scrollOffset = -1e9;
    assert.deepEqual(s.visibleRange(20), { from: 20, to: 20 });
    assert.deepEqual(s.drawRange({ from: 20, to: 20 }, 20), { from: 20, to: 20 });
    assert.deepEqual(slotted(10, 0).visibleRange(20), { from: 0, to: 0 });
    assert.deepEqual(slotted(10, 0).visibleSlots(20), { from: 0, to: 0, length: 68 });
  });

  it('matches the bar-indexed range and draws exactly it in bar mode', () => {
    const plain = new TimeScale(10, 400);
    plain.scroll(7.5, 50);
    const range = plain.visibleRange(50);
    assert.deepEqual(plain.visibleSlots(50), { ...range, length: 50 });
    assert.equal(plain.drawRange(range, 50), range);
    assert.deepEqual(plain.visibleSlots(0), { from: 0, to: 0, length: 0 });
    assert.deepEqual(plain.visibleSlots(-3), { from: 0, to: 0, length: 0 });
    // Gapless slots never widen the draw range, so frames match bar mode.
    const identity = new TimeScale(10, 400);
    identity.setSlots(Float64Array.from({ length: 50 }, (_, i) => i));
    identity.scroll(7.5, 50);
    assert.deepEqual(identity.visibleRange(50), range);
    assert.equal(identity.drawRange(range, 50), range);
  });

  it('clamps scrolling in slot units and scrolls/fits by slot', () => {
    const s = slotted(10, 400);
    s.scroll(1e9, 20);
    assert.equal(s.scrollOffset, 67);
    assert.equal(s.indexToX(0, 20), 395);
    s.scroll(-1e9, 20);
    assert.equal(s.scrollOffset, -40);
    s.scrollTo(9, 20);
    assert.equal(s.scrollOffset, 58);
    assert.equal(s.indexToX(9, 20), 395);
    s.scrollTo(9.5, 20);
    assert.equal(s.scrollOffset, 33.5);
    const fit = slotted(10, 1000);
    fit.fitRange(12, 5, 20);
    close(fit.barSpacing, 1000 / 56);
    assert.equal(fit.scrollOffset, 7);
    close(fit.indexToX(5, 20), fit.barSpacing / 2);
    close(fit.indexToX(12, 20), 1000 - fit.barSpacing / 2);
  });

  it('uses bar-indexed math when slots do not cover the dataset', () => {
    const s = slotted(10, 400);
    const plain = new TimeScale(10, 400);
    for (const n of [19, 21]) {
      assert.equal(s.indexToX(3, n), plain.indexToX(3, n));
      assert.equal(s.xToFloatIndex(123, n), plain.xToFloatIndex(123, n));
      assert.deepEqual(s.visibleRange(n), plain.visibleRange(n));
      assert.deepEqual(s.visibleSlots(n), plain.visibleSlots(n));
      const range = { from: 3, to: 9 };
      assert.equal(s.drawRange(range, n), range);
    }
    s.scroll(1e9, 19);
    assert.equal(s.scrollOffset, 18);
  });

  it('matches bar indexing exactly for gapless (identity) slots', () => {
    const a = new TimeScale(7, 640);
    const b = new TimeScale(7, 640);
    b.setSlots(Float64Array.from({ length: 300 }, (_, i) => i));
    for (const s of [a, b]) {
      s.scroll(37.4, 300);
      s.zoom(1.3, 300, 211);
    }
    assert.deepEqual(b.visibleRange(300), a.visibleRange(300));
    for (const i of [0, 17, 123, 299]) assert.equal(b.indexToX(i, 300), a.indexToX(i, 300));
    for (const x of [0, 5, 320, 639]) close(b.xToFloatIndex(x, 300), a.xToFloatIndex(x, 300), 1e-9);
    for (const s of [a, b]) s.scroll(1e9, 300);
    assert.equal(b.scrollOffset, a.scrollOffset);
    for (const s of [a, b]) s.fitRange(40, 90, 300);
    assert.equal(b.barSpacing, a.barSpacing);
    assert.equal(b.scrollOffset, a.scrollOffset);
  });

  it('snaps the crosshair to the nearest candle on either side of a gap', () => {
    const s = slotted(10, 1000);
    const c = new Crosshair();
    c.update(s.indexToX(9, 20) + 3 * s.barSpacing, 0);
    assert.equal(c.snappedIndex(s, 20), 9);
    c.update(s.indexToX(10, 20) - 3 * s.barSpacing, 0);
    assert.equal(c.snappedIndex(s, 20), 10);
  });
});

describe('continuous time: axis ticks', () => {
  it('spaces ticks by slots inside the viewport so labels never pile up at a gap', () => {
    const s = new TimeScale(6, 720);
    const slots = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 110 + i)];
    s.setSlots(slots);
    // Slot position of a (possibly fractional) tick index.
    const slotOf = (i: number) => Number.isInteger(i) ? slots[i]! : slots[Math.floor(i)]! + (i % 1) * (slots[Math.ceil(i)]! - slots[Math.floor(i)]!);
    const range = s.visibleRange(20);
    // Index-stepped ticks would sit 3 bars (18px) apart; slot spacing keeps them 1/6 viewport (20 slots) apart.
    assert.deepEqual(timeTickIndices(range, 6), [0, 3, 6, 9, 12, 15, 18]);
    const ticks = timeTickIndices(range, 6, s, 20);
    // Candles snap ticks; the stretch of the gap with no candle within a step gets fractional ticks.
    assert.deepEqual(ticks.map((i) => Math.round(slotOf(i) * 1e9) / 1e9), [0, 20, 40, 60, 80, 110]);
    assert.deepEqual(ticks.filter(Number.isInteger), [0, 10]);
    close(ticks[1]!, 9 + 11 / 101);
    for (const scroll of [5, 3.7]) {
      s.scroll(scroll, 20);
      const shifted = timeTickIndices(s.visibleRange(20), 6, s, 20);
      assert.ok(shifted.length >= 5);
      for (const i of shifted) assert.ok(s.indexToX(i, 20) >= 0 && s.indexToX(i, 20) <= 720, `tick ${i} on screen`);
      for (let k = 1; k < shifted.length; k++) assert.ok(slotOf(shifted[k]!) - slotOf(shifted[k - 1]!) >= 20 - 1e-9);
    }
    // Nothing is labelled beyond the data.
    s.scroll(-1e9, 20);
    assert.ok(s.indexToX(19, 20) < 0);
    assert.deepEqual(timeTickIndices(s.visibleRange(20), 6, s, 20), []);
  });

  it('labels ticks inside a gap with interpolated times', () => {
    const s = new TimeScale(10, 400);
    const candles = [candleAt(BASE, 0), candleAt(BASE + 10 * HOUR, 1)];
    s.setSlots([0, 10]);
    const ctx = new MockCanvas(400, 300).context;
    drawTimeAxis(ctx, candles, [0, 0.25, 1, 1.5, -0.5], s, 280, (t) => String(t), '#fff', '12px mono');
    const labels = ctx.callsNamed('fillText').map((c) => [c[1], c[2]]);
    // Index 1.5 lies past the last candle: its time stays the last candle's; -0.5 has no candle.
    assert.deepEqual(labels, [
      [String(BASE), s.indexToX(0, 2)],
      [String(BASE + 2.5 * HOUR), s.indexToX(0.25, 2)],
      [String(BASE + 10 * HOUR), s.indexToX(1, 2)],
      [String(BASE + 10 * HOUR), s.indexToX(1.5, 2)],
    ]);
  });

  it('falls back to index steps in bar mode or when slots do not cover the data', () => {
    const s = new TimeScale(6, 720);
    const range = { from: 0, to: 20 };
    assert.deepEqual(timeTickIndices(range, 6, s, 20), timeTickIndices(range, 6));
    s.setSlots(GAPPED_SLOTS);
    assert.deepEqual(timeTickIndices(range, 6, s, 21), timeTickIndices(range, 6));
    assert.deepEqual(timeTickIndices(range, 6, s), timeTickIndices(range, 6));
    assert.deepEqual(timeTickIndices({ from: 0, to: 0 }, 6, s, 20), []);
  });
});

describe('continuous time: chart integration', () => {
  it('defaults to bar indexing with gaps collapsed', () => {
    assert.deepEqual(DEFAULT_CONFIG.timeScale, { continuous: false, intervalMs: null });
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { wasm: false, data: gapped() } });
    assert.deepEqual(chart.getConfig().timeScale, { continuous: false, intervalMs: null });
    assert.equal(chart.scale.indexToX(10) - chart.scale.indexToX(9), chart.scale.barSpacing());
    assert.equal(chart.scale.barSpacing(), 6);
  });

  it('renders candles and indicator lines across an open gap', () => {
    const { canvas, chart } = chartFor(gapped(), { indicators: [{ id: 'ma', name: 'sma', params: { period: 3 }, pane: 'main', colors: ['#123456'], visible: true }] });
    const bs = chart.scale.barSpacing();
    close(chart.scale.indexToX(10) - chart.scale.indexToX(9), 49 * bs);
    // Wicks are 1px fillRects at each candle's rounded center.
    const wicks = canvas.context.callsNamed('fillRect').filter((c) => c[3] === 1).map((c) => c[1] as number);
    const expected = Array.from({ length: 20 }, (_, i) => Math.round(chart.scale.indexToX(i)));
    assert.deepEqual(wicks, expected);
    assert.equal(wicks[10]! - wicks[9]!, 49 * bs);
    // The SMA line runs from candle 9 straight across the gap to candle 10.
    const calls = canvas.context.calls;
    const x9 = chart.scale.indexToX(9), x10 = chart.scale.indexToX(10);
    assert.ok(calls.some((c, k) => c[0] === 'lineTo' && c[1] === x9 && calls[k + 1]?.[0] === 'lineTo' && calls[k + 1]?.[1] === x10));
    // Vertical grid lines follow the slot-spaced ticks: candle 0, one step into the gap, then
    // the first candle after the gap (within a step of the next tick, so it takes that tick).
    const grid = calls.filter((c, k) => c[0] === 'moveTo' && c[2] === 0 && calls[k + 1]?.[0] === 'lineTo' && calls[k + 1]?.[1] === c[1]);
    const step = Math.floor(chart.plotArea.width / bs / 6);
    assert.ok(step > 9 && 58 - 2 * step < step, 'one tick lands inside the gap');
    const gridX = grid.map((c) => c[1] as number);
    assert.equal(gridX.length, 3);
    close(gridX[0]!, chart.scale.indexToX(0));
    close(gridX[1]!, chart.scale.indexToX(0) + step * bs);
    close(gridX[2]!, x10);
    chart.destroy();
  });

  it('autoscales and marks high/low from on-screen candles only, not the one before a gap', () => {
    // Session 1 trades near 100; after a 17-hour overnight gap, session 2 trades near 200.
    const data = Array.from({ length: 28 }, (_, i) => {
      const time = BASE + (i < 7 ? i : i + 17) * HOUR;
      const base = i < 7 ? 100 : 200;
      return { time, open: base + 1, high: base + 4, low: base, close: base + 2, volume: 1 };
    });
    const { canvas, chart } = chartFor(data, { priceAxis: { labels: { highLow: true } }, series: { type: 'line' } });
    // Put the left edge inside the overnight gap, three slots after candle 6.
    const bs = chart.scale.barSpacing();
    chart.scale.scrollBy(-(chart.scale.indexToX(6) / bs + 3));
    close(chart.scale.indexToX(6), -3 * bs);
    assert.ok(chart.scale.indexToX(7) > 0);
    assert.deepEqual(chart.scale.visibleRange(), { from: 7, to: 28 });
    // The price scale spans the visible 200..204 candles, not candle 6's 100.
    const height = chart.plotArea.height;
    assert.ok(chart.scale.yToPrice(height) > 199 && chart.scale.yToPrice(0) < 205);
    const labels = canvas.context.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(labels.includes('L 200.00') && labels.includes('H 204.00'), labels.join());
    // The line still enters from candle 6 across the gap.
    const x6 = chart.scale.indexToX(6);
    assert.ok(canvas.context.calls.some((c) => c[0] === 'moveTo' && c[1] === x6));
    chart.destroy();
  });

  it('draws line segments across a gap at the right edge before its far candle scrolls in', () => {
    const { canvas, chart } = chartFor(gapped(), { series: { type: 'line' } });
    chart.scale.scrollTo(9);
    chart.scale.scrollBy(-20);
    const x10 = chart.scale.indexToX(10);
    assert.ok(chart.scale.indexToX(9) < chart.plotArea.width && x10 > chart.plotArea.width);
    assert.equal(chart.scale.visibleRange().to, 10);
    const calls = canvas.context.calls;
    const stroke = calls.findIndex((c, k) => c[0] === 'stroke' && calls[k - 1]?.[0] === 'lineTo' && calls[k - 1]?.[1] === x10);
    assert.ok(stroke > 0, 'the series path ends at the first candle after the gap');
    chart.destroy();
  });

  it('keeps the time axis and grid labelled while the viewport is inside a gap', () => {
    const { canvas, chart } = chartFor(gapped(40, 20, 400), { formatters: { time: (t: number) => `t${t}` } });
    chart.scale.scrollTo(19);
    canvas.context.calls.length = 0;
    chart.scale.scrollBy(-200);
    assert.ok(chart.scale.indexToX(19) < 0 && chart.scale.indexToX(20) > chart.plotArea.width);
    const labels = canvas.context.callsNamed('fillText').filter((c) => c[3] === chart.plotArea.height + 4);
    assert.ok(labels.length >= 5, `${labels.length} labels`);
    const bs = chart.scale.barSpacing();
    for (const [, text, x] of labels) {
      // Each label is the interpolated time of its slot: hourly slots sit exactly on the hour.
      const hours = (Number(String(text).slice(1)) - BASE) / HOUR;
      assert.ok(Number.isInteger(hours) && hours > 19 && hours < 420, String(text));
      close(x as number, chart.scale.indexToX(0) + hours * bs, 1e-6);
      assert.ok((x as number) >= 0 && (x as number) <= chart.plotArea.width);
    }
    chart.destroy();
  });

  it('draws the same frame as bar indexing when the data has no gaps', () => {
    const cfg: DeepPartial<ChartConfig> = {
      timeAxis: { visible: false }, grid: { vertical: false }, statusLine: { visible: true },
      indicators: [{ id: 'ma', name: 'ema', params: { period: 9 }, pane: 'main', colors: [], visible: true },
        { id: 'vol', name: 'vol', params: {}, pane: 'sub', colors: [], visible: true }],
    };
    const frames = [false, true].map((continuous) => {
      const canvas = new MockCanvas(800, 500);
      const chart = createChart({ container: canvas, config: { ...cfg, wasm: false, data: hourly(400), timeScale: { continuous } } });
      chart.addDrawing({ name: 'trendline', points: [{ index: 300, price: 150 }, { index: 380, price: 170 }] });
      chart.scale.scrollBy(12.5);
      chart.scale.zoom(1.4, 300);
      chart.setCrosshair(200, 120);
      return canvas.context.calls;
    });
    assert.deepEqual(frames[1], frames[0]);
  });

  it('places, hits, moves and snaps drawings on both sides of a gap', () => {
    const { chart } = chartFor(gapped());
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 5, price: 100 }, { index: 15, price: 120 }] });
    const x5 = chart.scale.indexToX(5), x15 = chart.scale.indexToX(15);
    const midX = (x5 + x15) / 2, midY = (chart.scale.priceToY(100) + chart.scale.priceToY(120)) / 2;
    assert.ok(midX > chart.scale.indexToX(9) && midX < chart.scale.indexToX(10), 'midpoint lies in the gap');
    assert.equal(chart.drawingAt(midX, midY), id);
    chart.selectDrawing(id);
    assert.equal(chart.handleAt(x15, chart.scale.priceToY(120)), 1);
    // Translating by pixels keeps the pixel geometry, even into the gap.
    const dx = 20 * chart.scale.barSpacing();
    chart.translateDrawing(id, dx, 0);
    const [a, b] = chart.getDrawing(id)!.points;
    close(chart.scale.indexToX(a!.index), x5 + dx);
    close(chart.scale.indexToX(b!.index), x15 + dx);
    close(a!.index, 9 + 16 / 49);
    // Pointer positions inside the gap map to fractional indices; magnets snap to the nearest candle.
    const inGap = chart.scale.indexToX(9) + 10 * chart.scale.barSpacing();
    close(chart.pointFromPixel(inGap, 50).index, 9 + 10 / 49);
    assert.equal(chart.snapPoint(inGap, 50, 'strong').index, 9);
    assert.equal(chart.snapPoint(chart.scale.indexToX(10) - 5 * chart.scale.barSpacing(), 50, 'strong').index, 10);
    chart.destroy();
  });

  it('shows the hovered candle on either side of a gap in the status line', () => {
    const { canvas, chart } = chartFor(gapped(), { statusLine: { visible: true } });
    const texts = () => canvas.context.callsNamed('fillText').map((c) => c[1]);
    const bs = chart.scale.barSpacing();
    canvas.context.calls.length = 0;
    chart.setCrosshair(chart.scale.indexToX(9) + 3 * bs, 100);
    assert.ok(texts().includes('O 109.00'));
    canvas.context.calls.length = 0;
    chart.setCrosshair(chart.scale.indexToX(10) - 3 * bs, 100);
    assert.ok(texts().includes('O 110.00'));
    chart.destroy();
  });

  it('exposes slot-aware ScaleApi conversions and box zoom', () => {
    const { chart, plotWidth } = chartFor(gapped(40, 20, 48));
    const bs = chart.scale.barSpacing();
    assert.deepEqual(chart.scale.visibleRange(), { from: 0, to: 40 });
    close(chart.scale.xToIndex(chart.scale.indexToX(19) + 10 * bs), 19 + 10 / 49);
    chart.scale.zoomToRange(15, 22);
    const spacing = chart.scale.barSpacing();
    close(spacing, plotWidth / (22 + 48 - 15 + 1));
    close(chart.scale.indexToX(15), spacing / 2);
    close(chart.scale.indexToX(22), plotWidth - spacing / 2);
    // Box zoom between two pixels inside and after the gap fits exactly those positions.
    const c = new DrawingController(chart);
    c.arm(ZOOM_TOOL);
    const x0 = chart.scale.indexToX(19) + 10 * spacing, x1 = chart.scale.indexToX(21);
    const i0 = chart.scale.xToIndex(x0), i1 = chart.scale.xToIndex(x1);
    c.pointerDown(x0, 50);
    c.pointerMove(x1, 50);
    c.pointerUp(x1, 50);
    const after = chart.scale.barSpacing();
    close(chart.scale.indexToX(i0), after / 2);
    close(chart.scale.indexToX(i1), plotWidth - after / 2);
    close(chart.scale.priceToBarRatio() / after, chart.scale.priceToBarRatio() / chart.scale.barSpacing());
    chart.destroy();
  });

  it('pans by pixels even when the first two candles straddle a gap', () => {
    const data = [candleAt(BASE, 0), ...hourly(60).map((c, i) => candleAt(c.time + 48 * HOUR, i + 1))];
    const { chart } = chartFor(data);
    assert.equal(chart.scale.indexToX(1) - chart.scale.indexToX(0), 48 * chart.scale.barSpacing());
    const c = new DrawingController(chart);
    const before = chart.scale.indexToX(30);
    c.pointerDown(300, 200);
    c.pointerMove(330, 200);
    c.pointerUp(330, 200);
    close(chart.scale.indexToX(30), before + 30);
    chart.destroy();
  });

  it('smooth-zooms by bar spacing, not by the distance across a leading gap', () => {
    const data = [candleAt(BASE, 0), ...hourly(60).map((c, i) => candleAt(c.time + 48 * HOUR, i + 1))];
    const { chart } = chartFor(data);
    const frames = new Frames();
    const zoom = new SmoothZoom(chart.scale, frames, { timeConstant: 0 });
    zoom.zoomBy(2, 400);
    frames.settle();
    close(chart.scale.barSpacing(), 12);
    zoom.zoomBy(1000, 400);
    frames.settle();
    close(chart.scale.barSpacing(), MAX_BAR_SPACING);
    chart.destroy();
  });

  it('smooth-pages by the viewport width in slots and stops at the ends of the data', () => {
    const { chart } = chartFor(gapped(600, 400, 48));
    chart.scale.zoom(0.5);
    const frames = new Frames();
    const scroll = new SmoothScroll(chart, frames);
    const window = chart.scale.visibleSlots();
    const range = chart.scale.visibleRange();
    const bs = chart.scale.barSpacing();
    const span = window.to - window.from;
    assert.equal(window.length, 648);
    assert.ok(span > range.to - range.from, 'the gap leaves fewer candles than slots in view');
    close(span, chart.plotArea.width / bs + 2, 1);
    const start = chart.scale.indexToX(0);
    scroll.page(1);
    frames.tick(60);
    const mid = chart.scale.indexToX(0);
    assert.ok(mid > start && mid < start + span * 0.8 * bs);
    frames.settle();
    close(chart.scale.indexToX(0), start + span * 0.8 * bs);
    for (let i = 0; i < 50; i++) scroll.page(1);
    frames.settle();
    assert.equal(chart.scale.visibleRange().from, 0);
    assert.equal(chart.scale.visibleSlots().from, 0);
    for (let i = 0; i < 50; i++) scroll.page(-1);
    frames.settle();
    assert.equal(chart.scale.visibleRange().to, chart.dataLength);
    assert.equal(chart.scale.visibleSlots().to, 648);
    chart.destroy();
  });

  /** 200 hourly candles, a `haltHours` trading halt, then `after` more (the halt is wider than the viewport). */
  const halted = (after: number, haltHours = 1000): Candle[] =>
    Array.from({ length: 200 + after }, (_, i) => candleAt(BASE + (i < 200 ? i : i + haltHours) * HOUR, i));
  /** Candles whose centre is on screen. */
  const onScreen = (chart: ReturnType<typeof createChart>) => {
    const shown: number[] = [];
    for (let i = 0; i < chart.dataLength; i++) {
      const x = chart.scale.indexToX(i);
      if (x >= 0 && x <= chart.plotArea.width) shown.push(i);
    }
    return shown;
  };
  const pageUntil = (scroll: SmoothScroll, frames: Frames, direction: 1 | -1, done: () => boolean, max: number, each?: () => void) => {
    let presses = 0;
    while (!done() && presses < max) {
      scroll.page(direction);
      frames.settle();
      presses++;
      each?.();
    }
    assert.ok(done(), `reached the end within ${max} presses`);
    return presses;
  };

  it('pages through a gap wider than the viewport without stalling or skipping candles', () => {
    const { chart } = chartFor(halted(300));
    const frames = new Frames();
    const scroll = new SmoothScroll(chart, frames, { duration: 0 });
    const viewport = chart.plotArea.width / chart.scale.barSpacing();
    assert.ok(viewport < 1000, 'the halt is wider than the viewport');
    const seen = new Set(onScreen(chart));
    const moves: number[] = [];
    const maxPresses = Math.ceil(1500 / (0.8 * viewport)) + 2;
    const presses = pageUntil(scroll, frames, 1, () => chart.scale.visibleSlots().from === 0, maxPresses, () => {
      for (const i of onScreen(chart)) seen.add(i);
    });
    assert.ok(presses >= 10, 'crossing the halt takes several pages');
    // Every candle was on screen but the first two, which end just past the left edge as in bar mode.
    for (let i = 2; i < chart.dataLength; i++) assert.ok(seen.has(i), `candle ${i} shown`);
    assert.ok(chart.scale.indexToX(0) > -2.5 * chart.scale.barSpacing());
    // And back to the live edge, 0.8 of the viewport's slots per page (the last page stops at the data).
    const spans: number[] = [];
    let x = chart.scale.indexToX(0);
    let span = chart.scale.visibleSlots().to - chart.scale.visibleSlots().from;
    pageUntil(scroll, frames, -1, () => chart.scale.visibleRange().to === chart.dataLength, maxPresses, () => {
      moves.push((x - chart.scale.indexToX(0)) / chart.scale.barSpacing());
      spans.push(span);
      x = chart.scale.indexToX(0);
      span = chart.scale.visibleSlots().to - chart.scale.visibleSlots().from;
    });
    assert.ok(moves.length >= 10);
    moves.slice(0, -1).forEach((move, k) => close(move, 0.8 * spans[k]!, 1e-6));
    assert.ok(moves.at(-1)! > 0 && moves.at(-1)! <= 0.8 * spans.at(-1)! + 1e-6);
    chart.destroy();
  });

  it('pages out of a gap that fills the viewport, in both directions', () => {
    const { chart } = chartFor(halted(5));
    const frames = new Frames();
    const scroll = new SmoothScroll(chart, frames, { duration: 0 });
    const inGap = () => {
      chart.scale.scrollTo(199);
      chart.scale.scrollBy(-500);
      assert.deepEqual(onScreen(chart), []);
      assert.deepEqual(chart.scale.visibleRange(), { from: 199, to: 201 });
    };
    inGap();
    const before = chart.scale.indexToX(0);
    const window = chart.scale.visibleSlots();
    scroll.page(1);
    frames.settle();
    close((chart.scale.indexToX(0) - before) / chart.scale.barSpacing(), 0.8 * (window.to - window.from), 1e-6);
    // Only five candles follow the halt, yet paging reaches them within the halt's width in pages.
    inGap();
    const maxPresses = Math.ceil(1000 / (0.8 * chart.plotArea.width / chart.scale.barSpacing())) + 1;
    pageUntil(scroll, frames, -1, () => chart.scale.visibleRange().to === chart.dataLength, maxPresses);
    assert.deepEqual(onScreen(chart).slice(0, 4), [200, 201, 202, 203]);
    assert.ok(chart.scale.indexToX(204) < chart.plotArea.width + chart.scale.barSpacing());
    inGap();
    pageUntil(scroll, frames, 1, () => onScreen(chart).includes(199), maxPresses);
    chart.destroy();
  });

  it('pages history back to a first candle that sits before a gap', () => {
    const data = [candleAt(BASE, 0), ...hourly(400).map((c, i) => candleAt(c.time + 48 * HOUR, i + 1))];
    const { chart } = chartFor(data);
    const frames = new Frames();
    const scroll = new SmoothScroll(chart, frames, { duration: 0 });
    pageUntil(scroll, frames, 1, () => chart.scale.visibleSlots().from === 0, 10);
    const bs = chart.scale.barSpacing();
    // Candle 0 ends where bar mode leaves bar 0: just past the left edge.
    const x0 = chart.scale.indexToX(0);
    assert.ok(x0 < 0 && x0 > -2.5 * bs, `candle 0 at ${x0}`);
    assert.equal(chart.scale.visibleRange().from, 0);
    chart.destroy();
  });

  it('smooth-pages custom scales without barSpacing by the first bar width', () => {
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { wasm: false, data: hourly(2000) } });
    chart.scale.zoom(0.5);
    const { barSpacing: _unused, visibleSlots: _alsoUnused, ...scale } = chart.scale;
    const frames = new Frames();
    const scroll = new SmoothScroll({ dataLength: chart.dataLength, scale }, frames);
    const range = chart.scale.visibleRange();
    const start = chart.scale.indexToX(0);
    scroll.page(1);
    frames.settle();
    close(chart.scale.indexToX(0), start + (range.to - range.from) * 0.8 * 3);
    chart.destroy();
  });

  it('extends slots incrementally on tail appends and rebuilds when needed', () => {
    const { chart } = chartFor(gapped());
    const bs = () => chart.scale.barSpacing();
    const x = (i: number) => chart.scale.indexToX(i);
    const last = gapped()[19]!.time;
    chart.appendData(candleAt(last + HOUR, 20));
    close(x(20) - x(19), bs());
    chart.appendData(candleAt(last + 6 * HOUR, 21));
    close(x(21) - x(20), 5 * bs());
    // Updating the live candle keeps its slot.
    chart.appendData({ ...candleAt(last + 6 * HOUR, 21), close: 150 });
    close(x(21) - x(20), 5 * bs());
    close(x(21), chart.plotArea.width - bs() / 2);
    // Many appends grow the slot buffer.
    for (let k = 1; k <= 40; k++) chart.appendData(candleAt(last + (6 + k) * HOUR, 21 + k));
    close(x(61) - x(21), 40 * bs());
    // Out-of-order inserts rebuild from scratch.
    chart.appendData(candleAt(gapped()[9]!.time + 24 * HOUR, 99));
    close(x(10) - x(9), 24 * bs());
    close(x(11) - x(10), 25 * bs());
    chart.destroy();
  });

  it('rebuilds when an appended delta changes the inferred interval', () => {
    const { chart } = chartFor([0, 7200, 14400].map((t, i) => candleAt(BASE + t, i)));
    const x = (i: number) => chart.scale.indexToX(i);
    const bs = () => chart.scale.barSpacing();
    close(x(1) - x(0), bs());
    chart.appendData(candleAt(BASE + 18000, 3));
    // 2.5 slots of two hours round up to slot 3.
    close(x(3) - x(2), bs());
    chart.appendData(candleAt(BASE + 21600, 4));
    // One-hour deltas now tie with two-hour ones and win: slots become hourly.
    close(x(1) - x(0), 2 * bs());
    close(x(4) - x(3), bs());
    chart.destroy();
  });

  it('extends slots in O(1) on tail appends and rebuilds only when it must', () => {
    const proto = TimeSlotSync.prototype as unknown as { rebuild: (...args: unknown[]) => void };
    const original = proto.rebuild;
    let rebuilds = 0;
    proto.rebuild = function (this: unknown, ...args: unknown[]) { rebuilds++; original.apply(this, args); };
    try {
      const { chart } = chartFor(gapped());
      const slots = () => (chart as unknown as { timeScale: TimeScale }).timeScale.slots as Float64Array;
      assert.equal(rebuilds, 1);
      const last = gapped()[19]!.time;
      chart.appendData(candleAt(last + HOUR, 20));
      // The first append doubles the buffer; later appends and live updates reuse it.
      const buffer = slots().buffer;
      for (let k = 2; k <= 6; k++) chart.appendData(candleAt(last + k * HOUR, 19 + k));
      chart.appendData({ ...candleAt(last + 6 * HOUR, 25), close: 1 });
      chart.render();
      chart.render();
      chart.updateConfig({ timeScale: { continuous: true } });
      assert.equal(rebuilds, 1);
      assert.equal(slots().buffer, buffer);
      assert.equal(slots().length, 26);
      assert.equal(slots()[25], 73);
      // An out-of-order insert, replaced data and a changed interval each rebuild once.
      chart.appendData(candleAt(gapped()[9]!.time + 24 * HOUR, 99));
      assert.equal(rebuilds, 2);
      chart.setData(hourly(3));
      assert.equal(rebuilds, 3);
      chart.updateConfig({ timeScale: { intervalMs: 1_800_000 } });
      assert.equal(rebuilds, 4);
      chart.destroy();
      const small = chartFor([0, 7200, 14400].map((t, i) => candleAt(BASE + t, i))).chart;
      assert.equal(rebuilds, 5);
      small.appendData(candleAt(BASE + 18000, 3));
      assert.equal(rebuilds, 5);
      // One-hour deltas now tie with two-hour ones and win: the inferred interval changes.
      small.appendData(candleAt(BASE + 21600, 4));
      assert.equal(rebuilds, 6);
      small.destroy();
    } finally {
      proto.rebuild = original;
    }
  });

  it('starts from an empty dataset and grows', () => {
    const { chart } = chartFor([]);
    assert.deepEqual(chart.scale.visibleRange(), { from: 0, to: 0 });
    chart.appendData(candleAt(BASE, 0));
    chart.appendData(candleAt(BASE + HOUR, 1));
    chart.appendData(candleAt(BASE + 4 * HOUR, 2));
    const bs = chart.scale.barSpacing();
    close(chart.scale.indexToX(1) - chart.scale.indexToX(0), bs);
    close(chart.scale.indexToX(2) - chart.scale.indexToX(1), 3 * bs);
    chart.setData(gapped());
    close(chart.scale.indexToX(10) - chart.scale.indexToX(9), 49 * bs);
    chart.destroy();
  });

  it('toggles continuous mode via updateConfig keeping the right edge anchored', () => {
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { wasm: false, data: gapped(200, 150, 48) } });
    const right = () => chart.scale.xToIndex(chart.plotArea.width - chart.scale.barSpacing() / 2);
    const bs = chart.scale.barSpacing();
    // At the live edge the last candle stays pinned to the right.
    chart.updateConfig({ timeScale: { continuous: true } });
    close(chart.scale.indexToX(199), chart.plotArea.width - bs / 2);
    close(chart.scale.indexToX(150) - chart.scale.indexToX(149), 49 * bs);
    chart.updateConfig({ timeScale: { continuous: false } });
    close(chart.scale.indexToX(199), chart.plotArea.width - bs / 2);
    // Scrolled back (and to a fractional offset), the rightmost visible bar is kept.
    chart.scale.scrollBy(80.25);
    const before = chart.scale.xToIndex(chart.plotArea.width - bs / 2);
    chart.updateConfig({ timeScale: { continuous: true } });
    close(right(), before);
    // Re-applying the same settings is a no-op.
    const offset = chart.scale.indexToX(0);
    chart.updateConfig({ timeScale: { continuous: true, intervalMs: null } });
    assert.equal(chart.scale.indexToX(0), offset);
    // A new interval remaps (half-hour slots double the spacing) around the same bar.
    chart.updateConfig({ timeScale: { intervalMs: 1_800_000 } });
    close(chart.scale.indexToX(1) - chart.scale.indexToX(0), 2 * bs);
    close(right(), before);
    chart.updateConfig({ timeScale: { continuous: false } });
    close(right(), before);
    close(chart.scale.indexToX(150) - chart.scale.indexToX(149), bs);
    chart.destroy();
  });

  it('recomputes slots when data and settings change together or the config is edited in place', () => {
    const { chart } = chartFor(hourly(30));
    const bs = chart.scale.barSpacing();
    chart.updateConfig({ data: gapped(), timeScale: { intervalMs: 2 * HOUR * 1000 } });
    // Two-hour slots: hourly candles are bumped to slots 0..9, then hour 58 lands on slot 29.
    close(chart.scale.indexToX(10) - chart.scale.indexToX(9), 20 * bs);
    chart.updateConfig({ data: hourly(10) });
    close(chart.scale.indexToX(9) - chart.scale.indexToX(8), bs);
    // A config mutated outside updateConfig is picked up on the next append.
    chart.getConfig().timeScale.intervalMs = 1_800_000;
    chart.appendData(candleAt(BASE + 10 * HOUR, 10));
    close(chart.scale.indexToX(10) - chart.scale.indexToX(9), 2 * bs);
    chart.getConfig().timeScale.continuous = false;
    chart.appendData(candleAt(BASE + 11 * HOUR, 11));
    close(chart.scale.indexToX(11) - chart.scale.indexToX(10), bs);
    chart.destroy();
  });

  it('syncs a bare TimeScale directly', () => {
    const scale = new TimeScale(10, 500);
    const sync = new TimeSlotSync(scale);
    sync.sync(gapped(), { continuous: true, intervalMs: null }, 'data');
    assert.deepEqual(Array.from(scale.slots!), GAPPED_SLOTS);
    sync.sync(gapped(), { continuous: false, intervalMs: null }, 'config');
    assert.equal(scale.slots, null);
  });
});

describe('continuous time: toolbar scroll arrows', () => {
  const windows: Window[] = [];
  after(() => { for (const w of windows) void w.happyDOM.close(); });

  function toolbarFor(data: Candle[]) {
    const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
    windows.push(win);
    const doc = win.document;
    const rail = doc.createElement('div');
    const stage = doc.createElement('div');
    const canvasEl = doc.createElement('div');
    Object.defineProperties(canvasEl, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
    stage.append(canvasEl);
    doc.body.append(rail, stage);
    const { chart } = chartFor(data);
    const tb = createDrawingToolbar({
      chart,
      document: doc as unknown as UIDocument,
      canvas: canvasEl as unknown as UIElement,
      rail: rail as unknown as UIElement,
      overlay: stage as unknown as UIElement,
      storage: null,
      scheduler: new Frames(),
    });
    chart.scale.zoom(0.5);
    const [left, right] = [...doc.querySelectorAll('.cts-scroll')];
    const visible = () => {
      tb.refreshViewport();
      return [left!.classList.contains('cts-visible'), right!.classList.contains('cts-visible')];
    };
    return { chart, tb, visible };
  }

  it('uses bar spacing to decide when the chart is compressed', () => {
    // The first candle sits a weekend before the rest, so bars 0 and 1 are 48 slots apart.
    const data = [candleAt(BASE, 0), ...hourly(2000).map((c, i) => candleAt(c.time + 48 * HOUR, i + 1))];
    const { chart, tb, visible } = toolbarFor(data);
    assert.ok(chart.scale.indexToX(1) - chart.scale.indexToX(0) > 100);
    assert.deepEqual(visible(), [true, false]);
    tb.destroy();
    chart.destroy();
  });

  it('shows an arrow while candles lie beyond a gap on that side', () => {
    // A lone first candle a weekend before 2000 hourly candles, and a lone last one 1000 hours after.
    const data = [candleAt(BASE, 0), ...hourly(2000).map((c, i) => candleAt(c.time + 48 * HOUR, i + 1))];
    data.push(candleAt(data.at(-1)!.time + 1000 * HOUR, 2001));
    const { chart, tb, visible } = toolbarFor(data);
    // Inside the wide gap before the last candle, the right arrow still leads to it.
    chart.scale.scrollTo(2000);
    chart.scale.scrollBy(-500);
    assert.deepEqual(chart.scale.visibleRange(), { from: 2000, to: 2002 });
    assert.deepEqual(visible(), [true, true]);
    // With the left edge in the gap after the first candle, the left arrow stays until it is reached.
    const bs = chart.scale.barSpacing();
    chart.scale.scrollBy(1e9);
    chart.scale.scrollBy(-(chart.scale.indexToX(0) / bs + 3));
    close(chart.scale.indexToX(0), -3 * bs);
    assert.equal(chart.scale.visibleRange().from, 1);
    assert.deepEqual(visible(), [true, true]);
    chart.scale.scrollBy(1e9);
    assert.deepEqual(visible(), [false, true]);
    tb.destroy();
    chart.destroy();
  });
});
