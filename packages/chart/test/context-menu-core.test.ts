import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, MockCanvas, MockDocument, type Chart, type FrameScheduler, type IndicatorHit } from '../dist/index.js';
import type { Candle } from '../dist/core/data.js';
import type { ChartConfig, DeepPartial } from '../dist/config.js';
import type { IndicatorDef, IndicatorLine, IndicatorOutput } from '../dist/indicators/index.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

const N = 200;
const DATA = candles(N);

/** A custom indicator whose output is exactly `lines`/`bars` (no computation). */
function fixed(name: string, pane: 'main' | 'sub', output: Omit<IndicatorOutput, 'pane'>, extra: Partial<IndicatorDef> = {}): IndicatorDef {
  return { name, defaultParams: {}, defaultColors: [], defaultPane: pane, compute: () => ({ pane, ...output }), ...extra };
}

const line = (key: string, values: (number | null)[], extra: Partial<IndicatorLine> = {}): IndicatorLine => ({ key, values, color: '#fff', ...extra });

function make(config: DeepPartial<ChartConfig> = {}, defs: IndicatorDef[] = [], animation?: { scheduler: FrameScheduler }): Chart {
  const chart = createChart({
    document: new MockDocument(),
    config: { wasm: false, data: DATA, ...config },
    ...(animation !== undefined ? { animation } : {}),
  });
  for (const def of defs) chart.indicators.register(def);
  return chart;
}

/** Layout of the chart below: 800×500, 24px time axis → plot 476 px; a sub-pane takes 1/4. */
const MAIN_H = Math.floor(476 * 3 / 4);
const SUB_Y = MAIN_H;
const SUB_H = 476 - MAIN_H;

class TestFrames implements FrameScheduler {
  time = 0;
  now = () => this.time;
  request = () => 1;
  cancel = () => {};
}

describe('chart.scale.scrollPrice', () => {
  it('pans the range in scale units, turning autoscale off once, and ignores no-ops', () => {
    const chart = make({ width: 640, height: 400 });
    const price = chart.scale.yToPrice(200);
    chart.scale.scrollPrice(0);
    assert.equal(chart.getConfig().priceAxis.autoScale, true, 'a zero pan changes nothing');
    chart.scale.scrollPrice(40);
    assert.equal(chart.getConfig().priceAxis.autoScale, false);
    assert.ok(Math.abs(chart.scale.priceToY(price) - 240) < 1e-6);
    chart.scale.scrollPrice(-40); // autoscale already off: a plain re-render
    assert.ok(Math.abs(chart.scale.priceToY(price) - 200) < 1e-6);
    chart.updateConfig({ priceAxis: { mode: 'logarithmic', inverted: true } });
    const logPrice = chart.scale.yToPrice(100);
    chart.scale.scrollPrice(30);
    assert.ok(Math.abs(chart.scale.priceToY(logPrice) - 130) < 1e-6, 'log and inverted axes follow the pointer too');
    chart.destroy();
  });

  it('is a no-op before the main pane is laid out', () => {
    const chart = createChart({ container: new MockCanvas(0, 0), config: { wasm: false } });
    chart.scale.scrollPrice(10);
    assert.equal(chart.getConfig().priceAxis.autoScale, true);
    chart.destroy();
  });
});

