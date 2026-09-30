import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, resolveConfig } from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { DepthBook } from '../dist/core/depth.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';
import {
  computeInlineBookRows,
  inlineBookRowAt,
  DEFAULT_INLINE_BOOK_MAX_LEVELS,
  DEFAULT_INLINE_BOOK_WIDTH,
} from '../dist/core/inline-book.js';
import {
  attachInlineBook,
  createInlineBookPrimitive,
  formatBookSize,
} from '../dist/render/inline-book.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';

function book(overrides: Partial<DepthBook> = {}): DepthBook {
  return {
    bids: [[99, 1], [98, 2], [97, 4]],
    asks: [[100, 2], [101, 4], [102, 8]],
    time: 1,
    ...overrides,
  };
}

describe('computeInlineBookRows', () => {
  it('trims to maxLevels per side, best first, with cumulative depth from the best', () => {
    const rows = computeInlineBookRows(book(), 2);
    assert.equal(rows.bids.rows.length, 2);
    assert.equal(rows.asks.rows.length, 2);
    assert.deepEqual(rows.bids.rows.map((r) => r.price), [99, 98]);
    assert.deepEqual(rows.asks.rows.map((r) => r.price), [100, 101]);
    assert.deepEqual(rows.asks.rows.map((r) => r.cumulative), [2, 6]);
    assert.equal(rows.asks.maxSize, 4);
    assert.equal(rows.asks.maxCumulative, 6);
  });

  it('prices row bands at the midpoints between neighbors', () => {
    const rows = computeInlineBookRows(book(), 16);
    // Ask rows: [99.5, 100.5], [100.5, 101.5], [101.5, 102.5] — contiguous.
    assert.deepEqual(rows.asks.rows.map((r) => [r.low, r.high]), [
      [99.5, 100.5],
      [100.5, 101.5],
      [101.5, 102.5],
    ]);
    // Bid rows mirror: [98.5, 99.5], [97.5, 98.5], [96.5, 97.5].
    assert.deepEqual(rows.bids.rows.map((r) => [r.low, r.high]), [
      [98.5, 99.5],
      [97.5, 98.5],
      [96.5, 97.5],
    ]);
  });

  it('widens the rows beside a price gap instead of leaving dead space', () => {
    const rows = computeInlineBookRows(book({ asks: [[100, 1], [104, 2]] }), 16);
    assert.deepEqual(rows.asks.rows.map((r) => [r.low, r.high]), [
      [98, 102],
      [102, 106],
    ]);
  });

  it('reports best bid/ask and the spread', () => {
    const rows = computeInlineBookRows(book(), 16);
    assert.equal(rows.bestBid, 99);
    assert.equal(rows.bestAsk, 100);
    assert.equal(rows.spread, 1);
    assert.equal(computeInlineBookRows(book({ asks: [] }), 16).spread, null);
  });

  it('drops invalid levels and clamps maxLevels to a positive integer', () => {
    const rows = computeInlineBookRows(book({ bids: [[99, 1], [98, 0], [NaN, 2], [97, -1]] }), 0);
    assert.deepEqual(rows.bids.rows.map((r) => r.price), [99]);
    // A single-level side still gets a band (the fallback step from the other side).
    assert.ok(rows.bids.rows[0]!.high > rows.bids.rows[0]!.low);
  });
});

describe('inlineBookRowAt', () => {
  it('finds the row whose band contains the price', () => {
    const rows = computeInlineBookRows(book(), 16);
    assert.equal(inlineBookRowAt(rows.asks, 100.4)!.price, 100);
    assert.equal(inlineBookRowAt(rows.asks, 100.6)!.price, 101);
    assert.equal(inlineBookRowAt(rows.bids, 97)!.price, 97);
    assert.equal(inlineBookRowAt(rows.asks, 500), null);
    assert.equal(inlineBookRowAt(rows.bids, 100), null);
  });
});

