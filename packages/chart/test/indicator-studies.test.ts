import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../dist/core/data.js';
import { initWasm, type WasmKernels } from '../dist/wasm/loader.js';
import {
  atrIndicator,
  atrValues,
  donchianIndicator,
  donchianValues,
  ichimokuIndicator,
  ichimokuValues,
  psarIndicator,
  psarValues,
  rmaValues,
  rsiValues,
  stochIndicator,
  stochRsiIndicator,
  stochRsiValues,
  stochValues,
  supertrendIndicator,
  supertrendValues,
  trueRangeValues,
  type IndicatorDef,
  type IndicatorOutput,
} from '../dist/indicators/index.js';
import { windowExtremes, windowMid } from '../dist/indicators/donchian.js';
import { lengthParam, numberParam } from '../dist/indicators/params.js';

/** Five hand-checkable bars used by the worked examples below. */
const BARS: Candle[] = [
  { time: 0, open: 9, high: 10, low: 8, close: 9 },
  { time: 1, open: 9, high: 11, low: 9, close: 10 },
  { time: 2, open: 10, high: 12, low: 9, close: 11 },
  { time: 3, open: 11, high: 11, low: 7, close: 8 },
  { time: 4, open: 8, high: 15, low: 12, close: 14 },
];

/** Deterministic random walk with realistic OHLC relationships. */
function walk(n: number, seed = 1, start = 100): Candle[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let close = start;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open + (rnd() - 0.5) * 4);
    const high = Math.max(open, close) + rnd() * 2;
    const low = Math.min(open, close) - rnd() * 2;
    out.push({ time: i, open, high, low, close, volume: 100 });
  }
  return out;
}

/** Low-priced bars with occasional huge ranges, so bands cross zero (Supertrend seeding). */
function wild(n: number, seed: number): Candle[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const low = 0.01 + rnd() * 0.5;
    const high = low + rnd() * (rnd() < 0.2 ? 10 : 0.5);
    out.push({ time: i, open: low, high, low, close: low + (high - low) * rnd() });
  }
  return out;
}

function near(actual: readonly (number | null)[], expected: readonly (number | null)[], eps = 1e-9): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i], a = actual[i];
    if (e === null || e === undefined || Number.isNaN(e)) assert.equal(a ?? null, null, `index ${i}: expected null, got ${a}`);
    else assert.ok(a != null && Math.abs(a - e) <= eps * Math.max(1, Math.abs(e)), `index ${i}: expected ${e}, got ${a}`);
  }
}

const line = (out: IndicatorOutput, key: string) => out.lines.find((l) => l.key === key)!;

// ---- Independent oracles: literal transcriptions of TradingView's Pine definitions ----

function pineRma(src: number[], length: number): number[] {
  const out: number[] = [];
  let sum = NaN;
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(sum)) {
      if (i >= length - 1) {
        let s = 0;
        for (let j = i - length + 1; j <= i; j++) s += src[j]!;
        sum = s / length;
      }
    } else sum = (1 / length) * src[i]! + (1 - 1 / length) * sum;
    out.push(sum);
  }
  return out;
}

function pineTr(c: Candle[]): number[] {
  return c.map((bar, i) => i === 0 ? bar.high - bar.low
    : Math.max(Math.max(bar.high - bar.low, Math.abs(bar.high - c[i - 1]!.close)), Math.abs(bar.low - c[i - 1]!.close)));
}

function pineHighest(src: number[], len: number, i: number): number {
  if (i < len - 1) return NaN;
  let m = -Infinity;
  for (let j = i - len + 1; j <= i; j++) m = Math.max(m, src[j]!);
  return m;
}

function pineLowest(src: number[], len: number, i: number): number {
  if (i < len - 1) return NaN;
  let m = Infinity;
  for (let j = i - len + 1; j <= i; j++) m = Math.min(m, src[j]!);
  return m;
}

function pineSma(src: number[], len: number): number[] {
  return src.map((_, i) => {
    if (i < len - 1) return NaN;
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += src[j]!;
    return s / len;
  });
}

