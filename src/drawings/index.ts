/**
 * Drawing subsystem: registry, types, and the four built-in models.
 *
 * @module
 */

export type { DrawingDef, DrawingView, DrawPrimitive } from './types.js';
export { DrawingRegistry, createDrawingRegistry, BUILTIN_DRAWINGS } from './registry.js';
export { trendlineDrawing } from './trendline.js';
export { hlineDrawing } from './hline.js';
export { rectDrawing } from './rect.js';
export { fibDrawing, FIB_LEVELS } from './fib.js';
