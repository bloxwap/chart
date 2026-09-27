/**
 * Scale typography. Price/time tick labels, crosshair axis labels and price
 * badges share one font, which can differ from the status line and drawings
 * (TradingView sizes its scales independently of the legend).
 *
 * @module
 */

import type { ThemeConfig } from '../config.js';

/** Scale text size in CSS pixels: `theme.scaleFontSize`, else `theme.fontSize`. */
export function scaleFontSize(theme: ThemeConfig): number {
  return theme.scaleFontSize ?? theme.fontSize;
}

/** CSS font shorthand for scale text, e.g. `11px system-ui`. The family falls back to `theme.monoFamily`. */
export function scaleFont(theme: ThemeConfig): string {
  return `${scaleFontSize(theme)}px ${theme.scaleFontFamily !== '' ? theme.scaleFontFamily : theme.monoFamily}`;
}
