/**
 * Drawing registry: built-in models plus user-registered custom ones.
 *
 * @module
 */

import type { DrawingDef } from './types.js';
import { trendlineDrawing } from './trendline.js';
import { hlineDrawing } from './hline.js';
import { rectDrawing } from './rect.js';
import { fibDrawing } from './fib.js';

/** The four built-in drawing models. */
export const BUILTIN_DRAWINGS: readonly DrawingDef[] = [
  trendlineDrawing,
  hlineDrawing,
  rectDrawing,
  fibDrawing,
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
 * Creates a registry pre-loaded with the four built-in drawing models.
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
