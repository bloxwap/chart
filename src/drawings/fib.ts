/**
 * Fibonacci retracement drawing: level lines between two anchor points.
 *
 * @module
 */

import type { DrawingDef } from './types.js';

/** The retracement levels drawn, in order. */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Fibonacci retracement model (name `'fib'`, needs 2 points). */
export const fibDrawing: DrawingDef = {
  name: 'fib',
  minPoints: 2,
  geometry(points, view) {
    const p0 = points[0];
    const p1 = points[1];
    if (p0 === undefined || p1 === undefined) return [];
    const x1 = view.indexToX(p0.index);
    const x2 = view.indexToX(p1.index);
    const y1 = view.priceToY(p0.price);
    const y2 = view.priceToY(p1.price);
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const primitives = [];
    for (const level of FIB_LEVELS) {
      const y = y1 + (y2 - y1) * level;
      primitives.push({ type: 'line' as const, x1: left, y1: y, x2: right, y2: y });
      primitives.push({ type: 'text' as const, text: level.toFixed(3), x: right + 4, y });
    }
    return primitives;
  },
};
