/**
 * VWAP — anchored volume-weighted average price of HLC3, with optional
 * volume-weighted standard-deviation bands (TradingView's VWAP).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorOutput } from './types.js';
import type { StudyMeta } from './study-meta.js';
import { candleVolume, typicalPrice } from './candle-values.js';

const DAY_SECONDS = 86_400;

interface VwapBands {
  readonly upper: (number | null)[];
  readonly lower: (number | null)[];
  readonly mult: number;
}

function dayOf(candle: Candle): number {
  return Math.floor(candle.time / DAY_SECONDS);
}

/**
 * Anchor period of a UTC day number: the day itself (session), its
 * Monday-based week (day 0 is Thursday 1970-01-01) or its calendar month.
 */
function periodKey(day: number, anchor: number): number {
  if (anchor === 1) return Math.floor((day + 3) / 7);
  if (anchor === 2) {
    const date = new Date(day * DAY_SECONDS * 1000);
    return date.getUTCFullYear() * 12 + date.getUTCMonth();
  }
  return day;
}

/** First index of the anchor period that contains `index`. */
function periodStart(candles: readonly Candle[], index: number, anchor: number): number {
  let day = dayOf(candles[index]);
  const key = periodKey(day, anchor);
  while (index > 0) {
    const previous = dayOf(candles[index - 1]);
    if (previous !== day && periodKey(previous, anchor) !== key) break;
    day = previous;
    index--;
  }
  return index;
}

/** Running VWAP state: the current day and anchor key plus West's weighted accumulators. */
interface VwapState {
  day: number;
  key: number;
  weight: number;
  mean: number;
  m2: number;
}

/** States before and after the last computed candle, for tail updates. */
interface VwapTail {
  readonly length: number;
  readonly before: VwapState;
  readonly after: VwapState;
}

const INITIAL: VwapState = { day: NaN, key: NaN, weight: 0, mean: 0, m2: 0 };

// Tail states per cached output. Outputs are owned by one chart cache entry,
// so entries die with the output they describe.
const TAILS = new WeakMap<IndicatorOutput, VwapTail>();

/**
 * Runs VWAP over candles `start..end` from `state`, which must be the state
 * after candle `start − 1` (or {@link INITIAL} when `start` opens an anchor
 * period). Uses West's weighted incremental mean/variance, so bands need no
 * `Σv·x²` cancellation. Bars without positive volume leave the average
 * unchanged; the value is null until the period has traded volume. Returns
 * the tail snapshots so the next tail update can resume in O(1).
 */
function fillVwap(
  candles: readonly Candle[],
  start: number,
  state: VwapState,
  anchor: number,
  vwap: (number | null)[],
  bands: VwapBands | null,
): VwapTail {
  let { day, key, weight, mean, m2 } = state;
  const last = candles.length - 1;
  let before = state;
  for (let i = start; i < candles.length; i++) {
    if (i === last) before = { day, key, weight, mean, m2 };
    const candle = candles[i];
    const d = dayOf(candle);
    if (d !== day) {
      day = d;
      const k = periodKey(d, anchor);
      if (k !== key) {
        key = k;
        weight = 0;
        mean = 0;
        m2 = 0;
      }
    }
    const volume = candleVolume(candle);
    if (volume > 0) {
      const price = typicalPrice(candle);
      weight += volume;
      const delta = price - mean;
      mean += delta * (volume / weight);
      m2 += volume * delta * (price - mean);
    }
    const value = weight > 0 ? mean : null;
    vwap[i] = value;
    if (bands === null) continue;
    if (value === null) {
      bands.upper[i] = bands.lower[i] = null;
      continue;
    }
    const offset = bands.mult * Math.sqrt(Math.max(0, m2 / weight));
    bands.upper[i] = value + offset;
    bands.lower[i] = value - offset;
  }
  return { length: candles.length, before, after: { day, key, weight, mean, m2 } };
}

function anchorParam(params: Record<string, number>): number {
  return Math.floor(params['anchor'] ?? 0);
}

/** Band multiplier; non-finite values turn the bands off. */
function bandsParam(params: Record<string, number>): number {
  const mult = params['bands'] ?? 0;
  return Number.isFinite(mult) ? mult : 0;
}

