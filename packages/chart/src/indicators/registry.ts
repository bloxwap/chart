/**
 * Indicator registry: built-ins plus user-registered custom indicators.
 *
 * @module
 */

import type { IndicatorDef } from './types.js';
import { smaIndicator } from './sma.js';
import { emaIndicator } from './ema.js';
import { bollIndicator } from './boll.js';
import { macdIndicator } from './macd.js';
import { rsiIndicator } from './rsi.js';
import { kdjIndicator } from './kdj.js';
import { volIndicator } from './vol.js';

/** The seven built-in indicator definitions. */
export const BUILTIN_INDICATORS: readonly IndicatorDef[] = [
  smaIndicator,
  emaIndicator,
  bollIndicator,
  macdIndicator,
  rsiIndicator,
  kdjIndicator,
  volIndicator,
];

/** A mutable registry of indicator definitions keyed by name. */
export class IndicatorRegistry {
  private readonly defs = new Map<string, IndicatorDef>();

  /** Registers (or replaces) a definition. Returns `this` for chaining. */
  register(def: IndicatorDef): this {
    this.defs.set(def.name, def);
    return this;
  }

  /** Looks up a definition by name. */
  get(name: string): IndicatorDef | undefined {
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
 * Creates a registry pre-loaded with the seven built-ins.
 *
 * @param withBuiltins - Pass `false` for an empty registry.
 */
export function createIndicatorRegistry(withBuiltins = true): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  if (withBuiltins) {
    for (const def of BUILTIN_INDICATORS) registry.register(def);
  }
  return registry;
}
