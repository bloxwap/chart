/**
 * Regressions from the whole-diff core audit:
 *
 * - P0.1 crosshair events: the payload is diffed against the last delivered
 *   event, not just the pointer position. A still pointer re-emits when the
 *   bar or price under it changes: a live tick on the hovered bar, a scroll
 *   or zoom, prepended history, a data swap, a Heikin Ashi recompute.
 * - `appendData` with a candle older than the first goes in front like
 *   `prependData`: it is reported as `'prepend'`, and index-based drawings,
 *   the draft, the drawing controller and undo history move with their bars.
 *   A candle between existing bars stays an `'append'` with `lastTime`
 *   unchanged.
 * - MACD's histogram style rows are named for the sign they color.
 *
 * MA Ribbon's f64 computation with kernels loaded is covered in
 * indicators-studies.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChart,
  heikinAshi,
  macdIndicator,
  type Chart,
  type ChartConfig,
  type CrosshairMoveEvent,
  type DataLoadEvent,
  type DeepPartial,
} from '../dist/index.js';
import type { Candle } from '../dist/core/data.js';
import { MockCanvas } from '../dist/dom.js';
import { DrawingController } from '../dist/ui/index.js';

const T0 = 1_700_000_040;
const MIN = 60;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** A wavy one-minute bar; negative `i` is older history. */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 5) * 6;
  return { time: T0 + i * MIN, open: base, high: base + 3, low: base - 3, close: base + 1, volume: 10 + Math.abs(i) };
}
const bars = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, k) => bar(from + k));

function mount(config: DeepPartial<ChartConfig> = {}, data = bars(0, 200)): Chart {
  return createChart({ container: new MockCanvas(800, 500), config: { wasm: false, data, ...config } });
}

function record<T>(subscribe: (cb: (e: T) => void) => () => void): T[] {
  const events: T[] = [];
  subscribe((e) => events.push(e));
  return events;
}
const moves = (chart: Chart) => record<CrosshairMoveEvent>((cb) => chart.subscribeCrosshairMove(cb));
const loads = (chart: Chart) => record<DataLoadEvent>((cb) => chart.subscribeDataLoad(cb));

/** The bar the chart draws under canvas x (the status line's reading). */
const under = (chart: Chart, x: number): number =>
  Math.min(chart.dataLength - 1, Math.max(0, Math.round(chart.scale.xToIndex(x))));

/** Asserts `e` names the bar under its pointer, as currently loaded. */
function assertCurrent(chart: Chart, e: CrosshairMoveEvent): void {
  const index = under(chart, e.x);
  assert.equal(e.index, index);
  assert.equal(e.candle, chart.getData()[index]);
  assert.equal(e.time, chart.getData()[index]!.time);
  close(e.price!, chart.scale.yToPrice(e.y), 1e-9);
}

describe('audit-core: crosshair events follow what is under a still pointer', () => {
  it('a live tick on the hovered bar re-reports its OHLCV; one elsewhere stays quiet', () => {
    const data = bars(0, 200);
    const chart = mount({}, data);
    const events = moves(chart);
    const x = chart.scale.indexToX(199);
    chart.setCrosshair(x, 200);
    assert.equal(events.length, 1);
    const tick = { ...data[199]!, close: data[199]!.close + 0.5 }; // inside the bar's range: the axis holds
    chart.appendData(tick);
    assert.equal(events.length, 2);
    const e = events[1]!;
    assert.deepEqual([e.x, e.y, e.index, e.time, e.price], [x, 200, 199, tick.time, events[0]!.price]);
    assert.equal(e.candle, tick);
    assert.equal(e.displayCandle, tick);
    // Several ticks in one batch: one event, with the last of them.
    const ticks = [0.6, 0.7, 0.8].map((d) => ({ ...data[199]!, close: data[199]!.close + d }));
    chart.batch(() => { for (const t of ticks) chart.appendData(t); });
    assert.equal(events.length, 3);
    assert.equal(events[2]!.candle, ticks[2]);

    chart.setCrosshair(chart.scale.indexToX(150), 200);
    const count = events.length;
    chart.appendData({ ...data[199]!, close: data[199]!.close + 0.2 });
    chart.render();
    chart.refreshOverlay();
    assert.equal(events.length, count, 'bar 150 and the axis did not change');
    assertCurrent(chart, events.at(-1)!);
    chart.destroy();
  });

  it('scrolling and zooming report the bar that moved under the pointer', () => {
    const chart = mount();
    const events = moves(chart);
    chart.setCrosshair(400, 200);
    const first = events[0]!.index!;
    chart.scale.scrollBy(10);
    assert.equal(events.length, 2);
    assert.equal(events[1]!.index, first - 10);
    assertCurrent(chart, events[1]!);
    chart.scale.zoom(2, 100);
    assert.equal(events.length, 3);
    assert.notEqual(events[2]!.index, events[1]!.index);
    assertCurrent(chart, events[2]!);
    chart.setCrosshair(400, 200);
    assert.equal(events.length, 3, 'the same position again changes nothing');
    chart.destroy();
  });

  it('prepended history re-indexes the hovered bar; a data swap replaces it', () => {
    const data = bars(0, 200);
    const chart = mount({}, data);
    const events = moves(chart);
    const x = chart.scale.indexToX(150);
    chart.setCrosshair(x, 200);
    chart.prependData(bars(-50, 0));
    assert.equal(events.length, 2);
    const shifted = events[1]!;
    assert.deepEqual([shifted.index, shifted.time], [200, data[150]!.time], 'the same bar, 50 indices later');
    assert.equal(shifted.candle, data[150]);
    assertCurrent(chart, shifted);
    chart.setData(bars(1000, 1200));
    assert.equal(events.length, 3);
    assertCurrent(chart, events[2]!);
    assert.equal(events[2]!.time, bar(1000 + events[2]!.index!).time);
    chart.destroy();
  });

  it('a Heikin Ashi series re-reports the recomputed display bar', () => {
    const data = bars(0, 200);
    const chart = mount({ series: { type: 'heikin-ashi' } }, data);
    const events = moves(chart);
    chart.setCrosshair(chart.scale.indexToX(199), 200);
    chart.appendData({ ...data[199]!, open: data[199]!.open - 1 });
    assert.equal(events.length, 2);
    const e = events[1]!;
    assert.equal(e.candle, chart.getData()[199]);
    assert.deepEqual(e.displayCandle, heikinAshi(chart.getData())[199]);
    assert.notDeepEqual(e.displayCandle, events[0]!.displayCandle);
    chart.destroy();
  });

  it('a hidden crosshair stays quiet through scrolls and data changes', () => {
    const chart = mount();
    const events = moves(chart);
    chart.setCrosshair(400, 200);
    chart.clearCrosshair();
    assert.equal(events.length, 2);
    chart.scale.scrollBy(10);
    chart.appendData(bar(200));
    chart.prependData(bars(-10, 0));
    assert.equal(events.length, 2);
    assert.equal(events[1]!.active, false);
    chart.destroy();
  });
});

