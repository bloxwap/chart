/**
 * Integration: the P1.6b line studies inside a chart fed by the live bar folder
 * (`@bloxwap/chart/datafeed`) and drawn as Heikin Ashi.
 *
 * - The folder publishes in-bucket replacements, volume-0 rolled buckets and,
 *   on a gap, a batched burst of history bars (one `chart.batch` redraw). The
 *   chart then hands each study one tail update from the earliest changed
 *   index. VWAP and ADX resume from the Wilder/West state saved for their
 *   cached output, so they must stay incremental (no full compute) and equal a
 *   full compute, including a burst that crosses the UTC session boundary.
 * - Heikin Ashi transforms only what the main series draws; studies keep the
 *   real candles, live tails included.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBarFolder, type Candle } from '../dist/datafeed/index.js';
import {
  adxIndicator,
  cciIndicator,
  createChart,
  createIndicatorRegistry,
  heikinAshi,
  maRibbonIndicator,
  mfiIndicator,
  obvIndicator,
  vwapIndicator,
  type Chart,
  type IndicatorDef,
  type IndicatorOutput,
  type RenderView,
} from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';

const MIN = 60_000;
/** 2024-01-02T00:00:00Z in seconds: a UTC session boundary. */
const MIDNIGHT = 1_704_153_600;
/** Start of the last history bar, five minutes before midnight (ms). */
const T0 = (MIDNIGHT - 300) * 1000;

const flush = () => new Promise<void>((r) => setImmediate(r));
const view = (chart: Chart) => (chart as unknown as { lastView: RenderView }).lastView;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** `n` seeded 1m bars whose last bar opens at `lastMs`, with two-decimal prices. */
function history(n: number, lastMs: number, seed = 5): Candle[] {
  const next = rng(seed);
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.round((open + (next() - 0.5) * 2) * 100) / 100;
    const high = Math.round((Math.max(open, close) + next()) * 100) / 100;
    const low = Math.round((Math.min(open, close) - next()) * 100) / 100;
    out.push({ time: (lastMs - (n - 1 - i) * MIN) / 1000, open, high, low, close, volume: Math.round(10 + next() * 90) });
  }
  return out;
}

/** Studies with a tail updater; MA Ribbon (no updater) always recomputes. */
const INCREMENTAL = [vwapIndicator, adxIndicator, cciIndicator, mfiIndicator, obvIndicator];
const STUDIES = [...INCREMENTAL, maRibbonIndicator];
const PARAMS: Record<string, Record<string, number>> = {
  vwap: { anchor: 0, bands: 2 },
  adx: { diLength: 5, adxSmoothing: 4 },
  cci: { period: 10 },
  mfi: { period: 7 },
  obv: {},
  'ma-ribbon': { type: 1, len1: 5, len2: 10, len3: 0, len4: 30, len5: 0, len6: 0, len7: 0, len8: 0 },
};

interface Probe {
  chart: Chart;
  outputs: Map<string, IndicatorOutput>;
  computes: Map<string, number>;
  fallbacks: Map<string, number>;
}

/** A chart whose registry wraps each study to record its latest output and how it was produced. */
function mount(data: Candle[], extra: Record<string, unknown> = {}): Probe {
  const outputs = new Map<string, IndicatorOutput>();
  const computes = new Map<string, number>();
  const fallbacks = new Map<string, number>();
  const registry = createIndicatorRegistry(false);
  for (const def of STUDIES) {
    const wrapped: IndicatorDef = {
      ...def,
      compute(...args) {
        computes.set(def.name, (computes.get(def.name) ?? 0) + 1);
        const output = def.compute(...args);
        outputs.set(def.name, output);
        return output;
      },
    };
    if (def.update !== undefined) {
      const update = def.update;
      wrapped.update = (...args) => {
        const output = update(...args);
        if (output === undefined) fallbacks.set(def.name, (fallbacks.get(def.name) ?? 0) + 1);
        else outputs.set(def.name, output);
        return output;
      };
    }
    registry.register(wrapped);
  }
  const chart = createChart({
    container: new MockCanvas(900, 700),
    registries: { indicators: registry },
    config: { wasm: false, data, ...extra },
  });
  for (const def of STUDIES) chart.addIndicator({ name: def.name, params: PARAMS[def.name]! });
  return { chart, outputs, computes, fallbacks };
}

/** Every study's cached output equals a full compute over `candles`; the incremental ones never recomputed. */
function assertExact(probe: Probe, candles: readonly Candle[], step: string): void {
  for (const def of STUDIES) {
    const expected = def.compute(candles, PARAMS[def.name]!, def.defaultColors, null);
    assert.deepEqual(probe.outputs.get(def.name), expected, `${def.name} after ${step}`);
  }
  for (const def of INCREMENTAL) {
    assert.equal(probe.computes.get(def.name), 1, `${def.name} stays incremental after ${step}`);
    assert.equal(probe.fallbacks.get(def.name) ?? 0, 0, `${def.name} never falls back after ${step}`);
  }
}

