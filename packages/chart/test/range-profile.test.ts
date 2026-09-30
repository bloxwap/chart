import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachRangeProfile,
  createChart,
  createRangeProfilePrimitive,
  formatProfileVolume,
  gridVolumeRows,
  profileStep,
  resolveConfig,
  type Chart,
  type ChartConfig,
  type PanePrimitive,
} from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';

const bar = (low: number, high: number, up: boolean, volume?: number): Candle => ({
  time: 1_700_000_000, open: up ? low : high, high, low, close: up ? high : low, ...(volume === undefined ? {} : { volume }),
});

/** A 400px pane showing 90–110: at the default 14px rows that is 0.7 per row, rounded up to a step of 1. */
function target(candles: Candle[], options: { height?: number; width?: number; inverted?: boolean } = {}): PrimitiveDrawTarget {
  const height = options.height ?? 400;
  const priceScale = new PriceScale();
  priceScale.height = height;
  priceScale.topMargin = 0;
  priceScale.bottomMargin = 0;
  priceScale.inverted = options.inverted ?? false;
  priceScale.setRange(90, 110);
  return {
    width: options.width ?? 600, height, priceScale, timeScale: new TimeScale(),
    range: { from: 0, to: candles.length }, candles, pixelRatio: 1,
  };
}

describe('profileStep', () => {
  it('rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
    assert.equal(profileStep(0.7), 1);
    assert.equal(profileStep(1), 1);
    assert.equal(profileStep(1.5), 2);
    assert.equal(profileStep(2.2), 2.5);
    assert.equal(profileStep(3), 5);
    assert.equal(profileStep(70), 100);
    assert.equal(profileStep(0), 1);
    assert.equal(profileStep(Number.NaN), 1);
    assert.equal(profileStep(Infinity), 1);
  });
});

describe('gridVolumeRows', () => {
  it('spreads each bar over the rows it touches, split by direction', () => {
    const { up, down } = gridVolumeRows([bar(100, 101.5, true, 20), bar(102, 102.5, false, 6)], 0, 1, 100, 1, 4);
    assert.deepEqual(up, [10, 10, 0, 0]);
    assert.deepEqual(down, [0, 0, 6, 0]);
  });

  it('keeps only the on-grid share of a bar reaching past the grid, and skips off-grid bars', () => {
    const candles = [bar(98, 101.5, true, 40), bar(200, 201, true, 5), bar(10, 11, false, 5), bar(Number.NaN, 101, true, 5), bar(100, 100.5, true)];
    const { up, down } = gridVolumeRows(candles, -3, 99, 100, 1, 2);
    assert.deepEqual(up, [10, 10], '4 rows touched, 2 on the grid; no volume counts 0');
    assert.deepEqual(down, [0, 0]);
  });
});

describe('formatProfileVolume', () => {
  it('compacts to units, K and M', () => {
    assert.equal(formatProfileVolume(823.4), '823');
    assert.equal(formatProfileVolume(3_000), '3K');
    assert.equal(formatProfileVolume(12_400), '12K');
    assert.equal(formatProfileVolume(1_230_000), '1.2M');
  });
});

describe('createRangeProfilePrimitive', () => {
  it('mirrors down volume left and up volume right of the center, labelled and shaded by size, with the POC outlined', () => {
    const ctx = new MockContext2D();
    // Rows of 1 between 90 and 110; 20 volume up at 100, 5 down and 10 up at 95.
    createRangeProfilePrimitive({ inset: 50 }).draw(ctx, target([bar(100, 100.5, true, 20), bar(95, 95.5, false, 5), bar(95, 95.5, true, 10)]));
    // 200px wide, 50px in from the 600px edge: x 350..550, center 450, 100px per side.
    const bars = ctx.callsNamed('fillRect');
    assert.equal(bars.length, 4, 'two rows, down and up each');
    assert.ok(bars.some((c) => c[1] === 450 && c[3] === 100), 'the busiest up bar spans its whole side');
    assert.ok(bars.some((c) => c[1] === 425 && c[3] === 25), 'down volume grows left of the center');
    assert.ok(bars.some((c) => c[1] === 450 && c[3] === 50), 'widths follow the largest single side, not row totals');
    const labels = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.deepEqual(labels.sort(), ['0', '10', '20', '5']);
    const rects = ctx.callsNamed('rect');
    assert.equal(rects.length, 1);
    assert.equal(rects[0]![1], 350.5, 'the POC outline spans the profile');
    assert.equal(ctx.countCalls('stroke'), 1);
  });

  it('skips labels on short rows and the POC outline when disabled, and draws nothing without volume', () => {
    const ctx = new MockContext2D();
    createRangeProfilePrimitive({ rowHeight: 4, showPoc: false }).draw(ctx, target([bar(100, 100.5, true, 20)], { inverted: true }));
    assert.equal(ctx.countCalls('fillText'), 0, '4px rows are too short for labels');
    assert.equal(ctx.countCalls('stroke'), 0);
    assert.ok(ctx.countCalls('fillRect') > 0);

    const quiet = new MockContext2D();
    createRangeProfilePrimitive({ showLabels: false }).draw(quiet, target([bar(100, 100.5, true, 0)]));
    assert.equal(quiet.countCalls('fillRect'), 0);
    const flat = new MockContext2D();
    createRangeProfilePrimitive().draw(flat, target([bar(100, 100.5, true, 20)], { height: 0 }));
    assert.equal(flat.countCalls('fillRect'), 0, 'a zero-height pane draws nothing');
  });
});