describe('formatBookSize', () => {
  it('formats compact sizes', () => {
    assert.equal(formatBookSize(0.025), '0.0250');
    assert.equal(formatBookSize(12.4), '12.40');
    assert.equal(formatBookSize(1234), '1.23K');
    assert.equal(formatBookSize(2_500_000), '2.50M');
  });
});

function candles(n: number, start = 1700000000, step = 60): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 10,
  }));
}

function fakeTarget(width = 96, height = 400, min = 90, max = 110): PrimitiveDrawTarget {
  const priceScale = new PriceScale();
  priceScale.height = height;
  priceScale.setRange(min, max);
  const data = candles(10);
  return {
    width,
    height,
    priceScale,
    timeScale: new TimeScale(),
    range: { from: 0, to: data.length },
    candles: data,
    pixelRatio: 1,
  };
}

describe('createInlineBookPrimitive', () => {
  it('paints per-level bars with depth-proportional width anchored to the inner edge', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showSpread: false, showLabels: false, cumulative: false });
    primitive.draw(ctx, fakeTarget());
    const bars = ctx.callsNamed('fillRect');
    // 3 bids + 3 asks; the size-8 ask is the max, so it spans the full width.
    assert.equal(bars.length, 6);
    assert.ok(bars.some((c) => c[1] === 0 && c[3] === 96));
    // The size-4 levels span half the width, anchored at the right edge.
    assert.equal(bars.filter((c) => c[1] === 48 && c[3] === 48).length, 2);
    assert.equal(primitive.rows!.spread, 1);
  });

  it('mirrors bids left and asks right of a central label spine', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { layout: 'mirrored', showSpread: false, cumulative: false });
    // 130px band: a 34px spine leaves 48px per side.
    primitive.draw(ctx, fakeTarget(130));
    const bars = ctx.callsNamed('fillRect');
    assert.equal(bars.length, 6);
    // The size-8 ask spans its whole side from the spine's right edge; the size-4 bid grows left from the spine.
    assert.ok(bars.some((c) => c[1] === 82 && c[3] === 48));
    assert.ok(bars.some((c) => c[1] === 24 && c[3] === 24));
    for (const c of bars) assert.ok((c[1] as number) + (c[3] as number) <= 48 || (c[1] as number) >= 82, 'no bar enters the spine');
    const labels = ctx.callsNamed('fillText');
    assert.ok(labels.length > 0 && labels.every((c) => c[2] === 65), 'size labels sit on the spine');
  });

  it('takes theme colors, colors each size like its side, right-aligns sizes and bolds the best levels', () => {
    const styles: string[] = [];
    const ctx = new (class extends MockContext2D {
      override fillText(text: string, x: number, y: number): void {
        styles.push(`${String(this.fillStyle)}|${this.textAlign}|${this.font}`);
        super.fillText(text, x, y);
      }
    })();
    const defaults = resolveConfig();
    createInlineBookPrimitive(() => book(), { cumulative: false }).draw(ctx, fakeTarget(96, 400, 96, 104));
    const mono = defaults.theme.monoFamily;
    const sizes = ctx.callsNamed('fillText').filter((c) => !String(c[1]).startsWith('Δ'));
    assert.ok(sizes.length > 0 && sizes.every((c) => c[2] === 92), 'sizes sit against the price-axis edge');
    assert.ok(styles.includes(`${defaults.series.downColor}|right|bold 11px ${mono}`), 'the best ask is bold, in the ask (down) color');
    assert.ok(styles.includes(`${defaults.series.upColor}|right|bold 11px ${mono}`), 'the best bid is bold, in the bid (up) color');
    assert.ok(styles.includes(`${defaults.series.upColor}|right|500 11px ${mono}`), 'deeper bids are medium weight');
    assert.ok(styles.some((st) => st.startsWith(`${defaults.theme.textColor}|right|`)), 'the spread label follows the theme text color');

    const plain: string[] = [];
    const ctx2 = new (class extends MockContext2D {
      override fillText(text: string, x: number, y: number): void {
        plain.push(String(this.fillStyle));
        super.fillText(text, x, y);
      }
    })();
    createInlineBookPrimitive(() => book(), { labelColor: '#123456', bidColor: '#00ff00', showSpread: false }).draw(ctx2, fakeTarget(96, 400, 96, 104));
    assert.ok(plain.length > 0 && plain.every((c) => c === '#123456'), 'a fixed label color applies to both sides');
  });

  it('shades cumulative depth behind the bars when enabled', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book(), { showSpread: false, showLabels: false }).draw(ctx, fakeTarget());
    // 6 level bars + 6 cumulative shades; the deepest ask row is fully cumulative-covered.
    assert.equal(ctx.countCalls('fillRect'), 12);
  });

  it('highlights the spread row with a band and a label', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book(), { showLabels: false, cumulative: false }).draw(ctx, fakeTarget());
    const texts = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(texts.some((t) => t.startsWith('Δ ')));
  });

  it('labels the true spread when given one, falling back to the level gap on a bad value', () => {
    const label = (spread?: () => number | null): number => {
      const ctx = new MockContext2D();
      createInlineBookPrimitive(() => book(), { showLabels: false, cumulative: false, ...(spread ? { spread } : {}) }).draw(ctx, fakeTarget());
      return Number(ctx.callsNamed('fillText').map((c) => String(c[1])).find((t) => t.startsWith('Δ '))!.slice(2));
    };
    assert.equal(label(), 1, 'the gap between the best levels');
    assert.equal(label(() => 0.5), 0.5);
    assert.equal(label(() => 0), 0);
    for (const bad of [null, -1, Number.NaN, Infinity]) assert.equal(label(() => bad), 1, `falls back for ${bad}`);
  });

  it('labels only the rows tall enough for text, and none when showLabels is off', () => {
    // Bids a tenth apart near the spread (the middle one a thin row), then one far level (a tall row).
    const ragged = (): DepthBook => book({ bids: [[99, 1], [98.9, 2], [98.8, 3], [60, 5]] });
    const ctx = new MockContext2D();
    createInlineBookPrimitive(ragged, { showSpread: false, cumulative: false }).draw(ctx, fakeTarget(96, 400, 40, 120));
    const sizes = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(sizes.includes('5.00'), 'the tall far row is labelled');
    assert.ok(!sizes.includes('2.00'), 'a row too thin for text is not, though its side has a tall row');
    const off = new MockContext2D();
    createInlineBookPrimitive(ragged, { showSpread: false, showLabels: false }).draw(off, fakeTarget(96, 400, 60, 180));
    assert.equal(off.countCalls('fillText'), 0);
  });

  it('labels row sizes when the rows are tall enough', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book(), { showSpread: false }).draw(ctx, fakeTarget());
    const texts = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(texts.includes('1.00'));
    assert.ok(texts.includes('8.00'));
  });

  it('draws nothing without a book or with an empty one', () => {
    const ctx = new MockContext2D();
    const empty = createInlineBookPrimitive(() => null);
    empty.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('fillRect'), 0);
    assert.equal(empty.rows, null);
    const ctx2 = new MockContext2D();
    createInlineBookPrimitive(() => book({ bids: [], asks: [] })).draw(ctx2, fakeTarget());
    assert.equal(ctx2.countCalls('fillRect'), 0);
  });

  it('outlines the hovered level and shows a price/size/cumulative tooltip', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showLabels: false });
    primitive.setHover(101);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 1);
    const texts = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(texts.some((t) => t.includes('101.00') && t.includes('Σ 6.00')));
  });

  it('ignores hover prices inside the spread', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showLabels: false, showSpread: false });
    primitive.setHover(99.5);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 0);
  });

  it('skips levels outside the visible price range', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book({ bids: [[200, 1], [201, 2]], asks: [[202, 1], [203, 2]] }), { showSpread: false }).draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('fillRect'), 0);
    const ctx2 = new MockContext2D();
    createInlineBookPrimitive(() => book({ bids: [[50, 1], [49, 2]], asks: [[48, 1], [47, 2]] }), { showSpread: false }).draw(ctx2, fakeTarget());
    assert.equal(ctx2.countCalls('fillRect'), 0);
  });

  it('draws the spread band without a label when the band is too thin', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book(), { showLabels: false, cumulative: false }).draw(ctx, fakeTarget(96, 400, 0, 400));
    const texts = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(!texts.some((t) => t.startsWith('Δ ')));
    assert.ok(ctx.countCalls('fillRect') >= 3);
  });

  it('omits the spread band when either side of the book is empty', () => {
    const ctx = new MockContext2D();
    createInlineBookPrimitive(() => book({ asks: [] }), { showLabels: false, cumulative: false }).draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('fillRect'), 3);
    const ctx2 = new MockContext2D();
    createInlineBookPrimitive(() => book({ bids: [] }), { showLabels: false, cumulative: false }).draw(ctx2, fakeTarget());
    assert.equal(ctx2.countCalls('fillRect'), 3);
  });

  it('outlines a hovered bid level with the bid color', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showLabels: false });
    primitive.setHover(98);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 1);
    const texts = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(texts.some((t) => t.includes('98.00') && t.includes('Σ 3.00')));
  });

  it('ignores hover prices beyond the outermost level', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showLabels: false, showSpread: false });
    primitive.setHover(500);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 0);
  });

  it('never outlines a level when showHover is false', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), { showHover: false });
    primitive.setHover(101);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 0);
  });

  it('hovers the only side of a one-sided book', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book({ asks: [] }), { showLabels: false, showSpread: false });
    primitive.setHover(98);
    primitive.draw(ctx, fakeTarget());
    assert.equal(ctx.countCalls('stroke'), 1);
    const ctx2 = new MockContext2D();
    const primitive2 = createInlineBookPrimitive(() => book({ bids: [] }), { showLabels: false, showSpread: false });
    primitive2.setHover(50);
    primitive2.draw(ctx2, fakeTarget());
    assert.equal(ctx2.countCalls('stroke'), 0);
  });

  it('uses the explicitly provided style options', () => {
    const ctx = new MockContext2D();
    const primitive = createInlineBookPrimitive(() => book(), {
      maxLevels: 3,
      bidColor: '#111111',
      askColor: '#222222',
      cumulative: true,
      opacity: 0.7,
      cumulativeOpacity: 0.3,
      showSpread: true,
      spreadColor: '#333333',
      showLabels: true,
      labelColor: '#444444',
      showHover: true,
    });
    primitive.setHover(99);
    primitive.draw(ctx, fakeTarget());
    assert.ok(ctx.countCalls('fillRect') > 0);
    assert.equal(ctx.countCalls('stroke'), 1);
  });
});

