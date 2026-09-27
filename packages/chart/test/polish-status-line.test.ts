import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig, type ChartConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { renderChart, type RenderView } from '../dist/render/renderer.js';
import { drawStatusLine } from '../dist/render/settings-layers.js';
import type { IndicatorOutput } from '../dist/indicators/types.js';

// The status line wraps at segment boundaries instead of running under the price axis on a phone.
// MockContext2D measures 6 px per character; the theme font is 12 px, so rows are 18 px apart.

const INSET = 12;
const ROW = 18;

/** BTC-like bars around 84,700 (the 390 px phone case). */
const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
  time: 1_700_000_000 + i * 3600,
  open: 84_600 + i * 5,
  high: 84_700 + i * 5,
  low: 84_550 + i * 5,
  close: 84_650 + i * 5,
  volume: 1234.5 + i,
}));

function scale(min: number, max: number, height: number): PriceScale {
  const ps = new PriceScale();
  ps.height = height;
  ps.setRange(min, max);
  return ps;
}

function makeView(width: number, config: Parameters<typeof resolveConfig>[0] = {}, extra: Partial<RenderView> = {}): RenderView {
  const resolved: ChartConfig = resolveConfig({
    data: candles,
    width,
    height: 500,
    statusLine: { visible: true, symbol: 'BTCUSD', volume: true },
    priceAxis: { precision: 1 },
    ...config,
  });
  const plotWidth = width - resolved.priceAxis.width;
  const timeScale = new TimeScale(10, plotWidth);
  return {
    canvasWidth: width,
    canvasHeight: 500,
    plotWidth,
    plotHeight: 500 - resolved.timeAxis.height,
    pixelRatio: 1,
    candles,
    range: timeScale.visibleRange(candles.length),
    timeScale,
    panes: [{ layout: { id: 'main', kind: 'main', weight: 1, y: 0, height: 476 }, priceScale: scale(84_500, 84_800, 476), indicators: [] }],
    config: resolved,
    drawings: [],
    crosshair: { active: false, x: 0, y: 0 },
    ...extra,
  };
}

interface Text {
  text: string;
  x: number;
  y: number;
}

const texts = (ctx: MockContext2D): Text[] =>
  ctx.callsNamed('fillText').map((c) => ({ text: String(c[1]), x: Number(c[2]), y: Number(c[3]) }));

const width = (t: Text) => t.text.length * 6;

const SMA: IndicatorOutput = {
  pane: 'main',
  lines: [{ key: 'sma', values: candles.map((c) => c.close), color: '#123456' }],
};