describe('attachRangeProfile', () => {
  it('draws on the main pane behind the series, restyles live and detaches', () => {
    const doc = new MockDocument();
    const data = Array.from({ length: 40 }, (_, i) => ({
      time: 1_700_000_000 + i * 60, open: 100 + (i % 5), high: 103 + (i % 5), low: 99 + (i % 5), close: 101 + (i % 3), volume: 10 + i,
    }));
    const chart = createChart({ document: doc, config: { wasm: false, data, width: 800, height: 500 } });
    const ctx = doc.created[0]!.context;
    const paint = (): number => {
      ctx.calls.length = 0;
      chart.render();
      return ctx.callsNamed('rect').length;
    };
    const base = paint(); // the pane clip
    const api = attachRangeProfile(chart);
    assert.equal(paint(), base + 1, 'the POC outline');
    api.update({ showPoc: false });
    assert.equal(paint(), base);
    api.remove();
    ctx.calls.length = 0;
    chart.render();
    assert.equal(ctx.callsNamed('fillText').filter((c) => /^\d+K?$/.test(String(c[1]))).length > 0, false, 'no profile labels once removed');
    chart.destroy();
  });
});

/** A mock context that also records the fill/stroke color behind every draw call. */
class StyledContext extends MockContext2D {
  readonly styles: string[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.styles.push(String(this.fillStyle));
    super.fillRect(x, y, w, h);
  }
  override fillText(text: string, x: number, y: number): void {
    this.styles.push(String(this.fillStyle));
    super.fillText(text, x, y);
  }
  override stroke(): void {
    this.styles.push(String(this.strokeStyle));
    super.stroke();
  }
}

/** A chart stand-in capturing the attached primitive, with a live config and a manual frame clock. */
function harness(partial: Parameters<typeof resolveConfig>[0] = {}) {
  let config: ChartConfig = resolveConfig(partial);
  let primitive: PanePrimitive | null = null;
  let updates = 0;
  const chart = {
    attachPrimitive(p: PanePrimitive) {
      primitive = p;
      return { requestUpdate: () => { updates++; }, detach: () => { primitive = null; } };
    },
    getConfig: () => config,
  } as unknown as Chart;
  let time = 0;
  const frames: (() => void)[] = [];
  const cancelled: number[] = [];
  const scheduler = {
    now: () => time,
    request: (cb: (t: number) => void) => frames.push(() => cb(time)),
    cancel: (handle: number) => { cancelled.push(handle); },
  };
  const paint = (candles: Candle[], options: { height?: number } = {}): StyledContext => {
    const ctx = new StyledContext();
    primitive!.draw(ctx, target(candles, options));
    return ctx;
  };
  return {
    chart, scheduler, paint, frames, cancelled,
    get attached() { return primitive !== null; },
    get updates() { return updates; },
    advance: (ms: number) => { time += ms; },
    setConfig: (next: Parameters<typeof resolveConfig>[0]) => { config = resolveConfig(next); },
  };
}

/** Widths of the bars `ctx` filled, rounded. */
const widths = (ctx: MockContext2D): number[] => ctx.callsNamed('fillRect').map((c) => Math.round(c[3] as number));

describe('range profile theme tokens', () => {
  it('follows the series and text colors of the live config, and passes custom colors through', () => {
    const h = harness({ series: { upColor: '#00ff3f', downColor: '#ff479c' }, theme: { textColor: '#a1a1a1', monoFamily: 'Geist Mono' } });
    attachRangeProfile(h.chart);
    const candles = [bar(100, 100.5, true, 20), bar(95, 95.5, false, 5)];
    let ctx = h.paint(candles);
    assert.ok(ctx.styles.includes('#00ff3f'), 'up bars take series.upColor');
    assert.ok(ctx.styles.includes('#ff479c'), 'down bars take series.downColor');
    assert.ok(ctx.styles.includes('#a1a1a1'), 'the POC outline takes theme.textColor');
    const labels = ctx.callsNamed('fillText');
    const labelStyles = ctx.styles.filter((_, i) => ctx.calls.filter((c) => ['fillRect', 'fillText', 'stroke'].includes(c[0] as string))[i]![0] === 'fillText');
    assert.equal(labels.length, 4);
    assert.deepEqual(labelStyles, ['#ff479c', '#00ff3f', '#ff479c', '#00ff3f'], 'each size takes its side color');
    assert.ok(ctx.calls.some((c) => c[0] === 'set:font' && c[1] === '500 11px Geist Mono'), 'labels use the theme mono family at medium weight');
    assert.ok(ctx.calls.some((c) => c[0] === 'set:font' && c[1] === 'bold 11px Geist Mono'), 'the POC row is bold');
    h.setConfig({ series: { upColor: '#123456' } });
    ctx = h.paint(candles);
    assert.ok(ctx.styles.includes('#123456'), 'a theme switch recolors the next draw');

    const custom = harness();
    attachRangeProfile(custom.chart, { upColor: '#abcdef', labelColor: '#fedcba' });
    const styled = custom.paint(candles);
    assert.ok(styled.styles.includes('#abcdef') && styled.styles.includes('#fedcba'));
  });

  it('resolves tokens against the default theme when used as a bare primitive', () => {
    const ctx = new StyledContext();
    createRangeProfilePrimitive().draw(ctx, target([bar(100, 100.5, true, 20)]));
    assert.ok(ctx.styles.includes(resolveConfig().series.upColor));
  });
});

