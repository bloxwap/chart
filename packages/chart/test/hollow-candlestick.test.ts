import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, visibleMinMax, type RenderView } from '../dist/index.js';
import { MockCanvas, MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { ICONS } from '../dist/ui/icons.js';
import { SERIES_RENDERERS, drawHollowCandlesticks } from '../dist/series/index.js';

type Rect = [number, number, number, number];

/** Records fill styles per fillRect and the outline rects of each stroked path. */
class StyleContext extends MockContext2D {
  readonly fills: { style: string; rect: Rect }[] = [];
  readonly strokes: { style: string; rects: Rect[] }[] = [];
  private path: Rect[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ style: this.fillStyle, rect: [x, y, w, h] });
    super.fillRect(x, y, w, h);
  }
  override beginPath(): void {
    this.path = [];
    super.beginPath();
  }
  override rect(x: number, y: number, w: number, h: number): void {
    this.path.push([x, y, w, h]);
    super.rect(x, y, w, h);
  }
  override stroke(): void {
    this.strokes.push({ style: this.strokeStyle, rects: this.path });
    super.stroke();
  }
}

// Every color/fill combination: [color by previous close] × [hollow when close >= open].
const CANDLES: Candle[] = [
  { time: 1, open: 10, high: 13, low: 9, close: 12 }, // first bar vs own open: up, hollow
  { time: 2, open: 13, high: 14, low: 11, close: 11.5 }, // 11.5 < 12: down, filled
  { time: 3, open: 13, high: 13.5, low: 11, close: 12 }, // 12 >= 11.5: up, filled
  { time: 4, open: 10, high: 12, low: 9.5, close: 11 }, // 11 < 12: down, hollow
];
const UP = '#0a0', DOWN = '#a00';

function scales(): { ts: TimeScale; ps: PriceScale } {
  const ts = new TimeScale(10, 300);
  const ps = new PriceScale();
  ps.height = 200;
  ps.setRange(8, 15);
  return { ts, ps };
}
const cfg = (partial: Partial<SeriesConfig> = {}): SeriesConfig => ({ ...DEFAULT_CONFIG.series, upColor: UP, downColor: DOWN, ...partial });

function geometry(c: Candle, i: number, ts: TimeScale, ps: PriceScale, length = CANDLES.length) {
  const bodyWidth = Math.max(1, Math.floor(ts.barSpacing * 0.7));
  const x = Math.round(ts.indexToX(i, length));
  const top = Math.min(ps.priceToY(c.high), ps.priceToY(c.low));
  const bottom = Math.max(ps.priceToY(c.high), ps.priceToY(c.low));
  const bodyTop = Math.min(ps.priceToY(c.open), ps.priceToY(c.close));
  const height = Math.max(1, Math.abs(ps.priceToY(c.close) - ps.priceToY(c.open)));
  const left = x - Math.floor(bodyWidth / 2);
  return {
    x, top, bottom, bodyTop, height,
    body: [left, bodyTop, bodyWidth, height] as Rect,
    outline: [left + 0.5, bodyTop + 0.5, Math.max(0, bodyWidth - 1), Math.max(0, height - 1)] as Rect,
    wick: [x, top, 1, Math.max(1, bottom - top)] as Rect,
    upperWick: [x, top, 1, bodyTop - top] as Rect,
    lowerWick: [x, bodyTop + height, 1, bottom - bodyTop - height] as Rect,
  };
}

