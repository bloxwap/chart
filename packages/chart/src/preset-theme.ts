/**
 * A `chartTheme` mapping for the drawing toolbar and the settings card that
 * keeps a brand preset's colors on its theme without re-applying the rest of
 * the preset (fonts, sizes, the volume overlay, the status line…), so a theme
 * toggle never undoes the chart's config or the user's settings.
 *
 * ```ts
 * const chart = createChart({ container, preset: 'bloxwapDark', config: { data } });
 * const chartTheme = presetChartTheme('bloxwapDark');
 * const toolbar = createDrawingToolbar({ chart, ..., chartTheme });
 * const settings = createChartSettings({ chart, ..., chartTheme }); // so Reset defaults agrees
 * ```
 *
 * @module
 */

import { DEFAULT_CONFIG, mergeDeep, type ChartConfig, type DeepPartial } from './config.js';
import { withPreset, type ChartPresetName } from './presets.js';
import { CHART_THEMES, type ThemeName } from './themes.js';

/**
 * The colors a theme owns: chrome, grid, crosshair, series and the heatmap
 * ramp. Volume colors are left out; they follow the series colors by default.
 */
const THEME_COLORS: Readonly<Record<string, readonly string[]>> = {
  theme: ['background', 'textColor', 'borderColor'],
  grid: ['color'],
  crosshair: ['color', 'labelBackground', 'labelColor'],
  series: ['upColor', 'downColor', 'wickUpColor', 'wickDownColor', 'borderUpColor', 'borderDownColor', 'lineColor', 'areaFillColor', 'histogramColor'],
  heatmap: ['colorLow', 'colorHigh', 'stops'],
};

type Groups = Record<string, Record<string, unknown> | undefined>;

/** The {@link THEME_COLORS} that `config` sets, each valued from `values`. */
function themeColors(config: DeepPartial<ChartConfig>, values: DeepPartial<ChartConfig>): DeepPartial<ChartConfig> {
  const set = config as Groups, from = values as Groups;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [group, keys] of Object.entries(THEME_COLORS)) {
    for (const key of keys) if (set[group]?.[key] !== undefined) (out[group] ??= {})[key] = from[group]![key];
  }
  return out as DeepPartial<ChartConfig>;
}

/**
 * Maps toolbar themes to chart colors for a chart built on `preset`: on
 * `presetTheme` (default `'dark'`) the preset's theme colors over
 * `CHART_THEMES[presetTheme]`; on the other theme `CHART_THEMES[theme]`, with
 * every other color the preset set (wicks, borders, crosshair labels) back at
 * its default so none of the brand lingers. Only colors: fonts, sizes and
 * feature toggles are never touched. Pass it as `chartTheme` to both
 * `createDrawingToolbar` and `createChartSettings`.
 *
 * @throws If `preset` names no built-in preset.
 */
export function presetChartTheme(
  preset: ChartPresetName | DeepPartial<ChartConfig>,
  presetTheme: ThemeName = 'dark',
): (theme: ThemeName) => DeepPartial<ChartConfig> {
  const config = withPreset(preset, {})!;
  const colors = themeColors(config, config);
  const defaults = themeColors(config, DEFAULT_CONFIG as DeepPartial<ChartConfig>);
  return (theme) => (theme === presetTheme ? mergeDeep(CHART_THEMES[theme], colors) : mergeDeep(defaults, CHART_THEMES[theme]));
}