describe('range profile transitions', () => {
  it('tweens new rows in linearly over the duration, one frame request at a time', () => {
    const h = harness();
    attachRangeProfile(h.chart, { scheduler: h.scheduler, showLabels: false, showPoc: false });
    const candles = [bar(100, 100.5, true, 20)];
    assert.deepEqual(widths(h.paint(candles)), [], 'a new row starts empty');
    assert.equal(h.frames.length, 1, 'and asks for a frame');
    h.paint(candles); // a repaint mid-flight reuses the pending frame
    assert.equal(h.frames.length, 1);
    h.advance(90);
    h.frames.shift()!();
    assert.equal(h.updates, 1, 'the frame re-renders the pane');
    assert.deepEqual(widths(h.paint(candles)), [0, 50], 'half way: half the width');
    h.advance(90);
    h.frames.shift()!();
    assert.deepEqual(widths(h.paint(candles)), [0, 100]);
    assert.equal(h.frames.length, 0, 'settled: no more frames');
  });

  it('retargets a moving row from where it is, eases out on request, and shrinks vanished volume to nothing', () => {
    const h = harness();
    const api = attachRangeProfile(h.chart, { scheduler: h.scheduler, showPoc: false, easing: 'ease-out' });
    const a = [bar(100, 100.5, true, 20)];
    h.paint(a);
    h.advance(90);
    // Ease-out cubic at t=0.5 covers 87.5% of the way.
    assert.deepEqual(widths(h.paint(a)), [0, 88]);
    api.update({ width: 100 }); // new goal (50px) while moving: the next draw retargets from 87.5
    assert.deepEqual(widths(h.paint(a)), [0, 88], 'no jump on retarget');
    h.advance(45);
    // A quarter way, eased: 1 - 0.75³ ≈ 0.578 of 87.5 → 50.
    assert.deepEqual(widths(h.paint(a)), [0, 66]);
    h.advance(1000);
    h.paint(a);
    // The busy row moves: 100 now has no volume but still shrinks from its drawn width, unlabelled.
    const b = [bar(100, 100.5, true, 0), bar(95, 95.5, true, 20)];
    const ctx = h.paint(b);
    assert.ok(widths(ctx).includes(50), 'the old row starts at its drawn width');
    assert.equal(ctx.countCalls('fillText'), 2, 'only the row with volume is labelled');
  });

  it('starts re-bucketed rows from the previous shape at their price', () => {
    const h = harness();
    const api = attachRangeProfile(h.chart, { scheduler: h.scheduler, showLabels: false, showPoc: false });
    const candles = [bar(92.6, 93.9, true, 20)];
    h.paint(candles);
    h.advance(500);
    h.paint(candles); // settled on 1-wide rows 92 and 93
    api.update({ rowHeight: 44 }); // 2.2 per row → a step of 2.5: row 92.5 is a new key
    const ctx = h.paint(candles);
    assert.deepEqual(widths(ctx), [0, 100], 'no flash to empty: row 92.5 starts from the old shape at its price');
  });

  it('applies changes at once with a zero duration, and cancels a pending frame on remove', () => {
    const still = harness();
    attachRangeProfile(still.chart, { scheduler: still.scheduler, duration: 0, showLabels: false, showPoc: false });
    assert.deepEqual(widths(still.paint([bar(100, 100.5, true, 20)])), [0, 100]);
    assert.equal(still.frames.length, 0);

    const h = harness();
    const api = attachRangeProfile(h.chart, { scheduler: h.scheduler });
    h.paint([bar(100, 100.5, true, 20)]);
    assert.equal(h.frames.length, 1);
    api.remove();
    assert.deepEqual(h.cancelled, [1]);
    assert.equal(h.attached, false);
    api.remove(); // nothing pending: nothing to cancel
    assert.deepEqual(h.cancelled, [1]);
  });

  it('forgets its tweens when the view holds no volume', () => {
    const h = harness();
    attachRangeProfile(h.chart, { scheduler: h.scheduler, showLabels: false, showPoc: false });
    h.paint([bar(100, 100.5, true, 20)]);
    h.advance(500);
    h.paint([bar(100, 100.5, true, 20)]);
    h.paint([bar(100, 100.5, true, 0)]);
    assert.deepEqual(widths(h.paint([bar(100, 100.5, true, 20)])), [], 'the row grows in again from empty');
  });
});
