/**
 * Subtraction-free sliding-window sums (van Herk / Gil-Werman blocks).
 *
 * @module
 */

/**
 * Sums of the `period` values ending at each index `from..end − 1`, or of
 * every value from index 0 while fewer than `period` exist. `values[k]` holds
 * series index `base + k` (so `end = base + values.length`), and `base` must
 * be at most `max(0, from − period + 1)`; `period` is a finite integer ≥ 1.
 *
 * Indices are split into blocks at multiples of `period`, so each window is a
 * suffix of the previous block plus a prefix of its own, both accumulated by
 * additions only. That keeps a full pass O(n) without a running
 * add-and-subtract: no cancellation drift, a window of non-negative values
 * sums to exactly 0 only when all of them are 0, and every sum depends only
 * on its window, so a tail recompute from any `from` reproduces a full pass
 * bit for bit. Returns the sums indexed by `i − from`.
 */
export function windowSums(values: Float64Array, base: number, period: number, from: number): Float64Array {
  const end = base + values.length;
  const sums = new Float64Array(end - from);
  const suffix = new Float64Array(Math.min(period, values.length));
  let i = from;
  while (i < end) {
    const start = i - (i % period);
    const stop = Math.min(start + period, end);
    // Suffix sums of the previous block, back to the earliest window start needed in this one.
    const first = Math.max(0, i - period + 1);
    let acc = 0;
    for (let j = start - 1; j >= first; j--) suffix[j - first] = acc += values[j - base];
    let prefix = 0;
    for (let j = start; j < i; j++) prefix += values[j - base];
    for (; i < stop; i++) {
      prefix += values[i - base];
      const s = i - period + 1;
      sums[i - from] = start > 0 && s < start ? suffix[s - first] + prefix : prefix;
    }
  }
  return sums;
}
