/**
 * Integration: every Wave 1 feature on ONE chart, under the recording
 * MockCanvas/MockDocument stand-ins. The chart mounts through an injected
 * document with the bloxwapDark preset (scale fonts, volume overlay, status
 * line), Heikin Ashi bars on a time-continuous axis with a weekend gap, price
 * lines (mark, last, an autoscaled target and an off-screen one), markers
 * (one inside the gap), Ichimoku with custom lengths, Supertrend, VWAP with
 * bands, Stoch and MACD in sub-panes, a MACD restyle through updateIndicator,
 * the three chart event streams, the bar-close countdown (status line, axis
 * badge and ticker) and snapshots with a watermark.
 *
 * Each step checks that the frame is coherent: no non-finite coordinate in
 * any recorded call, event payloads that agree with the scale and the
 * displayed bars, and an autoscale that frames the bars, the overlays and
 * the autoscaled price line but ignores the off-screen one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChart,
  heikinAshi,
  scaleFont,
  type Chart,
  type CrosshairMoveEvent,
  type DataLoadEvent,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { startCountdownTicker } from '../dist/ui/index.js';
import { MockCanvas, MockContext2D, type ChartCanvas, type ChartDocument, type RecordedCall } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

const HOUR = 3600;
const HOUR_MS = HOUR * 1000;
/** A UTC hour boundary, in seconds. */
const T0 = 1_700_002_800;
const N = 150;
/** Bars from here on sit {@link GAP_HOURS} later: a weekend. */
const GAP_AT = 100;
const GAP_HOURS = 48;
const WIDTH = 960;
const HEIGHT = 640;

/** A wavy hourly bar, so Heikin Ashi values differ from the real ones and VWAP sees changing volume. */
function bar(i: number, time = T0 + (i < GAP_AT ? i : i + GAP_HOURS) * HOUR): Candle {
  const base = 100 + Math.sin(i / 6) * 10 + i * 0.05;
  const open = base;
  const close = base + Math.cos(i / 2) * 2;
  return { time, open, close, high: Math.max(open, close) + 1.5, low: Math.min(open, close) - 1.5, volume: 100 + ((i * 37) % 50) };
}

type Point = readonly [number, number];
type Op =
  | { readonly kind: 'stroke'; readonly color: string; readonly width: number; readonly alpha: number; readonly points: readonly Point[] }
  | { readonly kind: 'fill'; readonly color: string; readonly alpha: number; readonly points: readonly Point[] }
  | { readonly kind: 'rect'; readonly color: string; readonly alpha: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'text'; readonly color: string; readonly alpha: number; readonly font: string; readonly text: string; readonly x: number; readonly y: number };
type Text = Extract<Op, { kind: 'text' }>;
type Rect = Extract<Op, { kind: 'rect' }>;
type Stroke = Extract<Op, { kind: 'stroke' }>;

/**
 * A MockContext2D that also records paint ops with the style in effect and
 * canvas CSS coordinates (translations applied; the pixel-ratio scale is
 * not), and restores paint state like a browser context does.
 */
class Rec extends MockContext2D {
  readonly ops: Op[] = [];
  private path: Point[] = [];
  private tx = 0;
  private ty = 0;
  private readonly stack: { tx: number; ty: number; fill: string | object; stroke: string | object; width: number; alpha: number }[] = [];

