/**
 * Indicator plugin contract.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { WasmKernels } from '../wasm/loader.js';

/** One styled line of an indicator output, aligned to candle indices. */
export interface IndicatorLine {
  /** Role key, e.g. `'value'`, `'upper'`, `'dif'`. */
  readonly key: string;
  /** One value per candle index; `null` where undefined (warmup). */
  readonly values: readonly (number | null)[];
  readonly color: string;
}

/** Direction-colored histogram bars, e.g. VOL or the MACD histogram. */
export interface IndicatorBars {
  readonly values: readonly (number | null)[];
  /** Per-index direction: true paints `upColor`, false `downColor`. */
  readonly up: readonly boolean[];
  readonly upColor: string;
  readonly downColor: string;
}

/** Everything needed to draw one indicator instance. */
export interface IndicatorOutput {
  readonly pane: 'main' | 'sub';
  readonly lines: readonly IndicatorLine[];
  /** Optional histogram bars drawn behind the lines. */
  readonly bars?: IndicatorBars;
}

/**
 * A registered indicator: name, defaults, and a pure compute function.
 * Register custom indicators via {@link IndicatorRegistry.register}.
 */
export interface IndicatorDef {
  /** Unique registry name, e.g. `'sma'`. */
  readonly name: string;
  /** Default parameters, e.g. `{ period: 20 }`. */
  readonly defaultParams: Record<string, number>;
  /**
   * Default colors. {@link UP_COLOR}/{@link DOWN_COLOR} entries follow the
   * series' `upColor`/`downColor`, so direction-colored bars always match
   * the candles.
   */
  readonly defaultColors: string[];
  /** Which pane the indicator belongs to by default. */
  readonly defaultPane: 'main' | 'sub';
  /**
   * Computes the output from candles. Must be pure. Implementations use
   * `kernels` when non-null and a scalar JS path otherwise.
   */
  compute(
    candles: readonly Candle[],
    params: Record<string, number>,
    colors: readonly string[],
    kernels: WasmKernels | null,
  ): IndicatorOutput;
  /**
   * Optional tail updater for appended/replaced latest candles. `from` is the
   * first changed index; earlier candles are unchanged. The cached output is
   * owned by this chart and may be updated in place. Return undefined to use
   * full compute. History edits, new parameters/colors and WASM changes always
   * use compute; custom indicators without this hook retain that behavior.
   */
  update?(
    output: IndicatorOutput,
    candles: readonly Candle[],
    from: number,
    params: Record<string, number>,
    colors: readonly string[],
    kernels: WasmKernels | null,
  ): IndicatorOutput | undefined;
}

/** Color token resolved to the series' `upColor` at render time. */
export const UP_COLOR = 'up';

/** Color token resolved to the series' `downColor` at render time. */
export const DOWN_COLOR = 'down';

/** Replaces {@link UP_COLOR}/{@link DOWN_COLOR} tokens with concrete colors. */
export function resolveIndicatorColors(colors: readonly string[], upColor: string, downColor: string): string[] {
  return colors.map((c) => (c === UP_COLOR ? upColor : c === DOWN_COLOR ? downColor : c));
}