describe('integration: live bar folder x line studies', () => {
  it('keeps every study exact and incremental through ticks, rolls and a batched gap across midnight', async () => {
    const data = history(60, T0);
    const probe = mount(data);
    const { chart } = probe;
    const candles = () => view(chart).candles;
    assertExact(probe, candles(), 'mount');

    let now = T0 + 58_000;
    const gap: Candle[] = [
      // The held bucket again, now with history's high/low/volume.
      { time: (T0 + MIN) / 1000, open: 100, high: 103, low: 97.5, close: 102, volume: 80 },
      { time: MIDNIGHT - 180, open: 102, high: 104, low: 101, close: 103.5, volume: 40 },
      { time: MIDNIGHT - 120, open: 103.5, high: 104, low: 99, close: 100, volume: Number.NaN },
      { time: MIDNIGHT - 60, open: 100, high: 101, low: 98, close: 98.5, volume: 25 },
      { time: MIDNIGHT, open: 98.5, high: 99.5, low: 96, close: 97, volume: 60 },
      { time: MIDNIGHT + 60, open: 97, high: 99, low: 96.5, close: 98.75, volume: 35 },
      { time: MIDNIGHT + 120, open: 98.75, high: 100, low: 98, close: 99.5, volume: 45 },
    ];
    let reads = 0;
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: data.at(-1)!,
      onBar: (bar) => chart.appendData(bar),
      fetchGap: async () => {
        reads++;
        return gap;
      },
      batch: (run) => chart.batch(run),
      now: () => now,
    });

    // In-bucket tick: the last bar is replaced.
    now += 500;
    folder.pushTick(data.at(-1)!.high + 1);
    assert.equal(chart.dataLength, 60);
    assertExact(probe, candles(), 'an in-bucket tick');

    // Rolling tick: a volume-0 bucket is appended, then the app supplies its volume.
    now = T0 + MIN + 100;
    folder.pushTick(99);
    assert.equal(chart.dataLength, 61);
    assert.equal(candles().at(-1)!.volume, 0);
    assertExact(probe, candles(), 'a volume-0 roll');
    chart.appendData({ ...folder.bar!, volume: 500 });
    assertExact(probe, candles(), 'a volume fill');

    // A whole bucket late, past midnight: one batched burst replaces the held bar,
    // appends five history bars across the session boundary and rolls the replayed tick.
    now = MIDNIGHT * 1000 + 3 * MIN + 500;
    folder.pushTick(100.25);
    assert.equal(folder.filling, true);
    await flush();
    assert.equal(reads, 1);
    assert.equal(folder.filling, false);
    assert.equal(chart.dataLength, 61 + gap.length - 1 + 1);
    const live = candles();
    assert.equal(live.at(-1)!.time, MIDNIGHT + 180);
    assert.equal(live.at(-1)!.volume, 0, 'the replayed tick rolled a fresh bucket');
    assertExact(probe, live, 'a batched gap repair');

    // The session anchor reset at midnight: VWAP there is that bar's own HLC3, and
    // the zero-volume rolled bar carries the session's value forward.
    const vwap = probe.outputs.get('vwap')!.lines[0]!.values;
    const first = live.findIndex((c) => c.time === MIDNIGHT);
    const bar = live[first]!;
    assert.equal(vwap[first], (bar.high + bar.low + bar.close) / 3);
    assert.equal(vwap.at(-1), vwap.at(-2));

    // Ticks after the repair still resume from the saved state.
    now += 500;
    folder.pushTick(101);
    now += 500;
    folder.pushTick(95);
    assert.equal(candles().at(-1)!.low, 95);
    assertExact(probe, candles(), 'ticks after the repair');

    folder.dispose();
    chart.destroy();
  });
});

describe('integration: Heikin Ashi x line studies', () => {
  it('computes studies from the real candles, live tails included', () => {
    const data = history(80, T0, 11);
    const probe = mount(data.slice(0, 70), { series: { type: 'heikin-ashi' } });
    const { chart } = probe;
    for (const candle of data.slice(70)) chart.appendData(candle);
    const last = data.at(-1)!;
    chart.appendData({ ...last, close: last.close + 0.5, high: last.high + 0.5, volume: 999 });

    const v = view(chart);
    assert.equal(v.candles.length, 80);
    assert.deepEqual(v.displayCandles, heikinAshi(v.candles), 'the series draws Heikin Ashi bars');
    assertExact(probe, v.candles, 'Heikin Ashi appends');
    // Heikin Ashi closes move differently, so OBV over the displayed bars would differ.
    assert.notDeepEqual(probe.outputs.get('obv'), obvIndicator.compute(v.displayCandles!, {}, obvIndicator.defaultColors, null));
    chart.destroy();
  });
});
