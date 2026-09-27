/**
 * Parameter parsing shared by the built-in studies.
 *
 * @module
 */

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