describe('attachInlineBook', () => {
  function chartWith(config: Record<string, unknown> = {}) {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(50), width: 640, height: 400, ...config } });
    return { doc, chart };
  }

  it('docks a book pane sharing the main price scale', () => {
    const { chart } = chartWith();
    const fullWidth = chart.plotArea.width;
    const api = attachInlineBook(chart);
    assert.equal(api.pane!.id, 'inline-book');
    assert.equal(chart.plotArea.width, fullWidth - DEFAULT_INLINE_BOOK_WIDTH);
    const mainSeen: PrimitiveDrawTarget[] = [];
    chart.attachPrimitive({ draw: (_ctx, t) => { mainSeen.push(t); } });
    const paneSeen: PrimitiveDrawTarget[] = [];
    api.pane!.attachPrimitive({ draw: (_ctx, t) => { paneSeen.push(t); } });
    assert.equal(paneSeen[0]!.priceScale.minPrice, mainSeen[0]!.priceScale.minPrice);
    assert.equal(paneSeen[0]!.priceScale.maxPrice, mainSeen[0]!.priceScale.maxPrice);
    assert.equal(paneSeen[0]!.width, DEFAULT_INLINE_BOOK_WIDTH);
    api.remove();
    assert.equal(chart.plotArea.width, fullWidth);
    chart.destroy();
  });

  it('repaints from chart.setDepth without extra wiring', () => {
    const { doc, chart } = chartWith();
    const api = attachInlineBook(chart);
    const ctx = doc.created[0]!.context;
    const before = ctx.countCalls('fillRect');
    chart.setDepth(book());
    assert.ok(ctx.countCalls('fillRect') > before);
    chart.setDepth(null);
    api.remove();
    chart.destroy();
  });

  it('updates options and dock width live', () => {
    const { chart } = chartWith();
    const fullWidth = chart.plotArea.width;
    const api = attachInlineBook(chart, { maxLevels: 2 });
    assert.doesNotThrow(() => api.update({ bidColor: '#00ff00', cumulative: false }));
    api.update({ width: 60 });
    assert.equal(chart.plotArea.width, fullWidth - 60);
    api.remove();
    chart.destroy();
  });

  it('rejects a duplicate pane id', () => {
    const { chart } = chartWith();
    const api = attachInlineBook(chart);
    assert.throws(() => attachInlineBook(chart), /duplicate pane/);
    api.remove();
    attachInlineBook(chart).remove();
    chart.destroy();
  });

  it('follows config inlineBook writes while attached', () => {
    const { chart } = chartWith();
    const fullWidth = chart.plotArea.width;
    const api = attachInlineBook(chart);
    assert.doesNotThrow(() => chart.updateConfig({ inlineBook: { maxLevels: 1, askColor: '#ff0000' } }));
    chart.updateConfig({ inlineBook: { width: 72 } });
    assert.equal(chart.plotArea.width, fullWidth - 72);
    api.remove();
    chart.destroy();
  });

  it('hovers the book level under the crosshair', () => {
    const { doc, chart } = chartWith();
    const api = attachInlineBook(chart);
    const ctx = doc.created[0]!.context;
    /** Tooltips of a fresh frame, so a frame painted before the hover moved never counts. */
    const tooltips = (): string[] => {
      ctx.calls.length = 0;
      chart.render();
      return ctx.callsNamed('fillText').map((c) => String(c[1])).filter((t) => t.includes('Σ'));
    };
    const hoverAt = (price: number): string[] => {
      chart.setCrosshair(100, chart.scale.priceToY(price));
      return tooltips();
    };
    assert.deepEqual(hoverAt(101), [], 'no book yet: nothing to hover');
    chart.setDepth(book());
    assert.ok(hoverAt(101.1).some((t) => t.includes('101.00')), 'an ask level');
    assert.ok(hoverAt(100.9).some((t) => t.includes('101.00')), 'the same level keeps its hover');
    assert.ok(hoverAt(98).some((t) => t.includes('98.00')), 'a bid level');
    assert.deepEqual(hoverAt(99.5), [], 'inside the spread');
    assert.deepEqual(hoverAt(104), [], 'beyond the outermost ask');
    assert.ok(hoverAt(97).some((t) => t.includes('97.00')));
    chart.clearCrosshair();
    assert.deepEqual(tooltips(), [], 'a hidden crosshair drops the hover');
    api.remove();
    chart.destroy();
  });

  it('hovers the only side of a one-sided attached book', () => {
    const { doc, chart } = chartWith();
    const api = attachInlineBook(chart);
    const ctx = doc.created[0]!.context;
    const hoverAt = (price: number): string[] => {
      chart.setCrosshair(100, chart.scale.priceToY(price));
      ctx.calls.length = 0;
      chart.render();
      return ctx.callsNamed('fillText').map((c) => String(c[1])).filter((t) => t.includes('Σ'));
    };
    chart.setDepth(book({ asks: [] }));
    assert.ok(hoverAt(98).some((t) => t.includes('98.00')), 'no asks: a bid still hovers');
    chart.setDepth(book({ bids: [] }));
    assert.deepEqual(hoverAt(98), [], 'no bids: below the asks hovers nothing');
    api.remove();
    chart.destroy();
  });

  it('ignores config writes to other sections', () => {
    const { chart } = chartWith();
    const fullWidth = chart.plotArea.width;
    const api = attachInlineBook(chart);
    chart.updateConfig({ series: { upColor: '#00ff00' } });
    assert.equal(chart.plotArea.width, fullWidth - DEFAULT_INLINE_BOOK_WIDTH);
    api.remove();
    chart.destroy();
  });

  it('overlays the book behind the series along the plot edge, keeping the plot width', () => {
    const { doc, chart } = chartWith({ inlineBook: { placement: 'overlay' } });
    const fullWidth = chart.plotArea.width;
    const api = attachInlineBook(chart);
    assert.equal(api.pane, null);
    assert.equal(chart.plotArea.width, fullWidth, 'no dock strip');
    const ctx = doc.created[0]!.context;
    const edge = () => {
      ctx.calls.length = 0;
      chart.setDepth(book());
      return ctx.callsNamed('translate').map((c) => c[1] as number);
    };
    assert.ok(edge().includes(fullWidth - DEFAULT_INLINE_BOOK_WIDTH), 'the band hugs the right edge');
    chart.updateConfig({ inlineBook: { width: 60 } });
    assert.ok(edge().includes(fullWidth - 60));
    api.update({ width: 40 });
    assert.ok(edge().includes(fullWidth - 40));
    assert.equal(chart.plotArea.width, fullWidth);
    api.remove();
    chart.destroy();
  });

  it('insets the overlay band from the price axis, clamped to the plot', () => {
    const { doc, chart } = chartWith({ inlineBook: { placement: 'overlay', inset: 50 } });
    const plot = chart.plotArea.width;
    const api = attachInlineBook(chart);
    const ctx = doc.created[0]!.context;
    const edge = () => {
      ctx.calls.length = 0;
      chart.setDepth(book());
      return ctx.callsNamed('translate').map((c) => c[1] as number);
    };
    assert.ok(edge().includes(plot - DEFAULT_INLINE_BOOK_WIDTH - 50));
    api.update({ inset: 10 });
    assert.ok(edge().includes(plot - DEFAULT_INLINE_BOOK_WIDTH - 10), 'the attach option wins over the config');
    api.update({ inset: 10_000 });
    assert.ok(edge().includes(0), 'never past the plot left edge');
    api.remove();
    chart.destroy();
  });

  it('re-attaches the config book when its placement changes', () => {
    const { chart } = chartWith({ inlineBook: { enabled: true, width: 88 } });
    const docked = chart.plotArea.width;
    chart.updateConfig({ inlineBook: { placement: 'overlay' } });
    assert.equal(chart.plotArea.width, docked + 88, 'the overlay takes no plot width');
    chart.updateConfig({ inlineBook: { maxLevels: 5 } });
    assert.equal(chart.plotArea.width, docked + 88, 'other writes keep the attached book');
    chart.updateConfig({ inlineBook: { placement: 'dock' } });
    assert.equal(chart.plotArea.width, docked);
    chart.destroy();
  });

  it('attaches and removes with the config inlineBook.enabled flag', () => {
    const { chart } = chartWith({ inlineBook: { enabled: true, width: 88 } });
    const fullWidth = 640 - 88 - chart.getConfig().priceAxis.width;
    assert.equal(chart.plotArea.width, fullWidth);
    chart.updateConfig({ inlineBook: { enabled: false } });
    assert.equal(chart.plotArea.width, fullWidth + 88);
    chart.updateConfig({ inlineBook: { enabled: true } });
    assert.equal(chart.plotArea.width, fullWidth);
    chart.destroy();
  });
});