function pineStoch(src: number[], high: number[], low: number[], len: number): number[] {
  return src.map((v, i) => {
    const hh = pineHighest(high, len, i), ll = pineLowest(low, len, i);
    return 100 * (v - ll) / (hh - ll); // 0/0 → NaN (na)
  });
}

function pineSupertrend(c: Candle[], factor: number, period: number): { st: number[]; dir: number[] } {
  const atr = pineRma(pineTr(c), period);
  const st: number[] = [], dir: number[] = [];
  let upperPrev = NaN, lowerPrev = NaN;
  for (let i = 0; i < c.length; i++) {
    const src = (c[i]!.high + c[i]!.low) / 2;
    let upper = src + factor * atr[i]!;
    let lower = src - factor * atr[i]!;
    const prevLower = Number.isNaN(lowerPrev) ? 0 : lowerPrev;
    const prevUpper = Number.isNaN(upperPrev) ? 0 : upperPrev;
    const prevClose = i > 0 ? c[i - 1]!.close : NaN;
    lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    let d: number;
    if (i === 0 || Number.isNaN(atr[i - 1]!)) d = 1;
    else if (st[i - 1] === upperPrev) d = c[i]!.close > upper ? -1 : 1;
    else d = c[i]!.close < lower ? 1 : -1;
    const value = Number.isNaN(atr[i]!) ? NaN : d === -1 ? lower : upper;
    st.push(value);
    dir.push(d);
    upperPrev = Number.isNaN(atr[i]!) ? NaN : upper;
    lowerPrev = Number.isNaN(atr[i]!) ? NaN : lower;
  }
  return { st, dir };
}

function pineSar(c: Candle[], start: number, inc: number, max: number): number[] {
  let result = NaN, maxMin = NaN, acceleration = NaN, isBelow = false;
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const { high, low, close } = c[i]!;
    let isFirstTrendBar = false;
    if (i === 1) {
      if (close > c[0]!.close) {
        isBelow = true; maxMin = high; result = c[0]!.low;
      } else {
        isBelow = false; maxMin = low; result = c[0]!.high;
      }
      isFirstTrendBar = true;
      acceleration = start;
    }
    result = result + acceleration * (maxMin - result);
    if (isBelow) {
      if (result > low) {
        isFirstTrendBar = true; isBelow = false; result = Math.max(high, maxMin); maxMin = low; acceleration = start;
      }
    } else if (result < high) {
      isFirstTrendBar = true; isBelow = true; result = Math.min(low, maxMin); maxMin = high; acceleration = start;
    }
    if (!isFirstTrendBar) {
      if (isBelow) {
        if (high > maxMin) { maxMin = high; acceleration = Math.min(acceleration + inc, max); }
      } else if (low < maxMin) { maxMin = low; acceleration = Math.min(acceleration + inc, max); }
    }
    const low1 = i >= 1 ? c[i - 1]!.low : NaN, high1 = i >= 1 ? c[i - 1]!.high : NaN;
    if (isBelow) {
      result = Math.min(result, low1);
      if (i > 1) result = Math.min(result, c[i - 2]!.low);
    } else {
      result = Math.max(result, high1);
      if (i > 1) result = Math.max(result, c[i - 2]!.high);
    }
    out.push(result);
  }
  return out;
}

