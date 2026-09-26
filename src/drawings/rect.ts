/**
 * Rectangle drawing: an axis-aligned box between two (index, price) corners.
 *
 * @module
 */

import type { DrawingDef } from './types.js';

/** Rectangle model (name `'rect'`, needs 2 points). */
export const rectDrawing: DrawingDef = {
  name: 'rect',
  minPoints: 2,
  geometry(points, view) {
    const p0 = points[0];
    const p1 = points[1];
    if (p0 === undefined || p1 === undefined) return [];
    const x0 = view.indexToX(p0.index);
    const y0 = view.priceToY(p0.price);
    const x1 = view.indexToX(p1.index);
    const y1 = view.priceToY(p1.price);
    return [
      {
        type: 'rect',
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      },
    ];
  },
};
