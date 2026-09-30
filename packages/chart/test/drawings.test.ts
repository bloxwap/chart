import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_DRAWINGS,
  CURSOR_MODES,
  DrawingRegistry,
  FIB_LEVELS,
  TOOL_GROUPS,
  createDrawingRegistry,
  fibDrawing,
  findTool,
  hlineDrawing,
  rectDrawing,
  trendlineDrawing,
  volumeProfile,
} from '../dist/drawings/index.js';
import type { DrawingDef, DrawingView, DrawPrimitive, FullView } from '../dist/drawings/index.js';
import type { Candle } from '../dist/core/data.js';

// Identity pixel view: index → x * 10, price → y = 100 - price.
const view: DrawingView = {
  indexToX: (i) => i * 10,
  priceToY: (p) => 100 - p,
  width: 500,
  height: 300,
};

export const sampleCandles: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const base = 50 + Math.sin(i / 4) * 10;
  return { time: 1700000000 + i * 3600, open: base, high: base + 3, low: base - 3, close: base + (i % 2 === 0 ? 1 : -1), volume: 100 + i };
});

/** A view with every optional extra supplied. */
export const fullView: DrawingView = {
  ...view,
  xToIndex: (x) => x / 10,
  yToPrice: (y) => 100 - y,
  candles: sampleCandles,
  barSpacing: 10,
  formatPrice: (p) => p.toFixed(1),
  formatTime: (t) => `t${t}`,
  upColor: '#0f0',
  downColor: '#f00',
};

