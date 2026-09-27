import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../dist/core/data.js';
import { createChart } from '../dist/core/chart.js';
import { MockCanvas } from '../dist/dom.js';
import { initWasm, type WasmKernels } from '../dist/wasm/loader.js';
import * as root from '../dist/index.js';
import { windowSums } from '../dist/indicators/window-sums.js';
import {
  BUILTIN_INDICATORS,
  adxIndicator,
  adxMeta,
  adxValues,
  cciIndicator,
  cciMeta,
  cciValues,
  createIndicatorRegistry,
  emaValues,
  emaWasm,
  maRibbonIndicator,
  maRibbonMeta,
  mfiIndicator,
  mfiMeta,
  mfiValues,
  obvIndicator,
  obvMeta,
  obvValues,
  smaValues,
  smaWasm,
  vwapIndicator,
  vwapMeta,
  vwapValues,
  type IndicatorDef,
  type IndicatorOutput,
  type StudyMeta,
} from '../dist/indicators/index.js';

type Series = readonly (number | null)[];

const DAY = 86_400;
/** 2024-01-01T00:00:00Z, a Monday. */
const MONDAY = 1_704_067_200;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A seeded random walk; two-decimal prices so equal highs/lows/closes occur. */
function walk(n: number, seed = 7, start = MONDAY - 3 * DAY, step = 5 * 3600): Candle[] {
  const next = rng(seed);
  const candles: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = round2(open + (next() - 0.5) * 4);
    const high = round2(Math.max(open, close) + next() * 2);
    const low = round2(Math.min(open, close) - next() * 2);
    candles.push({ time: start + i * step, open, high, low, close, volume: Math.round(next() * 1000) + 1 });
  }
  return candles;
}

/** A candle whose HLC3 is exactly `price`. */
function flat(time: number, price: number, volume?: number): Candle {
  const candle = { time, open: price, high: price, low: price, close: price };
  return volume === undefined ? candle : { ...candle, volume };
}

/** Compares a study series with a reference where NaN/null means "no value". */
function assertClose(actual: Series, expected: readonly (number | null)[], tolerance = 1e-9, label = ''): void {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null || e === undefined || Number.isNaN(e)) {
      assert.equal(a, null, `${label}[${i}]: expected no value, got ${a}`);
    } else {
      assert.ok(typeof a === 'number' && Math.abs(a - e) <= tolerance * Math.max(1, Math.abs(e)), `${label}[${i}]: expected ${e}, got ${a}`);
    }
  }
}

function lineOf(output: IndicatorOutput, key: string): Series {
  const line = output.lines.find((l) => l.key === key);
  assert.ok(line, `missing line ${key}`);
  return line.values;
}

/** Wraps candles in a proxy that records the lowest index read through it. */
function tracked(candles: readonly Candle[]): { candles: readonly Candle[]; lowest: () => number } {
  let lowest = Infinity;
  const proxy = new Proxy(candles, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) lowest = Math.min(lowest, Number(key));
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { candles: proxy, lowest: () => lowest };
}

// ---------------------------------------------------------------------------
// TradingView references, ported from the charting library's PineJS Std
// helpers (sum/sma/rma/fixnan/dev/rsi/cum) and its DMI/CCI/MFI/OBV studies.
// ---------------------------------------------------------------------------

const nz = (value: number | undefined): number => (value === undefined || !Number.isFinite(value) ? 0 : value);
const na = (value: number | undefined): boolean => value === undefined || Number.isNaN(value);
const isZero = (value: number): boolean => Math.abs(value) <= 1e-10;

function tvSum(src: readonly number[], length: number): number[] {
  let previous = 0;
  return src.map((x, i) => (previous = nz(x) + previous - nz(src[i - length])));
}
function tvSma(src: readonly number[], length: number): number[] {
  const sum = tvSum(src, length);
  return src.map((_, i) => (na(src[i - length + 1]) ? NaN : sum[i]! / length));
}
function tvRma(src: readonly number[], length: number): number[] {
  const sum = tvSum(src, length);
  let previous = NaN;
  return src.map((x, i) => (previous = na(src[i - length + 1]) ? NaN : na(previous) ? sum[i]! / length : (x + previous * (length - 1)) / length));
}
function tvFixnan(src: readonly number[]): number[] {
  let last = NaN;
  return src.map((x) => (Number.isNaN(x) ? last : (last = x)));
}
const hlc3 = (c: Candle): number => (c.high + c.low + c.close) / 3;

function tvDmi(candles: readonly Candle[], length: number, smoothing: number) {
  const up = candles.map((c, i) => (i ? c.high - candles[i - 1]!.high : NaN));
  const down = candles.map((c, i) => (i ? -(c.low - candles[i - 1]!.low) : NaN));
  const plusDm = up.map((u, i) => (na(u) || na(down[i]) ? NaN : u > down[i]! && u > 0 ? u : 0));
  const minusDm = down.map((d, i) => (na(d) ? NaN : d > up[i]! && d > 0 ? d : 0));
  const tr = candles.map((c, i) => {
    const pc = i ? candles[i - 1]!.close : NaN;
    return Math.max(Math.max(c.high - c.low, Math.abs(c.high - pc)), Math.abs(c.low - pc));
  });
  const atr = tvRma(tr, length);
  const plus = tvFixnan(tvRma(plusDm, length).map((v, i) => (100 * v) / atr[i]!));
  const minus = tvFixnan(tvRma(minusDm, length).map((v, i) => (100 * v) / atr[i]!));
  const dx = plus.map((p, i) => {
    let sum = p + minus[i]!;
    if (isZero(sum)) sum += 1;
    return (Math.abs(p - minus[i]!) / sum) * 100;
  });
  return { plus, minus, adx: tvRma(dx, smoothing) };
}

