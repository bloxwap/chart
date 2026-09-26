import type { FrameScheduler } from './zoom.js';

/** Shared easing for short, interruptible UI transitions. */
export const easeOut = (progress: number): number => 1 - (1 - progress) ** 3;

interface Entry<T> {
  item: T;
  value: number;
  from: number;
  target: number;
  start: number;
}

/** Keeps departing items alive while their opacity/layout weight eases to zero. */
export class Presence<T extends { id: string }> {
  private readonly entries = new Map<string, Entry<T>>();
  private frame: number | null = null;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly invalidate: () => void,
    private readonly duration: number,
    initial: readonly T[],
  ) {
    if (!Number.isFinite(duration) || duration < 0) throw new Error('chart-ts: animation duration must be finite and nonnegative');
    for (const item of initial) this.entries.set(item.id, { item, value: 1, from: 1, target: 1, start: 0 });
  }

  update(items: readonly T[]): { item: T; opacity: number }[] {
    const now = this.scheduler.now();
    const active = new Set(items.map((item) => item.id));
    for (const item of items) {
      const entry = this.entries.get(item.id);
      if (entry) entry.item = item;
      else this.entries.set(item.id, { item, value: 0, from: 0, target: 0, start: now });
    }
    let moving = false;
    const result: { item: T; opacity: number }[] = [];
    for (const [id, entry] of this.entries) {
      const target = active.has(id) ? 1 : 0;
      if (entry.target !== target) {
        entry.from = entry.value;
        entry.target = target;
        entry.start = now;
      }
      const progress = this.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - entry.start) / this.duration));
      entry.value = entry.from + (entry.target - entry.from) * easeOut(progress);
      if (entry.value !== target) moving = true;
      if (entry.value > 0) result.push({ item: entry.item, opacity: entry.value });
      else if (target === 0) this.entries.delete(id);
    }
    if (moving && this.frame === null) {
      this.frame = this.scheduler.request(() => {
        this.frame = null;
        this.invalidate();
      });
    } else if (!moving) this.cancelFrame();
    return result;
  }

  destroy(): void {
    this.cancelFrame();
    this.entries.clear();
  }

  private cancelFrame(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
  }
}