/** Every number inside a primitive must be finite. */
export function assertFinite(prims: readonly DrawPrimitive[], label: string): void {
  for (const p of prims) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${label}: ${k}=${v}`);
      if (Array.isArray(v)) for (const n of v) if (typeof n === 'number') assert.ok(Number.isFinite(n), `${label}: ${k}[]`);
    }
  }
}

/** Point layouts exercised for every model. */
const LAYOUTS: { index: number; price: number }[][] = [
  [
    { index: 5, price: 40 },
    { index: 15, price: 60 },
    { index: 25, price: 45 },
    { index: 32, price: 70 },
    { index: 40, price: 50 },
    { index: 47, price: 65 },
    { index: 55, price: 42 },
  ],
  [
    { index: 30, price: 70 },
    { index: 20, price: 40 },
    { index: 10, price: 62 },
    { index: 8, price: 35 },
    { index: 4, price: 58 },
    { index: 2, price: 38 },
    { index: 1, price: 55 },
  ],
];

function pointsFor(def: DrawingDef, layout: { index: number; price: number }[]): { index: number; price: number }[] {
  const max = def.maxPoints ?? def.minPoints;
  const n = Number.isFinite(max) ? Math.max(def.minPoints, max) : 5;
  return layout.slice(0, n);
}

describe('drawing registry and catalog', () => {
  it('registers exactly the tools the catalog lists, with unique names', () => {
    const registry = createDrawingRegistry();
    const catalogNames = TOOL_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.tools.map((t) => t.name)));
    assert.equal(new Set(catalogNames).size, catalogNames.length);
    assert.deepEqual([...catalogNames].sort(), registry.names().sort());
    assert.equal(BUILTIN_DRAWINGS.length, catalogNames.length);
    assert.equal(catalogNames.length, 89);
  });
  it('looks up tools and exposes cursor modes', () => {
    assert.equal(findTool('gann-fan')?.label, 'Gann fan');
    assert.equal(findTool('nope'), undefined);
    assert.deepEqual(CURSOR_MODES.map((c) => c.name), ['cross', 'dot', 'arrow', 'demonstration', 'eraser']);
  });
  it('supports empty registries, custom models, unregister', () => {
    const registry = createDrawingRegistry(false);
    assert.equal(registry.has('trendline'), false);
    registry.register(trendlineDrawing).register(hlineDrawing);
    assert.equal(registry.get('hline'), hlineDrawing);
    assert.equal(registry.unregister('hline'), true);
    assert.equal(registry.unregister('hline'), false);
    assert.deepEqual(registry.names(), ['trendline']);
    assert.ok(new DrawingRegistry().names().length === 0);
  });
});

describe('every built-in model', () => {
  for (const def of BUILTIN_DRAWINGS) {
    it(`${def.name}: finite geometry for full, minimal and data-less views`, () => {
      for (const layout of LAYOUTS) {
        const pts = pointsFor(def, layout);
        for (const [label, v] of [
          ['full', fullView],
          ['minimal', view],
          ['no-data', { ...fullView, candles: [] }],
        ] as const) {
          const prims = def.geometry(pts, v);
          assert.ok(prims.length > 0, `${def.name}/${label} produced nothing`);
          assertFinite(prims, `${def.name}/${label}`);
        }
        const withText = def.geometry(pts, fullView, { text: 'Hello|World\nA|B', image: null });
        assertFinite(withText, `${def.name}/text`);
      }
    });
    it(`${def.name}: nothing below minPoints`, () => {
      assert.deepEqual(def.geometry(LAYOUTS[0]!.slice(0, def.minPoints - 1), fullView), []);
    });
  }
});

describe('lines', () => {
  it('trend line is a segment between converted points', () => {
    const prims = trendlineDrawing.geometry([{ index: 1, price: 10 }, { index: 5, price: 30 }], view);
    assert.deepEqual(prims, [{ type: 'line', x1: 10, y1: 90, x2: 50, y2: 70 }]);
  });
  it('horizontal line spans the width with a price tag', () => {
    const prims = hlineDrawing.geometry([{ index: 3, price: 25 }], view);
    assert.deepEqual(prims[0], { type: 'line', x1: 0, y1: 75, x2: 500, y2: 75 });
    assert.deepEqual(prims[1], { type: 'text', text: '25.00', x: 498, y: 75, align: 'right', bg: true });
  });
  it('rays and extended lines reach the viewport edge', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'extended-line')!;
    const [line] = def.geometry([{ index: 10, price: 50 }, { index: 20, price: 50 }], view);
    assert.ok(line?.type === 'line' && line.x1 < 0 && line.x2 > 500);
    const vertical = BUILTIN_DRAWINGS.find((d) => d.name === 'ray')!.geometry([{ index: 10, price: 50 }, { index: 10, price: 60 }], view);
    assert.ok(vertical[0]?.type === 'line' && vertical[0].y2 < 0);
    const degenerate = BUILTIN_DRAWINGS.find((d) => d.name === 'ray')!.geometry([{ index: 10, price: 50 }, { index: 10, price: 50 }], view);
    assert.ok(degenerate[0]?.type === 'line' && degenerate[0].x2 === 100);
  });
  it('info line reports change, bars, span and angle', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'info-line')!;
    const prims = def.geometry([{ index: 0, price: 50 }, { index: 10, price: 60 }], fullView);
    const label = prims.find((p) => p.type === 'text');
    assert.ok(label?.type === 'text');
    assert.match(label.text, /\+10\.0 \(\+20\.00%\)\n10 bars, 10h\n5\.7°/);
    const noData = def.geometry([{ index: 0, price: 50 }, { index: 10, price: 60 }], view);
    assert.ok(noData.some((p) => p.type === 'text' && p.text.includes('10 bars\n')));
  });
  it('vertical line omits its time tag without data', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'vertical-line')!;
    assert.equal(def.geometry([{ index: 3, price: 1 }], view).length, 1);
    assert.equal(def.geometry([{ index: 3, price: 1 }], fullView).length, 2);
  });
});

describe('fibonacci', () => {
  it('retracement puts level 0 at the second point and 1 at the first', () => {
    const prims = fibDrawing.geometry([{ index: 2, price: 100 }, { index: 6, price: 0 }], view);
    const lines = prims.filter((p) => p.type === 'line' && p.dash === undefined);
    assert.equal(lines.length, FIB_LEVELS.length);
    assert.ok(lines[0]?.type === 'line' && lines[0].y1 === 100);
    const last = lines.at(-1);
    assert.ok(last?.type === 'line' && last.y1 === 0);
    const texts = prims.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''));
    assert.ok(texts.includes('0.5 (50.00)'));
    assert.equal(prims.filter((p) => p.type === 'rect').length, FIB_LEVELS.length - 1);
  });
  it('fib time zone collapses to one line for a zero span', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'fib-time-zone')!;
    const prims = def.geometry([{ index: 3, price: 1 }, { index: 3, price: 5 }], view);
    assert.equal(prims.filter((p) => p.type === 'line').length, 2);
  });
  it('fib speed arcs open downward when b is below a', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'fib-speed-arcs')!;
    const arc = def.geometry([{ index: 3, price: 60 }, { index: 8, price: 40 }], view).find((p) => p.type === 'ellipse');
    assert.ok(arc?.type === 'ellipse' && arc.start === 0);
  });
});

describe('shapes', () => {
  it('rectangle normalizes corners and fills', () => {
    const prims = rectDrawing.geometry([{ index: 8, price: 10 }, { index: 2, price: 40 }], view);
    assert.deepEqual(prims, [{ type: 'rect', x: 20, y: 60, w: 60, h: 30, fill: true }]);
  });
  it('arrow marks add captions only when text is set', () => {
    for (const name of ['arrow-up', 'arrow-down']) {
      const def = BUILTIN_DRAWINGS.find((d) => d.name === name)!;
      assert.equal(def.geometry([{ index: 3, price: 50 }], view).length, 1);
      assert.equal(def.geometry([{ index: 3, price: 50 }], view, { text: 'Buy', image: null }).length, 2);
    }
  });
});

describe('annotations', () => {
  it('image tool draws the image or a placeholder', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'image')!;
    const pts = [{ index: 1, price: 90 }, { index: 5, price: 60 }];
    assert.equal(def.geometry(pts, view)[0]?.type, 'rect');
    const img = { width: 10, height: 10 };
    assert.deepEqual(def.geometry(pts, view, { text: '', image: img }), [{ type: 'image', image: img, x: 10, y: 10, w: 40, h: 30 }]);
  });
  it('anchored tools place points as screen fractions', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'anchored-text')!;
    assert.equal(def.anchored, true);
    const [t] = def.geometry([{ index: 0.5, price: 0.25 }], view);
    assert.ok(t?.type === 'text' && t.x === 250 && t.y === 75 && t.text === 'Text');
  });
  it('pin shows its text only when set', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'pin')!;
    assert.equal(def.geometry([{ index: 1, price: 1 }], view).length, 3);
    assert.equal(def.geometry([{ index: 1, price: 1 }], view, { text: 'x', image: null }).length, 4);
  });
  it('table renders a header row and cells from pipe/newline text', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'table')!;
    const prims = def.geometry([{ index: 1, price: 90 }], view, { text: 'A|B|C\n1', image: null });
    const texts = prims.filter((p) => p.type === 'text');
    assert.equal(texts.length, 6);
    assert.ok(texts.some((p) => p.type === 'text' && p.bold === true && p.text === 'C'));
  });
  it('price note aligns its label away from the anchor', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'price-note')!;
    const left = def.geometry([{ index: 5, price: 50 }, { index: 1, price: 60 }], view).find((p) => p.type === 'text');
    assert.ok(left?.type === 'text' && left.align === 'right');
  });
});

describe('forecasting', () => {
  it('positions normalize a default target and stop', () => {
    const long = BUILTIN_DRAWINGS.find((d) => d.name === 'long-position')!;
    const pts = long.normalize!([{ index: 10, price: 100 }]);
    assert.equal(pts.length, 3);
    assert.ok(pts[1]!.price > 100 && pts[2]!.price < 100);
    const short = BUILTIN_DRAWINGS.find((d) => d.name === 'short-position')!;
    const s = short.normalize!([{ index: 10, price: 100 }, { index: 20, price: 90 }]);
    assert.equal(s[2]!.price, 105);
    assert.deepEqual(short.normalize!(s), s);
  });
  it('positions report R/R and an open P&L once data reaches the entry', () => {
    const long = BUILTIN_DRAWINGS.find((d) => d.name === 'long-position')!;
    const prims = long.geometry([{ index: 10, price: 50 }, { index: 30, price: 60 }, { index: 30, price: 45 }], fullView);
    const texts = prims.flatMap((p) => (p.type === 'text' ? [p.text] : []));
    assert.ok(texts.includes('Long · R/R 2.00'));
    assert.ok(texts.some((t) => t.startsWith('P&L ')));
    const flat = long.geometry([{ index: 10, price: 50 }, { index: 30, price: 60 }, { index: 30, price: 50 }], view);
    assert.ok(flat.some((p) => p.type === 'text' && p.text.endsWith('R/R ∞')));
    const future = long.geometry([{ index: 100, price: 50 }, { index: 130, price: 60 }], fullView);
    assert.ok(!future.some((p) => p.type === 'text' && p.text.startsWith('P&L')));
    const losing = BUILTIN_DRAWINGS.find((d) => d.name === 'short-position')!
      .geometry([{ index: 1, price: 30 }, { index: 5, price: 20 }], fullView);
    assert.ok(losing.some((p) => p.type === 'text' && p.text.startsWith('P&L +') === false && p.text.startsWith('P&L')));
  });
  it('volume profile marks a point of control', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'volume-profile')!;
    const prims = def.geometry([{ index: 2, price: 70 }, { index: 50, price: 30 }], fullView);
    assert.ok(prims.some((p) => p.type === 'text' && p.text.startsWith('POC ')));
    const noVolume = def.geometry([{ index: 2, price: 70 }, { index: 5, price: 30 }], {
      ...fullView,
      candles: sampleCandles.map(({ volume: _v, ...c }) => c),
    });
    assertFinite(noVolume, 'no-volume profile');
  });
  it('anchored VWAP handles zero-volume bars', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'anchored-vwap')!;
    const prims = def.geometry([{ index: 55, price: 1 }], { ...fullView, candles: sampleCandles.map((c) => ({ ...c, volume: 0 })) });
    assert.ok(prims.some((p) => p.type === 'text' && p.text.startsWith('VWAP ')));
  });
  it('anchored VWAP weights bars without a volume field as 1', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'anchored-vwap')!;
    const prims = def.geometry([{ index: 55, price: 1 }], {
      ...fullView,
      candles: sampleCandles.map(({ volume: _v, ...c }) => c),
    });
    assertFinite(prims, 'volume-less vwap');
    assert.ok(prims.some((p) => p.type === 'text' && p.text.startsWith('VWAP ')));
  });
  it('volumeProfile falls back to a zero grid for a degenerate row count', () => {
    assert.deepEqual(volumeProfile(fullView as FullView, 0, 10, 0), { lo: 0, hi: 0, up: [], down: [] });
  });
  it('projection shows a dash for a flat first leg', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'projection')!;
    const prims = def.geometry([{ index: 1, price: 50 }, { index: 5, price: 50 }, { index: 9, price: 60 }], view);
    assert.ok(prims.some((p) => p.type === 'text' && p.text.startsWith('—')));
  });
  it('ghost feed walks backwards too', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'ghost-feed')!;
    const prims = def.geometry([{ index: 10, price: 50 }, { index: 7, price: 45 }, { index: 7, price: 45 }], view);
    assert.ok(prims.length >= 6);
  });
});

describe('patterns and cycles', () => {
  it('harmonic ratios show a dash for zero-height legs', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'xabcd')!;
    const flat = Array.from({ length: 5 }, (_, i) => ({ index: i * 5, price: 50 }));
    assert.ok(def.geometry(flat, view).some((p) => p.type === 'text' && p.text === '—'));
  });
  it('cycle tools degrade to a single mark for a zero period', () => {
    for (const name of ['cyclic-lines', 'time-cycles', 'sine-line']) {
      const def = BUILTIN_DRAWINGS.find((d) => d.name === name)!;
      assert.equal(def.geometry([{ index: 5, price: 50 }, { index: 5, price: 60 }], view).length, 1, name);
    }
  });
  it('time cycles default their height to half the period and open downward', () => {
    const def = BUILTIN_DRAWINGS.find((d) => d.name === 'time-cycles')!;
    const [first] = def.geometry([{ index: 5, price: 50 }, { index: 9, price: 50 }], view);
    assert.ok(first?.type === 'ellipse' && first.ry === 20);
    const [down] = def.geometry([{ index: 5, price: 50 }, { index: 9, price: 40 }], view);
    assert.ok(down?.type === 'ellipse' && down.start === 0);
  });
});