/**
 * Anchored VWAP of HLC3 with `upper`/`lower` at ±`mult` volume-weighted
 * standard deviations. `anchor`: 0 = UTC session (day), 1 = Monday-based UTC
 * week, 2 = UTC calendar month. Missing/zero volume adds nothing; values are
 * null until the current period has volume.
 */
export function vwapValues(
  candles: readonly Candle[],
  anchor = 0,
  mult = 1,
): { vwap: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const vwap = new Array<number | null>(candles.length).fill(null);
  const upper = new Array<number | null>(candles.length).fill(null);
  const lower = new Array<number | null>(candles.length).fill(null);
  fillVwap(candles, 0, INITIAL, Math.floor(anchor), vwap, { upper, lower, mult });
  return { vwap, upper, lower };
}

/** Display metadata for {@link vwapIndicator}. */
export const vwapMeta: StudyMeta = {
  label: 'Volume Weighted Average Price',
  shortName: 'VWAP',
  inputs: [
    {
      key: 'anchor',
      label: 'Anchor Period',
      integer: true,
      options: [
        { value: 0, label: 'Session' },
        { value: 1, label: 'Week' },
        { value: 2, label: 'Month' },
      ],
    },
    { key: 'bands', label: 'Bands Multiplier', min: 0, step: 0.5 },
  ],
  styles: [
    { key: 'vwap', label: 'VWAP', colorIndex: 0, kind: 'line' },
    { key: 'upper', label: 'Upper Band', colorIndex: 1, kind: 'line' },
    { key: 'lower', label: 'Lower Band', colorIndex: 2, kind: 'line' },
    { key: 'bandsFill', label: 'Bands Fill', colorIndex: 3, kind: 'fill' },
  ],
};

/**
 * VWAP indicator definition (name `'vwap'`, main pane). Params `anchor`
 * (0 session, 1 week, 2 month; default 0) and `bands` (standard-deviation
 * multiplier; 0 = no band lines). With bands, fill `bandsFill` shades
 * between them. Tail updates resume from the state saved for the output
 * being updated, or recompute the current anchor period.
 */
export const vwapIndicator: IndicatorDef = {
  name: 'vwap',
  ...vwapMeta,
  defaultParams: { anchor: 0, bands: 0 },
  defaultColors: ['#2196f3', '#4caf50', '#4caf50', 'rgba(76, 175, 80, 0.1)'],
  defaultPane: 'main',
  update(output, candles, from, params) {
    if (from >= candles.length) return output;
    const anchor = anchorParam(params);
    const [vwap, upper, lower] = output.lines.map((line) => line.values as (number | null)[]);
    const bands = upper === undefined ? null : { upper, lower, mult: bandsParam(params) };
    const tail = TAILS.get(output);
    const state = tail === undefined ? undefined : from === tail.length ? tail.after : from === tail.length - 1 ? tail.before : undefined;
    // Without saved state (e.g. a re-wrapped output), recompute the anchor period containing `from`.
    const start = state !== undefined ? from : from > 0 ? periodStart(candles, from - 1, anchor) : 0;
    TAILS.set(output, fillVwap(candles, start, state ?? INITIAL, anchor, vwap, bands));
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const mult = bandsParam(params);
    const vwap = new Array<number | null>(candles.length).fill(null);
    const lines = [{ key: 'vwap', values: vwap, color: colors[0] ?? '#2196f3' }];
    let bands: VwapBands | null = null;
    if (mult > 0) {
      bands = {
        upper: new Array<number | null>(candles.length).fill(null),
        lower: new Array<number | null>(candles.length).fill(null),
        mult,
      };
      lines.push(
        { key: 'upper', values: bands.upper, color: colors[1] ?? '#4caf50' },
        { key: 'lower', values: bands.lower, color: colors[2] ?? '#4caf50' },
      );
    }
    const output: IndicatorOutput = bands === null ? { pane: 'main', lines } : {
      pane: 'main', lines,
      fills: [{ key: 'bandsFill', upperKey: 'upper', lowerKey: 'lower', color: colors[3] ?? 'rgba(76, 175, 80, 0.1)' }],
    };
    TAILS.set(output, fillVwap(candles, 0, INITIAL, anchorParam(params), vwap, bands));
    return output;
  },
};
