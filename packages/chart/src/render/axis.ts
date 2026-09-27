/**
 * Axis tick selection and label drawing for the price (right) and time
 * (bottom) axes. Label fonts come from the consolidated config
 * (`theme.scaleFontFamily` / `theme.scaleFontSize`, falling back to
 * `theme.monoFamily` / `theme.fontSize`), computed by the renderer.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { firstSlotAtLeast, indexOfSlot, type TimeScale, type VisibleRange } from '../core/scale.js';
import type { Canvas2DLike } from '../dom.js';

/**
 * Picks up to `count` evenly spaced candle indices inside `range`.
 * Always includes the first visible index when the range is non-empty.
 *
 * When `timeScale` is time-continuous for `dataLength` candles (see
 * {@link TimeScale.setSlots}), ticks are instead at least `1/count` of the
 * viewport apart in time slots, inside the viewport and between the first and
 * last candle, so labels on either side of a gap never pile up. Ticks snap to a
 * candle within one step; elsewhere in a gap they get a fractional index (drawn
 * at its interpolated time), so the axis stays labelled while panning through gaps.
 */
export function timeTickIndices(range: VisibleRange, count: number, timeScale?: TimeScale, dataLength = 0): number[] {
  const span = range.to - range.from;
  if (span <= 0 || count <= 0) return [];
  const slots = timeScale?.slots ?? null;
  if (timeScale === undefined || slots === null || slots.length !== dataLength) {
    const step = Math.max(1, Math.floor(span / count));
    const indices: number[] = [];
    for (let i = range.from; i < range.to; i += step) indices.push(i);
    return indices;
  }
  const { width, barSpacing } = timeScale;
  const step = Math.max(1, Math.floor(width / barSpacing / count));
  const last = slots[dataLength - 1];
  // Slot positions at the viewport's right (x = width) and left (x = 0) edges, limited to the data.
  const right = last - timeScale.scrollOffset + 0.5;
  const end = Math.min(last, Math.floor(right));
  const indices: number[] = [];
  for (let slot = Math.max(slots[0], Math.ceil(right - width / barSpacing)); slot <= end;) {
    const i = firstSlotAtLeast(slots, slot);
    if (slots[i] <= end && slots[i] - slot < step) {
      indices.push(i);
      slot = slots[i] + step;
    } else {
      indices.push(indexOfSlot(slots, slot));
      slot += step;
    }
  }
  return indices;
}

/**
 * Draws time axis labels for the given tick indices along the bottom edge,
 * using the mono `font` (e.g. `12px "Geist Mono"`). A fractional index (a tick
 * inside a continuous-axis gap) shows the time interpolated between its neighbours.
 */
export function drawTimeAxis(
  ctx: Canvas2DLike,
  candles: readonly Candle[],
  indices: readonly number[],
  timeScale: TimeScale,
  axisY: number,
  formatter: (timestamp: number) => string,
  textColor: string,
  font: string,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const i of indices) {
    const k = Math.floor(i);
    const candle = candles[k];
    if (candle === undefined) continue;
    const time = i === k ? candle.time : Math.round(candle.time + (i - k) * ((candles[k + 1] ?? candle).time - candle.time));
    ctx.fillText(formatter(time), timeScale.indexToX(i, candles.length), axisY + 4);
  }
  ctx.restore();
}
