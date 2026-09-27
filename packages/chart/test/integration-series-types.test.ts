/**
 * Integration: the Heikin Ashi / hollow candle series types (P1.8) with the
 * bloxwapDark volume overlay (P1.11) and the live bar folder (P0.3).
 *
 * On a Heikin Ashi chart `view.liveCandle` is an HA bar, so the overlay reads
 * the displayed bars too: every volume bar, the animated live one included,
 * takes the HA direction of the bar drawn above it, with unchanged heights.
 * Hollow candles keep the overlay's close-vs-open rule on the real candles.
 * A folder streaming into an HA chart keeps the HA bars equal to a full
 * recompute through in-bucket ticks, rolls and a batched gap repair, while
 * updating only the tail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBarFolder } from '../dist/datafeed/index.js';
import { bloxwapDark, createChart, heikinAshi, type Chart, type FrameScheduler, type RenderView } from '../dist/index.js';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

interface Rect { x: number; y: number; w: number; h: number; fill: unknown; alpha: number }

/** Records each fillRect with the fill style and alpha in effect. */
class RectRecorder extends MockContext2D {
  readonly rects: Rect[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.rects.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha });
  }
}

class Frames implements FrameScheduler {
  time = 0;
  sequence = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = this.sequence++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
  settle() {
    for (let i = 0; i < 100 && this.callbacks.size; i++) this.tick();
    assert.equal(this.callbacks.size, 0);
  }
}

const UP = bloxwapDark.series!.upColor!;
const DOWN = bloxwapDark.series!.downColor!;
const OPACITY = bloxwapDark.volume!.opacity!;
const BACKGROUND = bloxwapDark.theme!.background!;
const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary

/**
 * A falling market of candles that each gap down and then close above their
 * own open: every real bar is up, every HA bar after the first is down.
 */
const FALLING: Candle[] = Array.from({ length: 10 }, (_, i) => {
  const open = 100 - 3 * i;
  return { time: (T0 - (9 - i) * MIN) / 1000, open, high: open + 0.7, low: open - 0.2, close: open + 0.5, volume: (i + 1) * 10 };
});

const dir = (c: Candle) => (c.close >= c.open ? UP : DOWN);
const view = (chart: Chart) => (chart as unknown as { lastView: RenderView }).lastView;

function mount(type: 'heikin-ashi' | 'hollow-candlestick', data: readonly Candle[], animation?: Frames): { chart: Chart; ctx: RectRecorder } {
  const ctx = new RectRecorder();
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => ctx };
  const chart = createChart({
    container: canvas,
    preset: 'bloxwapDark',
    config: { wasm: false, data: [...data], series: { type } },
    ...(animation !== undefined ? { animation: { scheduler: animation, duration: 200 } } : {}),
  });
  return { chart, ctx };
}

/**
 * Overlay bars of the last frame drawn by `action` (a frame starts with the
 * background fill), left to right; asserts they are finite.
 */
function overlayAfter(ctx: RectRecorder, action: () => void): Rect[] {
  ctx.rects.length = 0;
  action();
  let start = 0;
  ctx.rects.forEach((r, i) => { if (r.fill === BACKGROUND) start = i; });
  const frame = ctx.rects.slice(start);
  const bars = frame.filter((r) => r.alpha === OPACITY && (r.fill === UP || r.fill === DOWN));
  for (const r of bars) assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite), 'overlay rects are finite');
  return bars.sort((a, b) => a.x - b.x);
}

/** The displayed bars of the last frame, with the live bar in place of the last one. */
function shown(chart: Chart): Candle[] {
  const v = view(chart);
  const bars = [...(v.displayCandles ?? v.candles)];
  if (v.liveCandle !== undefined) bars[bars.length - 1] = v.liveCandle;
  return bars;
}

