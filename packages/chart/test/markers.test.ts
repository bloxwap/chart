import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, drawMarkers, firstMarkerAtOrAfter, MARKER_MAX_SIZE, MARKER_MIN_SIZE, type SeriesMarker } from '../dist/index.js';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig, type SeriesType } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import type { RenderView } from '../dist/render/renderer.js';

const T0 = 1000;
const STEP = 60;

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: T0 + i * STEP, open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i,
  }));
}

/** Records the fill color at each fill and caption. */
class Recorder extends MockContext2D {
  readonly paints: { op: string; style: string; args: unknown[] }[] = [];
  override fill(): void { super.fill(); this.paints.push({ op: 'fill', style: String(this.fillStyle), args: [] }); }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.paints.push({ op: 'fillText', style: String(this.fillStyle), args: [text, x, y] });
  }
}

interface ViewOptions {
  data?: Candle[];
  barSpacing?: number;
  width?: number;
  scroll?: number;
  type?: SeriesType;
  liveCandle?: Candle;
}

function makeView(markers: readonly SeriesMarker[] | undefined, options: ViewOptions = {}): { view: RenderView; scale: PriceScale } {
  const data = options.data ?? candles(20);
  const timeScale = new TimeScale(options.barSpacing ?? 10, options.width ?? 200);
  timeScale.scrollOffset = options.scroll ?? 0;
  const scale = new PriceScale();
  scale.height = 300;
  scale.setRange(90, 130);
  const config = resolveConfig({ series: { type: options.type ?? 'candlestick' } });
  const view: RenderView = {
    canvasWidth: 264, canvasHeight: 324, plotWidth: options.width ?? 200, plotHeight: 300, pixelRatio: 1,
    candles: data, range: timeScale.visibleRange(data.length), timeScale,
    panes: [{ layout: { id: 'main', kind: 'main', weight: 3, y: 0, height: 300 }, priceScale: scale, indicators: [] }],
    config, drawings: [], crosshair: { active: false, x: 0, y: 0 },
    ...(markers !== undefined ? { markers } : {}),
    ...(options.liveCandle !== undefined ? { liveCandle: options.liveCandle } : {}),
  };
  return { view, scale };
}

const at = (bar: number, extra = 0): number => T0 + bar * STEP + extra;

function near(actual: unknown, expected: number, message?: string): void {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, message ?? `${String(actual)} ≈ ${expected}`);
}

function nearAll(actual: readonly unknown[], expected: readonly number[], message?: string): void {
  assert.equal(actual.length, expected.length, message);
  expected.forEach((value, i) => near(actual[i], value, message));
}

