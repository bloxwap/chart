/**
 * Drawing model plugin contract.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';

/** Pixel-space view a drawing uses to place its geometry. */
export interface DrawingView {
  /** X pixel of a bar index (fractional allowed). */
  indexToX(index: number): number;
  /** Y pixel of a price. */
  priceToY(price: number): number;
  /** Plot width in pixels. */
  readonly width: number;
  /** Pane height in pixels. */
  readonly height: number;
}

/** A pixel-space primitive produced by a drawing model. */
export type DrawPrimitive =
  | { readonly type: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'text'; readonly text: string; readonly x: number; readonly y: number };

/**
 * A registered drawing model. Register custom models via
 * {@link DrawingRegistry.register}.
 */
export interface DrawingDef {
  /** Unique registry name, e.g. `'trendline'`. */
  readonly name: string;
  /** Minimum number of points needed before geometry is produced. */
  readonly minPoints: number;
  /** Pure geometry computation in pixel space. */
  geometry(points: readonly DrawingPoint[], view: DrawingView): DrawPrimitive[];
}
