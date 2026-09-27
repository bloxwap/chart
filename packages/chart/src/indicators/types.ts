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
  /** Stroke width in CSS pixels (dot size for `'dots'`). Default 1. */
  readonly lineWidth?: number;
  /**
   * `'line'` (default) joins points; `'step'` draws horizontal-then-vertical
   * steps; `'dots'` fills a circle per value (Parabolic SAR).
   */
  readonly style?: 'line' | 'dots' | 'step';
  /** Canvas dash pattern, e.g. `[6, 4]`. Default solid. */
  readonly dash?: readonly number[];
  /**
   * Bars to shift the plot by: `values[i]` is drawn at bar `i + offset`
   * (Ichimoku spans). Positive offsets extend into the right-side whitespace
   * past the last candle; negative ones shift back. Default 0.
   */
  readonly offset?: number;
  /**
   * Per-index colors overriding {@link color}; `null`/missing entries use
   * {@link color}. The path breaks where the color changes (Supertrend).
   */
  readonly colors?: readonly (string | null)[];
}

/**
 * A band filled between two lines of the same output, e.g. the Ichimoku
 * Kumo. `color` paints where the upper line is at or above the lower one,
 * `colorBelow` (default `color`) where it is below. Hidden only by its own
 * `key`: as in TradingView, hiding a boundary line keeps the band.
 */
export interface IndicatorFill {
  /** Key toggled via `IndicatorConfig.hiddenLines`. */
  readonly key?: string;
  readonly upperKey: string;
  readonly lowerKey: string;
  readonly color: string;
  readonly colorBelow?: string;
}

/** A horizontal reference line, e.g. the Stochastic 80/20 bands. */
export interface IndicatorLevel {
  /** Key toggled via `IndicatorConfig.hiddenLines`. */
  readonly key?: string;
  readonly value: number;
  readonly color: string;
  /** Dash pattern; default `[4, 4]`, pass `[]` for solid. */
  readonly dash?: readonly number[];
}

/** Direction-colored histogram bars, e.g. VOL or the MACD histogram. */
export interface IndicatorBars {
  /** Key toggled via `IndicatorConfig.hiddenLines`, e.g. `'hist'`. */
  readonly key?: string;
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
  /** Bands filled between pairs of {@link lines} (or {@link fillLines}), drawn first. */
  readonly fills?: readonly IndicatorFill[];
  /**
   * Fill-only boundary lines: never stroked, labelled or shown in the status
   * line, but {@link fills} resolve keys here after {@link lines} and
   * autoscale includes them. The chart moves a hidden line here while a
   * visible fill still uses it.
   */
  readonly fillLines?: readonly IndicatorLine[];
  /** Horizontal reference lines, drawn under the bars and lines and kept in autoscale. */
  readonly levels?: readonly IndicatorLevel[];
}

/** One user-editable parameter of an {@link IndicatorDef} (the settings "Inputs" tab). */
export interface IndicatorInputDef {
  /** Key in `IndicatorConfig.params`, e.g. `'period'`. */
  readonly key: string;
  /** Human label, e.g. `'Length'`. */
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Whole numbers only (lengths). */
  readonly integer?: boolean;
  /** A fixed choice list rendered as a select instead of a number field. */
  readonly options?: readonly { readonly value: number; readonly label: string }[];
}

/**
 * One row of an {@link IndicatorDef}'s "Style" tab. `key` names the output
 * plot (a line, bars, fill or level key) that `IndicatorConfig.hiddenLines`
 * toggles; a plot with several colors (histogram up/down, Supertrend
 * up/down, Kumo bull/bear) has one row per color sharing that key.
 * Line and dots rows address `IndicatorConfig.lineWidths` by their key's
 * position in {@link indicatorLineKeys}, which matches the output line order.
 */
export interface IndicatorStyleDef {
  readonly key: string;
  readonly label: string;
  /**
   * Index into `IndicatorConfig.colors`; a configured array shorter than
   * {@link IndicatorDef.defaultColors} uses the defaults for the rest (see
   * {@link indicatorStyleColors}). Entries may be the {@link UP_COLOR}/
   * {@link DOWN_COLOR} tokens, which follow the series colors: display them
   * via {@link resolveIndicatorColors}. Writing a concrete color over a token
   * pins that plot, so it stops following series recolors; writing the token
   * back restores that.
   */
  readonly colorIndex: number;
  /** Plot kind; default `'line'`. */
  readonly kind?: 'line' | 'dots' | 'histogram' | 'fill' | 'level';
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
  /** Display name, e.g. `'Ichimoku Cloud'`. */
  readonly label?: string;
  /** Compact legend name, e.g. `'Ichimoku'`. */
  readonly shortName?: string;
  /** Editable parameters, in display order. */
  readonly inputs?: readonly IndicatorInputDef[];
  /** Styleable plots, in display order. */
  readonly styles?: readonly IndicatorStyleDef[];
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

/**
 * An instance's colors padded to one per {@link IndicatorDef.defaultColors}
 * entry (`colors[i]`, else the default), tokens kept. A settings UI reads a
 * style row's color at `colorIndex` (resolved for display) and writes the
 * whole array back with that entry changed.
 */
export function indicatorStyleColors(def: Pick<IndicatorDef, 'defaultColors'>, colors: readonly string[]): string[] {
  const out = [...colors];
  for (let i = colors.length; i < def.defaultColors.length; i++) out.push(def.defaultColors[i]);
  return out;
}

/**
 * Keys of a definition's stroked plots (`'line'`/`'dots'` style rows,
 * de-duplicated) in output line order. A key's position here is its index
 * in `IndicatorConfig.lineWidths`.
 */
export function indicatorLineKeys(def: Pick<IndicatorDef, 'styles'>): string[] {
  const keys: string[] = [];
  for (const style of def.styles ?? []) {
    const kind = style.kind ?? 'line';
    if ((kind === 'line' || kind === 'dots') && !keys.includes(style.key)) keys.push(style.key);
  }
  return keys;
}
