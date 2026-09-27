/**
 * Layer-based canvas renderer. Layers, in order: background, watermark,
 * grid, series, indicators, drawings, axes, crosshair. Pointer overlays can
 * be repainted independently of the static layers.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { PaneLayout } from '../core/pane.js';
import type { ChartConfig } from '../config.js';
import type { IndicatorOutput } from '../indicators/types.js';
import type { Canvas2DLike } from '../dom.js';
import { contrastingTextColor } from '../color.js';
import { SERIES_RENDERERS } from '../series/index.js';
import { drawWatermark } from '../watermark.js';
import { drawTimeAxis, timeTickIndices } from './axis.js';
import { drawDrawings, type ResolvedDrawing } from './drawings.js';
import { drawPriceReferences, drawStatusLine } from './settings-layers.js';
import { scaleFont, scaleFontSize } from './scale-font.js';
import { drawVolumeOverlay } from './volume-overlay.js';
import { drawPriceLines } from './price-lines.js';
import { drawMarkers } from './markers.js';
import type { PriceLineRenderItem, SeriesMarker } from '../core/price-lines.js';
import { drawCountdownLabel } from './countdown.js';
import { drawIndicator } from './indicator-draw.js';

export type { ResolvedDrawing } from './drawings.js';

/** One pane with its scale and the indicator outputs that belong to it. */
export interface PaneRenderInfo {
  readonly layout: PaneLayout;
  readonly priceScale: PriceScale;
  readonly indicators: readonly IndicatorOutput[];
  /** Status-line labels by line key, parallel to `indicators`; keys without one show uppercased. */
  readonly indicatorLabels?: readonly ReadonlyMap<string, string>[];
  /** Per-overlay opacity during indicator transitions. Defaults to 1. */
  readonly indicatorOpacities?: readonly number[];
  /** Sub-pane opacity, including its grid, separator and axis. Defaults to 1. */
  readonly opacity?: number;
}

/** Everything {@link renderChart} needs for one frame. All sizes are CSS pixels. */
export interface RenderView {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly plotWidth: number;
  readonly plotLeft?: number;
  readonly plotHeight: number;
  /** Backing-store pixels per CSS pixel; the context is scaled by this ratio. */
  readonly pixelRatio: number;
  readonly candles: readonly Candle[];
  /**
   * Visual OHLC override for the last bar of `displayCandles ?? candles`, in
   * the same space (a Heikin Ashi bar for `'heikin-ashi'`); calculations use `candles`.
   */
  readonly liveCandle?: Candle;
  /**
   * Main-series bars as displayed (Heikin Ashi bars for `'heikin-ashi'`); the
   * series, status line and price references read these, and `liveCandle`
   * overrides their last bar. Defaults to `candles`.
   */
  readonly displayCandles?: readonly Candle[];
  readonly range: VisibleRange;
  readonly timeScale: TimeScale;
  /** First entry is the main pane; the rest are indicator sub-panes. */
  readonly panes: readonly PaneRenderInfo[];
  readonly config: ChartConfig;
  readonly drawings: readonly ResolvedDrawing[];
  readonly crosshair: { readonly active: boolean; readonly x: number; readonly y: number };
  /** Main-series price lines, painted above the built-in price references in order. */
  readonly priceLines?: readonly PriceLineRenderItem[];
  /** Main-series markers sorted by time. */
  readonly markers?: readonly SeriesMarker[];
  /** Wall clock in ms for the bar-close countdown; without it the countdown is hidden. */
  readonly now?: () => number;
}

function drawIndicatorOutput(
  ctx: Canvas2DLike,
  output: IndicatorOutput,
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  length: number,
): void {
  drawIndicator(ctx, output, range, timeScale, priceScale, length);
}