function tvCci(candles: readonly Candle[], length: number): number[] {
  const tp = candles.map(hlc3);
  const ma = tvSma(tp, length);
  return tp.map((x, i) => {
    let dev = 0;
    for (let o = 0; o < length; o++) dev += Math.abs(tp[i - o]! - ma[i]!);
    return (x - ma[i]!) / (0.015 * (dev / length));
  });
}

/**
 * Std.sum's semantics (nz, partial windows from bar 0) summed per window. The
 * library's running add/subtract can leave a residue above isZero's 1e-10 in
 * a window without flow, flipping MFI from 100 to 0 there; exact sums don't.
 */
function exactSum(src: readonly number[], length: number): number[] {
  return src.map((_, i) => {
    let sum = 0;
    for (let j = Math.max(0, i - length + 1); j <= i; j++) sum += nz(src[j]);
    return sum;
  });
}

function tvMfi(candles: readonly Candle[], length: number): number[] {
  const tp = candles.map(hlc3);
  const change = tp.map((x, i) => x - (i ? tp[i - 1]! : NaN));
  const le = (a: number, b: number): boolean => isZero(a - b) || a < b;
  const ge = (a: number, b: number): boolean => isZero(a - b) || a > b;
  const upper = exactSum(candles.map((c, i) => nz(c.volume) * (le(change[i]!, 0) ? 0 : tp[i]!)), length);
  const lower = exactSum(candles.map((c, i) => nz(c.volume) * (ge(change[i]!, 0) ? 0 : tp[i]!)), length);
  return upper.map((u, i) => (isZero(lower[i]!) ? 100 : isZero(u) ? 0 : 100 - 100 / (1 + u / lower[i]!)));
}

function tvObv(candles: readonly Candle[]): number[] {
  let total = 0;
  return candles.map((c, i) => {
    const change = i ? c.close - candles[i - 1]!.close : NaN;
    const volume = c.volume ?? NaN;
    return (total = nz(total) + (change > 0 && !isZero(change) ? volume : change < 0 && !isZero(change) ? -volume : 0 * volume));
  });
}

/**
 * Pine's ta.vwap (Σv·x / Σv) with calendar anchors built from Date. The band
 * variance is Σv·(x − vwap)² / Σv over the period in a second pass: the same
 * quantity as Pine's Σv·x²/Σv − vwap², without its cancellation residue.
 */
function referenceVwap(candles: readonly Candle[], anchor: number, mult: number) {
  const keyOf = (time: number): string => {
    const date = new Date(time * 1000);
    if (anchor === 2) return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (anchor === 1) {
      const back = (date.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back)).toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  };
  let key = '';
  let period: Candle[] = [];
  let sumPV = 0, sumV = 0;
  const vwap: (number | null)[] = [], upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (const c of candles) {
    const k = keyOf(c.time);
    if (k !== key) { key = k; period = []; sumPV = sumV = 0; }
    period.push(c);
    sumPV += hlc3(c) * nz(c.volume); sumV += nz(c.volume);
    if (sumV === 0) { vwap.push(null); upper.push(null); lower.push(null); continue; }
    const value = sumPV / sumV;
    const variance = period.reduce((sum, p) => sum + nz(p.volume) * (hlc3(p) - value) ** 2, 0) / sumV;
    const sd = Math.sqrt(variance);
    vwap.push(value); upper.push(value + mult * sd); lower.push(value - mult * sd);
  }
  return { vwap, upper, lower };
}

/**
 * Replays live-feed tail edits (replace the last candle, sometimes append a
 * few, sometimes append without a replace) and checks every tail update
 * reproduces a full compute exactly.
 */
function assertTailUpdates(def: IndicatorDef, params: Record<string, number>, candles: Candle[], seed: number, step: number): void {
  const colors = ['#111111', '#222222', '#333333'];
  const next = rng(seed);
  let output = def.compute(candles, params, colors, null);
  let updates = 0;
  for (let round = 0; round < 60; round++) {
    const last = candles[candles.length - 1]!;
    let from = candles.length;
    if (round % 3 !== 2) {
      from = candles.length - 1;
      const close = round2(last.close + (next() - 0.5) * 3);
      candles[from] = {
        ...last,
        close,
        high: Math.max(last.high, close),
        low: Math.min(last.low, close),
        volume: round % 5 === 0 ? 0 : Math.round(next() * 500),
      };
    }
    const appended = round % 2 === 1 || from === candles.length ? 1 + Math.floor(next() * 3) : 0;
    for (let k = 0; k < appended; k++) {
      const previous = candles[candles.length - 1]!;
      const close = round2(previous.close + (next() - 0.5) * 3);
      candles.push({
        time: previous.time + step,
        open: previous.close,
        close,
        high: round2(Math.max(previous.close, close) + next()),
        low: round2(Math.min(previous.close, close) - next()),
        volume: Math.round(next() * 800),
      });
    }
    const updated = def.update!(output, candles, from, params, colors, null);
    assert.ok(updated, `${def.name} tail update at ${from}`);
    output = updated;
    updates++;
    assert.deepEqual(output, def.compute(candles, params, colors, null), `${def.name} round ${round}`);
  }
  assert.equal(updates, 60);
}

