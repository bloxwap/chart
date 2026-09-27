/**
 * Integration: the P1.6a indicator engine (styling schema, extended painter,
 * channel/oscillator studies) against the features merged before it.
 *
 * - P1.6b line studies: their `<name>Meta` objects are the definitions'
 *   engine metadata, `lineWidths` follow style keys so a width stays with its
 *   plot when MA Ribbon/VWAP omit lines, and the new painter draws them
 *   exactly like the old polyline.
 * - Live bar folder (datafeed): ATR, Donchian and Ichimoku stay exact and
 *   incremental through ticks, rolls and a batched gap repair; the full
 *   recomputers stay exact; styling-only updates never recompute.
 * - Heikin Ashi (P1.8): the new studies read the real candles.
 * - Chart events (P0.1): `updateIndicator` relayouts are reported like any
 *   other render; styling alone moves nothing.
 * - Touch gestures (P0.4): a finger pan into the right-side whitespace shows
 *   Ichimoku's forward-shifted spans there and keeps them in the autoscale.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createLiveBarFolder } from '../dist/datafeed/index.js';
import {
  BUILTIN_INDICATORS,
  adxIndicator,
  adxMeta,
  atrIndicator,
  cciIndicator,
  cciMeta,
  createChart,
  createIndicatorRegistry,
  donchianIndicator,
  drawIndicator,
  heikinAshi,
  ichimokuIndicator,
  indicatorLineKeys,
  maRibbonIndicator,
  maRibbonMeta,
  mfiIndicator,
  mfiMeta,
  obvIndicator,
  obvMeta,
  psarIndicator,
  resolveIndicatorColors,
  stochIndicator,
  stochRsiIndicator,
  styleIndicatorOutput,
  supertrendIndicator,
  vwapIndicator,
  vwapMeta,
  type Chart,
  type CrosshairMoveEvent,
  type IndicatorDef,
  type IndicatorOutput,
  type RenderView,
  type StudyMeta,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { MockCanvas, MockContext2D, MockDocument, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale, type VisibleRange } from '../dist/core/scale.js';
import type { Candle } from '../dist/core/data.js';
import { drawHistogramBars } from '../dist/series/histogram.js';
import { createDrawingToolbar, type UIDocument, type UIElement } from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

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

/** Records the stroke color and width at every stroke (MockContext2D only logs methods). */
class StrokeRecorder extends MockContext2D {
  strokes: { style: unknown; width: number }[] = [];
  stroke(): void {
    super.stroke();
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth });
  }
  reset(): void {
    this.calls.length = 0;
    this.strokes = [];
  }
  widths(color: string): number[] {
    return this.strokes.filter((s) => s.style === color).map((s) => s.width);
  }
}

function recorded(data: Candle[]) {
  const ctx = new StrokeRecorder();
  const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
  const chart = createChart({ container: canvas, config: { wasm: false, data } });
  return { chart, ctx };
}

// ------------------------------------------------------------------ metadata

const LINE_STUDIES: [IndicatorDef, StudyMeta][] = [
  [vwapIndicator, vwapMeta],
  [adxIndicator, adxMeta],
  [cciIndicator, cciMeta],
  [mfiIndicator, mfiMeta],
  [obvIndicator, obvMeta],
  [maRibbonIndicator, maRibbonMeta],
];

/** Params that switch on every optional plot. */
const EVERY_PLOT: Record<string, Record<string, number>> = {
  vwap: { bands: 1 },
  'ma-ribbon': { len5: 5, len6: 6, len7: 7, len8: 8 },
};

