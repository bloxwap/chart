/**
 * Layer-based canvas renderer. Layers, in order: background, watermark,
 * grid, series, indicators, drawings, axes, crosshair. Rendering is a full
 * redraw on every invalidate — deliberately simple.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { PaneLayout } from '../core/pane.js';
import type { ChartConfig } from '../config.js';
import type { IndicatorOutput } from '../indicators/types.js';
import type { DrawPrimitive } from '../drawings/types.js';
import type { Canvas2DLike } from '../dom.js';
import { SERIES_RENDERERS } from '../series/index.js';
import { drawHistogramBars } from '../series/histogram.js';
import { drawWatermark } from '../watermark.js';
import { drawTimeAxis, timeTickIndices } from './axis.js';

/** One pane with its scale and the indicator outputs that belong to it. */
export interface PaneRenderInfo {
  readonly layout: PaneLayout;
  readonly priceScale: PriceScale;
  readonly indicators: readonly IndicatorOutput[];
}

/** A resolved drawing with its pixel-space primitives. */
export interface ResolvedDrawing {
  readonly color: string;
  readonly lineWidth: number;
  readonly primitives: readonly DrawPrimitive[];
}

/** Everything {@link renderChart} needs for one frame. All sizes are CSS pixels. */
export interface RenderView {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
  /** Backing-store pixels per CSS pixel; the context is scaled by this ratio. */
  readonly pixelRatio: number;
  readonly candles: readonly Candle[];
  readonly range: VisibleRange;
  readonly timeScale: TimeScale;
  /** First entry is the main pane; the rest are indicator sub-panes. */
  readonly panes: readonly PaneRenderInfo[];
  readonly config: ChartConfig;
  readonly drawings: readonly ResolvedDrawing[];
  readonly crosshair: { readonly active: boolean; readonly x: number; readonly y: number };
}

function drawLinePath(
  ctx: Canvas2DLike,
  values: readonly (number | null)[],
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
): void {
  ctx.beginPath();
  let pen = false;
  for (let i = range.from; i < range.to; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) {
      pen = false;
      continue;
    }
    const x = timeScale.indexToX(i, values.length);
    const y = priceScale.priceToY(v);
    if (pen) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      pen = true;
    }
  }
  ctx.stroke();
}

