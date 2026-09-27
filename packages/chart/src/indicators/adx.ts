/**
 * ADX — Wilder's directional movement system: +DI, −DI and the average
 * directional index (TradingView's DMI definition).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorOutput } from './types.js';
import type { StudyMeta } from './study-meta.js';

/** Running state after some prefix of candles. */
interface AdxState {
  /** Wilder RMAs of true range and ±DM (plain sums while warming up). */
  tr: number;
  plusDm: number;
  minusDm: number;
  /** Last defined ±DI, carried over flat stretches; NaN before the first. */
  plus: number;
  minus: number;
  /** DX samples seen, and their Wilder RMA (a plain sum while warming up). */
  count: number;
  adx: number;
}

/** States before and after the last computed candle, for tail updates. */
interface AdxTail {
  readonly length: number;
  readonly before: AdxState;
  readonly after: AdxState;
}

const INITIAL: AdxState = { tr: 0, plusDm: 0, minusDm: 0, plus: NaN, minus: NaN, count: 0, adx: 0 };

// Tail states per cached output. Outputs are owned by one chart cache entry,
// so entries die with the output they describe.
const TAILS = new WeakMap<IndicatorOutput, AdxTail>();

/**
 * One Wilder RMA step for the `n`-th sample: sums while `n < length`, seeds
 * with the mean at `n === length`, then `(value + previous·(length−1)) / length`.
 */
function wilder(previous: number, value: number, n: number, length: number): number {
  if (n < length) return previous + value;
  if (n === length) return (previous + value) / length;
  return (value + previous * (length - 1)) / length;
}

/**
 * Advances `state` over candles `from..end`, writing the three lines. Returns
 * the tail snapshots so the next tail update can resume exactly.
 */
function runAdx(
  candles: readonly Candle[],
  from: number,
  state: AdxState,
  diLength: number,
  adxSmoothing: number,
  adx: (number | null)[],
  plus: (number | null)[],
  minus: (number | null)[],
): AdxTail {
  const s = { ...state };
  const last = candles.length - 1;
  let before = state;
  for (let i = from; i < candles.length; i++) {
    if (i === last) before = { ...s };
    adx[i] = plus[i] = minus[i] = null;
    if (i === 0) continue;
    const candle = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
    const up = candle.high - previous.high;
    const down = previous.low - candle.low;
    s.tr = wilder(s.tr, tr, i, diLength);
    s.plusDm = wilder(s.plusDm, up > down && up > 0 ? up : 0, i, diLength);
    s.minusDm = wilder(s.minusDm, down > up && down > 0 ? down : 0, i, diLength);
    if (i < diLength) continue;
    // A zero true range leaves 0/0 DIs; like TradingView's fixnan, keep the last ones.
    if (s.tr > 0) {
      s.plus = 100 * s.plusDm / s.tr;
      s.minus = 100 * s.minusDm / s.tr;
    }
    if (Number.isNaN(s.plus)) continue;
    plus[i] = s.plus;
    minus[i] = s.minus;
    const sum = s.plus + s.minus;
    const dx = Math.abs(s.plus - s.minus) / (sum === 0 ? 1 : sum) * 100;
    s.count++;
    s.adx = wilder(s.adx, dx, s.count, adxSmoothing);
    if (s.count >= adxSmoothing) adx[i] = s.adx;
  }
  return { length: candles.length, before, after: s };
}

function lengths(params: Record<string, number>): [diLength: number, adxSmoothing: number] {
  return [Math.max(1, Math.floor(params['diLength'] ?? 14)), Math.max(1, Math.floor(params['adxSmoothing'] ?? 14))];
}

/**
 * Wilder DMI/ADX. True range and ±DM are smoothed by an SMA-seeded RMA of
 * `diLength`, so ±DI start at index `diLength`; ADX is the RMA of
 * DX = |+DI − −DI| / (+DI + −DI) · 100 over `adxSmoothing` and starts at
 * `diLength + adxSmoothing − 1`.
 */
export function adxValues(
  candles: readonly Candle[],
  diLength = 14,
  adxSmoothing = 14,
): { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] } {
  const adx = new Array<number | null>(candles.length).fill(null);
  const plusDI = new Array<number | null>(candles.length).fill(null);
  const minusDI = new Array<number | null>(candles.length).fill(null);
  const [di, smoothing] = lengths({ diLength, adxSmoothing });
  runAdx(candles, 0, INITIAL, di, smoothing, adx, plusDI, minusDI);
  return { adx, plusDI, minusDI };
}

/** Display metadata for {@link adxIndicator}. */
export const adxMeta: StudyMeta = {
  label: 'Average Directional Index',
  shortName: 'ADX',
  inputs: [
    { key: 'adxSmoothing', label: 'ADX Smoothing', min: 1, max: 50, step: 1, integer: true },
    { key: 'diLength', label: 'DI Length', min: 1, max: 2000, step: 1, integer: true },
  ],
  styles: [
    { key: 'adx', label: 'ADX', colorIndex: 0, kind: 'line' },
    { key: 'plusDI', label: '+DI', colorIndex: 1, kind: 'line' },
    { key: 'minusDI', label: '-DI', colorIndex: 2, kind: 'line' },
  ],
};

/**
 * ADX indicator definition (name `'adx'`, sub pane; params `adxSmoothing` =
 * 14, `diLength` = 14; lines `adx`, `plusDI`, `minusDI`). Tail updates
 * resume from the Wilder state saved for the output being updated.
 */
export const adxIndicator: IndicatorDef = {
  name: 'adx',
  ...adxMeta,
  defaultParams: { adxSmoothing: 14, diLength: 14 },
  defaultColors: ['#f50057', '#2196f3', '#ff6d00'],
  defaultPane: 'sub',
  update(output, candles, from, params) {
    // Nothing changed; returning early also keeps the saved `before` snapshot valid.
    if (from >= candles.length) return output;
    const tail = TAILS.get(output);
    const state = tail === undefined ? undefined : from === tail.length ? tail.after : from === tail.length - 1 ? tail.before : undefined;
    if (state === undefined) return undefined;
    const [adx, plus, minus] = output.lines.map((line) => line.values as (number | null)[]);
    TAILS.set(output, runAdx(candles, from, state, ...lengths(params), adx, plus, minus));
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const adx = new Array<number | null>(candles.length).fill(null);
    const plus = new Array<number | null>(candles.length).fill(null);
    const minus = new Array<number | null>(candles.length).fill(null);
    const output: IndicatorOutput = {
      pane: 'sub',
      lines: [
        { key: 'adx', values: adx, color: colors[0] ?? '#f50057' },
        { key: 'plusDI', values: plus, color: colors[1] ?? '#2196f3' },
        { key: 'minusDI', values: minus, color: colors[2] ?? '#ff6d00' },
      ],
    };
    TAILS.set(output, runAdx(candles, 0, INITIAL, ...lengths(params), adx, plus, minus));
    return output;
  },
};