describe('ATR', () => {
  it('matches the hand-computed Wilder RMA of the true range', () => {
    assert.deepEqual(trueRangeValues(BARS), [2, 2, 3, 4, 7]);
    near(atrValues(BARS, 3), [null, null, 7 / 3, 26 / 9, 115 / 27], 1e-12);
  });
  it('matches the Pine ta.atr transcription and handles degenerate lengths', () => {
    const c = walk(300, 5);
    for (const period of [1, 2, 14, 50]) near(atrValues(c, period), pineRma(pineTr(c), period), 1e-12);
    near(atrValues(BARS, 6), [null, null, null, null, null]);
    near(rmaValues([1, 2, 3], 0), [null, null, null]);
    near(rmaValues([1, 2, 3], NaN), [null, null, null]);
    assert.deepEqual(trueRangeValues([]), []);
  });
  it('floors fractional periods like the rolling helpers', () => {
    const fractional = rmaValues([1, 2, 3, 4, 5, 6], 2.5);
    assert.deepEqual(fractional, rmaValues([1, 2, 3, 4, 5, 6], 2));
    assert.deepEqual(Object.keys(fractional), ['0', '1', '2', '3', '4', '5']);
    near(rmaValues([1, 2, 3], 0.5), [null, null, null]);
    const c = walk(60, 4);
    assert.deepEqual(atrValues(c, 14.7), atrValues(c, 14));
    assert.deepEqual(supertrendValues(c, 10.5, 3), supertrendValues(c, 10, 3));
    const closes = c.map((bar) => bar.close);
    assert.deepEqual(stochRsiValues(closes, 14.9, 5.5, 3.2, 3.8), stochRsiValues(closes, 14, 5, 3, 3));
    assert.ok(stochRsiValues(closes, 14, 5, 3, 3).k.some((v) => v !== null));
  });
  it('definition uses defaults, colors and the sub pane', () => {
    const c = walk(40);
    const out = atrIndicator.compute(c, {}, [], null);
    assert.equal(out.pane, 'sub');
    assert.equal(out.lines[0]!.color, '#b71c1c');
    near(out.lines[0]!.values, atrValues(c, 14));
    assert.equal(atrIndicator.compute(c, { period: 5 }, ['#123'], null).lines[0]!.color, '#123');
  });
  it('tail updates equal full computation, falling back during warmup', () => {
    const c = walk(30, 9);
    const params = { period: 5 };
    let out = atrIndicator.compute(c.slice(0, 20), params, [], null);
    const live = c.slice(0, 20);
    for (let i = 20; i < 30; i++) {
      live.push(c[i]!);
      out = atrIndicator.update!(out, live, i, params, [], null)!;
      assert.deepEqual(out, atrIndicator.compute(live, params, [], null));
      live[i] = { ...c[i]!, high: c[i]!.high + 1, close: c[i]!.close + 0.5 };
      out = atrIndicator.update!(out, live, i, params, [], null)!;
      assert.deepEqual(out, atrIndicator.compute(live, params, [], null));
    }
    assert.equal(atrIndicator.update!(out, live, 4, params, [], null), undefined);
  });
});

describe('Supertrend', () => {
  it('matches the hand-computed ratchet and flip', () => {
    const { values, up } = supertrendValues(BARS, 2, 1);
    near(values, [null, 12, 12, 12, 8.375], 1e-12);
    assert.deepEqual(up, [false, false, false, false, true]);
  });
  it('matches the Pine ta.supertrend transcription on random walks', () => {
    for (const [period, factor] of [[10, 3], [3, 1], [7, 2.5], [2, 0.5]] as const) {
      const c = walk(400, period * 13);
      const pine = pineSupertrend(c, factor, period);
      const { values, up } = supertrendValues(c, period, factor);
      near(values, pine.st, 1e-12);
      assert.deepEqual(up.slice(period - 1), pine.dir.slice(period - 1).map((d) => d === -1));
    }
  });
  it('seeds its bands against zero like Pine, so negative lower bands match too', () => {
    let clamped = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const [period, factor] of [[2, 1], [3, 2], [5, 0.5]] as const) {
        const c = wild(40, seed);
        const pine = pineSupertrend(c, factor, period);
        const { values, up } = supertrendValues(c, period, factor);
        near(values, pine.st, 1e-12);
        assert.deepEqual(up.slice(period - 1), pine.dir.slice(period - 1).map((d) => d === -1));
        clamped += pine.st.filter((v) => v === 0).length;
      }
    }
    // The fixture really exercises the zero seed (an un-seeded ratchet plots negatives there).
    assert.ok(clamped > 0);
  });
  it('period 1 matches Pine from bar 1 and leaves the nz-seeded 0 of bar 0 empty', () => {
    for (const seed of [11, 12, 13]) {
      const c = walk(200, seed);
      const pine = pineSupertrend(c, 1.5, 1);
      const { values, up } = supertrendValues(c, 1, 1.5);
      assert.equal(pine.st[0], 0);
      assert.equal(values[0], null);
      near(values.slice(1), pine.st.slice(1), 1e-12);
      assert.deepEqual(up, pine.dir.map((d) => d === -1));
    }
    const out = supertrendIndicator.compute(BARS, { period: 1, multiplier: 1 }, ['#0f0', '#f00'], null).lines[0]!;
    assert.equal(out.colors![0], null);
    assert.ok(out.colors!.slice(1).every((c) => c !== null));
  });
  it('paints per-bar direction colors from the series tokens and breaks at flips', () => {
    const out = supertrendIndicator.compute(BARS, { period: 2, multiplier: 1 }, ['#0f0', '#f00'], null);
    const st = out.lines[0]!;
    assert.equal(out.pane, 'main');
    assert.equal(st.key, 'supertrend');
    assert.equal(st.color, '#0f0');
    assert.deepEqual(st.colors, [null, '#f00', '#f00', '#f00', '#0f0']);
    const defaults = supertrendIndicator.compute(walk(30), {}, [], null).lines[0]!;
    assert.ok(defaults.colors!.slice(9).every((c) => c === '#26a69a' || c === '#ef5350'));
    assert.deepEqual(defaults.colors!.slice(0, 9), new Array(9).fill(null));
  });
});