  override save(): void {
    super.save();
    this.stack.push({ tx: this.tx, ty: this.ty, fill: this.fillStyle, stroke: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
  }
  override restore(): void {
    super.restore();
    const state = this.stack.pop();
    if (state === undefined) return;
    ({ tx: this.tx, ty: this.ty, width: this.lineWidth, alpha: this.globalAlpha } = state);
    this.fillStyle = state.fill as string;
    this.strokeStyle = state.stroke as string;
  }
  override translate(x: number, y: number): void {
    super.translate(x, y);
    this.tx += x;
    this.ty += y;
  }
  override beginPath(): void {
    super.beginPath();
    this.path = [];
  }
  override moveTo(x: number, y: number): void {
    super.moveTo(x, y);
    this.path.push([x + this.tx, y + this.ty]);
  }
  override lineTo(x: number, y: number): void {
    super.lineTo(x, y);
    this.path.push([x + this.tx, y + this.ty]);
  }
  override stroke(): void {
    super.stroke();
    this.ops.push({ kind: 'stroke', color: String(this.strokeStyle), width: this.lineWidth, alpha: this.globalAlpha, points: [...this.path] });
  }
  override fill(): void {
    super.fill();
    this.ops.push({ kind: 'fill', color: String(this.fillStyle), alpha: this.globalAlpha, points: [...this.path] });
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.ops.push({ kind: 'rect', color: String(this.fillStyle), alpha: this.globalAlpha, x: x + this.tx, y: y + this.ty, w, h });
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.ops.push({ kind: 'text', color: String(this.fillStyle), alpha: this.globalAlpha, font: this.font, text, x: x + this.tx, y: y + this.ty });
  }
  /** Forgets everything recorded so far (the paint state is kept). */
  reset(): void {
    this.calls.length = 0;
    this.ops.length = 0;
  }
  texts(): Text[] {
    return this.ops.filter((o): o is Text => o.kind === 'text');
  }
  rects(): Rect[] {
    return this.ops.filter((o): o is Rect => o.kind === 'rect');
  }
  strokes(): Stroke[] {
    return this.ops.filter((o): o is Stroke => o.kind === 'stroke');
  }
}

class RecCanvas extends MockCanvas {
  override readonly context: Rec = new Rec();
}

/** An injected document whose canvases record paint ops. */
class RecDocument implements ChartDocument {
  readonly created: RecCanvas[] = [];
  createCanvas(width: number, height: number): ChartCanvas {
    const canvas = new RecCanvas(width, height);
    this.created.push(canvas);
    return canvas;
  }
}

/** Fails on the first non-finite number in any recorded call (arrays such as dash patterns included). */
function assertFinite(calls: readonly RecordedCall[], label: string): void {
  assert.ok(calls.length > 0, `${label}: something was painted`);
  for (const [at, call] of calls.entries()) {
    const numbers = call.slice(1).flatMap((arg) => (Array.isArray(arg) ? arg : [arg])).filter((arg) => typeof arg === 'number');
    assert.ok(numbers.every(Number.isFinite), `${label}: call #${at} ${call[0]}(${call.slice(1).join(', ')}) has a non-finite argument`);
  }
}

const near = (a: number, b: number, eps = 1e-6, label = '') => assert.ok(Math.abs(a - b) <= eps, `${label} ${a} ≉ ${b}`);

/** Frames painted since the last reset: full-canvas background fills. */
const paints = (ctx: Rec): number => ctx.rects().filter((r) => r.x === 0 && r.y === 0 && r.w === WIDTH && r.h === HEIGHT).length;

/** Counts `render()` calls, internal ones included (they go through the instance property). */
function countRenders(chart: Chart): { readonly count: number } {
  const counter = { count: 0 };
  const render = chart.render.bind(chart);
  chart.render = () => {
    counter.count++;
    render();
  };
  return counter;
}

function mount() {
  const data = Array.from({ length: N }, (_, i) => bar(i));
  const doc = new RecDocument();
  const clock = { now: (data.at(-1)!.time + 15 * 60) * 1000 };
  const chart = createChart({
    document: doc,
    preset: 'bloxwapDark',
    now: () => clock.now,
    config: {
      wasm: false,
      width: WIDTH,
      height: HEIGHT,
      data,
      series: { type: 'heikin-ashi' },
      timeScale: { continuous: true },
      timeAxis: { intervalMs: HOUR_MS },
      statusLine: { symbol: 'BLOX/USD', countdown: true },
      priceAxis: { labels: { countdown: true } },
    },
  });
  const live = doc.created[0]!.context;
  const events = {
    ranges: [] as VisibleRangeChangeEvent[],
    crosshairs: [] as CrosshairMoveEvent[],
    loads: [] as DataLoadEvent[],
  };
  chart.subscribeVisibleRangeChange((e) => events.ranges.push(e));
  chart.subscribeCrosshairMove((e) => events.crosshairs.push(e));
  chart.subscribeDataLoad((e) => events.loads.push(e));
  return { data, doc, clock, chart, live, events };
}

/** Status-line texts: the left-aligned ones in the top row of the main pane. */
const statusRow = (ctx: Rec, chart: Chart): Text[] =>
  ctx.texts().filter((t) => t.y === 12 && t.x < chart.plotArea.left + chart.plotArea.width);

describe('integration: all Wave 1 features on one chart', () => {
  it('stays coherent through restyles, pointer moves, scrolling, streaming and snapshots', async () => {
    const { data, doc, clock, chart, live, events } = mount();
    const renders = countRenders(chart);
    const fmt = chart.getConfig().formatters.price;
    const ha = heikinAshi(data);
    const top = Math.max(...data.map((c) => c.high));

    // ---- One batched setup: studies, price lines and markers paint once and emit nothing.
    live.reset();
    const setup = chart.batch(() => {
      const ichimoku = chart.addIndicator({ name: 'ichimoku', params: { conversion: 7, base: 22, span: 44, displacement: 22 } });
      const supertrend = chart.addIndicator({ name: 'supertrend', params: { period: 7, multiplier: 2 } });
      const vwap = chart.addIndicator({ name: 'vwap', params: { bands: 1 } });
      const stoch = chart.addIndicator({ name: 'stoch', pane: 'sub' });
      const macd = chart.addIndicator({ name: 'macd' });
      const mark = chart.series.createPriceLine({ price: 101.25, color: '#35b5ff', lineWidth: 1, lineStyle: 'dashed', axisLabelVisible: true, title: 'mark' });
      const last = chart.series.createPriceLine({ price: data.at(-1)!.close, color: 'rgba(255, 255, 255, 0.6)', lineWidth: 1, lineStyle: 'dotted', title: 'last' });
      const target = chart.series.createPriceLine({ price: top + 20, color: '#ffb300', title: 'target', autoscale: true });
      chart.series.createPriceLine({ price: 10_000, color: '#e91e63', title: 'far' });
      chart.series.setMarkers([
        { time: data[140]!.time, position: 'inBar', color: '#fafafa', shape: 'circle', text: 'I' },
        { time: data[96]!.time, position: 'aboveBar', color: '#ffb300', shape: 'arrowDown', text: 'S' },
        // Timed inside the weekend: belongs to the last bar before it.
        { time: data[GAP_AT - 1]!.time + 10 * HOUR, position: 'aboveBar', color: '#e91e63', shape: 'square', text: 'G' },
        { time: data[120]!.time, position: 'belowBar', color: '#35b5ff', shape: 'arrowUp', text: 'B' },
      ]);
      return { ichimoku, supertrend, vwap, stoch, macd, mark, last, target };
    });
    assert.equal(paints(live), 1, 'the batch paints once');
    assert.deepEqual([events.ranges.length, events.crosshairs.length, events.loads.length], [0, 0, 0],
      'adding studies, lines and markers neither moves the range nor loads data');
    assertFinite(live.calls, 'setup frame');

    const { width: plotWidth, height: mainHeight } = chart.plotArea;
    const range = chart.scale.visibleRange();
    assert.ok(range.from <= 90 && range.to === N, `the viewport shows the weekend and the last bar (${range.from}..${range.to})`);

    // Continuous axis: the weekend is 48 empty hourly slots between bars 99 and 100.
    const spacing = chart.scale.barSpacing();
    near(chart.scale.indexToX(GAP_AT) - chart.scale.indexToX(GAP_AT - 1), (GAP_HOURS + 1) * spacing, 1e-9, 'gap width');
    near(chart.scale.indexToX(GAP_AT + 1) - chart.scale.indexToX(GAP_AT), spacing, 1e-9, 'bar spacing after the gap');

    // Autoscale frames the Heikin Ashi bars and the autoscaled target, not the far line.
    let lo = Infinity, hi = -Infinity;
    for (let i = range.from; i < range.to; i++) {
      lo = Math.min(lo, ha[i]!.low);
      hi = Math.max(hi, ha[i]!.high);
    }
    const scaleTop = chart.scale.yToPrice(0);
    const scaleBottom = chart.scale.yToPrice(mainHeight);
    assert.ok(scaleTop >= top + 20 && scaleBottom <= lo, `the scale ${scaleBottom}..${scaleTop} holds ${lo}..${top + 20}`);
    assert.ok(scaleTop - scaleBottom < (top + 20 - lo) * 1.5, 'the far line does not stretch the scale');
    for (const price of [lo, hi, top + 20, 101.25]) {
      const y = chart.scale.priceToY(price);
      assert.ok(y >= 0 && y <= mainHeight, `${price} maps inside the main pane (${y})`);
    }

    // Price lines: title tags in the bloxwapDark scale font, the far one skipped.
    const font = scaleFont(chart.getConfig().theme);
    assert.equal(font, "11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
    const tags = new Map(live.texts().filter((t) => ['mark', 'last', 'target', 'far'].includes(t.text)).map((t) => [t.text, t]));
    assert.deepEqual([...tags.keys()].sort(), ['last', 'mark', 'target']);
    for (const [title, price] of [['mark', 101.25], ['last', data.at(-1)!.close], ['target', top + 20]] as const) {
      const tag = tags.get(title)!;
      assert.equal(tag.font, font);
      near(tag.y, Math.max(19 / 2, Math.min(mainHeight - 19 / 2, chart.scale.priceToY(price))), 1e-9, `${title} tag y`);
    }
    const markLine = live.strokes().find((s) => s.color === '#35b5ff' && s.points.length === 2 && s.points[0]![1] === s.points[1]![1]);
    assert.ok(markLine !== undefined && markLine.points[1]![0] === plotWidth, 'the mark line spans the plot');

    // Status line: symbol, the last Heikin Ashi bar's OHLC, the countdown last; the axis badge too.
    const status = statusRow(live, chart).map((t) => t.text);
    assert.equal(status[0], 'BLOX/USD');
    assert.ok(status.includes(`C ${fmt(ha.at(-1)!.close)}`), `the status line shows the HA close (${status.join(' | ')})`);
    assert.notEqual(fmt(ha.at(-1)!.close), fmt(data.at(-1)!.close));
    assert.equal(status.at(-1), '45:00');
    const badge = live.texts().find((t) => t.text === '45:00' && t.x > plotWidth);
    assert.ok(badge !== undefined && badge.font === font, 'the countdown badge uses the scale font');

    // Volume overlay: one half-opaque column per visible bar at its slot, in the HA direction, on the pane floor.
    const columns = live.rects().filter((r) => r.alpha === 0.5);
    assert.equal(columns.length, range.to - range.from);
    const { upColor, downColor } = chart.getConfig().series;
    for (const [k, column] of columns.entries()) {
      const i = range.from + k;
      assert.equal(column.x + Math.floor(column.w / 2), Math.round(chart.scale.indexToX(i)), `column ${i} x`);
      assert.equal(column.y + column.h, mainHeight, `column ${i} sits on the pane floor`);
      assert.equal(column.color, ha[i]!.close >= ha[i]!.open ? upColor : downColor, `column ${i} color`);
    }

    // Markers anchor on the displayed bars at their slots; the in-gap marker on the bar before the gap.
    const caption = (text: string) => live.texts().find((t) => t.text === text)!;
    assert.equal(caption('S').x, chart.scale.indexToX(96));
    assert.ok(caption('S').y < chart.scale.priceToY(ha[96]!.high));
    assert.equal(caption('G').x, chart.scale.indexToX(GAP_AT - 1));
    assert.equal(caption('B').x, chart.scale.indexToX(120));
    assert.ok(caption('B').y > chart.scale.priceToY(ha[120]!.low));
    assert.equal(caption('I').x, chart.scale.indexToX(140));

    // Studies: custom Ichimoku lengths are kept; every study drew, with the Kumo filled.
    assert.deepEqual(chart.getIndicator(setup.ichimoku)!.params, { conversion: 7, base: 22, span: 44, displacement: 22 });
    const strokeColors = new Set(live.strokes().map((s) => s.color));
    for (const color of ['#a5d6a7', '#ef9a9a', '#2196f3', '#4caf50', '#ff6d00', upColor, downColor]) {
      assert.ok(strokeColors.has(color), `a ${color} study line`);
    }
    assert.ok(live.ops.some((o) => o.kind === 'fill' && o.color === 'rgba(67, 160, 71, 0.1)' || o.kind === 'fill' && o.color === 'rgba(244, 67, 54, 0.1)'), 'the Kumo');

    // ---- updateIndicator restyles MACD: colors recompute, widths only repaint; the frame stays finite.
    const orange = (ctx: Rec) => ctx.strokes().filter((s) => s.color === '#ff6d00').length;
    const orangeBefore = orange(live);
    live.reset();
    const macdColors = ['#ffeb3b', '#00bcd4', '#8bc34a', '#e91e63'];
    assert.equal(chart.updateIndicator(setup.macd, { colors: macdColors, lineWidths: [3] }), true);
    assertFinite(live.calls, 'restyled frame');
    assert.deepEqual(chart.getIndicator(setup.macd)!.colors, macdColors);
    const dif = live.strokes().filter((s) => s.color === '#ffeb3b');
    const dea = live.strokes().filter((s) => s.color === '#00bcd4');
    assert.ok(dif.length > 0 && dif.every((s) => s.width === 3), 'the MACD line takes the new color and width');
    assert.ok(dea.length > 0 && dea.every((s) => s.width === 1), 'the signal line keeps its width');
    assert.equal(orange(live), orangeBefore - dea.length, 'only Stoch still paints the old signal orange');
    const histogram = live.rects().filter((r) => r.color === '#8bc34a' || r.color === '#e91e63');
    assert.ok(histogram.some((r) => r.color === '#8bc34a') && histogram.some((r) => r.color === '#e91e63'), 'histogram in both new colors');
    const difTop = Math.min(...dif.flatMap((s) => s.points.map((p) => p[1])));
    assert.ok(difTop > mainHeight, 'MACD paints below the main pane');
    assert.deepEqual([events.ranges.length, events.loads.length], [0, 0]);

    // ---- Crosshair events agree with the scale, the displayed bars and the status line.
    live.reset();
    chart.setCrosshair(chart.scale.indexToX(120), mainHeight / 2);
    let move = events.crosshairs.at(-1)!;
    assert.equal(events.crosshairs.length, 1);
    assert.equal(move.active, true);
    assert.equal(move.index, 120);
    assert.deepEqual(move.candle, data[120]);
    assert.deepEqual(move.displayCandle, ha[120]);
    assert.equal(move.time, data[120]!.time);
    assert.equal(move.paneId, 'main');
    near(move.price!, chart.scale.yToPrice(mainHeight / 2), 1e-9, 'crosshair price');
    assert.ok(statusRow(live, chart).some((t) => t.text === `C ${fmt(ha[120]!.close)}`), 'the status line prints the hovered HA bar');
    assert.equal(statusRow(live, chart).at(-1)!.text, '45:00', 'the countdown stays last while hovering');
    assertFinite(live.calls, 'crosshair frame');

    // Over the Stoch pane: its id and a finite oscillator price.
    chart.setCrosshair(chart.scale.indexToX(130), mainHeight + 10);
    move = events.crosshairs.at(-1)!;
    assert.equal(move.paneId, setup.stoch);
    assert.ok(Number.isFinite(move.price) && move.price! > -50 && move.price! < 150, `stoch price ${move.price}`);

    // Inside the weekend: the nearest candle on either side, never a fractional index.
    const gapX = (chart.scale.indexToX(GAP_AT - 1) + chart.scale.indexToX(GAP_AT)) / 2;
    chart.setCrosshair(gapX - 30, mainHeight / 3);
    move = events.crosshairs.at(-1)!;
    assert.ok(move.index === GAP_AT - 1 || move.index === GAP_AT, `gap index ${move.index}`);
    assert.deepEqual(move.candle, data[move.index!]);
    assert.deepEqual(move.displayCandle, ha[move.index!]);
    chart.clearCrosshair();
    move = events.crosshairs.at(-1)!;
    assert.deepEqual([move.active, move.index, move.candle, move.displayCandle, move.paneId], [false, null, null, null, null]);
    assert.equal(events.crosshairs.length, 4);
    assert.equal(events.ranges.length, 0, 'pointer moves never report a range change');

    // ---- Scrolling reports one sane range event per move.
    const rangeOk = (e: VisibleRangeChangeEvent, candles: readonly Candle[]) => {
      const length = candles.length;
      const visible = chart.scale.visibleRange();
      assert.deepEqual([e.from, e.to, e.length], [visible.from, visible.to, length]);
      assert.ok(e.from >= 0 && e.from < e.to && e.to <= length);
      assert.deepEqual([e.fromTime, e.toTime], [candles[e.from]!.time, candles[e.to - 1]!.time]);
      assert.ok(Number.isFinite(e.logicalFrom) && Number.isFinite(e.logicalTo) && e.logicalFrom < e.logicalTo);
      // Whitespace left of the first bar reads below 0; otherwise the one-bar left margin applies.
      assert.ok((e.from === 0 ? e.logicalFrom < 1 : e.logicalFrom >= e.from - 1) && e.logicalTo <= e.to,
        `logical ${e.logicalFrom}..${e.logicalTo} within ${e.from}..${e.to}`);
      near(e.barsBefore, e.logicalFrom);
      near(e.barsAfter, length - 1 - e.logicalTo);
    };
    chart.scale.scrollBy(60);
    assert.equal(events.ranges.length, 1);
    rangeOk(events.ranges[0]!, data);
    assert.ok(events.ranges[0]!.to < N && events.ranges[0]!.from < range.from, 'scrolled into history');
    // 60 slots back the right edge sits inside the weekend: the logical edge interpolates across it.
    assert.equal(events.ranges[0]!.to, GAP_AT);
    assert.ok(events.ranges[0]!.logicalTo > GAP_AT - 1 && events.ranges[0]!.logicalTo < GAP_AT);
    assert.ok(events.ranges[0]!.logicalFrom < 0, 'whitespace shows left of the first bar');
    assertFinite(live.calls, 'scrolled frame');
    chart.scale.scrollBy(-60);
    assert.equal(events.ranges.length, 2);
    rangeOk(events.ranges[1]!, data);
    assert.deepEqual([events.ranges[1]!.from, events.ranges[1]!.to], [range.from, range.to]);

    // ---- Streaming: an appended bar loads, moves the range, rebuilds the HA tail and restarts the countdown.
    const next = bar(N, data.at(-1)!.time + HOUR);
    clock.now = (next.time + 10 * 60) * 1000;
    live.reset();
    chart.appendData(next);
    assert.deepEqual(events.loads, [{ reason: 'append', length: N + 1, added: 1, firstTime: data[0]!.time, lastTime: next.time }]);
    assert.equal(events.ranges.length, 3);
    rangeOk(events.ranges[2]!, [...data, next]);
    assert.equal(events.ranges[2]!.to, N + 1, 'the new bar is in view');
    assertFinite(live.calls, 'appended frame');
    const streamed = heikinAshi([...data, next]);
    let row = statusRow(live, chart).map((t) => t.text);
    assert.ok(row.includes(`C ${fmt(streamed.at(-1)!.close)}`), 'the status line shows the new HA bar');
    assert.equal(row.at(-1), '50:00');
    assert.equal(live.rects().filter((r) => r.alpha === 0.5).length, events.ranges[2]!.to - events.ranges[2]!.from, 'a volume column per bar');

    // An in-bucket tick updates in place: one 'update' load and no range event.
    const tick = { ...next, close: next.close + 3, high: Math.max(next.high, next.close + 3) };
    live.reset();
    chart.batch(() => {
      chart.appendData(tick);
      setup.last.applyOptions({ price: tick.close });
    });
    assert.deepEqual(events.loads.at(-1), { reason: 'update', length: N + 1, added: 0, firstTime: data[0]!.time, lastTime: next.time });
    assert.equal(events.ranges.length, 3);
    const ticked = heikinAshi([...data, tick]);
    row = statusRow(live, chart).map((t) => t.text);
    assert.ok(row.includes(`C ${fmt(ticked.at(-1)!.close)}`));
    const lastTag = live.texts().find((t) => t.text === 'last')!;
    near(lastTag.y, chart.scale.priceToY(tick.close), 1e-9, 'the last line follows the tick');
    assertFinite(live.calls, 'ticked frame');

    // ---- Countdown ticker: an overlay-only repaint on the next second, with the injected timers.
    const timers: { fn: () => void; ms: number }[] = [];
    const ticker = startCountdownTicker({
      chart,
      window: {
        setTimeout: (fn: () => void, ms?: number) => timers.push({ fn, ms: ms ?? 0 }),
        clearTimeout: () => {},
      },
    });
    assert.equal(timers.length, 1);
    clock.now += 1000;
    live.reset();
    const before = renders.count;
    timers[0]!.fn();
    assert.equal(renders.count, before, 'the tick repaints the overlay without render()');
    assert.equal(paints(live), 1);
    assert.equal(statusRow(live, chart).at(-1)!.text, '49:59');
    assert.ok(live.texts().some((t) => t.text === '49:59' && t.x > plotWidth), 'the badge ticks too');
    ticker.stop();

    // ---- Snapshots repeat the live frame; the watermark and pixel ratio apply to the snapshot only.
    live.reset();
    chart.render();
    const frame = [...live.calls];
    const plain = chart.takeScreenshot() as RecCanvas;
    assert.equal(plain, doc.created.at(-1));
    assert.deepEqual([plain.width, plain.height], [WIDTH, HEIGHT]);
    assert.deepEqual(plain.context.calls, frame, 'a snapshot paints exactly the live frame');
    clock.now += 60_000;
    live.reset();
    const shot = chart.takeScreenshot({ watermark: { visible: true, text: 'bloxwap.pro' }, pixelRatio: 2 }) as RecCanvas;
    assert.equal(live.calls.length, 0, 'the live canvas is not repainted');
    assert.deepEqual([shot.width, shot.height], [WIDTH * 2, HEIGHT * 2]);
    assert.deepEqual(shot.context.calls[1], ['scale', 2, 2]);
    assertFinite(shot.context.calls, 'snapshot');
    const shotTexts = shot.context.texts().map((t) => t.text);
    for (const text of ['bloxwap.pro', 'BLOX/USD', 'mark', 'last', 'target', 'S', 'G', 'B', 'I', '48:59']) {
      assert.ok(shotTexts.includes(text), `the snapshot shows ${text}`);
    }
    assert.equal(chart.getConfig().watermark.visible, false, 'the live watermark stays off');
    const firstWatermark = shot.context.ops.findIndex((o) => o.kind === 'text' && o.text === 'bloxwap.pro');
    const firstColumn = shot.context.ops.findIndex((o) => o.kind === 'rect' && o.alpha === 0.5);
    assert.ok(firstWatermark >= 0 && firstWatermark < firstColumn, 'the watermark paints under the series');
    assert.equal(chart.toDataURL(), `data:image/png;mock,${WIDTH}x${HEIGHT}`);
    const blob = await chart.toBlob({ type: 'image/webp', pixelRatio: 0.5 });
    assert.deepEqual(blob, { size: (WIDTH / 2) * (HEIGHT / 2) * 4, type: 'image/webp' });

    // ---- A left price axis: events, status line and markers still agree on the bar under the pointer.
    live.reset();
    chart.updateConfig({ priceAxis: { position: 'left' } });
    const left = chart.plotArea.left;
    assert.ok(left > 0);
    assertFinite(live.calls, 'left-axis frame');
    assert.equal(live.texts().find((t) => t.text === 'B')!.x, chart.scale.indexToX(120));
    for (const i of [97, 120, N]) {
      live.reset();
      chart.setCrosshair(chart.scale.indexToX(i), mainHeight / 2);
      move = events.crosshairs.at(-1)!;
      assert.equal(move.index, i);
      assert.deepEqual(move.displayCandle, ticked[i]);
      const hovered = statusRow(live, chart).map((t) => t.text);
      assert.ok(hovered.includes(`C ${fmt(ticked[i]!.close)}`), `left axis: the status line prints bar ${i} (${hovered.join(' | ')})`);
    }

    // ---- Teardown: no more events or paints.
    const counts = [events.ranges.length, events.crosshairs.length, events.loads.length];
    chart.destroy();
    chart.appendData(bar(N + 1, next.time + HOUR));
    chart.setCrosshair(10, 10);
    assert.deepEqual([events.ranges.length, events.crosshairs.length, events.loads.length], counts);
    assert.throws(() => chart.takeScreenshot(), /destroyed/);
  });

  it('counts the first bar after a weekend down with the continuous axis interval', () => {
    // The last bar opens Monday, 49 hours after Friday's last bar; the clock is 15 minutes into it.
    const data = Array.from({ length: GAP_AT + 1 }, (_, i) => bar(i));
    const countdown = (config: { timeAxis?: { intervalMs: number }; timeScale: { continuous: boolean; intervalMs?: number } }) => {
      const doc = new RecDocument();
      const chart = createChart({
        document: doc,
        preset: 'bloxwapDark',
        now: () => (data.at(-1)!.time + 15 * 60) * 1000,
        config: { wasm: false, width: WIDTH, height: HEIGHT, data, series: { type: 'heikin-ashi' }, statusLine: { countdown: true }, priceAxis: { labels: { countdown: true } }, ...config },
      });
      const ctx = doc.created[0]!.context;
      const text = statusRow(ctx, chart).at(-1)!.text;
      assert.ok(ctx.texts().some((t) => t.text === text && t.x > chart.plotArea.width), `the badge reads ${text} too`);
      chart.destroy();
      return text;
    };
    // The declared slot width is the bar interval, so the weekend no longer reads as a 49-hour bar.
    assert.equal(countdown({ timeScale: { continuous: true, intervalMs: HOUR_MS } }), '45:00');
    // timeAxis.intervalMs still wins, and without either the last two candles decide, as documented.
    assert.equal(countdown({ timeAxis: { intervalMs: HOUR_MS / 2 }, timeScale: { continuous: true, intervalMs: HOUR_MS } }), '15:00');
    assert.equal(countdown({ timeScale: { continuous: true } }), '2d 00:45');
  });
});
