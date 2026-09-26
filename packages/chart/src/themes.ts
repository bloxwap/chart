/**
 * Built-in chart color themes. They pair with the toolbar's `dark`/`light`
 * themes so the canvas and the UI chrome always match.
 *
 * ```ts
 * chart.updateConfig(CHART_THEMES.light);
 * toolbar.setTheme('light');
 * ```
 *
 * @module
 */

import type { ChartConfig, DeepPartial } from './config.js';

/** Theme names shared by the chart presets and the toolbar. */
export type ThemeName = 'dark' | 'light';

/** Config partials for each theme; merge with `updateConfig`. */
export const CHART_THEMES: Readonly<Record<ThemeName, DeepPartial<ChartConfig>>> = {
  dark: {
    theme: { background: '#0a0a0a', textColor: '#a1a1a1', borderColor: '#262626' },
    grid: { color: 'rgba(255, 255, 255, 0.05)' },
    crosshair: { color: '#737373' },
  },
  light: {
    theme: { background: '#ffffff', textColor: '#4a5568', borderColor: '#e2e8f0' },
    grid: { color: 'rgba(120, 130, 150, 0.15)' },
    crosshair: { color: '#4a5568' },
  },
};