describe('Ichimoku', () => {
  it('matches hand-computed Donchian midpoints with TradingView offsets', () => {
    const v = ichimokuValues(BARS, 2, 3, 4);
    near(v.tenkan, [null, 9.5, 10.5, 9.5, 11]);
    near(v.kijun, [null, null, 10, 9.5, 11]);
    near(v.senkouA, [null, null, 10.25, 9.5, 11]);
    near(v.senkouB, [null, null, null, 9.5, 11]);
    near(v.chikou, [9, 10, 11, 8, 14]);
    const out = ichimokuIndicator.compute(BARS, { conversion: 2, base: 3, span: 4, displacement: 2 }, [], null);
    assert.deepEqual(out.lines.map((l) => [l.key, l.offset ?? 0]),
      [['tenkan', 0], ['kijun', 0], ['chikou', -1], ['senkouA', 1], ['senkouB', 1]]);
    assert.deepEqual(out.fills, [{ key: 'kumo', upperKey: 'senkouA', lowerKey: 'senkouB',
      color: 'rgba(67, 160, 71, 0.1)', colorBelow: 'rgba(244, 67, 54, 0.1)' }]);
  });
  it('defaults to 9/26/52/26 with a 25-bar shift and custom lengths recompute', () => {
    const c = walk(200, 4);
    const out = ichimokuIndicator.compute(c, {}, [], null);
    assert.equal(line(out, 'senkouA').offset, 25);
    assert.equal(line(out, 'chikou').offset, -25);
    const highs = c.map((b) => b.high), lows = c.map((b) => b.low);
    const mid = (len: number) => c.map((_, i) => (pineHighest(highs, len, i) + pineLowest(lows, len, i)) / 2);
    near(line(out, 'tenkan').values, mid(9));
    near(line(out, 'kijun').values, mid(26));
    near(line(out, 'senkouB').values, mid(52));
    near(line(out, 'senkouA').values, mid(9).map((t, i) => (t + mid(26)[i]!) / 2));
    const custom = ichimokuIndicator.compute(c, { conversion: 7, base: 22, span: 44, displacement: 22 }, [], null);
    near(line(custom, 'tenkan').values, mid(7));
    assert.equal(line(custom, 'senkouB').offset, 21);
    // A displacement of 1 means no shift, with a positive zero offset.
    const flat = ichimokuIndicator.compute(c, { displacement: 1 }, [], null);
    assert.ok(Object.is(line(flat, 'chikou').offset, 0));
    assert.deepEqual(ichimokuIndicator.compute(c, {}, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], null).lines.map((l) => l.color),
      ['a', 'b', 'c', 'd', 'e']);
  });
  it('keeps exact f64 channel prices (no f32 rounding) and nulls NaN windows', () => {
    const c = walk(60, 2, 65432.12);
    const out = ichimokuIndicator.compute(c, {}, [], null);
    const i = 59;
    const highs = c.map((b) => b.high), lows = c.map((b) => b.low);
    assert.equal(line(out, 'tenkan').values[i], (pineHighest(highs, 9, i) + pineLowest(lows, 9, i)) / 2);
    const holes = BARS.map((b, j) => (j === 2 ? { ...b, high: NaN } : b));
    near(ichimokuValues(holes, 2, 3, 4).tenkan, [null, 9.5, null, null, 11]);
  });
  it('tail updates equal full computation; long tails fall back', () => {
    const c = walk(120, 8);
    const params = { conversion: 3, base: 5, span: 8, displacement: 4 };
    const live = c.slice(0, 2);
    let out = ichimokuIndicator.compute(live, params, [], null);
    for (let i = 2; i < 120; i++) {
      live.push(c[i]!);
      out = ichimokuIndicator.update!(out, live, i, params, [], null) ?? ichimokuIndicator.compute(live, params, [], null);
      assert.deepEqual(out, ichimokuIndicator.compute(live, params, [], null));
    }
    live[119] = { ...live[119]!, low: NaN };
    out = ichimokuIndicator.update!(out, live, 119, params, [], null)!;
    assert.deepEqual(out, ichimokuIndicator.compute(live, params, [], null));
    assert.equal(ichimokuIndicator.update!(out, live, 0, params, [], null), undefined);
  });
});