describe('integration: engine metadata x P1.6b line studies', () => {
  it('each line study carries its Meta as engine metadata', () => {
    for (const [def, meta] of LINE_STUDIES) {
      assert.equal(def.label, meta.label, def.name);
      assert.equal(def.shortName, meta.shortName, def.name);
      assert.equal(def.inputs, meta.inputs, def.name);
      assert.equal(def.styles, meta.styles, def.name);
    }
  });

  it('every built-in describes its params, colors and plots for a settings dialog', () => {
    const candles = history(260, T0, 3);
    assert.equal(BUILTIN_INDICATORS.length, 20);
    for (const def of BUILTIN_INDICATORS) {
      assert.ok(def.label && def.shortName, def.name);
      assert.deepEqual(def.inputs!.map((i) => i.key).sort(), Object.keys(def.defaultParams).sort(), def.name);
      for (const input of def.inputs!) {
        assert.ok(input.label.length > 0, def.name);
        // A choice list ignores `step`; a whole-number field steps by 1.
        assert.ok(input.options !== undefined || input.integer !== true || input.step === 1, `${def.name}.${input.key}`);
      }
      assert.deepEqual([...new Set(def.styles!.map((s) => s.colorIndex))].sort((a, b) => a - b), def.defaultColors.map((_, i) => i), def.name);
      const colors = resolveIndicatorColors(def.defaultColors, '#0f0', '#f00');
      const full = def.compute(candles, { ...def.defaultParams, ...EVERY_PLOT[def.name] }, colors, null);
      assert.deepEqual(indicatorLineKeys(def), full.lines.map((l) => l.key), def.name);
      // At the defaults a study may omit plots, never reorder them.
      const keys = indicatorLineKeys(def);
      const shown = def.compute(candles, def.defaultParams, colors, null).lines.map((l) => keys.indexOf(l.key));
      assert.ok(shown.every((k, i) => k >= 0 && (i === 0 || k > shown[i - 1]!)), def.name);
    }
  });
});

// ------------------------------------------------------------------ line widths by key

describe('integration: lineWidths x studies that omit lines', () => {
  const RIBBON = ['#a00001', '#a00002', '#a00003', '#a00004', '#a00005', '#a00006', '#a00007', '#a00008'];

  it("MA Ribbon's widths stay with their slots when a middle slot is off", () => {
    const { chart, ctx } = recorded(history(120, T0));
    const id = chart.addIndicator({ name: 'ma-ribbon', params: { type: 0, len1: 3, len2: 0, len3: 5, len4: 7 }, colors: RIBBON });
    ctx.reset();
    // Slot order: ma1, ma2 (off), ma3, ma4.
    chart.updateIndicator(id, { lineWidths: [2, 5, 3] });
    assert.deepEqual(ctx.widths('#a00001'), [2]);
    assert.deepEqual(ctx.widths('#a00002'), [], 'the disabled slot draws nothing');
    assert.deepEqual(ctx.widths('#a00003'), [3], 'ma3 keeps its own width, not the disabled ma2 one');
    assert.deepEqual(ctx.widths('#a00004'), [1], 'ma4 has no width entry');
    ctx.reset();
    // Switching the slot on picks up the width that was waiting for it.
    chart.updateIndicator(id, { params: { len2: 4 } });
    assert.deepEqual([ctx.widths('#a00002'), ctx.widths('#a00003'), ctx.widths('#a00004')], [[5], [3], [1]]);
    ctx.reset();
    chart.updateIndicator(id, { hiddenLines: ['ma2'] });
    assert.deepEqual([ctx.widths('#a00002'), ctx.widths('#a00003')], [[], [3]]);
    chart.destroy();
  });

  it("VWAP's band widths apply once the bands are switched on", () => {
    const { chart, ctx } = recorded(history(120, T0));
    const id = chart.addIndicator({ name: 'vwap', colors: ['#b00001', '#b00002', '#b00003'], lineWidths: [4, 2, 3] });
    ctx.reset();
    chart.render();
    assert.deepEqual([ctx.widths('#b00001'), ctx.widths('#b00002')], [[4], []]);
    ctx.reset();
    chart.updateIndicator(id, { params: { bands: 1 } });
    assert.deepEqual([ctx.widths('#b00001'), ctx.widths('#b00002'), ctx.widths('#b00003')], [[4], [2], [3]]);
    chart.destroy();
  });

  it('styleIndicatorOutput maps widths by style key, else by line position', () => {
    const output: IndicatorOutput = { pane: 'main', lines: [
      { key: 'a', values: [1], color: '#1' },
      { key: 'c', values: [1], color: '#3' },
      { key: 'x', values: [1], color: '#9' },
    ] };
    const styled = (def?: Pick<IndicatorDef, 'styles'>) =>
      styleIndicatorOutput(output, { lineWidths: [2, 4, 6] }, def).lines.map((l) => l.lineWidth);
    const styles = [
      { key: 'a', label: 'A', colorIndex: 0 },
      { key: 'b', label: 'B', colorIndex: 1 },
      { key: 'c', label: 'C', colorIndex: 2, kind: 'dots' as const },
      { key: 'f', label: 'F', colorIndex: 3, kind: 'fill' as const },
    ];
    assert.deepEqual(styled(), [2, 4, 6], 'no definition: line order');
    assert.deepEqual(styled({}), [2, 4, 6], 'no style rows: line order');
    assert.deepEqual(styled({ styles: [{ key: 'f', label: 'F', colorIndex: 0, kind: 'fill' }] }), [2, 4, 6], 'no stroke rows: line order');
    assert.deepEqual(styled({ styles }), [2, 6, undefined], 'by key; an undeclared line keeps its own width');
    // Hiding alone never looks up the style rows.
    const hidden = styleIndicatorOutput(output, { hiddenLines: ['c'] }, { styles });
    assert.deepEqual(hidden.lines.map((l) => [l.key, l.lineWidth]), [['a', undefined], ['x', undefined]]);
  });
});

