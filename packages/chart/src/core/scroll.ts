import type { Chart, ScaleApi } from './chart.js';
import type { FrameScheduler } from './zoom.js';
import type { SlotRange } from './scale.js';
import { easeOut } from './presence.js';

export interface SmoothScrollOptions {
  /** Duration in ms; 0 disables easing. Default 240. */
  duration?: number;
  onFrame?: () => void;
}

/** Optional {@link ScaleApi} members; custom scales without them page as if bar-indexed. */
type OptionalScale = 'barSpacing' | 'visibleSlots';

/**
 * Frame-coalesced paging, bounded by available history. Cancel on direct input.
 * Pages and bounds are measured in scroll units ({@link ScaleApi.visibleSlots}), so
 * a time-continuous axis pages by the viewport's width even across wide gaps.
 * History prepended mid-scroll (e.g. by a lazy-loading datafeed) neither stops
 * the motion nor keeps it at the old first bar.
 */
export class SmoothScroll {
  private frame: number | null = null;
  private from = 0;
  private target = 0;
  /** The request's target before bounding by the history. */
  private wanted = 0;
  private expectedX = 0;
  private spacing = 0;
  /** Data extent (scroll units) that `target` was bounded by. */
  private length = 0;
  private start = 0;
  /** When the viewport was last at `expectedX`. */
  private last = 0;
  private direction = 0;
  private destroyed = false;
  private generation = 0;
  private readonly duration: number;

  constructor(
    private readonly chart: Pick<Chart, 'dataLength'> & { readonly scale: Omit<ScaleApi, OptionalScale> & Partial<Pick<ScaleApi, OptionalScale>> },
    private readonly scheduler: FrameScheduler,
    private readonly options: SmoothScrollOptions = {},
  ) {
    this.duration = options.duration ?? 240;
    if (!Number.isFinite(this.duration) || this.duration < 0) throw new Error('chart-ts: scroll duration must be finite and nonnegative');
  }

  /** Positive pages move into history; negative pages return toward live bars. */
  page(direction: 1 | -1, fraction = 0.8): void {
    const range = this.window();
    this.scrollBy(direction * (range.to - range.from) * fraction);
  }

  /** Scrolls by `bars` (time slots with a continuous axis), bounded by the available history. */
  scrollBy(bars: number): void {
    if (this.destroyed || !Number.isFinite(bars) || bars === 0) return;
    const { scale } = this.chart;
    const x = this.position();
    const step = scale.indexToX(1) - scale.indexToX(0);
    if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return;
    const spacing = this.barSpacing();
    const direction = Math.sign(bars);
    const base = this.frame === null || this.changed() || direction !== this.direction ? x : this.target;
    const range = this.window();
    this.wanted = base + bars * spacing;
    this.from = this.expectedX = x;
    this.spacing = spacing;
    this.target = this.bounded(range);
    this.direction = direction;
    this.last = this.start = this.scheduler.now();
    if (Math.abs(this.target - x) < 1e-7) { this.cancel(); return; }
    if (this.frame === null) this.frame = this.scheduler.request(this.step);
  }

  cancel(): void {
    this.generation++;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
  }

  destroy(): void { this.cancel(); this.destroyed = true; }

  /** The viewport in scroll units; custom scales without `visibleSlots` use the visible bar range. */
  private window(): SlotRange {
    const { scale, dataLength } = this.chart;
    return scale.visibleSlots?.() ?? { ...scale.visibleRange(), length: dataLength };
  }

  /** Pixels per scroll unit; custom scales without `barSpacing` use the first bar's width. */
  private barSpacing(): number {
    const { scale } = this.chart;
    return scale.barSpacing?.() ?? scale.indexToX(1) - scale.indexToX(0);
  }

  /** The latest bar's x: the scroll position, which (unlike bar 0's x) holds still when history is prepended. */
  private position(): number {
    return this.chart.scale.indexToX(this.chart.dataLength - 1);
  }

  /** `wanted`, bounded by the first and last data units of `range` as seen from `expectedX`; records its extent. */
  private bounded(range: SlotRange): number {
    const x = this.expectedX;
    this.length = range.length;
    return Math.max(x - (range.length - range.to) * this.spacing, Math.min(x + range.from * this.spacing, this.wanted));
  }

  private changed(): boolean {
    return Math.abs(this.position() - this.expectedX) > 1e-7 ||
      Math.abs(this.barSpacing() - this.spacing) > this.spacing * 1e-9;
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    if (this.destroyed || this.changed()) return;
    const generation = this.generation;
    const range = this.window();
    if (range.length !== this.length) {
      // History landed (or the data changed) mid-scroll: re-bound the request and ease on from here.
      const target = this.bounded(range);
      if (target !== this.target) {
        this.target = target;
        this.from = this.expectedX;
        this.start = this.last;
        if (Math.abs(target - this.from) < 1e-7) return;
      }
    }
    const progress = this.duration === 0 ? 1 : Math.min(1, Math.max(0, (time - this.start) / this.duration));
    const x = this.from + (this.target - this.from) * easeOut(progress);
    if (x !== this.expectedX) {
      this.chart.scale.scrollBy((x - this.expectedX) / this.spacing);
      this.expectedX = this.position();
      this.options.onFrame?.();
    }
    this.last = time;
    if (progress < 1 && !this.destroyed && this.frame === null && generation === this.generation) {
      this.frame = this.scheduler.request(this.step);
    }
  };
}
