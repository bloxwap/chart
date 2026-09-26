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
  /** Default line colors. */
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
}