function strokeHLine(ctx: Canvas2DLike, x1: number, x2: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function strokeVLine(ctx: Canvas2DLike, x: number, y1: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();
}

/**
 * Renders one complete frame. Pure with respect to `view`: every visual
 * decision flows from the view object, so tests can assert against a
 * recording mock context. All coordinates are CSS pixels; the 2D context is
 * scaled by `view.pixelRatio` for the duration of the frame.
 */
export function renderChart(ctx: Canvas2DLike, view: RenderView, overlay = true): void {
  ctx.save();
  ctx.scale(view.pixelRatio, view.pixelRatio);
  try {
    renderLayers(ctx, view, overlay);
  } finally {
    ctx.restore();
  }
}

function renderLayers(ctx: Canvas2DLike, view: RenderView, overlay: boolean): void {
  const { config, plotWidth, plotHeight } = view;
  const monoFont = scaleFont(config.theme);

  // Layer 0: background.
  ctx.fillStyle = config.theme.background;
  ctx.fillRect(0, 0, view.canvasWidth, view.canvasHeight);
  const plotLeft = view.plotLeft ?? 0;
  if (plotLeft > 0) {
    ctx.translate(plotLeft, 0);
    view = { ...view, crosshair: { ...view.crosshair, x: view.crosshair.x - plotLeft } };
  }
  const axisWidth = view.canvasWidth - plotWidth;
  const axisX = config.priceAxis.position === 'left' ? -axisWidth : plotWidth;

  // Layer 1: watermark (under everything else).
  drawWatermark(ctx, config.watermark, plotWidth, plotHeight, config.theme.fontFamily);

  // Layer 2: grid.
  const timeIndices = timeTickIndices(view.range, config.timeAxis.tickCount, view.timeScale, view.candles.length);
  if (config.grid.visible) {
    ctx.save();
    ctx.strokeStyle = config.grid.color;
    ctx.lineWidth = 1;
    if (config.grid.horizontal) {
      for (const pane of view.panes) {
        ctx.globalAlpha = pane.opacity ?? 1;
        for (const tick of pane.priceScale.ticks(config.priceAxis.tickCount)) {
          strokeHLine(ctx, 0, plotWidth, pane.layout.y + pane.priceScale.priceToY(tick));
        }
      }
    }
    if (config.grid.vertical) {
      ctx.globalAlpha = 1;
      for (const i of timeIndices) {
        strokeVLine(ctx, view.timeScale.indexToX(i, view.candles.length), 0, plotHeight);
      }
    }
    ctx.restore();
  }

  // Layer 3: main series. Continuous time axes also draw the candles just outside the viewport.
  const drawRange = view.timeScale.drawRange(view.range, view.candles.length);
  const mainPane = view.panes[0];
  if (mainPane !== undefined) {
    ctx.save();
    ctx.translate(0, mainPane.layout.y);
    ctx.beginPath();
    ctx.rect(0, 0, plotWidth, mainPane.layout.height);
    ctx.clip();
    drawVolumeOverlay(ctx, view, mainPane.layout.height);
    SERIES_RENDERERS[config.series.type](
      ctx,
      view.displayCandles ?? view.candles,
      drawRange,
      view.timeScale,
      mainPane.priceScale,
      config.series,
      view.liveCandle,
    );
    drawMarkers(ctx, view, mainPane.priceScale);
    // Layer 4a: main-pane indicators overlay the series.
    for (const [index, output] of mainPane.indicators.entries()) {
      ctx.globalAlpha = mainPane.indicatorOpacities?.[index] ?? 1;
      drawIndicatorOutput(ctx, output, drawRange, view.timeScale, mainPane.priceScale, view.candles.length);
    }
    ctx.restore();
  }

  // Layer 4b: sub-pane indicators.
  for (const pane of view.panes.slice(1)) {
    ctx.save();
    ctx.globalAlpha = pane.opacity ?? 1;
    ctx.translate(0, pane.layout.y);
    ctx.beginPath();
    ctx.rect(0, 0, plotWidth, pane.layout.height);
    ctx.clip();
    for (const output of pane.indicators) {
      drawIndicatorOutput(ctx, output, drawRange, view.timeScale, pane.priceScale, view.candles.length);
    }
    ctx.restore();
  }

  // Layer 5: drawings on the main pane, clipped to its plot area.
  if (mainPane !== undefined && view.drawings.length > 0) {
    ctx.save();
    ctx.translate(0, mainPane.layout.y);
    ctx.beginPath();
    ctx.rect(0, 0, plotWidth, mainPane.layout.height);
    ctx.clip();
    drawDrawings(ctx, view.drawings, {
      sansFamily: config.theme.fontFamily,
      monoFamily: config.theme.monoFamily,
      fontSize: config.theme.fontSize,
      background: config.theme.background,
      pixelRatio: view.pixelRatio,
      width: plotWidth,
    });
    ctx.restore();
  }

  // Layer 6: pane separators.
  ctx.save();
  ctx.strokeStyle = config.theme.borderColor;
  ctx.lineWidth = 1;
  for (const pane of view.panes) {
    ctx.globalAlpha = pane.opacity ?? 1;
    strokeHLine(ctx, 0, plotWidth, pane.layout.y);
  }
  ctx.restore();

  // Layer 7: axes.
  if (config.priceAxis.visible) {
    ctx.save();
    ctx.font = monoFont;
    ctx.fillStyle = config.theme.textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const pane of view.panes) {
      ctx.save();
      ctx.globalAlpha = pane.opacity ?? 1;
      if (pane.opacity !== undefined && pane.opacity < 1) {
        ctx.beginPath();
        ctx.rect(axisX, pane.layout.y, axisWidth, pane.layout.height);
        ctx.clip();
      }
      for (const tick of pane.priceScale.ticks(config.priceAxis.tickCount)) {
        ctx.fillText(
          pane.priceScale.format(tick, config.formatters.price, config.priceAxis.precision),
          axisX + 6,
          pane.layout.y + pane.priceScale.priceToY(tick),
        );
      }
      ctx.restore();
    }
    ctx.restore();
  }
  if (config.timeAxis.visible) {
    drawTimeAxis(
      ctx,
      view.candles,
      timeIndices,
      view.timeScale,
      plotHeight,
      config.formatters.time,
      config.theme.textColor,
      monoFont,
    );
  }

  drawPriceReferences(ctx, view);
  drawPriceLines(ctx, view);
  if (overlay) renderOverlayLayers(ctx, view);
}