describe('chart.resetScale', () => {
  it('restores the initial bar spacing and scrolls back to the latest bar', () => {
    const chart = make();
    const initial = chart.scale.barSpacing();
    chart.scale.zoom(3);
    chart.scale.scrollBy(40);
    assert.notEqual(chart.scale.barSpacing(), initial);
    assert.ok(chart.scale.visibleRange().to < N);
    chart.resetScale();
    assert.equal(chart.scale.barSpacing(), initial);
    assert.equal(chart.scale.visibleRange().to, N);
    // The latest bar sits at the right edge of the plot, as on first render.
    const fresh = make();
    assert.equal(chart.scale.indexToX(N - 1), fresh.scale.indexToX(N - 1));
    assert.deepEqual(chart.scale.visibleRange(), fresh.scale.visibleRange());
  });

  it('turns price autoscale back on and refits the price range', () => {
    const chart = make({ priceAxis: { autoScale: false } });
    const frozenTop = chart.scale.yToPrice(0);
    chart.scale.scrollBy(120); // older bars: a manual scale keeps the old range
    assert.equal(chart.scale.yToPrice(0), frozenTop);
    chart.resetScale();
    assert.equal(chart.getConfig().priceAxis.autoScale, true);
    assert.equal(chart.scale.yToPrice(0), make().scale.yToPrice(0));
  });

  it('keeps the scale mode and re-captures a locked price-to-bar ratio', () => {
    const chart = make({ priceAxis: { lockPriceToBarRatio: true, mode: 'logarithmic' } });
    const locked = chart.scale.priceToBarRatio();
    // Ten times the prices: the lock holds the old ratio, so the candles overflow.
    const scaled = DATA.map((c) => ({ ...c, open: c.open * 10, high: c.high * 10, low: c.low * 10, close: c.close * 10 }));
    chart.setData(scaled);
    assert.ok(Math.abs(chart.scale.priceToBarRatio() - locked) < 1e-9);
    chart.resetScale();
    const refit = make({ data: scaled, priceAxis: { lockPriceToBarRatio: true, mode: 'logarithmic' } });
    assert.ok(Math.abs(chart.scale.priceToBarRatio() - refit.scale.priceToBarRatio()) < 1e-9);
    assert.notEqual(chart.scale.priceToBarRatio(), locked);
    assert.equal(chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.equal(chart.getConfig().priceAxis.lockPriceToBarRatio, true);
  });

  it('renders normally: visible range listeners hear the move', () => {
    const chart = make();
    chart.scale.scrollBy(50);
    const events: { from: number; to: number }[] = [];
    chart.subscribeVisibleRangeChange((e) => events.push({ from: e.from, to: e.to }));
    chart.resetScale();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.to, N);
  });

  it('scrolls to the latest time slot on a continuous axis', () => {
    // A 10-bar gap in the middle of hourly data.
    const gapped = DATA.map((c, i) => (i >= 100 ? { ...c, time: c.time + 10 * 3600 } : c));
    const chart = make({ data: gapped, timeScale: { continuous: true } });
    chart.scale.zoom(0.5);
    chart.scale.scrollBy(30);
    chart.resetScale();
    const slots = chart.scale.visibleSlots();
    assert.equal(slots.to, slots.length);
    assert.equal(chart.scale.barSpacing(), 6);
  });
});