function drawIndicatorOutput(
  ctx: Canvas2DLike,
  output: IndicatorOutput,
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
): void {
  if (output.bars !== undefined) {
    drawHistogramBars(
      ctx,
      output.bars.values,
      output.bars.up,
      range,
      timeScale,
      priceScale,
      output.bars.upColor,
      output.bars.downColor,
    );
  }
  for (const line of output.lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1;
    drawLinePath(ctx, line.values, range, timeScale, priceScale);
  }
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
export function renderChart(ctx: Canvas2DLike, view: RenderView): void {
  ctx.save();
  ctx.scale(view.pixelRatio, view.pixelRatio);
  try {
    renderLayers(ctx, view);
  } finally {
    ctx.restore();
  }
}

function renderLayers(ctx: Canvas2DLike, view: RenderView): void {
  const { config, plotWidth, plotHeight } = view;
  const monoFont = `${config.theme.fontSize}px ${config.theme.monoFamily}`;

  // Layer 0: background.
  ctx.fillStyle = config.theme.background;
  ctx.fillRect(0, 0, view.canvasWidth, view.canvasHeight);

  // Layer 1: watermark (under everything else).
  drawWatermark(ctx, config.watermark, plotWidth, plotHeight, config.theme.fontFamily);

  // Layer 2: grid.
  const timeIndices = timeTickIndices(view.range, config.timeAxis.tickCount);
  if (config.grid.visible) {
    ctx.save();
    ctx.strokeStyle = config.grid.color;
    ctx.lineWidth = 1;
    if (config.grid.horizontal) {
      for (const pane of view.panes) {
        for (const tick of pane.priceScale.ticks(config.priceAxis.tickCount)) {
          strokeHLine(ctx, 0, plotWidth, pane.layout.y + pane.priceScale.priceToY(tick));
        }
      }
    }
    if (config.grid.vertical) {
      for (const i of timeIndices) {
        strokeVLine(ctx, view.timeScale.indexToX(i, view.candles.length), 0, plotHeight);
      }
    }
    ctx.restore();
  }

  // Layer 3: main series.
  const mainPane = view.panes[0];
  if (mainPane !== undefined) {
    ctx.save();
    ctx.translate(0, mainPane.layout.y);
    SERIES_RENDERERS[config.series.type](
      ctx,
      view.candles,
      view.range,
      view.timeScale,
      mainPane.priceScale,
      config.series,
    );
    // Layer 4a: main-pane indicators overlay the series.
    for (const output of mainPane.indicators) {
      drawIndicatorOutput(ctx, output, view.range, view.timeScale, mainPane.priceScale);
    }
    ctx.restore();
  }

  // Layer 4b: sub-pane indicators.
  for (const pane of view.panes.slice(1)) {
    ctx.save();
    ctx.translate(0, pane.layout.y);
    for (const output of pane.indicators) {
      drawIndicatorOutput(ctx, output, view.range, view.timeScale, pane.priceScale);
    }
    ctx.restore();
  }

  // Layer 5: drawings on the main pane.
  if (mainPane !== undefined) {
    ctx.save();
    ctx.translate(0, mainPane.layout.y);
    for (const drawing of view.drawings) {
      ctx.strokeStyle = drawing.color;
      ctx.fillStyle = drawing.color;
      ctx.lineWidth = drawing.lineWidth;
      ctx.font = monoFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const prim of drawing.primitives) {
        if (prim.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(prim.x1, prim.y1);
          ctx.lineTo(prim.x2, prim.y2);
          ctx.stroke();
        } else if (prim.type === 'rect') {
          ctx.beginPath();
          ctx.rect(prim.x, prim.y, prim.w, prim.h);
          ctx.stroke();
        } else {
          ctx.fillText(prim.text, prim.x, prim.y);
        }
      }
    }
    ctx.restore();
  }

  // Layer 6: pane separators.
  ctx.save();
  ctx.strokeStyle = config.theme.borderColor;
  ctx.lineWidth = 1;
  for (const pane of view.panes) {
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
      for (const tick of pane.priceScale.ticks(config.priceAxis.tickCount)) {
        ctx.fillText(
          config.formatters.price(tick),
          plotWidth + 6,
          pane.layout.y + pane.priceScale.priceToY(tick),
        );
      }
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

  // Layer 8: crosshair with axis label boxes.
  if (config.crosshair.visible && view.crosshair.active) {
    ctx.save();
    ctx.strokeStyle = config.crosshair.color;
    ctx.lineWidth = 1;
    ctx.setLineDash(config.crosshair.dashed ? [4, 4] : []);
    strokeVLine(ctx, view.crosshair.x, 0, plotHeight);
    strokeHLine(ctx, 0, plotWidth, view.crosshair.y);
    ctx.setLineDash([]);

    const pad = 4;
    const labelH = config.theme.fontSize + pad * 2;
    ctx.font = monoFont;
    ctx.textBaseline = 'middle';
    // Price label box on the price axis, clamped inside the plot vertically.
    if (config.priceAxis.visible && mainPane !== undefined) {
      const text = config.formatters.price(mainPane.priceScale.yToPrice(view.crosshair.y));
      const w = ctx.measureText(text).width + pad * 2;
      const by = Math.min(Math.max(view.crosshair.y - labelH / 2, 0), plotHeight - labelH);
      ctx.fillStyle = config.crosshair.labelBackground;
      ctx.fillRect(plotWidth, by, w, labelH);
      ctx.fillStyle = config.crosshair.labelColor;
      ctx.textAlign = 'left';
      ctx.fillText(text, plotWidth + pad, by + labelH / 2);
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
      ctx.fillStyle = config.crosshair.labelColor;
      ctx.textAlign = 'center';
      ctx.fillText(text, bx + w / 2, plotHeight + labelH / 2);
    }
    ctx.restore();
  }
}