describe('study registration and metadata', () => {
  const studies: [IndicatorDef, StudyMeta][] = [
    [vwapIndicator, vwapMeta],
    [adxIndicator, adxMeta],
    [cciIndicator, cciMeta],
    [mfiIndicator, mfiMeta],
    [obvIndicator, obvMeta],
    [maRibbonIndicator, maRibbonMeta],
  ];

  it('registers every study as a built-in and exports it from the root barrel', () => {
    const registry = createIndicatorRegistry();
    for (const [def] of studies) {
      assert.equal(registry.get(def.name), def);
      assert.ok(BUILTIN_INDICATORS.includes(def));
    }
    assert.deepEqual(studies.map(([def]) => def.name), ['vwap', 'adx', 'cci', 'mfi', 'obv', 'ma-ribbon']);
    assert.deepEqual(studies.map(([def]) => def.defaultPane), ['main', 'sub', 'sub', 'sub', 'sub', 'main']);
    assert.equal(root.vwapIndicator, vwapIndicator);
    assert.equal(root.maRibbonMeta, maRibbonMeta);
    assert.equal(root.adxValues, adxValues);
    assert.equal(root.obvValues, obvValues);
    assert.equal(root.cciValues, cciValues);
    assert.equal(root.mfiValues, mfiValues);
    assert.equal(root.vwapValues, vwapValues);
    for (const name of ['adxIndicator', 'adxMeta', 'cciIndicator', 'cciMeta', 'mfiIndicator', 'mfiMeta', 'obvIndicator', 'obvMeta', 'vwapMeta', 'maRibbonIndicator'] as const) {
      assert.ok(root[name], name);
    }
  });

  it('describes exactly the params and lines each study produces', () => {
    const candles = walk(260);
    const everything: Record<string, Record<string, number>> = {
      vwap: { bands: 1 },
      'ma-ribbon': { len5: 5, len6: 6, len7: 7, len8: 8 },
    };
    for (const [def, meta] of studies) {
      assert.ok(meta.shortName.length > 0 && meta.label.length >= meta.shortName.length);
      assert.deepEqual(meta.inputs.map((input) => input.key).sort(), Object.keys(def.defaultParams).sort(), def.name);
      const output = def.compute(candles, { ...def.defaultParams, ...everything[def.name] }, def.defaultColors, null);
      const lineStyles = meta.styles.filter((style) => style.kind === 'line');
      assert.deepEqual(output.lines.map((line) => line.key), lineStyles.map((style) => style.key), def.name);
      for (const style of lineStyles) {
        assert.equal(lineOf(output, style.key) === output.lines[style.colorIndex]!.values, true, `${def.name} ${style.key}`);
        assert.equal(output.lines[style.colorIndex]!.color, def.defaultColors[style.colorIndex]);
      }
      // Reference levels (CCI, MFI) and band fills (VWAP) have their own keyed, colored style rows.
      const plotStyles = meta.styles.filter((style) => style.kind !== 'line');
      const plots = [...(output.levels ?? []), ...(output.fills ?? [])];
      assert.deepEqual(plots.map((plot) => plot.key), plotStyles.map((style) => style.key), def.name);
      for (const style of plotStyles) {
        assert.equal(plots.find((plot) => plot.key === style.key)!.color, def.defaultColors[style.colorIndex], `${def.name} ${style.key}`);
      }
      for (const input of meta.inputs) {
        if (input.options) assert.ok(input.options.some((option) => option.value === def.defaultParams[input.key]), `${def.name}.${input.key}`);
        if (input.min !== undefined) assert.ok(def.defaultParams[input.key]! >= input.min);
      }
      assert.equal(output.pane, def.defaultPane);
    }
    assert.deepEqual(vwapMeta.inputs[0]!.options!.map((o) => o.label), ['Session', 'Week', 'Month']);
    assert.deepEqual(maRibbonMeta.inputs[0]!.options!.map((o) => o.label), ['SMA', 'EMA']);
  });
});

describe('obv', () => {
  it('accumulates signed volume from 0 and ignores missing or non-finite volume', () => {
    const candles: Candle[] = [
      flat(0, 10, 100), flat(1, 11, 200), flat(2, 11, 300), flat(3, 9, 400), flat(4, 12, 500),
      flat(5, 13), flat(6, 12, NaN), flat(7, 14, 50),
    ];
    assert.deepEqual(obvValues(candles), [0, 200, 200, -200, 300, 300, 300, 350]);
    const output = obvIndicator.compute(candles, {}, [], null);
    assert.deepEqual(output, { pane: 'sub', lines: [{ key: 'obv', values: [0, 200, 200, -200, 300, 300, 300, 350], color: '#2196f3' }] });
    assert.deepEqual(obvValues([]), []);
  });

  it('matches the TradingView study', () => {
    const candles = walk(400, 3);
    assertClose(obvValues(candles), tvObv(candles), 0, 'obv');
  });

  it('continues the running total on tail updates, including from an empty series', () => {
    assertTailUpdates(obvIndicator, {}, walk(40, 5), 11, 3600);
    const candles: Candle[] = [];
    let output = obvIndicator.compute(candles, {}, ['red'], null);
    candles.push(flat(0, 10, 5));
    output = obvIndicator.update!(output, candles, 0, {}, ['red'], null)!;
    candles.push(flat(1, 9, 7));
    output = obvIndicator.update!(output, candles, 1, {}, ['red'], null)!;
    assert.deepEqual(lineOf(output, 'obv'), [0, -7]);
  });
});

