import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, type RenderView } from '../dist/index.js';
import { MockCanvas, MockContext2D } from '../dist/dom.js';
import { DEFAULT_CONFIG, type SeriesConfig, type SeriesType } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { barIsUp } from '../dist/series/direction.js';
import { heikinAshi } from '../dist/series/heikin-ashi.js';
import { drawPriceReferences, drawStatusLine } from '../dist/render/settings-layers.js';
import { SERIES_RENDERERS } from '../dist/series/index.js';

const UP = '#00aa00', DOWN = '#aa0000';
const fmt = (value: number) => value.toFixed(2);

/** Records the style in effect for every fillRect, fillText and stroke. */
class StyleContext extends MockContext2D {
  readonly rects: string[] = [];
  readonly texts = new Map<string, string>();
  readonly strokes: string[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push(this.fillStyle);
    super.fillRect(x, y, w, h);
  }
  override fillText(text: string, x: number, y: number): void {
    this.texts.set(text, this.fillStyle);
    super.fillText(text, x, y);
  }
  override stroke(): void {
    this.strokes.push(this.strokeStyle);
    super.stroke();
  }
}

const series = (partial: Partial<SeriesConfig> = {}): SeriesConfig => ({ ...DEFAULT_CONFIG.series, upColor: UP, downColor: DOWN, ...partial });

/** Chart with only the last-price line and badge plus the status line enabled. */
function chartView(data: Candle[], type: SeriesType, extra: Partial<SeriesConfig> = {}): RenderView {
  const chart = createChart({
    container: new MockCanvas(800, 500),
    config: {
      data, wasm: false,
      series: { type, upColor: UP, downColor: DOWN, ...extra },
      statusLine: { visible: true },
      formatters: { price: fmt },
      priceAxis: { labels: { lastPrice: true }, lines: { lastPrice: true } },
    },
  });
  return (chart as unknown as { lastView: RenderView }).lastView;
}

/** Color of the last-price badge and line, and of each status-line OHLC text. */
function labels(view: RenderView, candle: Candle) {
  const refs = new StyleContext();
  drawPriceReferences(refs, view);
  assert.equal(refs.rects.length, 1, 'one badge');
  assert.equal(refs.strokes.length, 1, 'one line');
  const status = new StyleContext();
  drawStatusLine(status, view);
  const ohlc = [`O ${fmt(candle.open)}`, `H ${fmt(candle.high)}`, `L ${fmt(candle.low)}`, `C ${fmt(candle.close)}`].map((t) => status.texts.get(t));
  return { badge: refs.rects[0], line: refs.strokes[0], ohlc };
}

// Last bar rises within itself (hollow) but closes below the previous close.
const HOLLOW_DOWN: Candle[] = [
  { time: 1, open: 10, high: 13, low: 9, close: 12 },
  { time: 2, open: 10, high: 12, low: 9.5, close: 11 },
];
// Last bar falls within itself (filled) but closes above the previous close.
const FILLED_UP: Candle[] = [
  { time: 1, open: 10, high: 10.75, low: 9.75, close: 10.5 },
  { time: 2, open: 12, high: 12.5, low: 10.5, close: 11 },
];

describe('barIsUp', () => {
  const data = HOLLOW_DOWN;
  it('compares hollow candles with the previous close and the first bar with its open', () => {
    assert.equal(barIsUp(series({ type: 'hollow-candlestick' }), data, 1, data[1]!), false);
    assert.equal(barIsUp(series({ type: 'hollow-candlestick' }), data, 0, data[0]!), true);
    assert.equal(barIsUp(series({ type: 'hollow-candlestick' }), [{ ...data[0]!, close: 9 }], 0, { ...data[0]!, close: 9 }), false);
  });

  it('uses the given bar (the live candle) against the stored previous close', () => {
    assert.equal(barIsUp(series({ type: 'hollow-candlestick' }), data, 1, { ...data[1]!, close: 12 }), true, 'equal closes are up');
  });

  it('honours colorByPreviousClose only for types whose renderers do', () => {
    for (const type of ['candlestick', 'bar', 'histogram'] as const) {
      assert.equal(barIsUp(series({ type }), data, 1, data[1]!), true, `${type}: close vs open by default`);
      assert.equal(barIsUp(series({ type, colorByPreviousClose: true }), data, 1, data[1]!), false, `${type}: previous close`);
      assert.equal(barIsUp(series({ type, colorByPreviousClose: true }), data, 0, { ...data[0]!, close: 9 }), false, `${type}: first bar vs open`);
    }
    for (const type of ['line', 'area', 'heikin-ashi'] as const) {
      assert.equal(barIsUp(series({ type, colorByPreviousClose: true }), data, 1, data[1]!), true, `${type}: close vs open`);
    }
  });
});