// ------------------------------------------------------------------ painter parity

/** The pre-engine indicator painter (renderer.ts `drawLinePath`), kept verbatim as the parity reference. */
function legacyDraw(ctx: MockContext2D, output: IndicatorOutput, range: VisibleRange, ts: TimeScale, ps: PriceScale): void {
  if (output.bars !== undefined) {
    drawHistogramBars(ctx, output.bars.values, output.bars.up, range, ts, ps, output.bars.upColor, output.bars.downColor);
  }
  for (const line of output.lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let pen = false;
    for (let i = range.from; i < range.to; i++) {
      const v = line.values[i];
      if (v === null || v === undefined || Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const x = ts.indexToX(i, line.values.length);
      const y = ps.priceToY(v);
      if (pen) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.stroke();
  }
}

describe('integration: engine painter x P1.6b line studies', () => {
  it('paints every line study exactly like the old polyline at every scroll position', () => {
    const candles = history(90, T0, 9);
    const params: Record<string, Record<string, number>> = {
      vwap: { bands: 1.5 },
      adx: { diLength: 5, adxSmoothing: 4 },
      cci: { period: 6 },
      mfi: { period: 5 },
      obv: {},
      'ma-ribbon': { type: 0, len1: 3, len2: 0, len3: 8, len4: 12 },
    };
    for (const [def] of LINE_STUDIES) {
      const computed = def.compute(candles, { ...def.defaultParams, ...params[def.name] }, def.defaultColors, null);
      // The legacy painter only knew lines; the CCI/MFI levels and VWAP band fill are checked elsewhere.
      const output: IndicatorOutput = { pane: computed.pane, lines: computed.lines };
      for (const scroll of [0, 9, -6, 85]) {
        const ts = new TimeScale(10, 300);
        ts.scrollOffset = scroll;
        const ps = new PriceScale();
        ps.height = 200;
        ps.setRange(-150, 300);
        const range = ts.visibleRange(candles.length);
        const ctx = new StrokeRecorder();
        const legacy = new StrokeRecorder();
        drawIndicator(ctx, output, range, ts, ps, candles.length);
        legacyDraw(legacy, output, range, ts, ps);
        assert.deepEqual(ctx.calls, legacy.calls, `${def.name} @ ${scroll}`);
        assert.deepEqual(ctx.strokes, legacy.strokes, `${def.name} @ ${scroll}`);
      }
    }
  });
});

// ------------------------------------------------------------------ live bar folder / Heikin Ashi

/** Studies with a tail updater; the rest recompute on every change. */
const INCREMENTAL = [atrIndicator, donchianIndicator, ichimokuIndicator];
const STUDIES = [...INCREMENTAL, supertrendIndicator, psarIndicator, stochIndicator, stochRsiIndicator];
const PARAMS: Record<string, Record<string, number>> = {
  atr: { period: 5 },
  donchian: { period: 6 },
  ichimoku: { conversion: 3, base: 5, span: 8, displacement: 4 },
  supertrend: { period: 4, multiplier: 2 },
  psar: { start: 0.02, increment: 0.02, max: 0.2 },
  stoch: { period: 5, smoothK: 2, smoothD: 3 },
  stochrsi: { rsi: 5, stoch: 5, k: 2, d: 2 },
};
const UP = '#26a69a';
const DOWN = '#ef5350';

interface Probe {
  chart: Chart;
  ids: Map<string, string>;
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
    config: { wasm: false, data, series: { upColor: UP, downColor: DOWN }, ...extra },
  });
  const ids = new Map<string, string>();
  for (const def of STUDIES) ids.set(def.name, chart.addIndicator({ name: def.name, params: PARAMS[def.name]! }));
  return { chart, ids, outputs, computes, fallbacks };
}