describe('cci', () => {
  it('matches hand-computed values on HLC3 and blanks warmup and flat windows', () => {
    const candles = [1, 2, 3, 2, 8].map((price, i) => flat(i, price));
    assertClose(cciValues(candles, 3), [null, null, 100, -50, 100], 1e-12);
    // HLC3 rather than close: (12 + 6 + 9) / 3 = 9.
    const mixed = [flat(0, 7), { time: 1, open: 9, high: 12, low: 6, close: 9 }, flat(2, 11)];
    assertClose(cciValues(mixed, 3), [null, null, (11 - 9) / (0.015 * (4 / 3))], 1e-12);
    const flatWindow = [flat(0, 0.1), flat(1, 0.1), flat(2, 0.1), flat(3, 0.4)];
    assertClose(cciValues(flatWindow, 3), [null, null, null, 100], 1e-9);
    assert.deepEqual(cciValues(candles, 1), [null, null, null, null, null]);
    assert.deepEqual(cciValues(candles.slice(0, 2)), [null, null]);
  });

  it('matches the TradingView study for several lengths', () => {
    const candles = walk(300, 9);
    for (const period of [2, 14, 20, 50]) assertClose(cciValues(candles, period), tvCci(candles, period), 1e-8, `cci(${period})`);
    const output = cciIndicator.compute(candles, {}, [], null);
    assert.deepEqual(output.lines.map((l) => [l.key, l.color]), [['cci', '#2196f3']]);
    assert.deepEqual(lineOf(output, 'cci'), cciValues(candles, 20));
  });

  it('reproduces full computes on tail updates', () => {
    assertTailUpdates(cciIndicator, { period: 20 }, walk(30, 13), 17, 3600);
    assertTailUpdates(cciIndicator, { period: 5 }, walk(3, 14), 18, 60);
  });
});

describe('mfi', () => {
  it('matches hand-computed values from the first candle and handles one-sided and missing flow', () => {
    const volumes = [1, 2, 3, 4];
    const candles = [10, 11, 10.5, 12].map((price, i) => flat(i, price, volumes[i]));
    // Candle 0 has no previous tp, so (like TradingView) its flow of 10 counts both ways.
    assertClose(mfiValues(candles, 2), [50, (100 * 32) / 42, (100 * 22) / 53.5, (100 * 48) / 79.5], 1e-12);
    const rising = [1, 2, 3, 4].map((price, i) => flat(i, price, 10));
    assert.deepEqual(mfiValues(rising, 2), [50, 75, 100, 100]);
    const falling = [4, 3, 2, 1].map((price, i) => flat(i, price, 10));
    assertClose(mfiValues(falling, 2), [50, (100 * 40) / 110, 0, 0], 1e-12);
    // No negative flow gives 100, including windows without any flow (TradingView's rsi).
    const noVolume = [1, 2, 3, 4].map((price, i) => flat(i, price));
    assert.deepEqual(mfiValues(noVolume, 2), [100, 100, 100, 100]);
    const unchanged = [5, 5, 5, 6].map((price, i) => flat(i, price, 10));
    assert.deepEqual(mfiValues(unchanged, 2), [50, 50, 100, 100]);
    // Partial windows until `period` candles exist.
    assertClose(mfiValues(candles.slice(0, 3)), [50, (100 * 32) / 42, (100 * 32) / 73.5], 1e-12);
    assert.deepEqual(mfiValues([]), []);
  });

  it('plots 100 through a zero-volume stretch once no negative flow is left', () => {
    const volumes = [5, 5, 5, 0, 0, 0, 0];
    const candles = [10, 11, 10, 12, 13, 12, 11].map((price, i) => flat(i, price, volumes[i]));
    const expected = [50, (100 * 105) / 155, (100 * 105) / 205, (100 * 55) / 105, 0, 100, 100];
    assertClose(mfiValues(candles, 3), expected, 1e-12);
    assertClose(tvMfi(candles, 3), expected, 1e-12);
  });

  it('matches the TradingView study from the first candle', () => {
    const candles = walk(300, 21);
    const sparse = candles.map((c, i) => (i % 9 < 4 ? { ...c, volume: 0 } : c));
    for (const period of [1, 3, 14, 40, 500]) {
      assertClose(mfiValues(candles, period), tvMfi(candles, period), 1e-9, `mfi(${period})`);
      assertClose(mfiValues(sparse, period), tvMfi(sparse, period), 1e-9, `sparse mfi(${period})`);
    }
    const output = mfiIndicator.compute(candles, {}, [], null);
    assert.deepEqual(output.lines.map((l) => [l.key, l.color]), [['mfi', '#7e57c2']]);
    assert.deepEqual(lineOf(output, 'mfi'), mfiValues(candles, 14));
  });

  it('reproduces full computes on tail updates', () => {
    assertTailUpdates(mfiIndicator, { period: 14 }, walk(30, 23), 29, 3600);
    assertTailUpdates(mfiIndicator, { period: 5 }, walk(2, 24), 30, 60);
  });
});