describe('audit-core: appendData older than the first candle', () => {
  it('goes in front like prependData: a prepend event, and drawings and the view stay on their bars', () => {
    const data = bars(0, 200);
    const chart = mount({}, data);
    const seen = loads(chart);
    const text = chart.addDrawing({ name: 'text', points: [{ index: 50, price: 100 }], text: 'x' });
    const right = chart.scale.visibleRange().to - 1;
    const x = chart.scale.indexToX(right);
    const older = bar(-1);
    chart.appendData(older);
    assert.deepEqual(seen, [{ reason: 'prepend', length: 201, added: 1, firstTime: older.time, lastTime: data[199]!.time }]);
    assert.equal(chart.getData()[0], older);
    assert.equal(chart.getDrawing(text)!.points[0]!.index, 51);
    assert.equal(chart.getData()[51], data[50]);
    close(chart.scale.indexToX(right + 1), x);
    chart.destroy();
  });

  it('keeps a drawing being placed and undo snapshots on their bars', () => {
    const chart = mount({}, bars(0, 300));
    const controller = new DrawingController(chart);
    const line = chart.addDrawing({ id: 'line', name: 'trendline', points: [{ index: 10, price: 100 }, { index: 20, price: 110 }] });
    controller.history.checkpoint();
    chart.moveDrawingPoint(line, 0, { index: 15, price: 100 });
    const y = chart.scale.priceToY(100);
    const x0 = chart.scale.indexToX(250), x1 = chart.scale.indexToX(270);
    controller.arm('trendline');
    controller.pointerDown(x0, y);
    controller.pointerUp(x0, y);
    chart.appendData(bar(-1));
    controller.pointerDown(x1, y);
    controller.pointerUp(x1, y);
    assert.deepEqual(chart.getConfig().drawings.at(-1)!.points.map((p) => p.index), [251, 271]);
    controller.undo(); // the new trendline
    controller.undo(); // the moved point
    assert.deepEqual(chart.getDrawing('line')!.points, [{ index: 11, price: 100 }, { index: 21, price: 110 }]);
    controller.dispose();
    chart.destroy();
  });

  it('re-pins the right edge on a continuous time axis', () => {
    const chart = mount({ timeScale: { continuous: true, intervalMs: MIN * 1000 } });
    chart.scale.scrollBy(20);
    const right = chart.scale.visibleRange().to - 1;
    const x = chart.scale.indexToX(right);
    chart.appendData(bar(-30)); // across a 29-bar gap
    close(chart.scale.indexToX(right + 1), x);
    assert.equal(chart.scale.visibleSlots().length, 230);
    chart.destroy();
  });

  it('a candle between bars stays an append with lastTime unchanged; the first time is an update', () => {
    const data = [...bars(0, 100), ...bars(101, 200)];
    const chart = mount({}, data);
    const seen = loads(chart);
    chart.appendData(bar(100));
    chart.appendData({ ...data[0]!, close: 99 });
    assert.deepEqual(seen, [
      { reason: 'append', length: 200, added: 1, firstTime: data[0]!.time, lastTime: data[198]!.time },
      { reason: 'update', length: 200, added: 0, firstTime: data[0]!.time, lastTime: data[198]!.time },
    ]);
    chart.destroy();
    const empty = mount({}, []);
    const first = loads(empty);
    empty.appendData(bar(0));
    assert.equal(first[0]!.reason, 'append');
    empty.destroy();
  });
});

describe('audit-core: MACD histogram style rows', () => {
  it('are named for the sign they color, growing or shrinking', () => {
    assert.deepEqual(macdIndicator.styles!.filter((s) => s.key === 'hist').map((s) => [s.label, s.colorIndex]),
      [['Histogram positive', 2], ['Histogram negative', 3]]);
    const out = macdIndicator.compute(bars(0, 200), { fast: 3, slow: 6, signal: 3 }, ['a', 'b', 'pos', 'neg'], null);
    const { values, up, upColor, downColor } = out.bars!;
    assert.deepEqual([upColor, downColor], ['pos', 'neg']);
    const hist = values as number[];
    const shrinkingPositive = hist.findIndex((v, i) => i > 6 && v > 0 && v < hist[i - 1]!);
    const growingNegative = hist.findIndex((v, i) => i > 6 && v < 0 && v > hist[i - 1]!);
    assert.ok(shrinkingPositive > 0 && growingNegative > 0);
    assert.deepEqual([up![shrinkingPositive], up![growingNegative]], [true, false]);
  });
});
