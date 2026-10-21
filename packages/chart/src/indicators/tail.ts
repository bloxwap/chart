/** Maximum replay batch and history needed for replacement checkpoints. */
export const MAX_TAIL_BATCH = 32;
export const TAIL_HISTORY_MARGIN = MAX_TAIL_BATCH + 2;

/** Private, output-owned recurrence checkpoints for append/replace updates. */
export class TailState<T> {
  private checkpoints = new Map<number, T>();
  constructor(private copy: (state: T) => T) {}
  save(index: number, length: number, state: T): void {
    if (index >= length - 2) this.checkpoints.set(index, this.copy(state));
  }
  get(index: number): T | undefined {
    const state = this.checkpoints.get(index);
    return state === undefined ? undefined : this.copy(state);
  }
  prune(length: number): void {
    for (const index of this.checkpoints.keys()) if (index < length - 2) this.checkpoints.delete(index);
  }
}

/** Bound replay work, and reject indices outside the cached tail. */
export function smallTail(length: number, from: number, cost = 1): boolean {
  return from >= 0 && from < length && length - from <= MAX_TAIL_BATCH && (length - from) * cost <= Math.max(MAX_TAIL_BATCH, length * 2);
}

/** Bounded intermediate history, including room for the maximum replay batch. */
export class TailSeries {
  private values: (number | null)[];
  length: number;
  constructor(values: readonly (number | null)[], private capacity: number) {
    this.values = new Array<number | null>(capacity);
    this.length = values.length;
    for (let i = Math.max(0, values.length - capacity); i < values.length; i++) this.values[i % capacity] = values[i];
  }
  at(index: number): number | null {
    return this.values[index % this.capacity];
  }
  set(index: number, value: number | null): void {
    this.values[index % this.capacity] = value;
    this.length = Math.max(this.length, index + 1);
  }
}

export type MutableSeries = (number | null)[] | TailSeries;

export function setSeriesValue(series: MutableSeries, index: number, value: number | null): void {
  if (Array.isArray(series)) series[index] = value;
  else series.set(index, value);
}