/** Every study's cached output equals a full compute over `candles`; the incremental ones computed once. */
function assertExact(probe: Probe, candles: readonly Candle[], step: string): void {
  for (const def of STUDIES) {
    const expected = def.compute(candles, PARAMS[def.name]!, resolveIndicatorColors(def.defaultColors, UP, DOWN), null);
    assert.deepEqual(probe.outputs.get(def.name), expected, `${def.name} after ${step}`);
  }
  for (const def of INCREMENTAL) {
    assert.equal(probe.computes.get(def.name), 1, `${def.name} stays incremental after ${step}`);
    assert.equal(probe.fallbacks.get(def.name) ?? 0, 0, `${def.name} never falls back after ${step}`);
  }
}

describe('integration: live bar folder x channel/oscillator studies', () => {
  it('keeps every study exact, and ATR/Donchian/Ichimoku incremental, through ticks, rolls and a batched gap', async () => {
    const data = history(60, T0);
    const probe = mount(data);
    const { chart } = probe;
    const candles = () => view(chart).candles;
    assertExact(probe, candles(), 'mount');

    // Restyling repaints from the cache: nothing recomputes and the tails keep updating in place.
    const computes = new Map(probe.computes);
    chart.updateIndicator(probe.ids.get('ichimoku')!, { lineWidths: [2, 2, 2, 2, 2], hiddenLines: ['chikou', 'kumo'] });
    chart.updateIndicator(probe.ids.get('stoch')!, { hiddenLines: ['upperBand'] });
    assert.deepEqual(probe.computes, computes);

    let now = T0 + 58_000;
    const gap: Candle[] = [
      { time: (T0 + MIN) / 1000, open: 100, high: 103, low: 97.5, close: 102, volume: 80 },
      { time: MIDNIGHT - 180, open: 102, high: 104, low: 101, close: 103.5, volume: 40 },
      { time: MIDNIGHT - 120, open: 103.5, high: 104, low: 99, close: 100, volume: 30 },
      { time: MIDNIGHT - 60, open: 100, high: 101, low: 98, close: 98.5, volume: 25 },
      { time: MIDNIGHT, open: 98.5, high: 99.5, low: 96, close: 97, volume: 60 },
      { time: MIDNIGHT + 60, open: 97, high: 99, low: 96.5, close: 98.75, volume: 35 },
    ];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: data.at(-1)!,
      onBar: (bar) => chart.appendData(bar),
      fetchGap: async () => gap,
      batch: (run) => chart.batch(run),
      now: () => now,
    });

    now += 500;
    folder.pushTick(data.at(-1)!.high + 1);
    assertExact(probe, candles(), 'an in-bucket tick');

    now = T0 + MIN + 100;
    folder.pushTick(99);
    assert.equal(chart.dataLength, 61);
    assertExact(probe, candles(), 'a roll');

    now = MIDNIGHT * 1000 + 2 * MIN + 500;
    folder.pushTick(100.25);
    await flush();
    assert.equal(chart.dataLength, 61 + gap.length - 1 + 1);
    assertExact(probe, candles(), 'a batched gap repair');

    // The styled Ichimoku still paints its restyled tail: shifted spans reach displacement - 1 bars past the last candle.
    const ichimoku = view(chart).panes[0]!.indicators.find((o) => o.lines.some((l) => l.key === 'tenkan'))!;
    assert.deepEqual(ichimoku.lines.map((l) => [l.key, l.lineWidth]), [['tenkan', 2], ['kijun', 2], ['senkouA', 2], ['senkouB', 2]]);
    assert.deepEqual(ichimoku.fills, [], 'the hidden Kumo is gone');
    const senkouA = ichimoku.lines.find((l) => l.key === 'senkouA')!;
    assert.equal(senkouA.values.length + senkouA.offset!, candles().length + PARAMS['ichimoku']!['displacement']! - 1);

    now += 500;
    folder.pushTick(95);
    assertExact(probe, candles(), 'ticks after the repair');
    folder.dispose();
    chart.destroy();
  });
});

