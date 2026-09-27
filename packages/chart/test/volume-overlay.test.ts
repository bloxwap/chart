import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, resolveConfig, type ChartConfig, type DeepPartial } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { renderChart, type RenderView } from '../dist/render/renderer.js';
import { drawVolumeOverlay } from '../dist/render/volume-overlay.js';
import { drawCandlesticks } from '../dist/series/candlestick.js';
import { createChart, drawVolumeOverlay as exported } from '../dist/index.js';

interface Rect { x: number; y: number; w: number; h: number; fill: unknown; alpha: number }

/** Records each fillRect together with the fill style and alpha in effect. */
class RectRecorder extends MockContext2D {
  readonly rects: Rect[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.rects.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha });
  }
}

const PANE_H = 300;

// up, down, up, down, up — volumes 100/200/50/400/80.
const CANDLES: Candle[] = [
  { time: 0, open: 100, high: 104, low: 99, close: 103, volume: 100 },
  { time: 60, open: 103, high: 104, low: 100, close: 101, volume: 200 },
  { time: 120, open: 101, high: 106, low: 100, close: 105, volume: 50 },
  { time: 180, open: 105, high: 106, low: 98, close: 99, volume: 400 },
  { time: 240, open: 99, high: 103, low: 98, close: 102, volume: 80 },
];

function makeView(
  config: DeepPartial<ChartConfig>,
  opts: { candles?: readonly Candle[]; range?: { from: number; to: number }; liveCandle?: Candle } = {},
): RenderView {
  const candles = opts.candles ?? CANDLES;
  const timeScale = new TimeScale(10, 400);
  const priceScale = new PriceScale();
  priceScale.height = PANE_H;
  priceScale.setRange(95, 110);
  return {
    canvasWidth: 464,
    canvasHeight: 324,
    plotWidth: 400,
    plotHeight: PANE_H,
    pixelRatio: 1,
    candles,
    ...(opts.liveCandle !== undefined ? { liveCandle: opts.liveCandle } : {}),
    range: opts.range ?? timeScale.visibleRange(candles.length),
    timeScale,
    panes: [{ layout: { id: 'main', kind: 'main', weight: 3, y: 0, height: PANE_H }, priceScale, indicators: [] }],
    config: resolveConfig(config),
    drawings: [],
    crosshair: { active: false, x: 0, y: 0 },
  };
}

const ON = { volume: { overlay: true } } as const;

describe('volume overlay config', () => {
  it('defaults off with series-following tokens, 50% opacity and 20% height', () => {
    assert.deepEqual(DEFAULT_CONFIG.volume, { overlay: false, upColor: 'up', downColor: 'down', opacity: 0.5, height: 0.2 });
    assert.equal(exported, drawVolumeOverlay);
  });
});

