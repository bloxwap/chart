/** Smooth, frame-coalesced zoom with an injected clock; no global DOM access. */
import type { ScaleApi } from './chart.js';
import { MAX_BAR_SPACING, MIN_BAR_SPACING } from './scale.js';

export interface FrameScheduler {
  /** Same time origin as the timestamps passed to request callbacks. */
  now(): number;
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export interface SmoothZoomOptions {
  /** Exponential easing time constant in ms; 0 disables easing. Default 55. */
  timeConstant?: number;
  /** Called after a zoom step, e.g. to update navigation controls. */
  onFrame?: () => void;
}

/** Structural subset of WheelEvent, suitable for browsers or synthetic input. */
export interface ZoomWheelInput {
  readonly deltaY: number;
  /** DOM_DELTA_PIXEL = 0, DOM_DELTA_LINE = 1, DOM_DELTA_PAGE = 2. */
  readonly deltaMode: number;
  readonly ctrlKey?: boolean;
}

const MIN_LOG = Math.log(MIN_BAR_SPACING);
const MAX_LOG = Math.log(MAX_BAR_SPACING);
const clampLog = (value: number): number => Math.min(MAX_LOG, Math.max(MIN_LOG, value));

/**
 * Accumulates wheel/button input into a bounded target spacing and eases toward
 * it once per animation frame. Equal opposite deltas produce reciprocal zoom.
 * Cancel when starting a drag, replacing data, or resizing the viewport.
 * History prepended mid-zoom does not stop it when the scale has `visibleSlots`.
 */
export class SmoothZoom {
  private frame: number | null = null;
  private target = 0;
  private expectedSpacing = 0;
  private expectedX = 0;
  private anchor = 0;
  private previousTime = 0;
  private direction = 0;
  private advanced = false;
  private destroyed = false;
  private generation = 0;
  private readonly timeConstant: number;

  constructor(
    private readonly scale: Pick<ScaleApi, 'zoom' | 'indexToX'> & Partial<Pick<ScaleApi, 'barSpacing' | 'visibleSlots'>>,
    private readonly scheduler: FrameScheduler,
    private readonly options: SmoothZoomOptions = {},
  ) {
    this.timeConstant = options.timeConstant ?? 55;
    if (!Number.isFinite(this.timeConstant) || this.timeConstant < 0) {
      throw new Error('chart-ts: zoom timeConstant must be finite and nonnegative');
    }
  }

  /** Queue a multiplicative zoom about a CSS-pixel anchor. */
  zoomBy(factor: number, anchorX: number): void {
    if (this.destroyed || !Number.isFinite(factor) || factor <= 0 || factor === 1 || !Number.isFinite(anchorX)) return;
    const spacing = this.spacing();
    if (!Number.isFinite(spacing) || spacing <= 0) return;
    const change = Math.log(factor);
    const direction = Math.sign(change);
    if (this.frame === null || this.externallyChanged(spacing) ||
        (this.advanced && direction !== this.direction)) {
      this.target = Math.log(spacing);
      this.previousTime = this.scheduler.now();
      this.advanced = false;
    }
    this.direction = direction;
    this.expectedSpacing = spacing;
    this.expectedX = this.position(spacing);
    this.anchor = anchorX;
    this.target = clampLog(this.target + change);
    if (Math.abs(this.target - Math.log(spacing)) < 1e-12) {
      this.cancel();
      return;
    }
    if (this.frame === null) this.frame = this.scheduler.request(this.step);
  }

  /** Normalize mouse wheels, trackpads and Ctrl+wheel pinch gestures. */
  wheel(event: ZoomWheelInput, anchorX: number, viewportHeight: number): void {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
    const pixels = event.deltaY * unit;
    if (!Number.isFinite(pixels)) return;
    const delta = Math.max(-120, Math.min(120, pixels));
    this.zoomBy(Math.exp(-delta * (event.ctrlKey ? 0.008 : 0.002)), anchorX);
  }

  /** Stop queued motion without moving the current viewport. */
  cancel(): void {
    this.generation++;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.advanced = false;
  }

  /** Cancel pending work and permanently ignore further input. */
  destroy(): void {
    this.cancel();
    this.destroyed = true;
  }

  /** Pixels per bar; `barSpacing` stays exact when a time-continuous gap separates bars 0 and 1. */
  private spacing(): number {
    return this.scale.barSpacing?.() ?? this.scale.indexToX(1) - this.scale.indexToX(0);
  }

  /**
   * X of the latest scroll unit: the scroll position, which (unlike bar 0's x)
   * holds still when history is prepended. Bar 0's x without `visibleSlots`.
   */
  private position(spacing: number): number {
    const slots = this.scale.visibleSlots?.();
    return this.scale.indexToX(0) + (slots === undefined ? 0 : (slots.length - 1) * spacing);
  }

  private externallyChanged(spacing: number): boolean {
    return Math.abs(spacing - this.expectedSpacing) > Math.abs(spacing) * 1e-9 ||
      Math.abs(this.position(spacing) - this.expectedX) > 1e-7;
  }

  private readonly step = (timestamp: number): void => {
    const generation = this.generation;
    this.frame = null;
    const spacing = this.spacing();
    // External scale changes (box zoom, fit, API calls) take precedence.
    if (this.destroyed || !Number.isFinite(spacing) || spacing <= 0 || this.externallyChanged(spacing)) return;
    const current = Math.log(spacing);
    const elapsed = Math.max(0, timestamp - this.previousTime);
    const alpha = this.timeConstant === 0 ? 1 : -Math.expm1(-elapsed / this.timeConstant);
    const remaining = this.target - current;
    const done = Math.abs(remaining) < 0.0001 || alpha === 1;
    const next = done ? this.target : current + remaining * alpha;
    this.previousTime = timestamp;
    const desired = Math.exp(next);
    if (next !== current) {
      this.scale.zoom(desired / spacing, this.anchor);
      this.expectedSpacing = this.spacing();
      this.expectedX = this.position(this.expectedSpacing);
      this.advanced = true;
      this.options.onFrame?.();
    }
    if (!done && !this.destroyed && this.frame === null && generation === this.generation) {
      this.frame = this.scheduler.request(this.step);
    }
  };
}