describe('vwap', () => {
  it('resets each UTC session, carries through zero volume and adds deviation bands', () => {
    const candles: Candle[] = [
      flat(MONDAY, 10, 1),
      flat(MONDAY + 3600, 12, 3),
      flat(MONDAY + 7200, 11, 0),
      flat(MONDAY + DAY, 20, 2),
      flat(MONDAY + DAY + 60, 22, 2),
      flat(MONDAY + 2 * DAY, 30),
      flat(MONDAY + 2 * DAY + 60, 31, 4),
    ];
    const { vwap, upper, lower } = vwapValues(candles, 0, 2);
    assertClose(vwap, [10, 11.5, 11.5, 20, 21, null, 31], 1e-12);
    const sd = Math.sqrt(0.75);
    assertClose(upper, [10, 11.5 + 2 * sd, 11.5 + 2 * sd, 20, 23, null, 31], 1e-12);
    assertClose(lower, [10, 11.5 - 2 * sd, 11.5 - 2 * sd, 20, 19, null, 31], 1e-12);

    const plain = vwapIndicator.compute(candles, { anchor: 0, bands: 0 }, [], null);
    assert.deepEqual(plain.lines.map((l) => [l.key, l.color]), [['vwap', '#2196f3']]);
    assert.deepEqual(lineOf(plain, 'vwap'), vwap);
    const banded = vwapIndicator.compute(candles, { bands: 2 }, ['a', 'b', 'c'], null);
    assert.deepEqual(banded.lines.map((l) => [l.key, l.color]), [['vwap', 'a'], ['upper', 'b'], ['lower', 'c']]);
    assert.deepEqual([lineOf(banded, 'upper'), lineOf(banded, 'lower')], [upper, lower]);
    assert.deepEqual(vwapIndicator.compute(candles, {}, [], null).lines.length, 1);
    assert.deepEqual(vwapIndicator.compute(candles, { bands: -1 }, [], null).lines.length, 1);
    assert.deepEqual(vwapIndicator.compute(candles, { bands: 1 }, [], null).lines.map((l) => l.color), ['#2196f3', '#4caf50', '#4caf50']);
  });

  it('anchors weeks on Monday UTC and months on the calendar month', () => {
    const at = (iso: string, price: number): Candle => flat(Date.parse(iso) / 1000, price, 1);
    const candles = [
      at('2023-12-30T12:00:00Z', 10), // Saturday
      at('2023-12-31T12:00:00Z', 20), // Sunday: same week, same month
      at('2024-01-01T00:00:00Z', 30), // Monday: new week and new month
      at('2024-01-03T12:00:00Z', 40),
      at('2024-01-07T23:59:59Z', 50), // Sunday: same week
      at('2024-01-08T00:00:00Z', 60), // Monday: new week
      at('2024-01-31T23:00:00Z', 70),
      at('2024-02-01T01:00:00Z', 80), // new month
    ];
    // 2024-02-01 is the Thursday of the week starting Monday 2024-01-29.
    assertClose(vwapValues(candles, 1, 0).vwap, [10, 15, 30, 35, 40, 60, 70, 75], 1e-12);
    assertClose(vwapValues(candles, 2, 0).vwap, [10, 15, 30, 35, 40, 45, 50, 80], 1e-12);
    assertClose(vwapValues(candles, 0, 0).vwap, [10, 20, 30, 40, 50, 60, 70, 80], 1e-12);
    // Unknown anchors fall back to the session.
    assert.deepEqual(vwapIndicator.compute(candles, { anchor: 7 }, [], null), vwapIndicator.compute(candles, {}, [], null));
    assert.deepEqual(vwapValues([]), { vwap: [], upper: [], lower: [] });
  });

  it("matches Pine's ta.vwap for every anchor", () => {
    const candles = walk(500, 31, MONDAY - 20 * DAY, 3 * 3600 + 17);
    for (const anchor of [0, 1, 2]) {
      const reference = referenceVwap(candles, anchor, 1.5);
      const actual = vwapValues(candles, anchor, 1.5);
      assertClose(actual.vwap, reference.vwap, 1e-10, `vwap anchor ${anchor}`);
      assertClose(actual.upper, reference.upper, 1e-10, `upper anchor ${anchor}`);
      assertClose(actual.lower, reference.lower, 1e-10, `lower anchor ${anchor}`);
    }
  });

  it('recomputes only the current anchor period on tail updates', () => {
    for (const anchor of [0, 1, 2]) {
      assertTailUpdates(vwapIndicator, { anchor, bands: 0 }, walk(40, 37, MONDAY - 2 * DAY, 7 * 3600), 41 + anchor, 7 * 3600);
      assertTailUpdates(vwapIndicator, { anchor, bands: 2 }, walk(40, 43, Date.UTC(2024, 0, 29) / 1000, 11 * 3600), 47 + anchor, 11 * 3600);
    }
    const candles: Candle[] = [];
    let output = vwapIndicator.compute(candles, { bands: 1 }, [], null);
    candles.push(flat(MONDAY, 10));
    output = vwapIndicator.update!(output, candles, 0, { bands: 1 }, [], null)!;
    assert.deepEqual(output.lines.map((l) => l.values), [[null], [null], [null]]);
  });
});

