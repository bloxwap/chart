/**
 * Crosshair state. Event wiring is the host's job; the chart only stores
 * coordinates and snaps to bars.
 *
 * @module
 */

import type { TimeScale } from './scale.js';

/** Mutable crosshair state tracked by the chart. */
export class Crosshair {
  private px = 0;
  private py = 0;
  private on = false;

  /** Whether the crosshair is currently shown. */
  get active(): boolean {
    return this.on;
  }

  /** Current x pixel. */
  get x(): number {
    return this.px;
  }

  /** Current y pixel. */
  get y(): number {
    return this.py;
  }

  /** Moves and activates the crosshair. */
  update(x: number, y: number): void {
    this.px = x;
    this.py = y;
    this.on = true;
  }

  /** Hides the crosshair. */
  clear(): void {
    this.on = false;
  }

  /**
   * Bar index under the crosshair, clamped to `[0, dataLength - 1]`,
   * or -1 for an empty dataset.
   */
  snappedIndex(scale: TimeScale, dataLength: number): number {
    if (dataLength <= 0) return -1;
    const idx = scale.xToIndex(this.px, dataLength);
    return Math.min(dataLength - 1, Math.max(0, idx));
  }
}