describe('integration: Heikin Ashi x channel/oscillator studies', () => {
  it('computes the studies from the real candles, live tails included', () => {
    const data = history(80, T0, 11);
    const probe = mount(data.slice(0, 70), { series: { type: 'heikin-ashi', upColor: UP, downColor: DOWN } });
    const { chart } = probe;
    for (const candle of data.slice(70)) chart.appendData(candle);
    const last = data.at(-1)!;
    chart.appendData({ ...last, close: last.close + 0.5, high: last.high + 0.5 });

    const v = view(chart);
    assert.deepEqual(v.displayCandles, heikinAshi(v.candles), 'the series draws Heikin Ashi bars');
    assertExact(probe, v.candles, 'Heikin Ashi appends');
    const colors = resolveIndicatorColors(supertrendIndicator.defaultColors, UP, DOWN);
    assert.notDeepEqual(probe.outputs.get('supertrend'),
      supertrendIndicator.compute(v.displayCandles!, PARAMS['supertrend']!, colors, null), 'Heikin Ashi bars would trend differently');
    chart.destroy();
  });
});

// ------------------------------------------------------------------ chart events

describe('integration: updateIndicator x chart events', () => {
  it('reports the relayout on the next crosshair move; styling alone changes no range', () => {
    const { chart } = recorded(history(120, T0));
    const ranges: VisibleRangeChangeEvent[] = [];
    const moves: CrosshairMoveEvent[] = [];
    chart.subscribeVisibleRangeChange((e) => ranges.push(e));
    chart.subscribeCrosshairMove((e) => moves.push(e));
    const id = chart.addIndicator({ name: 'stoch' });
    const sub = view(chart).panes[1]!.layout;
    const y = sub.y + sub.height / 2;
    chart.setCrosshair(300, y);
    assert.equal(moves.at(-1)!.paneId, id, 'Stochastic starts in its own sub-pane');

    chart.updateIndicator(id, { lineWidths: [3, 3], hiddenLines: ['d', 'lowerBand'], colors: ['#010101'] });
    chart.updateIndicator(id, { pane: 'main' });
    assert.equal(ranges.length, 0, 'restyling and moving panes keep the viewport');
    chart.setCrosshair(301, y);
    assert.equal(moves.at(-1)!.paneId, 'main', 'the sub-pane is gone');
    chart.updateIndicator(id, { pane: 'sub' });
    chart.setCrosshair(300, y);
    const back = moves.at(-1)!;
    assert.equal(back.paneId, id);
    assert.ok(back.price! > -10 && back.price! < 110, `oscillator-scale price, got ${back.price}`);

    // Inside a batch, the update renders and reports once, at the end.
    chart.batch(() => {
      chart.updateIndicator(id, { pane: 'main' });
      chart.scale.scrollBy(5);
      assert.equal(ranges.length, 0, 'nothing is delivered mid-batch');
    });
    assert.equal(ranges.length, 1);
    chart.destroy();
  });
});

// ------------------------------------------------------------------ touch gestures

class TestFrames {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => { const id = ++this.seq; this.callbacks.set(id, callback); return id; };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
}

