/**
 * Integration: price lines and series markers (P1.7) with the Heikin Ashi /
 * hollow candle series types (P1.8) and the bloxwapDark preset's scale font
 * and volume overlay (P1.10 / P1.11).
 *
 * Markers anchor on the bars as displayed: on a Heikin Ashi chart that is
 * the HA high/low (and the HA live bar while it animates), the same bars the
 * series draws and the price scale frames. Price-line badges and title tags
 * share the scale font with the built-in price badges, so under bloxwapDark
 * they are 11px system-ui and exactly as tall as the last-price badge.
 * Markers paint at full opacity above the half-transparent volume overlay.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bloxwapDark, createChart, heikinAshi, MARKER_MAX_SIZE, MARKER_MIN_SIZE, scaleFont,
  type Chart, type FrameScheduler, type RenderView, type SeriesMarker,
} from '../dist/index.js';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { resolveConfig, type ChartConfig, type DeepPartial, type SeriesType } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';

interface Paint { op: 'ellipse' | 'fillRect' | 'fillText'; args: number[]; text: string; fill: string; alpha: number; font: string }

/** Records circle glyphs, filled rects and texts with the paint state in effect. */
class Recorder extends MockContext2D {
  readonly paints: Paint[] = [];
  private push(op: Paint['op'], args: number[], text = ''): void {
    this.paints.push({ op, args, text, fill: String(this.fillStyle), alpha: this.globalAlpha, font: this.font });
  }
  override ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    super.ellipse(x, y, rx, ry, rotation, start, end);
    this.push('ellipse', [x, y, rx, ry]);
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.push('fillRect', [x, y, w, h]);
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.push('fillText', [x, y], text);
  }
  of(op: Paint['op']): Paint[] { return this.paints.filter((p) => p.op === op); }
}

class Frames implements FrameScheduler {
  time = 0;
  sequence = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = this.sequence++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
  settle() {
    for (let i = 0; i < 100 && this.callbacks.size; i++) this.tick();
    assert.equal(this.callbacks.size, 0);
  }
}

const MIN = 60;
const T0 = 1_700_000_040;
const MARK = '#35b5ff';

/**
 * A falling market whose candles each gap down and close above their own
 * open: every HA bar after the first opens far above the real high, so HA
 * and real anchors are clearly apart.
 */
const FALLING: Candle[] = Array.from({ length: 12 }, (_, i) => {
  const open = 100 - 3 * i;
  return { time: T0 + i * MIN, open, high: open + 0.7, low: open - 0.2, close: open + 0.5, volume: (i + 1) * 10 };
});

const view = (chart: Chart) => (chart as unknown as { lastView: RenderView }).lastView;

function mount(type: SeriesType, config: DeepPartial<ChartConfig> = {}, animation?: Frames): { chart: Chart; ctx: Recorder } {
  const ctx = new Recorder();
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => ctx };
  const chart = createChart({
    container: canvas,
    preset: 'bloxwapDark',
    config: { wasm: false, data: [...FALLING], series: { type }, ...config },
    ...(animation !== undefined ? { animation: { scheduler: animation, duration: 200 } } : {}),
  });
  return { chart, ctx };
}

/** Paints of the frame drawn by `action`. */
function frame(ctx: Recorder, action: () => void): Recorder {
  ctx.paints.length = 0;
  action();
  return ctx;
}

/** Glyph centre of a unit-size circle `above` the bar's top edge (or below its bottom edge). */
function circleY(v: RenderView, edge: number, above: boolean): number {
  const box = Math.min(Math.max(v.timeScale.barSpacing, MARKER_MIN_SIZE), MARKER_MAX_SIZE);
  const size = box * 0.8;
  const margin = Math.max(box * 0.1, 3);
  const y = v.panes[0]!.priceScale.priceToY(edge);
  return above ? y - margin - size / 2 : y + margin + size / 2;
}

