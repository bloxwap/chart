/**
 * Horizontal line drawing: a full-width line at one price level.
 *
 * @module
 */

import type { DrawingDef } from './types.js';

/** Horizontal line model (name `'hline'`, needs 1 point). */
export const hlineDrawing: DrawingDef = {
  name: 'hline',
  minPoints: 1,
  geometry(points, view) {
    const p0 = points[0];
    if (p0 === undefined) return [];
    const y = view.priceToY(p0.price);
    return [{ type: 'line', x1: 0, y1: y, x2: view.width, y2: y }];
  },
};
