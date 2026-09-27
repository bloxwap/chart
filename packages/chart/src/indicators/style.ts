/**
 * Per-instance indicator styling: config normalisation, patches, and the
 * line widths / hidden plots the chart applies to computed outputs.
 *
 * @module
 */

import type { IndicatorConfig } from '../config.js';
import { indicatorLineKeys, type IndicatorDef, type IndicatorLine, type IndicatorOutput } from './types.js';

/** An {@link IndicatorConfig} with its defaulted styling fields present. */
export type ResolvedIndicatorConfig = IndicatorConfig & { lineWidths: number[]; hiddenLines: string[] };

/**
 * Editable fields of an indicator instance (see `Chart.updateIndicator`).
 * `params` merge per key over the current values; arrays replace.
 */
export type IndicatorPatch = Partial<Omit<IndicatorConfig, 'id' | 'name'>>;

const NONE: readonly never[] = [];

/** Adds missing `lineWidths`/`hiddenLines` (older configs) in place and returns the config. */
export function normalizeIndicatorConfig(config: IndicatorConfig): ResolvedIndicatorConfig {
  config.lineWidths ??= [];
  config.hiddenLines ??= [];
  return config as ResolvedIndicatorConfig;
}

/** Applies `patch` in place: `params` merge per key, every other field (arrays copied) replaces. */
export function applyIndicatorPatch(config: IndicatorConfig, patch: IndicatorPatch): void {
  if (patch.params !== undefined) config.params = { ...config.params, ...patch.params };
  if (patch.colors !== undefined) config.colors = [...patch.colors];
  if (patch.lineWidths !== undefined) config.lineWidths = [...patch.lineWidths];
  if (patch.hiddenLines !== undefined) config.hiddenLines = [...patch.hiddenLines];
  if (patch.pane !== undefined) config.pane = patch.pane;
  if (patch.visible !== undefined) config.visible = patch.visible;
}

/**
 * Applies an instance's `lineWidths` and `hiddenLines` to a computed output.
 * Returns `output` itself when neither is set, so unstyled indicators cost
 * nothing per frame. Hidden keys drop lines, bars, fills and levels; a hidden
 * line that bounds a visible fill moves to `fillLines`, so the band stays.
 *
 * When `def` declares line/dots style rows, a line's width is
 * `lineWidths[indicatorLineKeys(def).indexOf(line.key)]`, so widths stay
 * with their plots when a study omits some lines (MA Ribbon's disabled slots,
 * VWAP without bands); otherwise widths follow the output line order.
 */
export function styleIndicatorOutput(
  output: IndicatorOutput,
  config: Pick<IndicatorConfig, 'lineWidths' | 'hiddenLines'>,
  def?: Pick<IndicatorDef, 'styles'>,
): IndicatorOutput {
  const widths = config.lineWidths ?? NONE;
  const hidden: readonly string[] = config.hiddenLines ?? NONE;
  if (widths.length === 0 && hidden.length === 0) return output;
  const keys: readonly string[] = widths.length > 0 && def !== undefined ? indicatorLineKeys(def) : NONE;
  const shown = (key: string | undefined): boolean => key === undefined || !hidden.includes(key);
  const fills = output.fills?.filter((fill) => shown(fill.key));
  const lines: IndicatorLine[] = [];
  const bounds: IndicatorLine[] = [...(output.fillLines ?? NONE)];
  for (let i = 0; i < output.lines.length; i++) {
    const line = output.lines[i];
    if (!shown(line.key)) {
      if (fills?.some((fill) => fill.upperKey === line.key || fill.lowerKey === line.key)) bounds.push(line);
      continue;
    }
    const width = keys.length > 0 ? widths[keys.indexOf(line.key)] : widths[i];
    lines.push(width !== undefined && width > 0 && Number.isFinite(width) ? { ...line, lineWidth: width } : line);
  }
  const styled: { -readonly [K in keyof IndicatorOutput]: IndicatorOutput[K] } = { ...output, lines };
  if (output.bars !== undefined && !shown(output.bars.key)) delete styled.bars;
  if (fills !== undefined) styled.fills = fills;
  if (bounds.length > 0) styled.fillLines = bounds;
  if (output.levels !== undefined) styled.levels = output.levels.filter((level) => shown(level.key));
  return styled;
}