describe('adx', () => {
  it('matches a hand-computed Wilder DMI', () => {
    const candles: Candle[] = [
      { time: 0, open: 9, high: 10, low: 8, close: 9 },
      { time: 1, open: 9, high: 11, low: 9, close: 10 },
      { time: 2, open: 10, high: 12, low: 10, close: 11 },
      { time: 3, open: 11, high: 11, low: 8, close: 9 },
      { time: 4, open: 9, high: 13, low: 9, close: 12 },
    ];
    const { adx, plusDI, minusDI } = adxValues(candles, 2, 2);
    assertClose(plusDI, [null, null, 50, 20, 100 * 1.25 / 3.25], 1e-12);
    assertClose(minusDI, [null, null, 0, 40, 100 * 0.5 / 3.25], 1e-12);
    const dx4 = (Math.abs(1.25 - 0.5) / 1.75) * 100;
    assertClose(adx, [null, null, null, (100 + 100 / 3) / 2, (dx4 + (100 + 100 / 3) / 2) / 2], 1e-12);
  });

  it('matches the TradingView DMI study', () => {
    const candles = walk(400, 51);
    for (const [length, smoothing] of [[14, 14], [5, 3], [1, 1], [30, 50]] as const) {
      const reference = tvDmi(candles, length, smoothing);
      const actual = adxValues(candles, length, smoothing);
      assertClose(actual.plusDI, reference.plus, 1e-9, `+DI ${length}/${smoothing}`);
      assertClose(actual.minusDI, reference.minus, 1e-9, `-DI ${length}/${smoothing}`);
      assertClose(actual.adx, reference.adx, 1e-9, `ADX ${length}/${smoothing}`);
    }
    const defaults = adxValues(candles);
    assert.equal(defaults.plusDI.lastIndexOf(null), 13);
    assert.equal(defaults.plusDI.findIndex((v) => v !== null), 14);
    assert.equal(defaults.adx.findIndex((v) => v !== null), 27);
    const output = adxIndicator.compute(candles, {}, [], null);
    assert.deepEqual(output.lines.map((l) => [l.key, l.color]), [['adx', '#f50057'], ['plusDI', '#2196f3'], ['minusDI', '#ff6d00']]);
    assert.deepEqual([lineOf(output, 'adx'), lineOf(output, 'plusDI'), lineOf(output, 'minusDI')], [defaults.adx, defaults.plusDI, defaults.minusDI]);
  });

  it('waits out a flat start, carries DIs over zero-range bars and handles zero DI sums', () => {
    const still = Array.from({ length: 6 }, (_, i) => flat(i, 10));
    const moving: Candle[] = [...still, { time: 6, open: 10, high: 12, low: 10, close: 11 }, { time: 7, open: 11, high: 13, low: 11, close: 12 }];
    const flatStart = adxValues(moving, 2, 2);
    assert.deepEqual(flatStart.plusDI.slice(0, 6), [null, null, null, null, null, null]);
    assertClose(flatStart.plusDI.slice(6), [100, 200 / 3], 1e-12);
    assertClose(flatStart.minusDI.slice(6), [0, 0], 1e-12);
    assertClose(flatStart.adx, [null, null, null, null, null, null, null, 100], 1e-12);

    const gap: Candle[] = [
      { time: 0, open: 9, high: 10, low: 8, close: 9 },
      { time: 1, open: 9, high: 11, low: 9, close: 10 },
      flat(2, 10),
      { time: 3, open: 10, high: 10, low: 7, close: 8 },
    ];
    const carried = adxValues(gap, 1, 1);
    assertClose(carried.plusDI, [null, 50, 50, 0], 1e-12);
    assertClose(carried.minusDI, [null, 0, 0, 100], 1e-12);
    assertClose(carried.adx, [null, 100, 100, 100], 1e-12);

    const ranging = Array.from({ length: 8 }, (_, i): Candle => ({ time: i, open: 10, high: 11, low: 9, close: i % 2 ? 10.5 : 10 }));
    assertClose(adxValues(ranging, 2, 2).adx, [null, null, null, 0, 0, 0, 0, 0], 1e-12);
    assertClose(adxValues(ranging, 2, 2).plusDI, [null, null, 0, 0, 0, 0, 0, 0], 1e-12);
    assert.deepEqual(adxValues([]), { adx: [], plusDI: [], minusDI: [] });
  });

  it('resumes exactly from saved Wilder state on tail updates', () => {
    assertTailUpdates(adxIndicator, { diLength: 14, adxSmoothing: 14 }, walk(20, 61), 67, 3600);
    assertTailUpdates(adxIndicator, { diLength: 3, adxSmoothing: 2 }, walk(2, 62), 68, 60);
    const candles: Candle[] = [];
    let output = adxIndicator.compute(candles, {}, [], null);
    candles.push(flat(0, 10));
    output = adxIndicator.update!(output, candles, 0, {}, [], null)!;
    assert.deepEqual(output.lines.map((l) => l.values), [[null], [null], [null]]);
  });

  it('asks for a full compute when it has no state for the requested tail', () => {
    const candles = walk(40, 71);
    const output = adxIndicator.compute(candles, {}, [], null);
    assert.equal(adxIndicator.update!({ ...output }, candles, 39, {}, [], null), undefined);
    assert.equal(adxIndicator.update!(output, candles, 38, {}, [], null), undefined);
    assert.equal(adxIndicator.update!(output, candles, 39, {}, [], null), output);
  });
});

describe('ma-ribbon', () => {
  const candles = walk(260, 81);
  const closes = candles.map((c) => c.close);

  it('draws EMA(20/50/100/200) by default in gradient slot colors', () => {
    const output = maRibbonIndicator.compute(candles, maRibbonIndicator.defaultParams, maRibbonIndicator.defaultColors, null);
    assert.equal(output.pane, 'main');
    assert.deepEqual(output.lines.map((l) => [l.key, l.color]), [['ma1', '#f6c309'], ['ma2', '#fb9800'], ['ma3', '#fb6500'], ['ma4', '#f60c0c']]);
    assert.deepEqual(output.lines.map((l) => l.values), [20, 50, 100, 200].map((length) => emaValues(closes, length)));
    assert.deepEqual(maRibbonIndicator.compute(candles, {}, [], null), output);
  });

  it('switches to SMA, skips disabled slots and colors by slot', () => {
    const params = { type: 0, len1: 5, len2: 0, len3: -3, len4: NaN, len5: 0, len6: 8, len7: 0, len8: 300 };
    const output = maRibbonIndicator.compute(candles, params, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], null);
    assert.deepEqual(output.lines.map((l) => [l.key, l.color]), [['ma1', 'c1'], ['ma6', 'c6'], ['ma8', '#62128f']]);
    // Slots are keyed, not positional: meta styles resolve each emitted line by its key.
    assert.deepEqual(output.lines.map((l) => maRibbonMeta.styles.find((style) => style.key === l.key)!.colorIndex), [0, 5, 7]);
    assert.deepEqual(output.lines.map((l) => l.values), [smaValues(closes, 5), smaValues(closes, 8), smaValues(closes, 300)]);
    assert.ok(output.lines[2]!.values.every((v) => v === null));
    const none = maRibbonIndicator.compute(candles, { len1: 0, len2: 0, len3: 0, len4: 0 }, [], null);
    assert.deepEqual(none.lines, []);
  });

  it('stays in f64 with WASM kernels loaded, so BTC-scale averages keep their cents', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    // A BTC-like walk: at ~130k an f32 holds prices to 1/64, and a sliding f32 sum drifts further.
    const btc = walk(3000, 83).map((c) => ({ ...c, open: c.open + 130_000, high: c.high + 130_000, low: c.low + 130_000, close: c.close + 130_000 }));
    const btcCloses = btc.map((c) => c.close);
    for (const type of [0, 1]) {
      const params = { type, len5: 7 };
      const withKernels = maRibbonIndicator.compute(btc, params, [], kernels);
      assert.deepEqual(withKernels, maRibbonIndicator.compute(btc, params, [], null));
      assert.deepEqual(withKernels.lines.map((l) => l.values), [20, 50, 100, 200, 7].map((length) => (type ? emaValues : smaValues)(btcCloses, length)));
      // What the f32 kernels would have shown: off by more than a displayed cent.
      const f32 = (type ? emaWasm : smaWasm)(Float32Array.from(btcCloses), 200, kernels);
      const drift = Math.max(...f32.map((v, i) => (v === null ? 0 : Math.abs(v - (withKernels.lines[3]!.values[i] as number)))));
      assert.ok(drift > 0.01, `f32 drift ${drift}`);
    }
  });
});

