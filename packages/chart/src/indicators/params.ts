/**
 * Parameter parsing shared by the built-in studies.
 *
 * @module
 */

import type { IndicatorDef } from './types.js';

/** A whole-number length: floored and at least `min`; `fallback` when missing or non-finite. */
export function lengthParam(params: Record<string, number>, key: string, fallback: number, min = 1): number {
  const value = params[key];
  return value !== undefined && Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}

/** A real-valued parameter; `fallback` when missing or non-finite. */
export function numberParam(params: Record<string, number>, key: string, fallback: number): number {
  const value = params[key];
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * Params for one indicator instance: non-finite values fall back to
 * `defaultParams`, then each declared input is clamped to `min`/`max` and
 * rounded when `integer`, matching the indicators dialog.
 */
export function normalizeIndicatorParams(
  def: Pick<IndicatorDef, 'defaultParams' | 'inputs'>,
  params: Record<string, number> | undefined,
): Record<string, number> {
  const next: Record<string, number> = { ...def.defaultParams, ...params };
  for (const input of def.inputs ?? []) {
    const value = next[input.key];
    if (value === undefined || !Number.isFinite(value)) {
      const fallback = def.defaultParams[input.key];
      if (fallback === undefined) delete next[input.key];
      else next[input.key] = fallback;
      continue;
    }
    let clamped = input.integer === true ? Math.round(value) : value;
    if (input.min !== undefined) clamped = Math.max(input.min, clamped);
    if (input.max !== undefined) clamped = Math.min(input.max, clamped);
    next[input.key] = clamped;
  }
  return next;
}