describe('drawVolumeOverlay', () => {
  it('costs nothing when the overlay is off: no draw calls, no candle reads', () => {
    const ctx = new MockContext2D();
    const view = { config: resolveConfig({ volume: { upColor: '#123456', opacity: 1, height: 1 } }) } as RenderView;
    Object.defineProperty(view, 'candles', { get: () => { throw new Error('read candles'); } });
    drawVolumeOverlay(ctx, view, PANE_H);
    assert.deepEqual(ctx.calls, []);
    assert.equal(ctx.globalAlpha, 1);
  });

  it('pins bars to the pane bottom, scaled to the tallest visible bar, at the configured alpha', () => {
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, makeView(ON), PANE_H);
    // The 400 bar reaches 20% of 300px = 60px; the rest scale linearly (50 → 7.5 → 8).
    assert.deepEqual(ctx.rects.map((r) => r.h), [15, 30, 8, 60, 12]);
    for (const r of ctx.rects) {
      assert.equal(r.y + r.h, PANE_H, 'bottom edge sits on the pane bottom');
      assert.equal(r.alpha, 0.5);
    }
    const { upColor, downColor } = DEFAULT_CONFIG.series;
    assert.deepEqual(ctx.rects.map((r) => r.fill), [upColor, downColor, upColor, downColor, upColor]);
    assert.equal(ctx.globalAlpha, 1, 'alpha is restored');
  });

  it('matches the candle body columns', () => {
    const view = makeView(ON);
    const bars = new RectRecorder();
    drawVolumeOverlay(bars, view, PANE_H);
    const candles = new RectRecorder();
    drawCandlesticks(candles, view.candles, view.range, view.timeScale, view.panes[0]!.priceScale, view.config.series);
    const bodies = candles.rects.filter((_, i) => i % 2 === 1); // wick, body per candle
    assert.deepEqual(bars.rects.map((r) => [r.x, r.w]), bodies.map((r) => [r.x, r.w]));
  });

  it('culls to the visible range and rescales to its own maximum', () => {
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, makeView(ON, { range: { from: 0, to: 3 } }), PANE_H);
    // Visible max is 200 (the 400 bar is off-screen): 100 → 30px, 200 → 60px, 50 → 15px.
    assert.deepEqual(ctx.rects.map((r) => r.h), [30, 60, 15]);
    const empty = new RectRecorder();
    drawVolumeOverlay(empty, makeView(ON, { range: { from: 2, to: 2 } }), PANE_H);
    assert.deepEqual(empty.calls, []);
  });

  it('skips missing, zero and NaN volumes and draws nothing without any volume', () => {
    const mixed: Candle[] = [
      { time: 0, open: 1, high: 2, low: 0, close: 2 },
      { time: 1, open: 1, high: 2, low: 0, close: 2, volume: 0 },
      { time: 2, open: 1, high: 2, low: 0, close: 2, volume: Number.NaN },
      { time: 3, open: 1, high: 2, low: 0, close: 2, volume: 10 },
    ];
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, makeView(ON, { candles: mixed }), PANE_H);
    assert.equal(ctx.rects.length, 1);
    assert.equal(ctx.rects[0]!.h, 60);
    const none = new RectRecorder();
    const bare = CANDLES.map(({ volume: _volume, ...c }) => c);
    drawVolumeOverlay(none, makeView(ON, { candles: bare }), PANE_H);
    assert.deepEqual(none.calls, []);
    assert.equal(none.globalAlpha, 1);
  });

  it('uses the live candle for the last bar', () => {
    const live: Candle = { ...CANDLES[4]!, close: 97, volume: 800 };
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, makeView(ON, { liveCandle: live }), PANE_H);
    const last = ctx.rects.at(-1)!;
    assert.equal(last.h, 60, 'the live volume sets the maximum');
    assert.equal(ctx.rects[3]!.h, 30);
    assert.equal(last.fill, DEFAULT_CONFIG.series.downColor, 'the live direction colors the bar');
  });

  it('follows the series colors through tokens, honors explicit colors and clamps opacity and height', () => {
    const tokens = new RectRecorder();
    drawVolumeOverlay(tokens, makeView({ ...ON, series: { upColor: '#00ff00', downColor: '#ff0000' } }), PANE_H);
    assert.deepEqual(new Set(tokens.rects.map((r) => r.fill)), new Set(['#00ff00', '#ff0000']));

    const explicit = new RectRecorder();
    explicit.globalAlpha = 0.8;
    drawVolumeOverlay(explicit, makeView({ volume: { overlay: true, upColor: '#0000ff', downColor: '#ffff00', opacity: 2, height: 5 } }), PANE_H);
    assert.deepEqual(explicit.rects.map((r) => r.fill), ['#0000ff', '#ffff00', '#0000ff', '#ffff00', '#0000ff']);
    assert.ok(explicit.rects.every((r) => r.alpha === 0.8), 'opacity clamps to 1 and multiplies the current alpha');
    assert.equal(explicit.rects[3]!.h, PANE_H, 'height clamps to the full pane');
    assert.equal(explicit.globalAlpha, 0.8);
  });
});

describe('drawVolumeOverlay degenerate input', () => {
  it('draws nothing for a non-positive or NaN opacity or height', () => {
    for (const volume of [{ opacity: 0 }, { opacity: -1 }, { opacity: Number.NaN }, { height: 0 }, { height: -0.5 }, { height: Number.NaN }]) {
      const ctx = new RectRecorder();
      drawVolumeOverlay(ctx, makeView({ volume: { overlay: true, ...volume } }), PANE_H);
      assert.deepEqual(ctx.calls, [], JSON.stringify(volume));
      assert.equal(ctx.globalAlpha, 1);
    }
  });

  it('skips infinite and negative volumes and scales to the finite maximum', () => {
    const odd: Candle[] = [
      { time: 0, open: 1, high: 2, low: 0, close: 2, volume: Number.POSITIVE_INFINITY },
      { time: 1, open: 2, high: 2, low: 0, close: 1, volume: 100 },
      { time: 2, open: 1, high: 2, low: 0, close: 2, volume: -50 },
      { time: 3, open: 1, high: 2, low: 0, close: 2, volume: 50 },
    ];
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, makeView(ON, { candles: odd }), PANE_H);
    assert.deepEqual(ctx.rects.map((r) => [r.y, r.h]), [[PANE_H - 60, 60], [PANE_H - 30, 30]]);
    assert.ok(ctx.rects.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y)));
    const only = new RectRecorder();
    drawVolumeOverlay(only, makeView(ON, { candles: [odd[0]!] }), PANE_H);
    assert.deepEqual(only.calls, [], 'no finite volume, no bars');
  });
});

