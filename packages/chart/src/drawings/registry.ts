/**
 * Drawing registry: built-in models plus user-registered custom ones.
 *
 * @module
 */

import type { DrawingDef } from './types.js';
import { LINE_DRAWINGS } from './lines.js';
import { CHANNEL_DRAWINGS } from './channels.js';
import { FIB_DRAWINGS } from './fibonacci.js';
import { PATTERN_DRAWINGS } from './patterns.js';
import { FORECAST_DRAWINGS } from './forecasting.js';
import { SHAPE_DRAWINGS } from './shapes.js';
import { ANNOTATION_DRAWINGS } from './annotations.js';

/** Every built-in drawing model (see `TOOL_GROUPS` for toolbar grouping). */
export const BUILTIN_DRAWINGS: readonly DrawingDef[] = [
  ...LINE_DRAWINGS,
  ...CHANNEL_DRAWINGS,
  ...FIB_DRAWINGS,
  ...PATTERN_DRAWINGS,
  ...FORECAST_DRAWINGS,
  ...SHAPE_DRAWINGS,
  ...ANNOTATION_DRAWINGS,
];

/** A mutable registry of drawing definitions keyed by name. */
export class DrawingRegistry {
  private readonly defs = new Map<string, DrawingDef>();

  /** Registers (or replaces) a definition. Returns `this` for chaining. */
  register(def: DrawingDef): this {
    this.defs.set(def.name, def);
    return this;
  }

  /** Looks up a definition by name. */
  get(name: string): DrawingDef | undefined {
    return this.defs.get(name);
  }

  /** True when `name` is registered. */
  has(name: string): boolean {
    return this.defs.has(name);
  }

  /** Removes a definition; returns whether it existed. */
  unregister(name: string): boolean {
    return this.defs.delete(name);
  }

  /** All registered names. */
  names(): string[] {
    return [...this.defs.keys()];
  }
}

/**
 * Creates a registry pre-loaded with every built-in drawing model.
 *
 * @param withBuiltins - Pass `false` for an empty registry.
 */
export function createDrawingRegistry(withBuiltins = true): DrawingRegistry {
  const registry = new DrawingRegistry();
  if (withBuiltins) {
    for (const def of BUILTIN_DRAWINGS) registry.register(def);
  }
  return registry;
}