describe('Donchian', () => {
  it('matches hand-computed channels with a fill between the bands', () => {
    const v = donchianValues(BARS, 2);
    near(v.upper, [null, 11, 12, 12, 15]);
    near(v.lower, [null, 8, 9, 7, 7]);
    near(v.basis, [null, 9.5, 10.5, 9.5, 11]);
    const out = donchianIndicator.compute(BARS, { period: 2 }, [], null);
    assert.equal(out.pane, 'main');
    assert.deepEqual(out.lines.map((l) => l.key), ['basis', 'upper', 'lower']);
    assert.deepEqual(out.fills, [{ key: 'background', upperKey: 'upper', lowerKey: 'lower', color: 'rgba(33, 150, 243, 0.1)' }]);
    assert.equal(donchianIndicator.compute(BARS, {}, [], null).lines[0]!.values.every((v) => v === null), true);
    const custom = donchianIndicator.compute(BARS, { period: 2 }, ['a', 'b', 'c', 'd'], null);
    assert.deepEqual([...custom.lines.map((l) => l.color), custom.fills![0]!.color], ['a', 'b', 'c', 'd']);
  });
  it('nulls windows with NaN prices on either side', () => {
    const holes = BARS.map((b, j) => (j === 1 ? { ...b, low: NaN } : b));
    const v = donchianValues(holes, 2);
    near(v.upper, [null, 11, 12, 12, 15]);
    near(v.lower, [null, null, null, 7, 7]);
    near(v.basis, [null, null, null, 9.5, 11]);
  });
  it('window helpers scan directly', () => {
    assert.deepEqual(windowExtremes(BARS, 3, 3), { high: 12, low: 7 });
    assert.equal(windowMid(BARS, 1, 3), null);
    assert.equal(windowMid(BARS, 4, 2), 11);
  });
  it('tail updates equal full computation across warmup, NaN and fallbacks', () => {
    const c = walk(80, 6);
    const params = { period: 6 };
    const live: Candle[] = [];
    let out = donchianIndicator.compute(live, params, [], null);
    for (let i = 0; i < 80; i++) {
      live.push(i === 40 ? { ...c[i]!, high: NaN } : i === 50 ? { ...c[i]!, low: NaN } : c[i]!);
      out = donchianIndicator.update!(out, live, i, params, [], null) ?? donchianIndicator.compute(live, params, [], null);
      assert.deepEqual(out, donchianIndicator.compute(live, params, [], null));
    }
    assert.equal(donchianIndicator.update!(out, live, 0, params, [], null), undefined);
  });
});

