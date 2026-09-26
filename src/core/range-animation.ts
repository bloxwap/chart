import type { FrameScheduler } from './zoom.js';
import { easeOut } from './presence.js';

interface Range { min: number; max: number }
interface Transition { from: Range; to: Range; start: number }

/** Interpolates autoscale ranges without recalculating indicator output. */
export class RangeAnimation {
  private readonly ranges = new Map<string, Transition>();
  private frame: number | null = null;

  constructor(private readonly scheduler: FrameScheduler, private readonly invalidate: () => void, private readonly duration: number) {}

  update(id: string, min: number, max: number): Range {
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    const now = this.scheduler.now();
    let entry = this.ranges.get(id);
    if (!entry) {
      entry = { from: { min, max }, to: { min, max }, start: now };
      this.ranges.set(id, entry);
    }
    const progress = this.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - entry.start) / this.duration));
    const eased = easeOut(progress);
    let current = progress === 1 ? entry.to : {
      min: entry.from.min + (entry.to.min - entry.from.min) * eased,
      max: entry.from.max + (entry.to.max - entry.from.max) * eased,
    };
    if (entry.to.min !== min || entry.to.max !== max) {
      entry.from = current;
      entry.to = { min, max };
      entry.start = now;
    }
    if (this.duration === 0) current = entry.to;
    if ((current.min !== min || current.max !== max) && this.frame === null) {
      this.frame = this.scheduler.request(() => { this.frame = null; this.invalidate(); });
    }
    return current;
  }

  retain(ids: readonly string[]): void {
    for (const id of this.ranges.keys()) if (!ids.includes(id)) this.ranges.delete(id);
  }

  clear(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.ranges.clear();
  }
}
