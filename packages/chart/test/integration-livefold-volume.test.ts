/**
 * Integration: the live bar folder (`@bloxwap/chart/datafeed`) feeding a chart
 * whose bloxwapDark preset turns the volume overlay on. The folder opens every
 * new bucket with volume 0 and backfills gaps from normalized history, so the
 * overlay must skip the forming bar until the feed supplies volume, keep
 * scaling from the bars that have it, and never paint a non-finite rect.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBarFolder, type Candle } from '../dist/datafeed/index.js';
import { DEFAULT_CONFIG, bloxwapDark, createChart, type Chart } from '../dist/index.js';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';

interface Rect { x: number; y: number; w: number; h: number; fill: unknown; alpha: number }

/** Records each fillRect with the fill style and alpha in effect. */
class RectRecorder extends MockContext2D {
  readonly rects: Rect[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.rects.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha });
  }
}

const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary
const UP = bloxwapDark.series!.upColor!;
const DOWN = bloxwapDark.series!.downColor!;
const OPACITY = bloxwapDark.volume!.opacity!;

const flush = () => new Promise<void>((r) => setImmediate(r));

/** 20 alternating up/down 1m bars ending at T0, volumes 10..200. */
const HISTORY: Candle[] = Array.from({ length: 20 }, (_, i) => {
  const up = i % 2 === 0;
  return {
    time: (T0 - (19 - i) * MIN) / 1000,
    open: up ? 100 : 101,
    high: 102,
    low: 99,
    close: up ? 101 : 100,
    volume: (i + 1) * 10,
  };
});

function mount(): { chart: Chart; ctx: RectRecorder } {
  const ctx = new RectRecorder();
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => ctx };
  const chart = createChart({ container: canvas, preset: 'bloxwapDark', config: { wasm: false, data: HISTORY } });
  return { chart, ctx };
}

/** Overlay bars among the rects recorded since the last clear; asserts they are finite. */
function overlayBars(ctx: RectRecorder): Rect[] {
  const bars = ctx.rects.filter((r) => r.alpha === OPACITY && (r.fill === UP || r.fill === DOWN));
  for (const r of bars) {
    assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite), 'overlay rects are finite');
    assert.ok(r.h >= 1);
  }
  return bars;
}

/** Runs `action` and returns the overlay bars of the frame(s) it drew. */
function overlayAfter(ctx: RectRecorder, action: () => void): Rect[] {
  ctx.rects.length = 0;
  action();
  return overlayBars(ctx);
}

/** Bottom edge shared by every bar (the main-pane bottom). */
function bottom(bars: readonly Rect[]): number {
  const edges = new Set(bars.map((r) => r.y + r.h));
  assert.equal(edges.size, 1, 'bars are pinned to one baseline');
  return [...edges][0]!;
}

describe('integration: live bar folder x volume overlay', () => {
  it('draws no bar for a freshly rolled (volume 0) bucket until the feed supplies volume', () => {
    const { chart, ctx } = mount();
    const initial = overlayAfter(ctx, () => chart.updateConfig({}));
    assert.equal(initial.length, HISTORY.length);
    assert.deepEqual(initial.map((r) => r.fill), HISTORY.map((c) => (c.close >= c.open ? UP : DOWN)));
    const base = bottom(initial);

    let now = T0 + 58_000;
    const published: Candle[] = [];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: HISTORY.at(-1)!,
      onBar: (b) => {
        published.push(b);
        chart.appendData(b);
      },
      now: () => now,
    });

    // In-bucket tick: the held bar keeps its volume, so its bar keeps its height.
    now += 500;
    const inBucket = overlayAfter(ctx, () => folder.pushTick(102));
    assert.equal(chart.dataLength, HISTORY.length);
    assert.equal(published.at(-1)!.volume, HISTORY.at(-1)!.volume);
    assert.deepEqual(inBucket.map((r) => r.h), initial.map((r) => r.h));
    assert.equal(inBucket.at(-1)!.fill, UP, 'the tick closed the down bar above its open');

    // Rolling tick: a new bar with volume 0 appears, but no overlay bar for it.
    now = T0 + MIN + 100;
    const rolled = overlayAfter(ctx, () => folder.pushTick(99));
    assert.equal(chart.dataLength, HISTORY.length + 1);
    assert.equal(published.at(-1)!.volume, 0);
    assert.equal(rolled.length, HISTORY.length);
    assert.equal(bottom(rolled), base);

    // The app supplies the forming bar's volume: it now draws, as the tallest
    // bar, in the down color (the bar opened at 102 and trades at 99).
    const withVolume = overlayAfter(ctx, () => chart.appendData({ ...folder.bar!, volume: 1000 }));
    assert.equal(withVolume.length, HISTORY.length + 1);
    const last = withVolume.reduce((a, b) => (b.x > a.x ? b : a));
    assert.equal(last.fill, DOWN);
    assert.equal(Math.max(...withVolume.map((r) => r.h)), last.h);
    assert.equal(bottom(withVolume), base);
    folder.dispose();
    chart.destroy();
  });

  it('backfilled gap bars carry their own volume; normalized NaN volumes draw nothing', async () => {
    const { chart, ctx } = mount();
    const base = bottom(overlayAfter(ctx, () => chart.updateConfig({})));
    const now = T0 + 5 * MIN + 500;
    const gap: Candle[] = [
      { time: (T0 + MIN) / 1000, open: 100, high: 103, low: 99, close: 102, volume: 50 },
      { time: (T0 + 2 * MIN) / 1000, open: 102, high: 103, low: 99, close: 100, volume: Number.NaN },
      { time: (T0 + 3 * MIN) / 1000, open: 100, high: 101, low: 97, close: 98, volume: 70 },
      { time: (T0 + 4 * MIN) / 1000, open: 98, high: 104, low: 98, close: 103, volume: 90 },
    ];
    const folder = createLiveBarFolder({
      intervalMs: MIN,
      seedBar: HISTORY.at(-1)!,
      fetchGap: async () => gap,
      onBar: (b) => chart.appendData(b),
      batch: (run) => chart.batch(run),
      now: () => now,
    });
    ctx.rects.length = 0;
    folder.pushTick(103.5); // a whole bucket late: repair, then replay this tick
    assert.equal(folder.filling, true);
    await flush();
    const bars = overlayBars(ctx);
    assert.equal(folder.filling, false);
    assert.equal(chart.dataLength, HISTORY.length + gap.length + 1);
    assert.equal(folder.bar!.volume, 0, 'the replayed tick rolled a fresh bucket');
    // One batched frame: history + the 3 gap bars with volume; the NaN-volume
    // gap bar (normalized to 0) and the rolled bucket draw no bar.
    assert.equal(bars.length, HISTORY.length + 3);
    assert.equal(bottom(bars), base);
    const tail = [...bars].sort((a, b) => a.x - b.x).slice(-3);
    assert.deepEqual(tail.map((r) => r.fill), [UP, DOWN, UP]);
    // Bars sit in main-pane coordinates, so the baseline is the pane height;
    // gap volumes 50/70/90 scale against history's 200, the tallest visible.
    const scale = (base * DEFAULT_CONFIG.volume.height) / 200; // the preset keeps the default height
    assert.deepEqual(tail.map((r) => r.h), [50, 70, 90].map((v) => Math.max(1, Math.round(v * scale))));
    folder.dispose();
    chart.destroy();
  });
});