/** Repaints hover-dependent status text and crosshair above a cached base. */
export function renderOverlay(ctx: Canvas2DLike, view: RenderView): void {
  ctx.save();
  ctx.scale(view.pixelRatio, view.pixelRatio);
  try {
    const left = view.plotLeft ?? 0;
    if (left > 0) {
      ctx.translate(left, 0);
      view = { ...view, crosshair: { ...view.crosshair, x: view.crosshair.x - left } };
    }
    renderOverlayLayers(ctx, view);
  } finally {
    ctx.restore();
  }
}

function renderOverlayLayers(ctx: Canvas2DLike, view: RenderView): void {
  const { config, plotWidth, plotHeight } = view;
  const mainPane = view.panes[0];
  const axisX = config.priceAxis.position === 'left' ? -(view.canvasWidth - plotWidth) : plotWidth;
  const monoFont = scaleFont(config.theme);
  drawStatusLine(ctx, view);
  drawCountdownLabel(ctx, view);

  // Layer 8: crosshair with axis label boxes.
  const mode = config.crosshair.mode;
  if (config.crosshair.visible && view.crosshair.active && mode !== 'arrow' &&
      view.crosshair.x >= 0 && view.crosshair.x <= plotWidth && view.crosshair.y <= plotHeight) {
    ctx.save();
    ctx.strokeStyle = config.crosshair.color;
    ctx.fillStyle = config.crosshair.color;
    ctx.lineWidth = 1;
    if (mode === 'cross') {
      ctx.setLineDash(config.crosshair.dashed ? [4, 4] : []);
      strokeVLine(ctx, view.crosshair.x, 0, plotHeight);
      strokeHLine(ctx, 0, plotWidth, view.crosshair.y);
      ctx.setLineDash([]);
    } else {
      // 'dot' marks the pointer; 'demonstration' adds a presenter halo.
      if (mode === 'demonstration') {
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.ellipse(view.crosshair.x, view.crosshair.y, 18, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.ellipse(view.crosshair.x, view.crosshair.y, 3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const pad = 4;
    const labelH = scaleFontSize(config.theme) + pad * 2;
    const labelColor = config.crosshair.labelColor === 'auto'
      ? contrastingTextColor(config.crosshair.labelBackground, config.theme.background)
      : config.crosshair.labelColor;
    ctx.font = monoFont;
    ctx.textBaseline = 'middle';
    // Price label box on the price axis, clamped inside the plot vertically.
    if (config.priceAxis.visible && mainPane !== undefined) {
      const hoveredPane = view.panes.find((pane) => view.crosshair.y >= pane.layout.y && view.crosshair.y <= pane.layout.y + pane.layout.height) ?? mainPane;
      const text = hoveredPane.priceScale.format(hoveredPane.priceScale.yToPrice(view.crosshair.y - hoveredPane.layout.y), config.formatters.price, config.priceAxis.precision);
      const w = ctx.measureText(text).width + pad * 2;
      const by = Math.min(Math.max(view.crosshair.y - labelH / 2, 0), plotHeight - labelH);
      ctx.fillStyle = config.crosshair.labelBackground;
      ctx.fillRect(axisX, by, w, labelH);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'left';
      ctx.fillText(text, axisX + pad, by + labelH / 2);
    }
    // Time label box on the time axis, clamped inside the plot horizontally.
    if (config.timeAxis.visible && view.candles.length > 0) {
      const idx = Math.min(
        view.candles.length - 1,
        Math.max(0, view.timeScale.xToIndex(view.crosshair.x, view.candles.length)),
      );
      const text = config.formatters.time(view.candles[idx].time);
      const w = ctx.measureText(text).width + pad * 2;
      const bx = Math.min(Math.max(view.crosshair.x - w / 2, 0), plotWidth - w);
      ctx.fillStyle = config.crosshair.labelBackground;
      ctx.fillRect(bx, plotHeight, w, labelH);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.fillText(text, bx + w / 2, plotHeight + labelH / 2);
    }
    ctx.restore();
  }
}
