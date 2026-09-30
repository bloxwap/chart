/**
 * Pane primitives: host draw passes attached to a pane, in the spirit of
 * TradingView's `IPanePrimitive`. A primitive paints on the pane's own canvas
 * layer, below or above its series and indicators.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { Canvas2DLike } from '../dom.js';
import type { GLQuadSink } from './gl/backend.js';

/** What a primitive sees when it draws. All sizes are CSS pixels. */
export interface PrimitiveDrawTarget {
  /** Pane width; the context is translated to the pane's top-left and clipped to `width` × `height`. */
  readonly width: number;
  readonly height: number;
  readonly priceScale: PriceScale;
  readonly timeScale: TimeScale;
  /** Bar range the pane's content draws (may extend past the viewport on a continuous axis). */
  readonly range: VisibleRange;
  readonly candles: readonly Candle[];
  readonly pixelRatio: number;
  /**
   * Set only on the main pane when the WebGL2 backend is active. Primitives
   * that can emit their geometry as quads (e.g. the heatmap) submit them here
   * instead of painting `ctx`; the frame composites at the series layer.
   */
  readonly gl?: GLQuadSink;
}

/** A custom canvas layer attached to a pane. */
export interface PanePrimitive {
  /** `'behind'` draws under the pane's series and indicators, `'above'` (default) over them. */
  readonly zOrder?: 'behind' | 'above';
  /** Paints the layer into the pane-clipped, pane-translated context. */
  draw(ctx: Canvas2DLike, target: PrimitiveDrawTarget): void;
}

/** Primitives of one pane, split by z-order for the renderer. */
export interface PanePrimitives {
  readonly behind: readonly PanePrimitive[];
  readonly above: readonly PanePrimitive[];
}

/** Splits primitives into `behind`/`above` draw passes, preserving order. */
export function splitPrimitives(primitives: readonly PanePrimitive[]): PanePrimitives {
  const behind: PanePrimitive[] = [];
  const above: PanePrimitive[] = [];
  for (const primitive of primitives) {
    (primitive.zOrder === 'behind' ? behind : above).push(primitive);
  }
  return { behind, above };
}
