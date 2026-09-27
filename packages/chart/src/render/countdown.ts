/**
 * Bar-close countdown: time left until the latest bar closes, shown in the
 * status line and optionally under the last-price badge. Markets are assumed
 * to trade 24x7, so no session calendar applies. The clock comes from the
 * view (the chart's injected `now`); the renderer never reads the time itself.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { Canvas2DLike } from '../dom.js';
import type { RenderView } from './renderer.js';
import { contrastingTextColor } from '../color.js';
import { scaleFont } from './scale-font.js';
import { lastDisplayedBar, priceBadgeHeight, priceBadgeTop } from './price-badge.js';

const pad = (n: number): string => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;
/** Mean Gregorian month. */
const MONTH_MS = 30.436875 * DAY_MS;

/**
 * Formats a remaining duration TradingView-style: `mm:ss` under an hour,
 * `hh:mm:ss` under a day, `Nd hh:mm` beyond. Partial seconds round up, so a
 * bar reads `00:00` only once it has closed; negative input clamps to `00:00`.
 */
export function formatCountdown(ms: number): string {
  const total = ms > 0 ? Math.ceil(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600) % 24;
  if (total < 3600) return `${pad(minutes)}:${pad(seconds)}`;
  if (total < 86400) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${Math.floor(total / 86400)}d ${pad(hours)}:${pad(minutes)}`;
}

/**
 * The bar interval in ms: a positive finite `intervalMs`, else the time delta
 * of the last two candles, else `null` (unknown).
 */
export function barIntervalMs(candles: readonly Candle[], intervalMs: number | null): number | null {
  if (intervalMs !== null && intervalMs > 0 && Number.isFinite(intervalMs)) return intervalMs;
  const n = candles.length;
  const delta = n < 2 ? 0 : (candles[n - 1]!.time - candles[n - 2]!.time) * 1000;
  return delta > 0 ? delta : null;
}

/**
 * Close time in ms of a bar opening at `openMs`: one `intervalMs` later, or
 * N UTC calendar months later when the interval spans N months (N×28 to N×31
 * days, e.g. 1M, 3M or 12M bars), since months differ in length.
 */
export function barCloseMs(openMs: number, intervalMs: number): number {
  const months = Math.round(intervalMs / MONTH_MS);
  if (months < 1 || intervalMs < months * 28 * DAY_MS || intervalMs > months * 31 * DAY_MS) return openMs + intervalMs;
  const close = new Date(openMs);
  close.setUTCMonth(close.getUTCMonth() + months);
  return close.getTime();
}

/**
 * Milliseconds until the latest bar closes at `now` (negative once overdue),
 * or `null` without candles or a known interval.
 */
export function barCountdownMs(candles: readonly Candle[], intervalMs: number | null, now: number): number | null {
  const last = candles[candles.length - 1];
  const interval = barIntervalMs(candles, intervalMs);
  return last === undefined || interval === null ? null : barCloseMs(last.time * 1000, interval) - now;
}

/**
 * The formatted countdown for a frame, or `null` when it cannot be shown. The
 * interval is `timeAxis.intervalMs`, else the continuous axis's declared
 * `timeScale.intervalMs` (so the first bar after a weekend never reads as a
 * multi-day bar), else inferred from the last two candles.
 */
export function countdownText(view: RenderView): string | null {
  const { timeAxis, timeScale } = view.config;
  const remaining = view.now === undefined ? null : barCountdownMs(view.candles, timeAxis.intervalMs ?? timeScale.intervalMs, view.now());
  return remaining === null ? null : formatCountdown(remaining);
}

/** One colored run of status-line text. */
export interface StatusSegment {
  text: string;
  color: string;
  /** Spacing drawn after the text when another segment follows on its row. */
  gap: string;
  /** Wraps together with the previous segment instead of starting a row on its own. */
  attach?: boolean;
}

/**
 * Appends the countdown to status-line segments, separated from the previous
 * one and attached to it, so a wrapping status line never strands it alone.
 */
export function pushCountdownSegment(segments: StatusSegment[], view: RenderView): void {
  const text = countdownText(view);
  if (text === null) return;
  const previous = segments[segments.length - 1];
  if (previous !== undefined) previous.gap = '   ';
  segments.push({ text, color: view.config.theme.textColor, gap: '', attach: true });
}

/**
 * Draws the countdown as a second badge under the last-price badge (above it
 * when there is no room below), or in its place when that label is off. A
 * text wider than the axis (e.g. `30d 23:59`) widens the badge into the plot.
 * An overlay layer, so a once-per-second repaint skips the static layers.
 */
export function drawCountdownLabel(ctx: Canvas2DLike, view: RenderView): void {
  const { config, plotWidth } = view;
  const axis = config.priceAxis;
  const pane = view.panes[0];
  if (!axis.labels.countdown || !axis.visible || pane === undefined) return;
  const text = countdownText(view);
  if (text === null) return;
  // Anchored and colored like the last-price badge: the displayed bar (Heikin
  // Ashi for 'heikin-ashi'), its renderer's direction, and the scale font.
  const { bar: last, color } = lastDisplayedBar(view);
  const y = pane.priceScale.priceToY(last.close);
  const height = pane.layout.height;
  if (!Number.isFinite(y) || y < 0 || y > height) return;
  const labelHeight = priceBadgeHeight(config.theme);
  const axisWidth = view.canvasWidth - plotWidth;
  ctx.save();
  ctx.font = scaleFont(config.theme);
  const width = Math.max(axisWidth, Math.ceil(ctx.measureText(text).width) + 8);
  const x = axis.position === 'left' ? -axisWidth : plotWidth + axisWidth - width;
  const priceTop = priceBadgeTop(y, height, labelHeight);
  const top = !axis.labels.lastPrice ? priceTop
    : priceTop + labelHeight * 2 <= height ? priceTop + labelHeight : priceTop - labelHeight;
  ctx.fillStyle = color;
  ctx.fillRect(x, top, width, labelHeight);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = contrastingTextColor(color, config.theme.background);
  ctx.fillText(text, x + 4, top + labelHeight / 2);
  ctx.restore();
}