function near(actual: number | undefined, expected: number, message: string): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≈ ${expected}`);
}

const above = (bar: number, color: string): SeriesMarker => ({ time: FALLING[bar]!.time, position: 'aboveBar', color, shape: 'circle' });
const below = (bar: number, color: string): SeriesMarker => ({ time: FALLING[bar]!.time, position: 'belowBar', color, shape: 'circle' });

describe('integration: markers x series types', () => {
  it('anchors aboveBar/belowBar markers on the displayed Heikin Ashi high and low', () => {
    const { chart, ctx } = mount('heikin-ashi');
    const ha = heikinAshi(FALLING);
    assert.ok(ha[5]!.high - FALLING[5]!.high > 1, 'the HA high sits well above the real high');
    chart.series.setMarkers([above(5, '#a1'), below(7, '#b1'), above(11, '#c1')]);
    const glyphs = ctx.of('ellipse');
    assert.equal(glyphs.length, 3);
    const v = view(chart);
    near(glyphs[0]!.args[1], circleY(v, ha[5]!.high, true), 'aboveBar over the HA high');
    near(glyphs[1]!.args[1], circleY(v, ha[7]!.low, false), 'belowBar under the HA low');
    near(glyphs[2]!.args[1], circleY(v, ha[11]!.high, true), 'the last bar uses the HA bar too');
    assert.deepEqual(glyphs.map((g) => g.args[0]), [5, 7, 11].map((i) => v.timeScale.indexToX(i, FALLING.length)));

    // The same markers on candlesticks sit on the real bars.
    const real = frame(ctx, () => chart.updateConfig({ series: { type: 'candlestick' } })).of('ellipse');
    const r = view(chart);
    near(real[0]!.args[1], circleY(r, FALLING[5]!.high, true), 'aboveBar over the real high');
    near(real[1]!.args[1], circleY(r, FALLING[7]!.low, false), 'belowBar under the real low');
    chart.destroy();
  });

  it('follows the animated Heikin Ashi live bar on the last bar', () => {
    const frames = new Frames();
    const { chart, ctx } = mount('heikin-ashi', {}, frames);
    const last = FALLING.at(-1)!;
    const next: Candle = { time: last.time + MIN, open: last.open - 3, high: last.open - 2.3, low: last.open - 6, close: last.open - 2.5, volume: 500 };
    chart.series.setMarkers([above(3, '#a1'), { time: next.time, position: 'belowBar', color: '#live', shape: 'circle' }]);
    chart.appendData(next);
    const settled = heikinAshi([...FALLING, next]).at(-1)!;
    const glyphs = frame(ctx, () => frames.tick(60)).of('ellipse');
    const v = view(chart);
    const live = v.liveCandle!;
    assert.equal(v.displayCandles!.length, FALLING.length + 1);
    assert.ok(Math.abs(live.low - settled.low) > 0.1, 'mid-animation the HA live bar differs from the settled one');
    near(glyphs[0]!.args[1], circleY(v, v.displayCandles![3]!.high, true), 'history keeps its HA anchor');
    near(glyphs[1]!.args[1], circleY(v, live.low, false), 'the live marker rides the animated HA low');
    frames.settle();
    const done = frame(ctx, () => chart.updateConfig({})).of('ellipse');
    near(done[1]!.args[1], circleY(view(chart), settled.low, false), 'then lands on the settled HA low');
    chart.destroy();
  });

  it('anchors hollow candle markers on the real high and low', () => {
    const { chart, ctx } = mount('hollow-candlestick');
    chart.series.setMarkers([above(4, '#a1'), below(4, '#b1')]);
    const v = view(chart);
    assert.equal(v.displayCandles, v.candles);
    const glyphs = ctx.of('ellipse');
    near(glyphs[0]!.args[1], circleY(v, FALLING[4]!.high, true), 'aboveBar over the high');
    near(glyphs[1]!.args[1], circleY(v, FALLING[4]!.low, false), 'belowBar under the low');
    chart.destroy();
  });

  it('paints markers at full opacity above the half-transparent volume overlay', () => {
    const { chart, ctx } = mount('heikin-ashi');
    const paints = frame(ctx, () => chart.series.setMarkers([below(6, '#b1'), above(6, '#a1')])).paints;
    const opacity = bloxwapDark.volume!.opacity!;
    const lastVolume = paints.map((p) => p.op === 'fillRect' && p.alpha === opacity).lastIndexOf(true);
    const firstGlyph = paints.findIndex((p) => p.op === 'ellipse');
    assert.ok(lastVolume >= 0 && firstGlyph > lastVolume, 'glyphs come after the overlay bars');
    assert.deepEqual(paints.filter((p) => p.op === 'ellipse').map((p) => [p.fill, p.alpha]), [['#b1', 1], ['#a1', 1]]);
    chart.destroy();
  });
});

describe('integration: price lines x bloxwapDark scale font', () => {
  it('sizes badges and title tags with the scale font, like the last-price badge', () => {
    const { chart, ctx } = mount('candlestick');
    const theme = resolveConfig(bloxwapDark).theme;
    const font = scaleFont(theme);
    const height = theme.scaleFontSize! + 8;
    const plotWidth = view(chart).plotWidth;
    const price = FALLING[6]!.close;
    const paints = frame(ctx, () => chart.series.createPriceLine({ price, color: MARK, title: 'mark' })).paints;
    const v = view(chart);
    const format = (value: number) => v.panes[0]!.priceScale.format(value, v.config.formatters.price, v.config.priceAxis.precision);

    const badge = paints.find((p) => p.op === 'fillRect' && p.fill === MARK && p.args[0] === plotWidth)!;
    const tag = paints.find((p) => p.op === 'fillRect' && p.fill === MARK && p.args[0]! < plotWidth)!;
    assert.equal(badge.args[3], height);
    assert.equal(tag.args[3], height);
    const lastClose = FALLING.at(-1)!.close;
    const lastBadge = paints.find((p) => p.op === 'fillText' && p.text === format(lastClose));
    const lastRect = paints.find((p) => p.op === 'fillRect' && p.args[0] === plotWidth && p.fill === bloxwapDark.series!.upColor);
    assert.ok(lastBadge !== undefined && lastRect !== undefined, 'the last-price badge is painted');
    assert.equal(lastRect.args[3], badge.args[3], 'price-line badge matches the last-price badge height');

    const texts = paints.filter((p) => p.op === 'fillText' && (p.text === 'mark' || p.text === format(price)));
    assert.deepEqual(texts.map((p) => [p.text, p.font]), [[format(price), font], ['mark', font]]);
    assert.equal(lastBadge.font, font);
    chart.destroy();
  });

  it('frames the Heikin Ashi bars plus autoscale lines on a heikin-ashi chart', () => {
    const { chart } = mount('heikin-ashi');
    const scale = () => view(chart).panes[0]!.priceScale;
    const ha = heikinAshi(FALLING);
    const haMin = Math.min(...ha.map((c) => c.low));
    const haMax = Math.max(...ha.map((c) => c.high));
    assert.equal(scale().minPrice, haMin);
    assert.equal(scale().maxPrice, haMax);
    chart.series.createPriceLine({ price: haMax + 20, autoscale: true });
    chart.series.createPriceLine({ price: haMin - 1, autoscale: false });
    assert.equal(scale().minPrice, haMin, 'a line without autoscale leaves the HA minimum');
    assert.equal(scale().maxPrice, haMax + 20);
    chart.destroy();
  });
});
