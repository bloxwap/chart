import type { Chart } from './chart.js';
import type { FrameScheduler } from './zoom.js';
import { easeOut } from './presence.js';

export interface SmoothScrollOptions {
  /** Duration in ms; 0 disables easing. Default 240. */
  duration?: number;
  onFrame?: () => void;
}

/** Frame-coalesced paging, bounded by available history. Cancel on direct input. */
export class SmoothScroll {
  private frame: number | null = null;
  private from = 0;
  private target = 0;
  private expectedX = 0;
  private spacing = 0;
  private start = 0;
  private direction = 0;
  private destroyed = false;
  private generation = 0;
  private readonly duration: number;

  constructor(
    private readonly chart: Pick<Chart, 'scale' | 'dataLength'>,
    private readonly scheduler: FrameScheduler,
    private readonly options: SmoothScrollOptions = {},
  ) {
    this.duration = options.duration ?? 240;
    if (!Number.isFinite(this.duration) || this.duration < 0) throw new Error('chart-ts: scroll duration must be finite and nonnegative');
  }

  /** Positive pages move into history; negative pages return toward live bars. */
  page(direction: 1 | -1, fraction = 0.8): void {
    const range = this.chart.scale.visibleRange();
    this.scrollBy(direction * (range.to - range.from) * fraction);
  }

  scrollBy(bars: number): void {
    if (this.destroyed || !Number.isFinite(bars) || bars === 0) return;
    const { scale, dataLength } = this.chart;
    const x = scale.indexToX(0);
    const spacing = scale.indexToX(1) - x;
    if (!Number.isFinite(x) || !Number.isFinite(spacing) || spacing <= 0) return;
    const direction = Math.sign(bars);
    const base = this.frame === null || this.changed() || direction !== this.direction ? x : this.target;
    const range = scale.visibleRange();
    this.target = Math.max(x - (dataLength - range.to) * spacing,
      Math.min(x + range.from * spacing, base + bars * spacing));
    this.from = this.expectedX = x;
    this.spacing = spacing;
    this.direction = direction;
    this.start = this.scheduler.now();
    if (Math.abs(this.target - x) < 1e-7) { this.cancel(); return; }
    if (this.frame === null) this.frame = this.scheduler.request(this.step);
  }

  cancel(): void {
    this.generation++;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
  }

  destroy(): void { this.cancel(); this.destroyed = true; }

  private changed(): boolean {
    const x = this.chart.scale.indexToX(0);
    return Math.abs(x - this.expectedX) > 1e-7 ||
      Math.abs(this.chart.scale.indexToX(1) - x - this.spacing) > this.spacing * 1e-9;
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    if (this.destroyed || this.changed()) return;
    const generation = this.generation;
    const progress = this.duration === 0 ? 1 : Math.min(1, Math.max(0, (time - this.start) / this.duration));
    const x = this.from + (this.target - this.from) * easeOut(progress);
    if (x !== this.expectedX) {
      this.chart.scale.scrollBy((x - this.expectedX) / this.spacing);
      this.expectedX = this.chart.scale.indexToX(0);
      this.options.onFrame?.();
    }
    if (progress < 1 && !this.destroyed && this.frame === null && generation === this.generation) {
      this.frame = this.scheduler.request(this.step);
    }
  };
}