describe('drawHollowCandlesticks', () => {
  it('is registered as hollow-candlestick', () => {
    assert.equal(SERIES_RENDERERS['hollow-candlestick'], drawHollowCandlesticks);
  });

  it('colors by previous close and fills only bars that close below their open', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    drawHollowCandlesticks(ctx, CANDLES, { from: 0, to: 4 }, ts, ps, cfg());
    const g = CANDLES.map((c, i) => geometry(c, i, ts, ps));
    // Up pass (bars 0, 2), then down pass (bars 1, 3); wicks default to the body color.
    assert.deepEqual(ctx.fills, [
      { style: UP, rect: g[0]!.upperWick },
      { style: UP, rect: g[0]!.lowerWick },
      { style: UP, rect: g[2]!.wick },
      { style: UP, rect: g[2]!.body },
      { style: DOWN, rect: g[1]!.wick },
      { style: DOWN, rect: g[1]!.body },
      { style: DOWN, rect: g[3]!.upperWick },
      { style: DOWN, rect: g[3]!.lowerWick },
    ]);
    // Hollow bodies are 1px outlines, one stroke per color.
    assert.deepEqual(ctx.strokes, [
      { style: UP, rects: [g[0]!.outline] },
      { style: DOWN, rects: [g[3]!.outline] },
    ]);
    assert.equal(ctx.lineWidth, 1);
  });

  it('uses wick and border color overrides and outlines filled bodies when borders are on', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    drawHollowCandlesticks(ctx, CANDLES, { from: 0, to: 4 }, ts, ps, cfg({
      borderVisible: true, wickUpColor: '#0f0', wickDownColor: '#f00', borderUpColor: '#00f', borderDownColor: '#ff0',
    }));
    const g = CANDLES.map((c, i) => geometry(c, i, ts, ps));
    assert.deepEqual(ctx.fills.map((f) => f.style), ['#0f0', '#0f0', '#0f0', UP, '#f00', DOWN, '#f00', '#f00']);
    assert.deepEqual(ctx.strokes, [
      { style: '#00f', rects: [g[0]!.outline, g[2]!.outline] },
      { style: '#ff0', rects: [g[1]!.outline, g[3]!.outline] },
    ]);
  });

  it('hides bodies (full wicks, no outlines) and wicks independently', () => {
    const { ts, ps } = scales();
    const g = CANDLES.map((c, i) => geometry(c, i, ts, ps));
    const noBody = new StyleContext();
    drawHollowCandlesticks(noBody, CANDLES, { from: 0, to: 4 }, ts, ps, cfg({ bodyVisible: false }));
    assert.deepEqual(noBody.fills.map((f) => f.rect), [g[0]!.wick, g[2]!.wick, g[1]!.wick, g[3]!.wick]);
    assert.deepEqual(noBody.strokes.map((s) => s.rects), [[], []]);
    const bordersOnly = new StyleContext();
    drawHollowCandlesticks(bordersOnly, CANDLES, { from: 0, to: 4 }, ts, ps, cfg({ bodyVisible: false, borderVisible: true }));
    assert.equal(bordersOnly.fills.length, 6, 'split wicks for outlined hollow bars, full wicks for the rest');
    assert.deepEqual(bordersOnly.strokes.map((s) => s.rects.length), [2, 2]);
    const noWick = new StyleContext();
    drawHollowCandlesticks(noWick, CANDLES, { from: 0, to: 4 }, ts, ps, cfg({ wickVisible: false }));
    assert.deepEqual(noWick.fills, [{ style: UP, rect: g[2]!.body }, { style: DOWN, rect: g[1]!.body }]);
  });

  it('skips empty wick segments of a hollow bar that opens at its low and closes at its high', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    const bar: Candle = { time: 1, open: 10, high: 12, low: 10, close: 12 };
    drawHollowCandlesticks(ctx, [bar], { from: 0, to: 1 }, ts, ps, cfg());
    assert.deepEqual(ctx.fills, []);
    assert.deepEqual(ctx.strokes[0]!.rects, [geometry(bar, 0, ts, ps, 1).outline]);
  });

  it('colors the first bar by its own open and later bars by the previous close even off-screen', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    const first: Candle = { time: 1, open: 12, high: 13, low: 9, close: 10 };
    drawHollowCandlesticks(ctx, [first], { from: 0, to: 1 }, ts, ps, cfg());
    assert.deepEqual(ctx.fills.map((f) => f.style), [DOWN, DOWN]);
    const partial = new StyleContext();
    drawHollowCandlesticks(partial, CANDLES, { from: 3, to: 4 }, ts, ps, cfg());
    assert.deepEqual(partial.strokes, [{ style: UP, rects: [] }, { style: DOWN, rects: [geometry(CANDLES[3]!, 3, ts, ps).outline] }]);
  });

  it('draws the live candle in place of the last bar against the stored previous close', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    const live: Candle = { ...CANDLES[3]!, close: 12.5, high: 12.75 }; // 12.5 >= 12: now up and hollow
    drawHollowCandlesticks(ctx, CANDLES, { from: 3, to: 4 }, ts, ps, cfg(), live);
    assert.deepEqual(ctx.strokes, [{ style: UP, rects: [geometry(live, 3, ts, ps).outline] }, { style: DOWN, rects: [] }]);
  });

  it('draws nothing for an empty range', () => {
    const { ts, ps } = scales();
    const ctx = new StyleContext();
    drawHollowCandlesticks(ctx, CANDLES, { from: 0, to: 0 }, ts, ps, cfg());
    assert.deepEqual(ctx.fills, []);
    assert.deepEqual(ctx.strokes.map((s) => s.rects), [[], []]);
  });
});

describe('hollow-candlestick chart', () => {
  it('renders the real candles and autoscales like candlesticks', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ time: i + 1, open: 100 + (i % 7), high: 104 + (i % 7), low: 97 + (i % 5), close: 101 + (i % 3) }));
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { data, wasm: false, series: { type: 'hollow-candlestick' } } });
    const view = (chart as unknown as { lastView: RenderView }).lastView;
    assert.equal(view.displayCandles, view.candles);
    const range = chart.scale.visibleRange();
    const mm = visibleMinMax(data, range.from, range.to, null);
    assert.equal(view.panes[0]!.priceScale.minPrice, mm.min);
    assert.equal(view.panes[0]!.priceScale.maxPrice, mm.max);
    assert.ok(canvas.context.countCalls('stroke') >= 2);
  });
});

describe('series icons', () => {
  it('ship chart-heikin-ashi and chart-hollow-candlestick', () => {
    assert.match(ICONS['chart-heikin-ashi'], /^<svg /);
    assert.match(ICONS['chart-hollow-candlestick'], /fill="currentColor"/);
  });
});
