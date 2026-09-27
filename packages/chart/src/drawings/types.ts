/**
 * Drawing model plugin contract.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import type { Candle } from '../core/data.js';
import type { CanvasImageSourceLike } from '../dom.js';

/**
 * Pixel-space view a drawing uses to place its geometry. The first four
 * members are always present; the chart also supplies the optional extras
 * (data, inverse mapping, formatters, semantic colors). Models must degrade
 * gracefully when an extra is absent — see {@link resolveView}.
 */
export interface DrawingView {
  /** X pixel of a bar index (fractional allowed). */
  indexToX(index: number): number;
  /** Y pixel of a price. */
  priceToY(price: number): number;
  /** Plot width in pixels. */
  readonly width: number;
  /** Pane height in pixels. */
  readonly height: number;
  /** Inverse of {@link indexToX}. */
  xToIndex?(x: number): number;
  /** Inverse of {@link priceToY}. */
  yToPrice?(y: number): number;
  /** The chart's candles (for data-aware tools: regression, VWAP, volume profile). */
  readonly candles?: readonly Candle[];
  /** Pixels per bar. */
  readonly barSpacing?: number;
  /** Price label formatter. */
  formatPrice?(price: number): string;
  /** Time label formatter (UNIX seconds). */
  formatTime?(time: number): string;
  /** Semantic "up"/"profit" color. */
  readonly upColor?: string;
  /** Semantic "down"/"loss" color. */
  readonly downColor?: string;
}

/** Per-instance payload a drawing may render (text notes, emoji, images). */
export interface DrawingMeta {
  /** Free text; `\n` separates lines. Tables use `|` between cells. */
  readonly text: string;
  /** Image for the image tool. */
  readonly image: CanvasImageSourceLike | null;
}

/**
 * Optional paint overrides shared by all primitives. Unset fields inherit
 * the drawing's color/width.
 */
export interface PrimitiveStyle {
  /** Stroke color override. */
  readonly color?: string;
  /** Stroke width override in CSS pixels. */
  readonly width?: number;
  /** Dash pattern override. */
  readonly dash?: readonly number[];
  /** Opacity multiplier for stroke and fill (0-1). */
  readonly alpha?: number;
  /** Fill color; `true` fills with the stroke color. Unset = no fill. */
  readonly fill?: string | true;
  /** Fill opacity (0-1); default 0.15. */
  readonly fillAlpha?: number;
  /** Skip the stroke (fill only). */
  readonly noStroke?: boolean;
}

/** Text placement and decoration. */
export interface TextStyle {
  readonly align?: 'left' | 'center' | 'right';
  readonly baseline?: 'top' | 'middle' | 'bottom';
  /** Font size in CSS pixels; default is the theme size. */
  readonly size?: number;
  readonly bold?: boolean;
  /** `'sans'` for prose, `'mono'` (default) for numbers. */
  readonly font?: 'sans' | 'mono';
  /** Text color override; boxed text defaults to black/white by background luminance. */
  readonly color?: string;
  /** Background box color; `true` uses the drawing color. */
  readonly bg?: string | true;
  /** Background box border color. */
  readonly border?: string;
  /** Background box padding; default 4. */
  readonly pad?: number;
  /** Background corner radius; default 3. */
  readonly radius?: number;
  /**
   * Keep the label within the plot horizontally: a box crossing its left or
   * right edge slides back in (see `slideInside`). Models set it only
   * while the labelled shape is on screen (`spansPlot`), so labels of
   * drawings scrolled out of view leave with them.
   */
  readonly inside?: boolean;
}

/** A pixel-space primitive produced by a drawing model. */
export type DrawPrimitive =
  | ({ readonly type: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } & PrimitiveStyle)
  | ({ readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number } & PrimitiveStyle)
  | ({ readonly type: 'text'; readonly text: string; readonly x: number; readonly y: number } & TextStyle)
  | ({
      readonly type: 'path';
      /** Flat `[x0, y0, x1, y1, …]` coordinates. */
      readonly points: readonly number[];
      readonly closed?: boolean;
    } & PrimitiveStyle)
  | ({
      readonly type: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly rotation?: number;
      /** Start angle (radians); default 0. */
      readonly start?: number;
      /** End angle (radians); default 2π. */
      readonly end?: number;
    } & PrimitiveStyle)
  | ({
      readonly type: 'bezier';
      readonly x1: number;
      readonly y1: number;
      readonly cx1: number;
      readonly cy1: number;
      readonly cx2: number;
      readonly cy2: number;
      readonly x2: number;
      readonly y2: number;
    } & PrimitiveStyle)
  | {
      readonly type: 'image';
      readonly image: CanvasImageSourceLike;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    };

/**
 * A registered drawing model. Register custom models via
 * {@link DrawingRegistry.register}.
 */
export interface DrawingDef {
  /** Unique registry name, e.g. `'trendline'`. */
  readonly name: string;
  /** Minimum number of points needed before geometry is produced. */
  readonly minPoints: number;
  /**
   * Points collected while placing the drawing. Defaults to `minPoints`;
   * `Infinity` means open-ended (path, polyline) finished by the host.
   */
  readonly maxPoints?: number;
  /** Placed by dragging a freehand stroke (brush, highlighter). */
  readonly freehand?: boolean;
  /**
   * Points are screen fractions (`index` = x/width, `price` = y/height)
   * rather than data coordinates, so the drawing stays pinned on screen.
   */
  readonly anchored?: boolean;
  /** Tools that render {@link DrawingMeta.text} and want the host to ask for it. */
  readonly wantsText?: boolean;
  /** Expands placed points into the stored set (e.g. adds a default stop). */
  normalize?(points: readonly DrawingPoint[]): DrawingPoint[];
  /** Pure geometry computation in pixel space. */
  geometry(points: readonly DrawingPoint[], view: DrawingView, meta?: DrawingMeta): DrawPrimitive[];
}