describe('degenerate study params', () => {
  it('yield empty lines instead of throwing for NaN or infinite lengths', () => {
    const candles = walk(40, 97);
    for (const period of [NaN, Infinity]) {
      for (const def of [cciIndicator, mfiIndicator]) {
        const output = def.compute(candles, { period }, [], null);
        assert.ok(output.lines[0]!.values.every((v) => v === null), `${def.name}(${period})`);
        assert.equal(output.lines[0]!.values.length, 40);
      }
      const adx = adxIndicator.compute(candles, { diLength: period, adxSmoothing: 3 }, [], null);
      assert.ok(adx.lines.every((line) => line.values.every((v) => v === null)), `adx(${period})`);
      const ribbon = maRibbonIndicator.compute(candles, { len1: period, len2: 0, len3: 0, len4: 3 }, [], null);
      assert.deepEqual(ribbon.lines.map((l) => l.key), ['ma4']);
      assert.deepEqual(vwapIndicator.compute(candles, { anchor: period, bands: period }, [], null), vwapIndicator.compute(candles, {}, [], null));
    }
  });
});

describe('windowSums', () => {
  const naive = (values: readonly number[], period: number, i: number): number => {
    let sum = 0;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) sum += values[j]!;
    return sum;
  };

  it('sums each trailing window, partially at the start, and tails reproduce full passes bit for bit', () => {
    const next = rng(101);
    const values = Array.from({ length: 53 }, () => next() * 1000 - 100);
    for (const period of [1, 2, 3, 7, 10, 53, 80]) {
      const full = windowSums(Float64Array.from(values), 0, period, 0);
      assertClose([...full], values.map((_, i) => naive(values, period, i)), 1e-12, `period ${period}`);
      for (const from of [0, 1, 6, 20, 52, 53]) {
        const base = Math.max(0, from - period + 1);
        const tail = windowSums(Float64Array.from(values.slice(base)), base, period, from);
        assert.deepEqual([...tail], [...full.subarray(from)], `period ${period} from ${from}`);
      }
    }
  });

  it('never subtracts, so a huge value leaving the window cannot swallow the rest', () => {
    const values = Float64Array.from([1e20, 0.5, 0, 0, 0.25, 0]);
    assert.deepEqual([...windowSums(values, 0, 2, 0)], [1e20, 1e20, 0.5, 0, 0.25, 0.25]);
    assert.deepEqual([...windowSums(values.subarray(2), 2, 2, 3)], [0, 0.25, 0.25]);
  });
});

