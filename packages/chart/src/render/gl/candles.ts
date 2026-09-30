/**
 * Candlestick geometry for the WebGL2 backend: each wick and body becomes one
 * instanced quad, mirroring {@link drawCandlesticks} pixel-for-pixel. Candle
 * borders (`SeriesConfig.borderVisible`) are strokes, not quads, so bordered
 * candles stay on the Canvas2D path (the caller checks the flag).
 *
 * @module
 */

import { parseColor } from '../../color.js';
import type { Candle } from '../../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../../core/scale.js';
import type { SeriesConfig } from '../../config.js';
import type { GLQuadSink } from './backend.js';

type RGBA = readonly [number, number, number, number];

/** Channels 0-1 regardless of the parsed color's space; `null` for unsupported syntax. */
function glColor(input: string): RGBA | null {
  const c = parseColor(input);
  if (c === null) return null;
  const d = c.space === 'srgb' ? 255 : 1;
  return [c.r / d, c.g / d, c.b / d, c.a];
}

/**
 * Packs the visible candles into `sink` as wick and body quads in pane-local
 * CSS pixels (the sink applies the pixel ratio). Returns `false` without
 * emitting anything when a series color is not parseable — the caller then
 * draws the series with Canvas2D instead.
 */
export function packCandleQuads(
  sink: GLQuadSink,
  candles: readonly Candle[],
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  config: SeriesConfig,
  liveCandle?: Candle,
): boolean {
  const up = glColor(config.upColor);
  const down = glColor(config.downColor);
  const wickUp = glColor(config.wickUpColor !== '' ? config.wickUpColor : config.upColor);
  const wickDown = glColor(config.wickDownColor !== '' ? config.wickDownColor : config.downColor);
  if (up === null || down === null || wickUp === null || wickDown === null) return false;
  const bodyWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
  for (let i = range.from; i < range.to; i++) {
    const c = (i === candles.length - 1 ? liveCandle : undefined) ?? candles[i];
    const rising = c.close >= (config.colorByPreviousClose && i > 0 ? candles[i - 1].close : c.open);
    const body = rising ? up : down;
    const wick = rising ? wickUp : wickDown;
    const x = Math.round(timeScale.indexToX(i, candles.length));
    const yHigh = priceScale.priceToY(c.high);
    const yLow = priceScale.priceToY(c.low);
    const yOpen = priceScale.priceToY(c.open);
    const yClose = priceScale.priceToY(c.close);
    if (config.wickVisible) {
      sink.quad(x, Math.min(yHigh, yLow), 1, Math.max(1, Math.abs(yLow - yHigh)), wick[0], wick[1], wick[2], wick[3]);
    }
    if (config.bodyVisible) {
      const bodyTop = Math.min(yOpen, yClose);
      const height = Math.max(1, Math.abs(yClose - yOpen));
      sink.quad(x - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, height, body[0], body[1], body[2], body[3]);
    }
  }
  return true;
}