describe('drawVolumeOverlay below 1px bar spacing', () => {
  /** Bars at `spacing` px with distinct, direction-alternating volumes. */
  function dense(spacing: number) {
    const count = 900;
    const candles: Candle[] = Array.from({ length: count }, (_, i) => {
      const open = 100;
      const close = i % 3 === 0 ? 99 : 101;
      return { time: i * 60, open, high: 102, low: 98, close, volume: 1000 + ((i * 7919) % 1009) };
    });
    const view = makeView(ON, { candles });
    view.timeScale.barSpacing = spacing;
    const range = view.timeScale.visibleRange(count);
    const dense = { ...view, range };
    const ctx = new RectRecorder();
    drawVolumeOverlay(ctx, dense, PANE_H);
    // Expected: every visible bar grouped by the pixel column it rounds to.
    let max = 0;
    for (let i = range.from; i < range.to; i++) max = Math.max(max, candles[i]!.volume!);
    const scale = PANE_H * 0.2 / max;
    const columns = new Map<number, { h: number; colors: Map<number, Set<string>> }>();
    for (let i = range.from; i < range.to; i++) {
      const c = candles[i]!;
      const x = Math.round(view.timeScale.indexToX(i, count));
      const h = Math.max(1, Math.round(c.volume! * scale));
      const color = c.close >= c.open ? DEFAULT_CONFIG.series.upColor : DEFAULT_CONFIG.series.downColor;
      const col = columns.get(x) ?? { h: 0, colors: new Map() };
      col.h = Math.max(col.h, h);
      col.colors.set(h, (col.colors.get(h) ?? new Set()).add(color));
      columns.set(x, col);
    }
    return { ctx, columns, bars: range.to - range.from };
  }

  for (const spacing of [0.5, 0.7]) {
    it(`paints one bar per pixel column at ${spacing}px spacing, the tallest, so alpha stays at opacity`, () => {
      const { ctx, columns, bars } = dense(spacing);
      assert.ok(bars > ctx.rects.length, 'several bars share columns');
      assert.equal(ctx.rects.length, columns.size);
      assert.equal(new Set(ctx.rects.map((r) => r.x)).size, ctx.rects.length, 'no column is painted twice');
      for (const r of ctx.rects) {
        const col = columns.get(r.x)!;
        assert.equal(r.w, 1);
        assert.equal(r.h, col.h, `column ${r.x} shows its tallest bar`);
        assert.ok(col.colors.get(r.h)!.has(r.fill as string), 'in that bar\'s direction color');
        assert.equal(r.alpha, 0.5);
        assert.equal(r.y + r.h, PANE_H);
      }
      assert.ok(ctx.rects.some((r) => r.fill === DEFAULT_CONFIG.series.downColor) && ctx.rects.some((r) => r.fill === DEFAULT_CONFIG.series.upColor));
    });
  }

  it('paints every bar in its own column from 1px spacing up', () => {
    const { ctx, bars } = dense(1);
    assert.equal(ctx.rects.length, bars);
  });
});

describe('volume overlay in the renderer', () => {
  it('leaves the default frame untouched: overlay settings are inert while off', () => {
    const base = new MockContext2D();
    renderChart(base, makeView({}));
    const tuned = new MockContext2D();
    renderChart(tuned, makeView({ volume: { upColor: '#123456', downColor: '#654321', opacity: 1, height: 1 } }));
    assert.deepEqual(tuned.calls, base.calls);
    // The main-pane clip is followed directly by the first candle wick.
    const clip = base.calls.findIndex((c) => c[0] === 'clip');
    assert.equal(base.calls[clip + 1]![0], 'fillRect');
  });

  it('draws inside the main-pane clip, under the series', () => {
    const off = new MockContext2D();
    renderChart(off, makeView({}));
    const on = new RectRecorder();
    renderChart(on, makeView(ON));
    const clip = on.calls.findIndex((c) => c[0] === 'clip');
    assert.deepEqual(on.calls.slice(clip - 3, clip + 1).map((c) => c[0]), ['translate', 'beginPath', 'rect', 'clip']);
    assert.deepEqual(on.calls[clip - 3], ['translate', 0, 0]);
    assert.deepEqual(on.calls[clip - 1], ['rect', 0, 0, 400, PANE_H]);
    const bars = on.calls.slice(clip + 1, clip + 1 + CANDLES.length);
    assert.ok(bars.every((c) => c[0] === 'fillRect' && (c[2] as number) + (c[4] as number) === PANE_H));
    assert.equal(on.countCalls('fillRect'), off.countCalls('fillRect') + CANDLES.length);
    const candle = on.rects[1 + CANDLES.length]!; // after the background and the bars
    assert.equal(candle.alpha, 1, 'candles paint at full alpha above the bars');
  });

  it('never moves the main price autoscale', () => {
    const huge = CANDLES.map((c) => ({ ...c, volume: (c.volume ?? 0) * 1e9 }));
    const make = (overlay: boolean) => {
      const ctx = new RectRecorder();
      const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => ctx };
      const chart = createChart({ container: canvas, config: { wasm: false, data: huge, volume: { overlay } } });
      return { chart, ctx };
    };
    const a = make(false);
    const b = make(true);
    for (const price of [98, 100, 104, 106]) assert.equal(b.chart.scale.priceToY(price), a.chart.scale.priceToY(price));
    assert.equal(b.ctx.rects.length, a.ctx.rects.length + CANDLES.length);
    b.chart.updateConfig({ series: { upColor: '#abcdef' } });
    assert.ok(b.ctx.rects.some((r) => r.fill === '#abcdef' && r.alpha === 0.5), 'recolored candles recolor the bars');
  });
});