describe('last-price badge and status line follow the drawn bar color', () => {
  it('hollow candles: a hollow bar closing below the previous close is labeled down', () => {
    const view = chartView(HOLLOW_DOWN, 'hollow-candlestick');
    // The renderer draws bar 1 in the down pass (its outline is in the down stroke).
    const drawn = new StyleContext();
    SERIES_RENDERERS['hollow-candlestick'](drawn, HOLLOW_DOWN, { from: 0, to: 2 }, view.timeScale, view.panes[0]!.priceScale, view.config.series);
    assert.deepEqual(drawn.strokes, [UP, DOWN]);
    assert.deepEqual(drawn.rects, [UP, UP, DOWN, DOWN], 'bar 0 wicks up, bar 1 wicks down');
    assert.deepEqual(labels(view, HOLLOW_DOWN[1]!), { badge: DOWN, line: DOWN, ohlc: [DOWN, DOWN, DOWN, DOWN] });
  });

  it('hollow candles: a filled bar closing above the previous close is labeled up', () => {
    const view = chartView(FILLED_UP, 'hollow-candlestick');
    assert.deepEqual(labels(view, FILLED_UP[1]!), { badge: UP, line: UP, ohlc: [UP, UP, UP, UP] });
  });

  it('hollow candles: the hovered bar and the live candle use the same rule', () => {
    const view = chartView(HOLLOW_DOWN, 'hollow-candlestick');
    const hovered: RenderView = { ...view, crosshair: { active: true, x: view.timeScale.indexToX(0, 2), y: 50 } };
    const status = new StyleContext();
    drawStatusLine(status, hovered);
    assert.equal(status.texts.get(`C ${fmt(12)}`), UP, 'first bar compares with its own open');
    const live = { ...HOLLOW_DOWN[1]!, close: 12.5, high: 12.5 };
    assert.deepEqual(labels({ ...view, liveCandle: live }, live), { badge: UP, line: UP, ohlc: [UP, UP, UP, UP] });
  });

  it('candlesticks with colorByPreviousClose label by the previous close; without it by the open', () => {
    assert.deepEqual(labels(chartView(HOLLOW_DOWN, 'candlestick', { colorByPreviousClose: true }), HOLLOW_DOWN[1]!),
      { badge: DOWN, line: DOWN, ohlc: [DOWN, DOWN, DOWN, DOWN] });
    assert.deepEqual(labels(chartView(HOLLOW_DOWN, 'candlestick'), HOLLOW_DOWN[1]!),
      { badge: UP, line: UP, ohlc: [UP, UP, UP, UP] });
  });

  it('line series keep close vs open even with colorByPreviousClose', () => {
    assert.deepEqual(labels(chartView(HOLLOW_DOWN, 'line', { colorByPreviousClose: true }), HOLLOW_DOWN[1]!),
      { badge: UP, line: UP, ohlc: [UP, UP, UP, UP] });
  });

  it('Heikin Ashi labels by HA close vs HA open, ignoring colorByPreviousClose', () => {
    // Real last bar closes below the previous real close; its HA bar rises (HA close > HA open)
    // while the HA close sits below the previous HA close.
    const data: Candle[] = [
      { time: 1, open: 10, high: 20, low: 10, close: 14 },
      { time: 2, open: 13, high: 13.5, low: 12.5, close: 13 },
    ];
    const ha = heikinAshi(data);
    assert.ok(ha[1]!.close >= ha[1]!.open && ha[1]!.close < ha[0]!.close, 'fixture: HA up within the bar, down vs previous');
    const view = chartView(data, 'heikin-ashi', { colorByPreviousClose: true });
    assert.deepEqual(labels(view, ha[1]!), { badge: UP, line: UP, ohlc: [UP, UP, UP, UP] });
  });
});
