/**
 * Drawing subsystem: registry, types, geometry helpers, the toolbar
 * catalog, and every built-in model.
 *
 * @module
 */

export type { DrawingDef, DrawingView, DrawingMeta, DrawPrimitive, PrimitiveStyle, TextStyle } from './types.js';
export { DrawingRegistry, createDrawingRegistry, BUILTIN_DRAWINGS } from './registry.js';
export { defineDrawing, EMPTY_META } from './define.js';
export type { DrawingSpec } from './define.js';
export * from './geom.js';
export { hitTest, distToSegment } from './hit.js';
export { TOOL_GROUPS, CURSOR_MODES, findTool } from './catalog.js';
export type { ToolEntry, ToolSection, ToolGroup } from './catalog.js';
export * from './lines.js';
export * from './channels.js';
export * from './fibonacci.js';
export * from './patterns.js';
export * from './forecasting.js';
export * from './shapes.js';
export * from './annotations.js';
