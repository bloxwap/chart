import type { Candle } from './data.js';
import type { FrameScheduler } from './zoom.js';
import { easeOut } from './presence.js';

const samePrices = (a: Candle, b: Candle): boolean =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
const finitePrices = (c: Candle): boolean =>
  Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);

/** A visual-only live candle; the data store and indicators retain the real prices. */
export class CandleAnimation {
  private from: Candle | null = null;
  private target: Candle | null = null;
  private start = 0;
  private frame: number | null = null;

  constructor(private readonly scheduler: FrameScheduler, private readonly invalidate: () => void, private readonly duration: number) {}

  update(candle: Candle | undefined, animate = true): Candle | undefined {
    if (candle === undefined) { this.clear(); return undefined; }
    if (this.target === null || this.duration === 0 || !animate || !finitePrices(candle) || !finitePrices(this.target)) {
      this.clear();
      this.from = this.target = candle;
      return candle;
    }
    const now = this.scheduler.now();
    if (candle.time !== this.target.time) {
      // A new interval grows from its own open, never from the previous bar's close.
      this.from = { ...candle, high: candle.open, low: candle.open, close: candle.open };
      this.start = now;
    } else if (!samePrices(candle, this.target)) {
      this.from = this.sample(now);
      this.start = now;
    }
    this.target = candle;
    const current = this.sample(now);
    if (current !== candle && this.frame === null) {
      this.frame = this.scheduler.request(() => { this.frame = null; this.invalidate(); });
    }
    return current;
  }

  clear(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.from = this.target = null;
  }

  private sample(now: number): Candle {
    const from = this.from!, to = this.target!;
    const progress = Math.min(1, Math.max(0, (now - this.start) / this.duration));
    if (progress === 1 || samePrices(from, to)) return to;
    const eased = easeOut(progress);
    return {
      ...to,
      open: from.open + (to.open - from.open) * eased,
      high: from.high + (to.high - from.high) * eased,
      low: from.low + (to.low - from.low) * eased,
      close: from.close + (to.close - from.close) * eased,
    };
  }
}