describe('chart.indicatorAt', () => {
  const closes = DATA.map((c) => c.close);

  it('hits a main-pane overlay line and misses beside it', () => {
    const chart = make({}, [fixed('close-line', 'main', { lines: [line('c', closes)] })]);
    const id = chart.addIndicator({ name: 'close-line' });
    const x = chart.scale.indexToX(180);
    const y = chart.scale.priceToY(closes[180]!);
    assert.deepEqual(chart.indicatorAt(x, y), { id, key: 'c' } satisfies IndicatorHit);
    // Between two bars the stroke is still under the pointer.
    const mid = chart.scale.indexToX(180.5);
    assert.deepEqual(chart.indicatorAt(mid, (y + chart.scale.priceToY(closes[181]!)) / 2), { id, key: 'c' });
    assert.equal(chart.indicatorAt(x, y + 12), null);
    // The tolerance widens the reach.
    assert.deepEqual(chart.indicatorAt(x, y + 12, 14), { id, key: 'c' });
    // A point in the (empty) sub-pane band is outside the main pane.
    assert.equal(chart.indicatorAt(x, 499), null);
  });

  it('hits sub-pane lines in their own pane only', () => {
    const flat = Array.from({ length: N }, () => 50);
    const chart = make({}, [fixed('flat', 'sub', { lines: [line('flat', flat)] })]);
    const id = chart.addIndicator({ name: 'flat' });
    const x = chart.scale.indexToX(150);
    // A flat series pads its range symmetrically, so the line runs through the pane's middle.
    const y = SUB_Y + SUB_H / 2;
    assert.deepEqual(chart.indicatorAt(x, y), { id, key: 'flat' });
    assert.equal(chart.indicatorAt(x, y - 10), null);
    // The same pixel offset inside the main pane never reaches the sub-pane line.
    assert.equal(chart.indicatorAt(x, SUB_Y - 20), null);
  });

  it('hits histogram bars by their key, or "bars" without one', () => {
    const tens = Array.from({ length: N }, () => 10);
    const up = Array.from({ length: N }, () => true);
    const chart = make({}, [
      fixed('hist', 'sub', { lines: [], bars: { key: 'hist', values: tens, up, upColor: '#0f0', downColor: '#f00' } }),
      fixed('plain-bars', 'sub', { lines: [], bars: { values: tens.map((v, i) => (i === 150 ? Number.NaN : v)), up, upColor: '#0f0', downColor: '#f00' } }),
    ]);
    const hist = chart.addIndicator({ name: 'hist' });
    const x = chart.scale.indexToX(150);
    // Two sub-panes of equal weight: 3 : 1 : 1.
    const main = Math.floor(476 * 3 / 5);
    const sub = Math.floor(476 / 5);
    chart.addIndicator({ name: 'plain-bars' });
    // Inside a bar (range 0..10 fills the usable height).
    assert.deepEqual(chart.indicatorAt(x, main + sub / 2), { id: hist, key: 'hist' });
    // Above the bar tops by more than the tolerance.
    assert.equal(chart.indicatorAt(x, main + 1), null);
    const plain = chart.getConfig().indicators[1]!.id;
    assert.deepEqual(chart.indicatorAt(chart.scale.indexToX(120), main + sub + sub / 2), { id: plain, key: 'bars' });
    // A NaN bar is a gap, but its neighbours are within reach.
    assert.deepEqual(chart.indicatorAt(x, main + sub + sub / 2), { id: plain, key: 'bars' });
    assert.equal(chart.indicatorAt(x, main + sub + sub / 2, 0), null);
  });

  it('hits dots only near a dot', () => {
    const dots = closes.map((v, i) => (i % 10 === 0 ? v + 3 : null));
    const chart = make({}, [fixed('dots', 'main', { lines: [line('sar', dots, { style: 'dots', lineWidth: 2 })] })]);
    const id = chart.addIndicator({ name: 'dots' });
    const x = chart.scale.indexToX(150);
    const y = chart.scale.priceToY(dots[150]!);
    assert.deepEqual(chart.indicatorAt(x, y), { id, key: 'sar' });
    // Radius 3 plus the 6 px tolerance.
    assert.deepEqual(chart.indicatorAt(x + 8.5, y), { id, key: 'sar' });
    assert.equal(chart.indicatorAt(x + 9.5, y), null);
    // Dots are never joined: halfway to the next dot is empty.
    assert.equal(chart.indicatorAt(chart.scale.indexToX(155), (y + chart.scale.priceToY(dots[160]!)) / 2), null);
  });

  it('follows step corners and colour breaks like the painter', () => {
    const levels = closes.map((_, i) => (i < 150 ? 100 : 110));
    const defs = [
      fixed('stepped', 'main', { lines: [line('s', levels, { style: 'step' })] }),
      fixed('diagonal', 'main', { lines: [line('d', levels)] }),
      fixed('two-tone', 'main', { lines: [line('t', levels, { colors: levels.map((_, i) => (i < 150 ? '#f00' : '#0f0')) })] }),
    ];
    const chart = make({}, defs);
    chart.scale.zoom(40 / 6);
    chart.scale.scrollTo(160);
    // All three share the values, so the autoscaled range (and these pixels) stay put.
    const stepped = chart.addIndicator({ name: 'stepped' });
    const x0 = chart.scale.indexToX(149);
    const x1 = chart.scale.indexToX(150);
    const y0 = chart.scale.priceToY(100);
    const y1 = chart.scale.priceToY(110);
    assert.equal(x1 - x0, 40);
    // Just before the step, on the lower level.
    assert.deepEqual(chart.indicatorAt(x1 - 5, y0), { id: stepped, key: 's' });
    // The riser is vertical at the new bar.
    assert.deepEqual(chart.indicatorAt(x1, (y0 + y1) / 2), { id: stepped, key: 's' });
    chart.removeIndicator(stepped);
    // A plain line cuts the corner diagonally instead.
    const diagonal = chart.addIndicator({ name: 'diagonal' });
    assert.equal(chart.indicatorAt(x1 - 5, y0), null);
    assert.deepEqual(chart.indicatorAt((x0 + x1) / 2, (y0 + y1) / 2), { id: diagonal, key: 'd' });
    chart.removeIndicator(diagonal);
    // A colour change breaks the path: nothing joins bar 149 to bar 150.
    const twoTone = chart.addIndicator({ name: 'two-tone' });
    assert.equal(chart.indicatorAt((x0 + x1) / 2, (y0 + y1) / 2), null);
    assert.deepEqual(chart.indicatorAt(x1, y1), { id: twoTone, key: 't' });
  });

  it('applies line offsets', () => {
    const shifted = closes.map((_, i) => (i < 100 ? 90 : 120));
    const chart = make({}, [
      fixed('lead', 'main', { lines: [line('span', shifted, { offset: 26 })] }),
      fixed('plain', 'main', { lines: [line('span', shifted)] }),
    ]);
    const lead = chart.addIndicator({ name: 'lead' });
    const x = chart.scale.indexToX(110);
    // Bar 110 plots values[84] = 90 when shifted forward by 26 bars.
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(90)), { id: lead, key: 'span' });
    assert.equal(chart.indicatorAt(x, chart.scale.priceToY(120)), null);
    chart.updateIndicator(lead, { visible: false });
    const plain = chart.addIndicator({ name: 'plain' });
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(120)), { id: plain, key: 'span' });
  });

  it('ignores hidden lines, hidden bars and hidden indicators', () => {
    const tens = Array.from({ length: N }, () => 10);
    const chart = make({}, [
      fixed('pair', 'main', { lines: [line('upper', closes.map((v) => v + 1)), line('lower', closes.map((v) => v - 1))] }),
      fixed('only-bars', 'sub', { lines: [], bars: { key: 'hist', values: tens, up: tens.map(() => true), upColor: '#0f0', downColor: '#f00' } }),
    ]);
    const pair = chart.addIndicator({ name: 'pair', hiddenLines: ['upper'] });
    const x = chart.scale.indexToX(170);
    assert.equal(chart.indicatorAt(x, chart.scale.priceToY(closes[170]! + 1), 1), null);
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(closes[170]! - 1), 1), { id: pair, key: 'lower' });
    chart.updateIndicator(pair, { hiddenLines: [] });
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(closes[170]! + 1), 1), { id: pair, key: 'upper' });
    chart.updateIndicator(pair, { visible: false });
    assert.equal(chart.indicatorAt(x, chart.scale.priceToY(closes[170]! - 1), 1), null);
    const bars = chart.addIndicator({ name: 'only-bars' });
    assert.deepEqual(chart.indicatorAt(x, SUB_Y + SUB_H / 2), { id: bars, key: 'hist' });
    chart.updateIndicator(bars, { hiddenLines: ['hist'] });
    assert.equal(chart.indicatorAt(x, SUB_Y + SUB_H / 2), null);
  });

  it('never hits over the price axis, on either side', () => {
    for (const position of ['left', 'right'] as const) {
      const flat = Array.from({ length: N }, () => 50);
      const chart = make({ priceAxis: { position } }, [fixed('flat', 'sub', { lines: [line('flat', flat)] })]);
      const id = chart.addIndicator({ name: 'flat' });
      const y = SUB_Y + SUB_H / 2;
      const { left, width } = chart.plotArea;
      assert.equal(left, position === 'left' ? 64 : 0);
      assert.deepEqual(chart.indicatorAt(left + 10, y), { id, key: 'flat' });
      assert.deepEqual(chart.indicatorAt(left + width - 1, y), { id, key: 'flat' });
      assert.equal(chart.indicatorAt(position === 'left' ? left - 10 : left + width + 10, y), null);
    }
  });

  it('prefers the nearest plot and, on a tie, the topmost', () => {
    const chart = make({}, [
      fixed('a', 'main', { lines: [line('a', closes)] }),
      fixed('b', 'main', { lines: [line('b', closes.map((v) => v + 0.2))] }),
    ]);
    const a = chart.addIndicator({ name: 'a' });
    const b = chart.addIndicator({ name: 'b' });
    const x = chart.scale.indexToX(160);
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(closes[160]!) + 1), { id: a, key: 'a' });
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(closes[160]! + 0.2)), { id: b, key: 'b' });
    const twin = chart.addIndicator({ name: 'a' });
    assert.deepEqual(chart.indicatorAt(x, chart.scale.priceToY(closes[160]!) + 1), { id: twin, key: 'a' });
  });

  it('skips indicators fading out after removal or hiding', () => {
    const chart = make(
      { indicators: [{ id: 'x', name: 'x', params: {}, pane: 'main', colors: [], visible: true }, { id: 'y', name: 'y', params: {}, pane: 'main', colors: [], visible: true }] },
      [fixed('x', 'main', { lines: [line('x', closes)] }), fixed('y', 'main', { lines: [line('y', closes)] })],
      { scheduler: new TestFrames() },
    );
    chart.render();
    const x = chart.scale.indexToX(150);
    const y = chart.scale.priceToY(closes[150]!);
    assert.deepEqual(chart.indicatorAt(x, y), { id: 'y', key: 'y' });
    chart.removeIndicator('y'); // still painted while it fades
    assert.deepEqual(chart.indicatorAt(x, y), { id: 'x', key: 'x' });
    chart.updateIndicator('x', { visible: false });
    assert.equal(chart.indicatorAt(x, y), null);
  });

  it('returns null without a frame: no 2D context, no plot height, or destroyed', () => {
    const def = fixed('flat', 'sub', { lines: [line('flat', Array.from({ length: N }, () => 50))] });
    const blind = createChart({ container: { width: 800, height: 500, getContext: () => null }, config: { wasm: false, data: DATA } });
    blind.indicators.register(def);
    blind.addIndicator({ name: 'flat' });
    assert.equal(blind.indicatorAt(400, SUB_Y + SUB_H / 2), null);
    const flat = make({ height: 24 }, [def]);
    flat.addIndicator({ name: 'flat' });
    assert.equal(flat.indicatorAt(400, 5), null);
    const gone = make({}, [def]);
    gone.addIndicator({ name: 'flat' });
    assert.notEqual(gone.indicatorAt(400, SUB_Y + SUB_H / 2), null);
    gone.destroy();
    assert.equal(gone.indicatorAt(400, SUB_Y + SUB_H / 2), null);
  });

  it('rejects NaN pointers', () => {
    const chart = make({}, [fixed('close-line', 'main', { lines: [line('c', closes)] })]);
    chart.addIndicator({ name: 'close-line' });
    assert.equal(chart.indicatorAt(Number.NaN, 100), null);
  });
});