describe('drawMarkers geometry', () => {
  it('places each shape above the high, below the low and on the close', () => {
    const { view, scale } = makeView([
      { time: at(5), position: 'aboveBar', color: '#aa0000', shape: 'circle' },
      { time: at(6), position: 'belowBar', color: '#00aa00', shape: 'square' },
      { time: at(7), position: 'inBar', color: '#0000aa', shape: 'arrowUp' },
      { time: at(8), position: 'aboveBar', color: '#aaaa00', shape: 'arrowDown' },
    ]);
    const ctx = new Recorder();
    drawMarkers(ctx, view, scale);
    const box = MARKER_MIN_SIZE; // barSpacing 10 clamps up to the minimum
    const margin = 3;
    const x = (bar: number): number => view.timeScale.indexToX(bar, 20);
    // Circle: 0.8 of the box, above the high.
    const circle = box * 0.8;
    assert.deepEqual(ctx.callsNamed('ellipse'), [
      ['ellipse', x(5), scale.priceToY(107) - margin - circle / 2, circle / 2, circle / 2, 0, 0, Math.PI * 2],
    ]);
    // Square: 0.7 of the box, below the low.
    const square = box * 0.7;
    const sy = scale.priceToY(104) + margin + square / 2;
    assert.deepEqual(ctx.callsNamed('rect'), [['rect', x(6) - square / 2, sy - square / 2, square, square]]);
    // Arrows: full box. arrowUp centered on the close points up; arrowDown points down.
    const moves = ctx.callsNamed('moveTo');
    assert.deepEqual(moves[0], ['moveTo', x(7), scale.priceToY(108) - box / 2]);
    const downY = scale.priceToY(110) - margin - box / 2;
    assert.deepEqual(moves[1], ['moveTo', x(8), downY + box / 2]);
    assert.equal(ctx.countCalls('closePath'), 2);
    assert.equal(ctx.countCalls('lineTo'), 12);
    assert.deepEqual(ctx.paints.map((p) => p.style), ['#aa0000', '#00aa00', '#0000aa', '#aaaa00']);
    assert.equal(ctx.countCalls('save'), 1);
    assert.equal(ctx.countCalls('restore'), 1);
  });

  it('stacks markers per bar and position with captions beyond the glyph', () => {
    const { view, scale } = makeView([
      { time: at(4), position: 'aboveBar', color: '#a1', shape: 'circle' },
      { time: at(4, 10), position: 'aboveBar', color: '#a2', shape: 'circle', text: 'B' },
      { time: at(4, 20), position: 'belowBar', color: '#b1', shape: 'circle', text: '' },
      { time: at(4, 30), position: 'belowBar', color: '#b2', shape: 'circle', text: 'S' },
      { time: at(4, 40), position: 'inBar', color: '#c1', shape: 'circle' },
      { time: at(4, 50), position: 'inBar', color: '#c2', shape: 'circle', size: 2, text: 'L' },
      { time: at(5), position: 'aboveBar', color: '#d1', shape: 'circle' },
    ]);
    const ctx = new Recorder();
    drawMarkers(ctx, view, scale);
    const fontSize = 12;
    const unit = MARKER_MIN_SIZE;
    const d = unit * 0.8, margin = 3;
    const ys = ctx.callsNamed('ellipse').map((c) => c[2] as number);
    const high = scale.priceToY(106), low = scale.priceToY(102), close = scale.priceToY(105);
    const big = unit * 2 * 0.8, bigMargin = Math.max(unit * 2 * 0.1, 3);
    const bigBottom = close + d / 2 - (d + margin);
    nearAll(ys, [
      high - margin - d / 2,
      high - margin - (d + margin) - d / 2,
      low + margin + d / 2,
      low + margin + (d + margin) + d / 2,
      close, // the first in-bar glyph centers on the close
      bigBottom - big / 2,
      scale.priceToY(107) - margin - d / 2, // a new bar restarts its stacks
    ]);
    const texts = ctx.paints.filter((p) => p.op === 'fillText');
    const x = view.timeScale.indexToX(4, 20);
    assert.deepEqual(texts.map((t) => [t.style, t.args[0], t.args[1]]), [['#a2', 'B', x], ['#b2', 'S', x], ['#c2', 'L', x]]);
    nearAll(texts.map((t) => t.args[2]), [
      high - margin - (d + margin) - d - margin - fontSize / 2,
      low + margin + (d + margin) + d + margin + fontSize / 2,
      bigBottom - big - bigMargin - fontSize / 2,
    ]);
    assert.ok(ctx.calls.some((c) => c[0] === 'set:font' && c[1] === '12px system-ui, sans-serif'));
  });

  it('anchors line and area markers at the close and follows the live candle', () => {
    for (const type of ['line', 'area'] as const) {
      const { view, scale } = makeView([
        { time: at(3), position: 'aboveBar', color: '#fff', shape: 'square' },
        { time: at(3), position: 'belowBar', color: '#fff', shape: 'square' },
      ], { type });
      const ctx = new MockContext2D();
      drawMarkers(ctx, view, scale);
      const close = scale.priceToY(104), s = MARKER_MIN_SIZE * 0.7;
      nearAll(ctx.callsNamed('rect').map((c) => c[2]), [close - 3 - s, close + 3], type);
    }
    const live: Candle = { time: at(19), open: 119, high: 125, low: 95, close: 120 };
    const { view, scale } = makeView([
      { time: at(18), position: 'aboveBar', color: '#fff', shape: 'square' },
      { time: at(19), position: 'aboveBar', color: '#fff', shape: 'square' },
    ], { liveCandle: live });
    const ctx = new MockContext2D();
    drawMarkers(ctx, view, scale);
    const s = MARKER_MIN_SIZE * 0.7;
    nearAll(ctx.callsNamed('rect').map((c) => c[2]), [scale.priceToY(120) - 3 - s, scale.priceToY(125) - 3 - s]);
  });

  it('keeps aboveBar and belowBar glyphs off the bar on an inverted scale', () => {
    for (const inverted of [false, true]) {
      const { view, scale } = makeView([
        { time: at(5), position: 'aboveBar', color: '#fff', shape: 'square', text: 'A' },
        { time: at(5), position: 'aboveBar', color: '#fff', shape: 'square' },
        { time: at(5), position: 'belowBar', color: '#fff', shape: 'square', text: 'B' },
        { time: at(5), position: 'belowBar', color: '#fff', shape: 'square' },
      ]);
      scale.inverted = inverted;
      const ctx = new MockContext2D();
      drawMarkers(ctx, view, scale);
      const highY = scale.priceToY(107), lowY = scale.priceToY(103);
      assert.equal(highY > lowY, inverted, 'the high is the bottom edge only when inverted');
      const top = Math.min(highY, lowY), bottom = Math.max(highY, lowY);
      const s = MARKER_MIN_SIZE * 0.7, margin = 3, step = s + margin;
      const ys = ctx.callsNamed('rect').map((c) => c[2] as number);
      nearAll(ys, [top - margin - s, top - margin - (step + 12 + margin) - s, bottom + margin, bottom + margin + step + 12 + margin],
        `inverted ${inverted}`);
      for (const y of ys) assert.ok(y + s <= top || y >= bottom, `glyph at ${y} stays off the bar [${top}, ${bottom}]`);
      const texts = ctx.callsNamed('fillText').map((c) => c[3] as number);
      nearAll(texts, [top - margin - s - margin - 6, bottom + margin + s + margin + 6], `captions, inverted ${inverted}`);
    }
  });

  it('clamps negative sizes to nothing and treats non-finite sizes as 1', () => {
    /** Throws like a real canvas does for a negative ellipse radius. */
    class StrictContext extends MockContext2D {
      override ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
        if (rx < 0 || ry < 0) throw new RangeError('IndexSizeError: negative radius');
        super.ellipse(x, y, rx, ry, rotation, start, end);
      }
    }
    const { view, scale } = makeView([
      { time: at(5), position: 'aboveBar', color: '#fff', shape: 'circle', size: -1 },
      { time: at(5), position: 'aboveBar', color: '#fff', shape: 'circle', size: 0 },
      { time: at(5), position: 'aboveBar', color: '#fff', shape: 'circle', size: Number.NaN },
      { time: at(5), position: 'aboveBar', color: '#fff', shape: 'circle', size: Number.POSITIVE_INFINITY },
      { time: at(6), position: 'belowBar', color: '#fff', shape: 'square', size: -2 },
    ]);
    const ctx = new StrictContext();
    drawMarkers(ctx, view, scale);
    const d = MARKER_MIN_SIZE * 0.8, margin = 3, high = scale.priceToY(107);
    const ellipses = ctx.callsNamed('ellipse');
    assert.deepEqual(ellipses.map((c) => c[3]), [0, 0, d / 2, d / 2], 'radii: clamped, clamped, default, default');
    // Empty glyphs still take their margin in the stack; later glyphs stay finite.
    nearAll(ellipses.map((c) => c[2]), [
      high - margin, high - 2 * margin, high - 3 * margin - d / 2, high - 3 * margin - (d + margin) - d / 2,
    ]);
    assert.deepEqual(ctx.callsNamed('rect').map((c) => [c[3], c[4]]), [[0, 0]]);
  });

  it('scales glyphs with bar spacing between the size bounds', () => {
    for (const [spacing, box] of [[20, 20], [80, MARKER_MAX_SIZE], [2, MARKER_MIN_SIZE]] as const) {
      const { view, scale } = makeView([{ time: at(19), position: 'inBar', color: '#fff', shape: 'square' }],
        { barSpacing: spacing });
      const ctx = new MockContext2D();
      drawMarkers(ctx, view, scale);
      assert.equal(ctx.callsNamed('rect')[0]?.[3], box * 0.7, `spacing ${spacing}`);
    }
  });
});

