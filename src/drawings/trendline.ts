/**
 * Trend line drawing: a straight segment between two (index, price) points.
 *
 * @module
 */

import type { DrawingDef } from './types.js';

/** Trend line model (name `'trendline'`, needs 2 points). */
export const trendlineDrawing: DrawingDef = {
  name: 'trendline',
  minPoints: 2,
  geometry(points, view) {
    const p0 = points[0];
    const p1 = points[1];
    if (p0 === undefined || p1 === undefined) return [];
    return [
      {
        type: 'line',
        x1: view.indexToX(p0.index),
        y1: view.priceToY(p0.price),
        x2: view.indexToX(p1.index),
        y2: view.priceToY(p1.price),
      },
    ];
  },
};
