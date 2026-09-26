/**
 * `defineDrawing` — the factory every built-in model uses. It owns the
 * point-count guard, view resolution, and pixel conversion so each model
 * only describes its geometry.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import type { DrawingDef, DrawingMeta, DrawPrimitive } from './types.js';
import { anchoredPx, resolveView, toPx, type FullView, type Pt } from './geom.js';

/** Meta used when the caller passes none. */
export const EMPTY_META: DrawingMeta = { text: '', image: null };

/** Model description accepted by {@link defineDrawing}. */
export interface DrawingSpec {
  readonly name: string;
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly freehand?: boolean;
  readonly anchored?: boolean;
  readonly wantsText?: boolean;
  normalize?(points: readonly DrawingPoint[]): DrawingPoint[];
  /**
   * Geometry from pixel points `p` (same order as `points` after
   * `normalize`, at least `minPoints` long) and the fully resolved view.
   */
  build(p: Pt[], view: FullView, points: readonly DrawingPoint[], meta: DrawingMeta): DrawPrimitive[];
}

/** Builds a {@link DrawingDef} from a {@link DrawingSpec}. */
export function defineDrawing(spec: DrawingSpec): DrawingDef {
  const { build, ...rest } = spec;
  return {
    ...rest,
    geometry(points, view, meta) {
      if (points.length < spec.minPoints) return [];
      const pts = spec.normalize !== undefined ? spec.normalize(points) : points;
      const px = spec.anchored === true ? anchoredPx(pts, view) : toPx(pts, view);
      return build(px, resolveView(view), pts, meta ?? EMPTY_META);
    },
  };
}