describe('drawMarkers snapping and culling', () => {
  it('snaps to the last candle at or before the marker and drops markers before the data', () => {
    const { view, scale } = makeView([
      { time: T0 - 1, position: 'inBar', color: '#fff', shape: 'circle' },
      { time: at(2, 59), position: 'inBar', color: '#fff', shape: 'circle' },
      { time: at(19, 10_000), position: 'inBar', color: '#fff', shape: 'circle' },
    ]);
    const ctx = new MockContext2D();
    drawMarkers(ctx, view, scale);
    assert.deepEqual(ctx.callsNamed('ellipse').map((c) => c[1]), [view.timeScale.indexToX(2, 20), view.timeScale.indexToX(19, 20)]);
  });

  it('draws only markers near the visible range and visits only those', () => {
    const data = candles(2000);
    const all: SeriesMarker[] = data.map((c) => ({ time: c.time, position: 'aboveBar', color: '#fff', shape: 'circle' }));
    let reads = 0;
    const counted = new Proxy(all, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const { view, scale } = makeView(counted, { data, scroll: 700 });
    const ctx = new MockContext2D();
    drawMarkers(ctx, view, scale);
    const { from, to } = view.range;
    assert.ok(from > 0 && to < data.length);
    // Reach: two glyph boxes plus 8em of caption, 24 + 96 = 120px = 12 bars at 10px.
    const reach = 12;
    const xs = ctx.callsNamed('ellipse').map((c) => c[1] as number);
    assert.equal(xs.length, to - from + 2 * reach);
    assert.equal(xs[0], view.timeScale.indexToX(from - reach, data.length));
    assert.equal(xs.at(-1), view.timeScale.indexToX(to - 1 + reach, data.length));
    const first = view.timeScale.indexToX(from, data.length), last = view.timeScale.indexToX(to - 1, data.length);
    for (const x of xs) assert.ok(x >= first - 120 && x <= last + 120, `${x} is within 120px of the visible bars`);
    assert.ok(reads < 2 * xs.length + 4 * Math.log2(all.length), `${reads} reads for ${xs.length} markers`);
  });

  it('paints markers of bars just past either edge so captions slide in', () => {
    const data = candles(400);
    const { view, scale } = makeView([], { data, barSpacing: 6, width: 300, scroll: 100 });
    const { from, to } = view.range;
    const markers: SeriesMarker[] = [
      { time: data[from - 40]!.time, position: 'aboveBar', color: '#f00', shape: 'circle', text: 'Liquidation' },
      { time: data[from - 1]!.time, position: 'aboveBar', color: '#0f0', shape: 'circle', text: 'Liquidation' },
      { time: data[to]!.time, position: 'aboveBar', color: '#00f', shape: 'circle', text: 'Liquidation' },
      { time: data[to + 40]!.time, position: 'aboveBar', color: '#ff0', shape: 'circle', text: 'Liquidation' },
    ];
    const ctx = new Recorder();
    drawMarkers(ctx, { ...view, markers }, scale);
    const x = (bar: number): number => view.timeScale.indexToX(bar, data.length);
    assert.ok(x(from - 1) < 0 && x(to) > view.plotWidth, 'both neighbours sit outside the plot');
    assert.deepEqual(ctx.paints.filter((p) => p.op === 'fillText').map((p) => [p.style, p.args[1]]),
      [['#0f0', x(from - 1)], ['#00f', x(to)]], 'only bars within reach paint; the clip crops them');
  });

  it('draws nothing without markers, bars or visible markers', () => {
    const cases: RenderView[] = [
      makeView(undefined).view,
      makeView([]).view,
      makeView([{ time: T0, position: 'inBar', color: '#fff', shape: 'circle' }], { data: [] }).view,
      makeView([{ time: T0, position: 'inBar', color: '#fff', shape: 'circle' }], { data: candles(200) }).view,
      makeView([{ time: at(150), position: 'inBar', color: '#fff', shape: 'circle' }], { data: candles(200), scroll: 100 }).view,
    ];
    for (const [i, view] of cases.entries()) {
      const ctx = new MockContext2D();
      drawMarkers(ctx, view, view.panes[0]!.priceScale);
      assert.equal(ctx.calls.length, 0, `case ${i}`);
    }
  });

  it('binary-searches the first marker at or after a time', () => {
    const list = [1, 3, 3, 5].map((time): SeriesMarker => ({ time, position: 'inBar', color: '#fff', shape: 'circle' }));
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((t) => firstMarkerAtOrAfter(list, t)), [0, 0, 1, 1, 3, 3, 4]);
    assert.equal(firstMarkerAtOrAfter([], 1), 0);
  });
});