describe('integration: touch pan x Ichimoku offsets', () => {
  it('a finger pan into the whitespace reveals the forward spans there and keeps them in the autoscale', () => {
    const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
    windows.push(win);
    const doc = win.document;
    const rail = doc.createElement('div');
    const stage = doc.createElement('div');
    const canvas = doc.createElement('div');
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
    stage.append(canvas);
    doc.body.append(rail, stage);
    const chartDoc = new MockDocument();
    // Bars 160-170 spike far above the rest. At 6px bars about 124 bars show, so
    // at the latest bar they are out of view and their leading spans, plotted
    // 149 bars ahead (309-321), lie past the last candle.
    const SPIKE = [160, 170];
    const data = history(300, T0).map((c, i) => (i >= SPIKE[0]! && i <= SPIKE[1]! ? { ...c, high: c.high + 200 } : c));
    const chart = createChart({ document: chartDoc, config: { wasm: false, width: 800, height: 500, data } });
    const live = chartDoc.created[0]!;
    const frames = new TestFrames();
    const tb = createDrawingToolbar({
      chart,
      document: doc as unknown as UIDocument,
      canvas: canvas as unknown as UIElement,
      rail: rail as unknown as UIElement,
      overlay: stage as unknown as UIElement,
      scheduler: frames,
    });
    const finger = (type: string, x: number) =>
      canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: 1, clientX: x, clientY: 200, button: 0, pointerType: 'touch', bubbles: true, cancelable: true }));
    const SENKOU_A = '#5e5e01';
    const params = { conversion: 3, base: 3, span: 3, displacement: 150 };
    const colors = ['#5e5e00', '#5e5e00', '#5e5e00', SENKOU_A, '#5e5e02', 'transparent', 'transparent'];
    chart.addIndicator({ name: 'ichimoku', params, colors });
    const spans = ichimokuIndicator.compute(data, params, colors, null).lines.filter((l) => l.key.startsWith('senkou'));
    const spikeTop = Math.max(...spans.flatMap((l) => l.values.slice(SPIKE[0], SPIKE[1]! + 3) as number[]));

    // Track the stroke color so the forward span's points can be told apart from other paths.
    const ctx = live.context;
    let style: unknown = ctx.strokeStyle;
    Object.defineProperty(ctx, 'strokeStyle', {
      get: () => style,
      set: (value: unknown) => { style = value; ctx.calls.push(['set:strokeStyle', value]); },
      configurable: true,
    });
    const spanXs = (): number[] => {
      const xs: number[] = [];
      let current: unknown = null;
      for (const call of ctx.calls) {
        if (call[0] === 'set:strokeStyle') current = call[1];
        else if (call[0] === 'stroke') current = null;
        else if (current === SENKOU_A && (call[0] === 'moveTo' || call[0] === 'lineTo')) xs.push(Number(call[1]));
      }
      return xs;
    };
    const top = () => view(chart).panes[0]!.priceScale.maxPrice;

    ctx.calls.length = 0;
    chart.render();
    assert.ok(Math.abs(Math.max(...spanXs()) - chart.scale.indexToX(299)) < 1e-6, 'at the latest bar the span ends at the last candle');
    assert.ok(top() < spikeTop, 'the spike is out of view and out of the autoscale');

    ctx.calls.length = 0;
    finger('pointerdown', 600);
    finger('pointermove', 300);
    frames.tick();
    frames.time += 200; // rest before lifting: no fling
    finger('pointerup', 300);
    const spacing = chart.scale.indexToX(1) - chart.scale.indexToX(0);
    assert.equal(spacing, 6);
    assert.ok(Math.abs(chart.scale.indexToX(299) - (chart.plotArea.width - 3 - 300)) < 1e-6, 'the finger dragged the last bar 300px left');
    const reach = Math.max(...spanXs());
    assert.ok(Math.abs(reach - chart.scale.indexToX(349)) < 1e-6, `the span fills the 50 whitespace bars (${reach})`);
    assert.ok(view(chart).range.from > SPIKE[1]!, 'the spike candles stay out of view');
    assert.ok(top() >= spikeTop, 'the spike spans plotted in the whitespace widen the autoscale');
    tb.destroy();
    chart.destroy();
  });
});