describe('Stochastic', () => {
  it('matches hand-computed %K/%D with 80/20 bands', () => {
    const closes = BARS.map((b) => b.close), highs = BARS.map((b) => b.high), lows = BARS.map((b) => b.low);
    near(stochValues(closes, highs, lows, 3), [null, null, 75, 20, 87.5], 1e-12);
    const out = stochIndicator.compute(BARS, { period: 3, smoothK: 1, smoothD: 2 }, [], null);
    near(line(out, 'k').values, [null, null, 75, 20, 87.5], 1e-12);
    near(line(out, 'd').values, [null, null, null, 47.5, 53.75], 1e-12);
    assert.deepEqual(out.levels, [
      { key: 'upperBand', value: 80, color: '#787b86' },
      { key: 'lowerBand', value: 20, color: '#787b86' },
    ]);
    assert.equal(out.pane, 'sub');
  });
  it('matches the Pine transcription (sma of ta.stoch) and returns na on flat windows', () => {
    const c = walk(300, 11);
    const closes = c.map((b) => b.close), highs = c.map((b) => b.high), lows = c.map((b) => b.low);
    const out = stochIndicator.compute(c, {}, [], null);
    const pineK = pineSma(pineStoch(closes, highs, lows, 14), 1);
    near(line(out, 'k').values, pineK, 1e-12);
    near(line(out, 'd').values, pineSma(pineK, 3), 1e-12);
    const smooth = stochIndicator.compute(c, { period: 5, smoothK: 3, smoothD: 4 }, ['x', 'y', 'u', 'l'], null);
    const k3 = pineSma(pineStoch(closes, highs, lows, 5), 3);
    near(line(smooth, 'k').values, k3, 1e-12);
    near(line(smooth, 'd').values, pineSma(k3, 4), 1e-12);
    assert.deepEqual(smooth.levels!.map((l) => l.color), ['u', 'l']);
    const flat = [1, 1, 1, 1];
    near(stochValues(flat, flat, flat, 2), [null, null, null, null]);
  });
  it('stays exact f64 on raw prices even when WASM kernels are available', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const c = walk(500, 3, 65000);
    // f32 prices near 65k are ~0.004 apart, enough to move %K by ~0.04 on a
    // narrow window, so the price stochastic deliberately ignores kernels.
    assert.deepEqual(stochIndicator.compute(c, {}, [], kernels), stochIndicator.compute(c, {}, [], null));
  });
  it('the kernel path of stochValues stays within 0-100 and near JS on bounded inputs', async () => {
    const kernels = (await initWasm()) as WasmKernels;
    const c = walk(300, 12);
    const osc = c.map((b) => 50 + (b.close - 100) / 2);
    const js = stochValues(osc, osc, osc, 9);
    const wasm = stochValues(osc, osc, osc, 9, kernels);
    near(wasm, js, 1e-4);
    for (const v of wasm) assert.ok(v === null || (v >= 0 && v <= 100));
  });
});

describe('Stochastic RSI', () => {
  it('matches the Pine transcription: sma(stoch(rsi), k), sma(k, d)', () => {
    const c = walk(400, 21);
    const closes = c.map((b) => b.close);
    const rsi = rsiValues(closes, 14).map((v) => v ?? NaN);
    const pineK = pineSma(pineStoch(rsi, rsi, rsi, 14), 3);
    const out = stochRsiIndicator.compute(c, {}, [], null);
    near(line(out, 'k').values, pineK, 1e-9);
    near(line(out, 'd').values, pineSma(pineK, 3), 1e-9);
    // Warmup: RSI(14) needs 15 closes, the stoch window 13 more, then k and d smoothing.
    assert.equal(line(out, 'k').values.findIndex((v) => v !== null), 14 + 13 + 2);
    assert.equal(line(out, 'd').values.findIndex((v) => v !== null), 14 + 13 + 4);
    assert.deepEqual(out.levels!.map((l) => l.value), [80, 20]);
  });
  it('custom lengths, flat RSI windows and WASM parity', async () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 8, 9, 10];
    const { k } = stochRsiValues(closes, 2, 3, 1, 1);
    // RSI(2) is pinned at 100 through bar 7, so those stoch windows are flat (na);
    // bar 8's drop to RSI 50 is the window low (0), as is bar 9's 25.
    assert.deepEqual(k.slice(0, 8), new Array(8).fill(null));
    assert.deepEqual(k.slice(8, 10), [0, 0]);
    assert.ok(k[10]! > 0);
    const kernels = (await initWasm()) as WasmKernels;
    const c = walk(300, 17);
    const js = stochRsiIndicator.compute(c, { rsi: 10, stoch: 12, k: 2, d: 5 }, ['a', 'b'], null);
    const wasm = stochRsiIndicator.compute(c, { rsi: 10, stoch: 12, k: 2, d: 5 }, ['a', 'b'], kernels);
    near(line(wasm, 'k').values, line(js, 'k').values, 1e-4);
    near(line(wasm, 'd').values, line(js, 'd').values, 1e-4);
    assert.deepEqual(js.lines.map((l) => l.color), ['a', 'b']);
  });
});