describe('incremental tail updates', () => {
  /** Replaces the last candle and appends one; checks the update and returns the lowest index it read. */
  function tick(def: IndicatorDef, params: Record<string, number>, candles: Candle[], output: IndicatorOutput) {
    const from = candles.length - 1;
    const last = candles[from]!;
    candles[from] = { ...last, close: last.close + 0.5, high: last.high + 0.5, volume: 7 };
    candles.push({ ...last, time: last.time + 60, close: last.close - 0.25, low: last.low - 0.25, volume: 3 });
    const probe = tracked(candles);
    const updated = def.update!(output, probe.candles, from, params, [], null);
    assert.equal(updated, output, `${def.name} updates in place`);
    assert.deepEqual(updated, def.compute(candles, params, [], null), def.name);
    return { from, lowest: probe.lowest() };
  }

  it('read only the candles the changed windows need', () => {
    const candles = walk(3000, 111, MONDAY, 60);
    const cases: [IndicatorDef, Record<string, number>, number][] = [
      [obvIndicator, {}, 1], // the previous close
      [adxIndicator, {}, 1], // the previous candle; Wilder state resumes
      [cciIndicator, { period: 20 }, 19], // the last window
      [mfiIndicator, { period: 14 }, 14], // the last window plus the tp before it
      [vwapIndicator, { anchor: 2, bands: 2 }, 0], // the month so far comes from saved state
    ];
    for (const [def, params, back] of cases) {
      const series = [...candles];
      const output = def.compute(series, params, [], null);
      for (let round = 0; round < 3; round++) {
        const { from, lowest } = tick(def, params, series, output);
        assert.equal(lowest, from - back, `${def.name} round ${round}`);
      }
    }
  });

  it('rescan only the current anchor period when VWAP has no saved state', () => {
    const candles = walk(3000, 113, MONDAY, 60);
    const params = { anchor: 0, bands: 1 };
    const rewrapped = { ...vwapIndicator.compute(candles, params, [], null) };
    const lastDay = Math.floor(candles[candles.length - 1]!.time / DAY);
    const dayStart = candles.findIndex((c) => Math.floor(c.time / DAY) === lastDay);
    assert.equal(dayStart, 2880);
    const { from, lowest } = tick(vwapIndicator, params, candles, rewrapped);
    assert.equal(lowest, dayStart - 1, `scanned back from ${from}`);
    // The rescan saves state, so the next tick is O(1) again.
    const next = tick(vwapIndicator, params, candles, rewrapped);
    assert.equal(next.lowest, next.from);

    // A deeper edit than the saved snapshots cover also rescans its period.
    const output = vwapIndicator.compute(candles, params, [], null);
    const at = candles.length - 2;
    candles[at] = { ...candles[at]!, volume: 999 };
    const deep = tracked(candles);
    vwapIndicator.update!(output, deep.candles, at, params, [], null);
    assert.equal(deep.lowest(), dayStart - 1);
    assert.deepEqual(output, vwapIndicator.compute(candles, params, [], null));

    // Without state, an update from 0 is a full recompute.
    const whole = { ...vwapIndicator.compute(candles.slice(0, 5), params, [], null) };
    assert.deepEqual(vwapIndicator.update!(whole, candles.slice(0, 5), 0, params, [], null), vwapIndicator.compute(candles.slice(0, 5), params, [], null));
  });

  it('treat an update with no changed candle as a no-op that keeps later tails exact', () => {
    for (const [def, params] of [[adxIndicator, {}], [vwapIndicator, { bands: 1 }]] as const) {
      const candles = walk(50, 117, MONDAY, 3600);
      const output = def.compute(candles, params, [], null);
      const snapshot = structuredClone(output);
      const probe = tracked(candles);
      assert.equal(def.update!(output, probe.candles, candles.length, params, [], null), output);
      assert.equal(probe.lowest(), Infinity, def.name);
      assert.deepEqual(output, snapshot);
      tick(def, params, candles, output);
    }
  });
});

describe('studies inside a chart', () => {
  it('renders every study and keeps live tail updates equal to full computes', () => {
    const outputs = new Map<string, IndicatorOutput>();
    const registry = createIndicatorRegistry(false);
    const studies = [vwapIndicator, adxIndicator, cciIndicator, mfiIndicator, obvIndicator, maRibbonIndicator];
    // Unique colors per study line, so the recorded strokes show which lines were drawn.
    const colorsOf = new Map(studies.map((def, s) => [def.name, def.defaultColors.map((_, i) => `#0${s}0${i}00`)]));
    const paramsOf = (def: IndicatorDef): Record<string, number> => ({ ...def.defaultParams, ...(def.name === 'vwap' ? { bands: 2 } : {}) });
    let updates = 0;
    for (const def of studies) {
      registry.register({
        ...def,
        compute(...args) {
          const output = def.compute(...args);
          outputs.set(def.name, output);
          return output;
        },
        ...(def.update
          ? {
              update(...args: Parameters<NonNullable<IndicatorDef['update']>>) {
                updates++;
                const output = def.update!(...args);
                if (output) outputs.set(def.name, output);
                return output;
              },
            }
          : {}),
      });
    }
    const canvas = new MockCanvas(800, 600);
    // Records the stroke color of every path that has at least one segment.
    const ctx = canvas.context;
    const stroked = new Set<string>();
    let segments = 0;
    const [beginPath, lineTo, stroke] = [ctx.beginPath.bind(ctx), ctx.lineTo.bind(ctx), ctx.stroke.bind(ctx)];
    ctx.beginPath = () => {
      segments = 0;
      beginPath();
    };
    ctx.lineTo = (x: number, y: number) => {
      segments++;
      lineTo(x, y);
    };
    ctx.stroke = () => {
      if (segments > 0) stroked.add(String(ctx.strokeStyle));
      stroke();
    };
    const candles = walk(120, 91, MONDAY - DAY, 3600);
    const chart = createChart({ container: canvas, registries: { indicators: registry }, config: { wasm: false, data: candles } });
    for (const def of studies) chart.addIndicator({ name: def.name, params: paramsOf(def), colors: colorsOf.get(def.name)! });
    // Every line with values in view was drawn in its own color; EMA(200) over 120 candles has none.
    const drawn = studies.flatMap((def) => outputs.get(def.name)!.lines.filter((l) => l.values.slice(-40).some((v) => v !== null)).map((l) => l.color));
    assert.equal(drawn.length, 12);
    for (const color of drawn) assert.ok(stroked.has(color), `stroked ${color}`);
    assert.ok(!stroked.has(colorsOf.get('ma-ribbon')![3]!));
    const live = [...candles];
    const last = live[live.length - 1]!;
    live[live.length - 1] = { ...last, close: last.close + 1, high: last.high + 1 };
    chart.appendData(live[live.length - 1]!);
    const next = { ...last, time: last.time + 3600, volume: 42 };
    live.push(next);
    chart.appendData(next);
    assert.equal(updates, 10);
    assert.equal(chart.dataLength, 121);
    for (const def of studies) {
      assert.deepEqual(outputs.get(def.name), def.compute(live, paramsOf(def), colorsOf.get(def.name)!, null), def.name);
    }
    chart.destroy();
  });
});