describe('status line wrapping', () => {
  it('keeps one row, drawn exactly as before, when everything fits', () => {
    const ctx = new MockContext2D();
    const view = makeView(1200, {}, { panes: [{ ...makeView(1200).panes[0]!, indicators: [SMA] }] });
    drawStatusLine(ctx, view);
    const out = texts(ctx);
    const status = out.slice(0, -1);
    assert.deepEqual(status.map((t) => t.text), ['BTCUSD', 'O 84695.0', 'H 84795.0', 'L 84645.0', 'C 84745.0', '+5.0 (+0.01%)', 'Volume 1253.5']);
    // The previous layout: one row at y 12, each segment after the previous one and its gap.
    const gaps = ['   ', ' ', ' ', ' ', '   ', '   ', ''];
    let x = INSET;
    status.forEach((t, i) => {
      assert.deepEqual([t.x, t.y], [x, INSET], t.text);
      x += (t.text + gaps[i]!).length * 6;
    });
    assert.deepEqual(out.at(-1), { text: 'SMA  84745.0', x: INSET, y: INSET + 12 + 8 });
  });

  it('wraps at segment boundaries on a 390 px phone, symbol first, and shifts the indicator rows down', () => {
    const ctx = new MockContext2D();
    const base = makeView(390);
    assert.equal(base.plotWidth, 390 - base.config.priceAxis.width);
    drawStatusLine(ctx, { ...base, panes: [{ ...base.panes[0]!, indicators: [SMA] }] });
    const out = texts(ctx);
    const status = out.slice(0, -1);
    const indicator = out.at(-1)!;
    assert.deepEqual(status[0], { text: 'BTCUSD', x: INSET, y: INSET }, 'the symbol stays first');
    assert.deepEqual(status.map((t) => t.text), ['BTCUSD', 'O 84695.0', 'H 84795.0', 'L 84645.0', 'C 84745.0', '+5.0 (+0.01%)', 'Volume 1253.5'], 'order kept');
    const rows = [...new Set(status.map((t) => t.y))];
    assert.ok(rows.length >= 2, `wrapped onto ${rows.length} rows`);
    rows.forEach((y, r) => assert.equal(y, INSET + r * ROW, 'rows stack by font size + 6'));
    for (const t of status) {
      assert.ok(t.x + width(t) <= base.plotWidth, `${t.text} ends at ${t.x + width(t)}, inside the plot`);
    }
    // Every row starts at the inset, and a row only breaks where the next segment would not fit.
    for (let i = 1; i < status.length; i++) {
      const [prev, t] = [status[i - 1]!, status[i]!];
      if (t.y === prev.y) continue;
      assert.equal(t.x, INSET);
      const gap = prev.text.startsWith('C ') || prev.text === 'BTCUSD' || prev.text.includes('(') ? 3 : 1;
      assert.ok(prev.x + width(prev) + gap * 6 + width(t) > base.plotWidth, `${t.text} could have stayed on its row`);
    }
    assert.deepEqual(indicator, { text: 'SMA  84745.0', x: INSET, y: rows.at(-1)! + 12 + 8 });
  });

  it('keeps the countdown with the segment before it', () => {
    const now = () => (candles.at(-1)!.time + 600) * 1000;
    const wide = new MockContext2D();
    drawStatusLine(wide, makeView(1400, { statusLine: { visible: true, symbol: 'BTCUSD', volume: true, countdown: true } }, { now }));
    const one = texts(wide);
    const volume = one.find((t) => t.text.startsWith('Volume'))!;
    const countdown = one.at(-1)!;
    assert.equal(countdown.text, '50:00');
    // A plot where the volume alone still fits on the first row but the countdown after it does not.
    const plotWidth = volume.x + width(volume) + 1;
    assert.ok(countdown.x + width(countdown) > plotWidth);
    const view = makeView(1400, { statusLine: { visible: true, symbol: 'BTCUSD', volume: true, countdown: true } }, { now });
    const ctx = new MockContext2D();
    drawStatusLine(ctx, { ...view, plotWidth });
    const out = texts(ctx);
    const [v, c] = [out.find((t) => t.text.startsWith('Volume'))!, out.at(-1)!];
    assert.deepEqual([v.x, v.y], [INSET, INSET + ROW], 'the volume moved down with it');
    assert.equal(c.y, v.y);
    assert.equal(c.x, INSET + ('Volume 1253.5   '.length * 6));
    assert.ok(out.slice(0, -2).every((t) => t.y === INSET));

    // Sweeping the width never strands the countdown at the start of a row.
    for (let w = 200; w <= 900; w += 7) {
      const sweep = new MockContext2D();
      drawStatusLine(sweep, makeView(w, { statusLine: { visible: true, symbol: 'BTCUSD', volume: true, countdown: true } }, { now }));
      const all = texts(sweep);
      assert.equal(all.at(-1)!.y, all.at(-2)!.y, `width ${w}`);
      assert.notEqual(all.at(-1)!.x, INSET, `width ${w}`);
    }
  });

  it('wraps the same way on a left price axis, inside the translated plot', () => {
    const draw = (position: 'left' | 'right') => {
      const view = makeView(390, { priceAxis: { precision: 1, position } });
      const ctx = new MockContext2D();
      renderChart(ctx, position === 'left' ? { ...view, plotLeft: view.canvasWidth - view.plotWidth } : view);
      return { ctx, view };
    };
    const left = draw('left');
    const right = draw('right');
    const axis = left.view.canvasWidth - left.view.plotWidth;
    assert.ok(left.ctx.callsNamed('translate').some((c) => c[1] === axis && c[2] === 0), 'the plot starts after the axis');
    const status = (ctx: MockContext2D) => texts(ctx).filter((t) => /^(BTCUSD|[OHLC] \d|[+-][\d.]+ \(|Volume )/.test(t.text));
    const l = status(left.ctx);
    assert.equal(l.length, 7);
    assert.deepEqual(l, status(right.ctx));
    assert.ok(new Set(l.map((t) => t.y)).size >= 2);
    for (const t of l) assert.ok(t.x >= INSET && t.x + width(t) <= left.view.plotWidth, t.text);
  });

  it('leaves a segment wider than the plot alone on its row', () => {
    const ctx = new MockContext2D();
    drawStatusLine(ctx, makeView(120, { statusLine: { visible: true, symbol: 'A-VERY-LONG-SYMBOL-NAME', volume: false, ohlc: false, change: true } }));
    const out = texts(ctx);
    assert.deepEqual(out.map((t) => [t.x, t.y]), [[INSET, INSET], [INSET, INSET + ROW]]);
  });
});

describe('status line wrapping at the plot edge (review)', () => {
  const draw = (plotWidth: number, config: Parameters<typeof resolveConfig>[0] = {}) => {
    const ctx = new MockContext2D();
    drawStatusLine(ctx, { ...makeView(1200, config), plotWidth });
    return ctx;
  };
  const wide = texts(draw(1100));
  const last = wide.at(-1)!;
  const end = last.x + width(last);

  it('a line that ends 0–11 px before the plot edge stays one row, drawn exactly as on a wide chart', () => {
    assert.equal(last.text, 'Volume 1253.5');
    for (const spare of [0, 1, 6, 11]) {
      assert.deepEqual(texts(draw(end + spare)), wide, `${spare} px to spare`);
    }
    // One pixel short, the volume (and only it) wraps.
    const short = texts(draw(end - 1));
    assert.deepEqual(short.slice(0, -1), wide.slice(0, -1));
    assert.deepEqual(short.at(-1), { text: last.text, x: INSET, y: INSET + ROW });
  });

  it('a segment whose text fits but whose gap would not stays on its row', () => {
    const close = wide.find((t) => t.text.startsWith('C '))!;
    // The close value ends on the edge; its 3-space gap (and everything after it) would cross it.
    const edge = close.x + width(close);
    const out = texts(draw(edge));
    assert.deepEqual(out.find((t) => t.text.startsWith('C ')), close, 'kept on the first row');
    assert.equal(out.find((t) => /^[+-]/.test(t.text))!.y, INSET + ROW, 'the change wraps after it');
  });

  it('measures each segment once when nothing wraps, and at most once more per overflowing group', () => {
    const measured = (ctx: MockContext2D) => ctx.callsNamed('measureText').length;
    assert.equal(measured(draw(end)), wide.length, 'one measure per segment, as the single-row layout did');
    const close = wide.find((t) => t.text.startsWith('C '))!;
    // At the close's edge the close overflows only by its gap (kept), and the change by its text too (wrapped).
    assert.equal(measured(draw(close.x + width(close))), wide.length + 2);
  });
});