describe('Parabolic SAR', () => {
  it('matches the hand-computed stop-and-reverse sequence', () => {
    near(psarValues(BARS, 0.02, 0.02, 0.2), [null, 8, 8, 12, 7], 1e-12);
    const out = psarIndicator.compute(BARS, {}, [], null);
    assert.equal(out.lines[0]!.style, 'dots');
    assert.equal(out.lines[0]!.color, '#2962ff');
    assert.equal(out.pane, 'main');
  });
  it('matches the Pine ta.sar transcription including falling starts and the acceleration cap', () => {
    for (const [seed, start, inc, max] of [[1, 0.02, 0.02, 0.2], [2, 0.01, 0.05, 0.1], [3, 0.1, 0.1, 0.3]] as const) {
      const c = walk(500, seed);
      near(psarValues(c, start, inc, max), pineSar(c, start, inc, max), 1e-12);
    }
    const falling = [BARS[1]!, BARS[0]!, BARS[3]!, BARS[4]!];
    near(psarValues(falling, 0.02, 0.02, 0.2), pineSar(falling, 0.02, 0.02, 0.2), 1e-12);
    assert.deepEqual(psarValues(BARS.slice(0, 1), 0.02, 0.02, 0.2), [null]);
    assert.deepEqual(psarValues([], 0.02, 0.02, 0.2), []);
    near(psarIndicator.compute(BARS, { start: 0.1, increment: 0.1, max: 0.5 }, ['#abc'], null).lines[0]!.values,
      psarValues(BARS, 0.1, 0.1, 0.5));
  });
});

describe('parameter parsing', () => {
  it('floors lengths, clamps minimums and falls back for missing or non-finite values', () => {
    assert.equal(lengthParam({ n: 9.7 }, 'n', 5), 9);
    assert.equal(lengthParam({ n: -3 }, 'n', 5), 1);
    assert.equal(lengthParam({ n: 0 }, 'n', 5, 2), 2);
    assert.equal(lengthParam({}, 'n', 5), 5);
    assert.equal(lengthParam({ n: NaN }, 'n', 5), 5);
    assert.equal(lengthParam({ n: Infinity }, 'n', 5), 5);
    assert.equal(numberParam({ f: 2.5 }, 'f', 3), 2.5);
    assert.equal(numberParam({ f: -Infinity }, 'f', 3), 3);
    assert.equal(numberParam({}, 'f', 3), 3);
  });
  it('every new study tolerates empty data and non-finite params', () => {
    const defs: IndicatorDef[] = [atrIndicator, supertrendIndicator, ichimokuIndicator, donchianIndicator,
      stochIndicator, stochRsiIndicator, psarIndicator];
    for (const def of defs) {
      const empty = def.compute([], {}, [], null);
      assert.ok(empty.lines.every((l) => l.values.length === 0), def.name);
      const bad = Object.fromEntries(Object.keys(def.defaultParams).map((k) => [k, NaN]));
      assert.deepEqual(def.compute(walk(80), bad, [], null), def.compute(walk(80), {}, [], null), def.name);
    }
  });
});