describe('chart.series markers', () => {
  it('sorts and copies markers, filters bad times and repaints above the series', () => {
    const ctx = new Recorder();
    const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
    const chart = createChart({ container: canvas, config: { wasm: false, data: candles(60) } });
    const input: SeriesMarker[] = [
      { time: at(50), position: 'aboveBar', color: '#bb0000', shape: 'circle', id: 'b' },
      { time: at(40), position: 'belowBar', color: '#aa0000', shape: 'arrowUp', text: 'buy', id: 'a' },
      { time: Number.NaN, position: 'inBar', color: '#cc0000', shape: 'square' },
    ];
    ctx.calls.length = 0;
    chart.series.setMarkers(input);
    assert.equal(ctx.countCalls('scale'), 1);
    assert.deepEqual(chart.series.markers().map((m) => m.id), ['a', 'b']);
    input[0]!.color = '#000000';
    assert.equal(chart.series.markers()[1]?.color, '#bb0000', 'markers are copied');
    (chart.series.markers() as SeriesMarker[]).length = 0;
    assert.equal(chart.series.markers().length, 2);
    // Elements are copies too: mutating one cannot unsort the stored markers.
    chart.series.markers()[0]!.time = 1e12;
    assert.deepEqual(chart.series.markers().map((m) => m.time), [at(40), at(50)]);
    const ellipse = ctx.calls.findIndex((c) => c[0] === 'ellipse');
    let lastCandle = -1;
    ctx.calls.forEach((c, i) => { if (c[0] === 'fillRect' && i < ellipse) lastCandle = i; });
    assert.ok(lastCandle > 0 && ellipse > lastCandle, 'markers paint after the candles');
    assert.deepEqual(ctx.callsNamed('ellipse')[0]?.[1], chart.scale.indexToX(50));
    assert.deepEqual(ctx.callsNamed('fillText').find((c) => c[1] === 'buy')?.[2], chart.scale.indexToX(40));
    // Markers are not drawings.
    chart.clearDrawings();
    chart.setDrawingsHidden(true);
    ctx.calls.length = 0;
    chart.render();
    assert.equal(ctx.countCalls('ellipse'), 1);
    chart.series.setMarkers([]);
    assert.equal(chart.series.markers().length, 0);
    chart.destroy();
  });
});
