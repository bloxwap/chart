/**
 * Candle data model and an array-backed store with binary-search access.
 *
 * @module
 */

/** A single OHLC(V) candle. `time` is a UNIX timestamp in seconds. */
export interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/**
 * Ordered, array-backed candle storage keyed by ascending `time`.
 */
export class DataStore {
  private candles: Candle[] = [];

  /** Number of candles held. */
  get length(): number {
    return this.candles.length;
  }

  /** Returns the candle at `index`, or `undefined` when out of range. */
  at(index: number): Candle | undefined {
    return this.candles[index];
  }

  /** Returns a defensive copy of all candles. */
  all(): Candle[] {
    return this.candles.slice();
  }

  /**
   * The internal candle array without copying, for hot read paths.
   * Callers must not mutate the result.
   */
  raw(): readonly Candle[] {
    return this.candles;
  }

  /** Last candle, or `undefined` when empty. */
  last(): Candle | undefined {
    return this.candles[this.candles.length - 1];
  }

  /**
   * Replaces the whole dataset. Input must be sorted by ascending time;
   * it is defensively sorted otherwise.
   */
  setData(candles: readonly Candle[]): void {
    this.candles = candles.slice();
    for (let i = 1; i < this.candles.length; i++) {
      if (this.candles[i - 1].time > this.candles[i].time) {
        this.candles.sort((a, b) => a.time - b.time);
        break;
      }
    }
  }

  /**
   * Inserts `older` in front of the dataset. The caller guarantees it is
   * sorted, unique and strictly earlier than the first candle.
   */
  prepend(older: readonly Candle[]): void {
    this.candles = older.concat(this.candles);
  }

  /** Removes all candles. */
  clear(): void {
    this.candles = [];
  }

  /**
   * Appends one candle. When its time already exists the candle is replaced;
   * out-of-order times are inserted at the correct position via binary search.
   */
  append(candle: Candle): void {
    const last = this.last();
    if (last === undefined || candle.time > last.time) {
      this.candles.push(candle);
      return;
    }
    // Keep lowerBound's first-match behavior for duplicate timestamps.
    if (candle.time === last.time && this.candles[this.candles.length - 2]?.time !== candle.time) {
      this.candles[this.candles.length - 1] = candle;
      return;
    }
    const idx = this.lowerBound(candle.time);
    const existing = this.candles[idx];
    if (existing !== undefined && existing.time === candle.time) {
      this.candles[idx] = candle;
    } else {
      this.candles.splice(idx, 0, candle);
    }
  }

  /**
   * Index of the first candle with `time >= target`, or `length` when all
   * candles are earlier.
   */
  lowerBound(time: number): number {
    let lo = 0;
    let hi = this.candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.candles[mid].time < time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Exact index of a candle by time, or -1. */
  indexOfTime(time: number): number {
    const idx = this.lowerBound(time);
    return this.candles[idx]?.time === time ? idx : -1;
  }

  /** Extracts the close series as a plain array. */
  closes(): number[] {
    return this.candles.map((c) => c.close);
  }

  /** Extracts the volume series, defaulting missing volumes to 0. */
  volumes(): number[] {
    return this.candles.map((c) => c.volume ?? 0);
  }
}
