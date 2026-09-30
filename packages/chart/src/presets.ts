/**
 * Named brand presets: complete looks layered under the built-in themes and
 * the caller's config (`preset` < `theme` < `config`).
 *
 * ```ts
 * const chart = createChart({ container, preset: 'bloxwapDark', config: { data } });
 * chart.updateConfig(bloxwapDark); // or apply later
 * ```
 *
 * Anything that applies a built-in theme afterwards (the drawing toolbar's
 * `setTheme`, including the one it runs when mounted, or the React
 * `<Chart theme>` prop) layers `CHART_THEMES` over the preset. Keep the
 * preset by mounting the toolbar with `applyChartTheme: false`, or keep its
 * colors on dark with `chartTheme: presetChartTheme(preset)` (on the toolbar
 * and the settings card, so Reset defaults agrees); `<Chart preset>` without a
 * `theme` prop keeps it too.
 *
 * @module
 */

import { mergeDeep, type ChartConfig, type DeepPartial } from './config.js';
import { DOWN_COLOR, UP_COLOR } from './indicators/types.js';

/** Names of the built-in {@link CHART_PRESETS}. */
export type ChartPresetName = 'bloxwapDark';

const PANE = '#171717';
const UP = '#00ff3f';
const DOWN = '#ff479c';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * The bloxwap.pro dark look: #171717 pane, faint grid, 11px system-ui scales
 * in #a1a1a1, borderless #00ff3f / #ff479c candles over a 50% volume overlay,
 * direction-colored last-price line and badge, a background-free system-ui
 * status line, invisible pane separators and a neutral crosshair. When the
 * liquidity heatmap is turned on it ramps neutral greys (thin liquidity) into
 * brand gold and yellow (walls), keeping clear of the candle colors.
 */
export const bloxwapDark: DeepPartial<ChartConfig> = {
  theme: {
    background: PANE,
    textColor: '#a1a1a1',
    // Pane separators paint the pane color, so they vanish.
    borderColor: PANE,
    // One family everywhere, like TradingView's custom_font_family: UI text,
    // the status line and drawing labels (monoFamily), and the scales.
    fontFamily: FONT,
    monoFamily: FONT,
    scaleFontFamily: FONT,
    scaleFontSize: 11,
  },
  grid: { color: 'rgba(255, 255, 255, 0.05)' },
  crosshair: { color: '#737373', labelBackground: '#262626', labelColor: '#fafafa' },
  series: {
    upColor: UP,
    downColor: DOWN,
    wickUpColor: UP,
    wickDownColor: DOWN,
    borderVisible: false,
    borderUpColor: UP,
    borderDownColor: DOWN,
  },
  statusLine: { visible: true, volume: false },
  priceAxis: { labels: { lastPrice: true }, lines: { lastPrice: true } },
  volume: { overlay: true, upColor: UP_COLOR, downColor: DOWN_COLOR, opacity: 0.5 },
  // Colors only; the heatmap stays off until a host or the user enables it. A linear
  // intensity curve keeps mid-sized levels grey so the gold walls stand out.
  heatmap: {
    stops: [
      { color: '#404040', at: 0 },
      { color: '#737373', at: 0.4 },
      { color: '#ffc83d', at: 0.85 },
      { color: '#fffb38', at: 1 },
    ],
    gamma: 1,
  },
};

/** Built-in presets by name; pass a name as `createChart({ preset })` or merge one with `updateConfig`. */
export const CHART_PRESETS: Readonly<Record<ChartPresetName, DeepPartial<ChartConfig>>> = { bloxwapDark };

/**
 * Layers a preset (a name or a config partial) under `partial`, which wins
 * field by field. Returns `partial` unchanged when `preset` is undefined.
 */
export function withPreset(
  preset: ChartPresetName | DeepPartial<ChartConfig> | undefined,
  partial: DeepPartial<ChartConfig> | undefined,
): DeepPartial<ChartConfig> | undefined {
  if (preset === undefined) return partial;
  return mergeDeep(typeof preset === 'string' ? namedPreset(preset) : preset, partial);
}

function namedPreset(name: string): DeepPartial<ChartConfig> {
  if (!Object.hasOwn(CHART_PRESETS, name)) throw new Error(`chart-ts: unknown preset "${name}"`);
  return CHART_PRESETS[name as ChartPresetName];
}