describe('integration: series types x volume overlay', () => {
  it('colors the overlay by HA direction on a heikin-ashi chart, with the heights of the real volumes', () => {
    const { chart, ctx } = mount('heikin-ashi', FALLING);
    const ha = heikinAshi(FALLING);
    assert.ok(FALLING.every((c) => dir(c) === UP), 'every real bar is up');
    assert.deepEqual(ha.map(dir), [UP, ...Array<string>(9).fill(DOWN)], 'HA turns them down');

    const bars = overlayAfter(ctx, () => chart.updateConfig({}));
    assert.equal(bars.length, FALLING.length);
    assert.deepEqual(bars.map((r) => r.fill), ha.map(dir));

    // The same chart as candlesticks: real colors, identical geometry.
    const real = overlayAfter(ctx, () => chart.updateConfig({ series: { type: 'candlestick' } }));
    assert.deepEqual(real.map((r) => r.fill), FALLING.map(dir));
    assert.deepEqual(real.map(({ x, y, w, h }) => ({ x, y, w, h })), bars.map(({ x, y, w, h }) => ({ x, y, w, h })));
    chart.destroy();
  });

  it('keeps the animated HA live bar and the history in one color space', () => {
    const frames = new Frames();
    const { chart, ctx } = mount('heikin-ashi', FALLING, frames);
    const last = FALLING.at(-1)!;
    const next: Candle = { time: last.time + MIN / 1000, open: last.open - 3, high: last.open - 2.3, low: last.open - 3.2, close: last.open - 2.5, volume: 500 };
    assert.equal(dir(next), UP, 'the real appended bar is up');
    chart.appendData(next);
    for (const step of [60, 60, 200]) {
      const bars = overlayAfter(ctx, () => frames.tick(step));
      const expected = shown(chart);
      assert.equal(bars.length, expected.length);
      assert.deepEqual(bars.map((r) => r.fill), expected.map(dir), `frame after ${step}ms`);
      assert.equal(bars.at(-1)!.fill, DOWN, 'the live bar takes its HA direction like the rest');
    }
    frames.settle();
    assert.deepEqual(view(chart).liveCandle, heikinAshi([...FALLING, next]).at(-1));
    chart.destroy();
  });

  it('keeps close-vs-open overlay colors on the real candles for hollow candles', () => {
    const { chart, ctx } = mount('hollow-candlestick', FALLING);
    const bars = overlayAfter(ctx, () => chart.updateConfig({}));
    assert.equal(view(chart).displayCandles, view(chart).candles);
    assert.deepEqual(bars.map((r) => r.fill), FALLING.map(dir));
    chart.destroy();
  });
});

describe('integration: live bar folder x heikin-ashi', () => {
  const HISTORY: Candle[] = Array.from({ length: 20 }, (_, i) => {
    const up = i % 3 !== 0;
    return { time: (T0 - (19 - i) * MIN) / 1000, open: up ? 100 : 101, high: 102, low: 99, close: up ? 101 : 100, volume: (i + 1) * 10 };
  });

  /**
   * Asserts the drawn HA bars equal a full recompute of the real candles and
   * returns a snapshot (the cache updates its array in place).
   */
  function assertFresh(chart: Chart): readonly Candle[] {
    const v = view(chart);
    assert.deepEqual(v.displayCandles, heikinAshi(v.candles));
    return [...v.displayCandles!];
  }

  it('updates the HA tail through ticks, rolls and a batched gap repair', async () => {
    const { chart, ctx } = mount('heikin-ashi', HISTORY);
    const start = assertFresh(chart);
    let now = T0 + 58_000;
    const gap: Candle[] = [
      { time: (T0 + 2 * MIN) / 1000, open: 100, high: 103, low: 99, close: 102, volume: 50 },
      { time: (T0 + 3 * MIN) / 1000, open: 102, high: 103, low: 97, close: 98, volume: 70 },
    ];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: HISTORY.at(-1)!,
      fetchGap: async () => gap,
      onBar: (b) => chart.appendData(b),
      batch: (run) => chart.batch(run),
      now: () => now,
    });

    // In-bucket tick: only the last HA bar changes; earlier ones are kept as is.
    now += 500;
    let bars = overlayAfter(ctx, () => folder.pushTick(104));
    let ha = assertFresh(chart);
    assert.equal(ha.length, HISTORY.length);
    for (let i = 0; i < ha.length - 1; i++) assert.equal(ha[i], start[i], `bar ${i} is not recomputed`);
    assert.deepEqual(bars.map((r) => r.fill), ha.map(dir));

    // Rolling tick: a volume-0 bucket gets an HA bar but no overlay bar.
    now = T0 + MIN + 100;
    bars = overlayAfter(ctx, () => folder.pushTick(103));
    const rolled = assertFresh(chart);
    assert.equal(rolled.length, HISTORY.length + 1);
    assert.equal(rolled.at(-1)!.volume, 0);
    for (let i = 0; i < ha.length - 1; i++) assert.equal(rolled[i], ha[i], `bar ${i} is not recomputed`);
    assert.deepEqual(rolled.at(-2), ha.at(-1), 'the closed bar keeps its HA values');
    assert.equal(bars.length, HISTORY.length);

    // A whole bucket late: the repair lands in one batched frame.
    now = T0 + 4 * MIN + 500;
    ctx.rects.length = 0;
    folder.pushTick(98.5);
    assert.equal(folder.filling, true);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(folder.filling, false);
    const repaired = assertFresh(chart);
    assert.equal(repaired.length, HISTORY.length + 1 + gap.length + 1);
    for (let i = 0; i < rolled.length - 1; i++) assert.equal(repaired[i], rolled[i], `bar ${i} survives the repair`);
    bars = overlayAfter(ctx, () => chart.updateConfig({}));
    const withVolume = repaired.filter((c) => (c.volume ?? 0) > 0);
    assert.deepEqual(bars.map((r) => r.fill), withVolume.map(dir));
    folder.dispose();
    chart.destroy();
  });
});
