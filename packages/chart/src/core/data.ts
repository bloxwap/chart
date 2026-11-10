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
 * Seconds above this are year 5138 or later, but the same number of
 * milliseconds is only 1973. Real second-based data never reaches it.
 */
const MILLISECOND_TIME = 1e11;

let warnedMillisecondTime = false;

/** Clears the one-shot millisecond warning. Intended for tests. */
export function resetCandleTimeWarning(): void {
  warnedMillisecondTime = false;
}

function nodeEnv(): string | undefined {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  if (proc === undefined) return undefined;
  if (proc.env === undefined) return undefined;
  return proc.env.NODE_ENV;
}

/**
 * Warns once, outside production, when `time` is too large to be UNIX seconds.
 * The candle is kept as given: callers pass seconds, and this does not rescale.
 */
export function noteCandleTime(time: number): void {
  if (!(time > MILLISECOND_TIME) || warnedMillisecondTime) return;
  if (nodeEnv() === 'production') return;
  warnedMillisecondTime = true;
  (globalThis as unknown as { console: { warn: (message: string) => void } }).console.warn(
    `chart-ts: candle time ${time} looks like milliseconds; Candle.time is UNIX seconds`,
  );
}

/** Whether `time`, `open`, `high`, `low` and `close` are finite numbers. */
export function finiteCandle(candle: Candle): boolean {
  return Number.isFinite(candle.time)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close);
}

/**
 * Expands `high`/`low` so they cover `open` and `close`, and replaces a
 * negative or non-finite volume with 0. Returns `candle` itself when nothing
 * changes. Assumes the OHLC fields are already finite.
 */
export function repairCandle(candle: Candle): Candle {
  if (candle.time > MILLISECOND_TIME) noteCandleTime(candle.time);
  let high = candle.high;
  let low = candle.low;
  if (candle.open > high) high = candle.open;
  if (candle.close > high) high = candle.close;
  if (candle.open < low) low = candle.open;
  if (candle.close < low) low = candle.close;
  const volume = candle.volume;
  const badVolume = volume !== undefined && (!(volume >= 0) || !Number.isFinite(volume));
  if (high === candle.high && low === candle.low && !badVolume) return candle;
  if (volume === undefined) return { time: candle.time, open: candle.open, high, low, close: candle.close };
  return { time: candle.time, open: candle.open, high, low, close: candle.close, volume: badVolume ? 0 : volume };
}

/** Index of the first row that is non-finite, out of order, duplicated, or inconsistent; `length` when every row is usable. */
function firstDirty(candles: readonly Candle[]): number {
  let prev = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const time = candle.time;
    if (!(time > prev) || !finiteCandle(candle)) return i;
    if (candle.low > candle.open || candle.low > candle.close || candle.open > candle.high || candle.close > candle.high) return i;
    const volume = candle.volume;
    if (volume !== undefined && (!(volume >= 0) || !Number.isFinite(volume))) return i;
    if (time > MILLISECOND_TIME) noteCandleTime(time);
    prev = time;
  }
  return candles.length;
}

/** Drops non-finite rows, repairs OHLC and volume, sorts ascending, and keeps the last row for each time. */
function sanitizeCandles(candles: readonly Candle[]): Candle[] {
  const out = new Array<Candle>(candles.length);
  let count = 0;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    if (!finiteCandle(candle)) continue;
    out[count++] = repairCandle(candle);
  }
  out.length = count;
  out.sort((a, b) => a.time - b.time);
  let write = 0;
  for (let read = 0; read < out.length; read++) {
    const row = out[read]!;
    if (write > 0 && out[write - 1]!.time === row.time) out[write - 1] = row;
    else out[write++] = row;
  }
  out.length = write;
  return out;
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
   * Replaces the whole dataset. Non-finite rows are dropped, duplicate times
   * keep the last row, `high`/`low` expand to cover `open` and `close`, and a
   * negative or non-finite volume becomes 0. An array that is already finite,
   * strictly increasing, unique and OHLC-consistent is stored as-is: no copy.
   * Callers must not mutate that array.
   */
  setData(candles: readonly Candle[]): void {
    if (firstDirty(candles) === candles.length) {
      this.candles = candles as Candle[];
      return;
    }
    this.candles = sanitizeCandles(candles);
  }

  /**
   * Inserts `older` in front of the dataset. Rows are cleaned like
   * {@link setData}. Anything that is not strictly earlier than the first
   * stored candle is dropped, so the existing series wins ties.
   */
  prepend(older: readonly Candle[]): void {
    const rows = firstDirty(older) === older.length ? older : sanitizeCandles(older);
    const firstTime = this.candles[0]?.time;
    if (firstTime === undefined) {
      this.candles = rows.concat(this.candles);
      return;
    }
    let count = rows.length;
    while (count > 0 && rows[count - 1]!.time >= firstTime) count--;
    this.candles = (count === rows.length ? rows : rows.slice(0, count)).concat(this.candles);
  }

  /** Removes all candles. */
  clear(): void {
    this.candles = [];
  }

  /**
   * Appends one candle, repaired like {@link setData}. A non-finite time or
   * OHLC price is ignored and returns false. When its time already exists the
   * candle is replaced; out-of-order times are inserted via binary search.
   */
  append(candle: Candle): boolean {
    if (!finiteCandle(candle)) return false;
    const next = repairCandle(candle);
    const last = this.last();
    if (last === undefined || next.time > last.time) {
      this.candles.push(next);
      return true;
    }
    // Keep lowerBound's first-match behavior for duplicate timestamps.
    if (next.time === last.time && this.candles[this.candles.length - 2]?.time !== next.time) {
      this.candles[this.candles.length - 1] = next;
      return true;
    }
    const idx = this.lowerBound(next.time);
    const existing = this.candles[idx];
    if (existing !== undefined && existing.time === next.time) {
      this.candles[idx] = next;
    } else {
      this.candles.splice(idx, 0, next);
    }
    return true;
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
