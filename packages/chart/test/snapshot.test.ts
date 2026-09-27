import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChart, canvasToBlob, canvasToDataURL, createSnapshotCanvas, snapshotToBlob, snapshotToDataURL,
  type SnapshotOptions,
} from '../dist/index.js';
import { MockCanvas, MockContext2D, MockDocument, type ChartCanvas, type ChartDocument, type MockBlob } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

const data = (n = 40): Candle[] => Array.from({ length: n }, (_, i) => ({
  time: 1_700_000_000 + i * 60, open: 100 + i, high: 103 + i, low: 98 + i, close: 101 + i, volume: 10 + i,
}));

/** Records the fill color active for every fillRect. */
class ColorContext extends MockContext2D {
  readonly fills: string[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push(String(this.fillStyle));
    super.fillRect(x, y, w, h);
  }
}

const texts = (canvas: MockCanvas): string[] => canvas.context.callsNamed('fillText').map((c) => String(c[1]));

/** A container canvas whose ownerDocument creates MockCanvas snapshots. */
function ownedCanvas(width = 800, height = 400) {
  const created: MockCanvas[] = [];
  const canvas = new MockCanvas(width, height);
  Object.assign(canvas, { ownerDocument: { createElement: (tag: string) => {
    assert.equal(tag, 'canvas');
    const c = new MockCanvas(300, 150);
    created.push(c);
    return c;
  } } });
  return { canvas, created };
}

describe('MockCanvas encoding', () => {
  it('yields deterministic blobs and data URLs, and nothing for an empty bitmap', () => {
    const canvas = new MockCanvas(4, 3);
    let blob: MockBlob | null = null;
    canvas.toBlob((b) => { blob = b; });
    assert.deepEqual(blob, { size: 48, type: 'image/png' });
    canvas.toBlob((b) => { blob = b; }, 'image/jpeg');
    assert.deepEqual(blob, { size: 48, type: 'image/jpeg' });
    assert.equal(canvas.toDataURL(), 'data:image/png;mock,4x3');
    assert.equal(canvas.toDataURL('image/webp'), 'data:image/webp;mock,4x3');
    for (const [w, h] of [[0, 3], [4, 0]] as const) {
      const empty = new MockCanvas(w, h);
      empty.toBlob((b) => { blob = b; });
      assert.equal(blob, null);
      assert.equal(empty.toDataURL(), 'data:,');
    }
  });
});

describe('Chart.takeScreenshot', () => {
  it('renders into a new document canvas at CSS size times the ratio', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, pixelRatio: 2, config: { wasm: false, width: 400, height: 300, data: data() } });
    const live = doc.created[0]!;
    const liveCalls = live.context.calls.length;
    const shot = chart.takeScreenshot() as MockCanvas;
    assert.equal(doc.created.length, 2);
    assert.equal(shot, doc.created[1]);
    assert.deepEqual([shot.width, shot.height], [800, 600]);
    assert.deepEqual(shot.context.callsNamed('scale')[0], ['scale', 2, 2]);
    assert.ok(shot.context.countCalls('fillText') > 0);
    const hi = chart.takeScreenshot({ pixelRatio: 3 }) as MockCanvas;
    assert.deepEqual([hi.width, hi.height], [1200, 900]);
    assert.deepEqual(hi.context.callsNamed('scale')[0], ['scale', 3, 3]);
    const lo = chart.takeScreenshot({ pixelRatio: 0.5 }) as MockCanvas;
    assert.deepEqual([lo.width, lo.height], [200, 150]);
    // Snapshots never repaint the live canvas.
    assert.equal(live.context.calls.length, liveCalls);
    chart.destroy();
  });

  it('creates the canvas through the container ownerDocument when no ChartDocument was injected', () => {
    const { canvas, created } = ownedCanvas(640, 480);
    const chart = createChart({ container: canvas, config: { wasm: false, data: data() } });
    const shot = chart.takeScreenshot();
    assert.equal(created.length, 1);
    assert.equal(shot, created[0]);
    assert.deepEqual([shot.width, shot.height], [640, 480]);
    assert.ok(texts(created[0]!).length > 0);
    chart.destroy();
  });

  it('prefers the injected ChartDocument, and throws when neither document exists', () => {
    const doc = new MockDocument();
    const { canvas, created } = ownedCanvas();
    assert.equal(createSnapshotCanvas(canvas, doc, 10, 20), doc.created[0]);
    assert.deepEqual([doc.created[0]!.width, doc.created[0]!.height], [10, 20]);
    assert.equal(created.length, 0);
    const bare = createChart({ container: new MockCanvas(200, 100), config: { wasm: false, data: data() } });
    assert.throws(() => bare.takeScreenshot(), /^Error: chart-ts: snapshots need a ChartDocument or a container canvas with an ownerDocument$/);
    const orphan = new MockCanvas(200, 100);
    Object.assign(orphan, { ownerDocument: null });
    assert.throws(() => createSnapshotCanvas(orphan, undefined, 1, 1), /chart-ts: snapshots need/);
    Object.assign(orphan, { ownerDocument: {} });
    assert.throws(() => createSnapshotCanvas(orphan, undefined, 1, 1), /chart-ts: snapshots need/);
    bare.destroy();
  });

  it('applies watermark overrides to the snapshot only', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: data(), watermark: { text: 'LIVE' } } });
    const live = doc.created[0]!;
    const shot = chart.takeScreenshot({ watermark: { visible: true, text: 'bloxwap.pro', fontSize: 30 } }) as MockCanvas;
    assert.ok(texts(shot).includes('bloxwap.pro'));
    assert.ok(shot.context.callsNamed('set:font').some((c) => String(c[1]).startsWith('30px ')));
    assert.ok(!texts(live).includes('bloxwap.pro'));
    assert.ok(!texts(live).includes('LIVE'));
    assert.deepEqual(chart.getConfig().watermark.text, 'LIVE');
    assert.equal(chart.getConfig().watermark.visible, false);
    // A later live render still has no watermark.
    chart.render();
    assert.ok(!texts(live).includes('bloxwap.pro'));
    // Without overrides the live watermark config carries over.
    const plain = chart.takeScreenshot() as MockCanvas;
    assert.ok(!texts(plain).includes('LIVE'));
    chart.updateConfig({ watermark: { visible: true } });
    assert.ok(texts(chart.takeScreenshot() as MockCanvas).includes('LIVE'));
    chart.destroy();
  });

  it('excludes the crosshair by default and includes it on request', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: data(), crosshair: { mode: 'dot' },
      statusLine: { visible: true, symbolVisible: false, change: false } } });
    const hoveredX = chart.scale.indexToX(5);
    chart.setCrosshair(hoveredX, 100);
    assert.ok(doc.created[0]!.context.countCalls('ellipse') > 0);
    const plain = chart.takeScreenshot() as MockCanvas;
    assert.equal(plain.context.countCalls('ellipse'), 0);
    assert.ok(texts(plain).includes(`C ${chart.getConfig().formatters.price(140)}`));
    const withCrosshair = chart.takeScreenshot({ crosshair: true }) as MockCanvas;
    assert.ok(withCrosshair.context.countCalls('ellipse') > 0);
    assert.ok(texts(withCrosshair).includes(`C ${chart.getConfig().formatters.price(106)}`));
    // The live crosshair state still applies after a snapshot.
    chart.clearCrosshair();
    assert.equal((chart.takeScreenshot({ crosshair: true }) as MockCanvas).context.countCalls('ellipse'), 0);
    chart.destroy();
  });

  it('overrides the background for the snapshot only', () => {
    const shots: ColorContext[] = [];
    const doc: ChartDocument = { createCanvas: (width, height) => {
      const ctx = new ColorContext();
      shots.push(ctx);
      return { width, height, getContext: () => ctx };
    } };
    const chart = createChart({ document: doc, config: { wasm: false, data: data(), theme: { background: '#101010' } } });
    chart.takeScreenshot({ background: 'transparent' });
    assert.equal(shots[1]!.fills[0], 'transparent');
    chart.takeScreenshot();
    assert.equal(shots[2]!.fills[0], '#101010');
    assert.equal(chart.getConfig().theme.background, '#101010');
    chart.destroy();
  });

  it('re-renders a stale view first and keeps only the live color space', () => {
    const canvas = new MockCanvas(400, 200), created: MockCanvas[] = [];
    const requested: unknown[] = [];
    Object.assign(canvas, { ownerDocument: { createElement: () => {
      const c = new MockCanvas();
      created.push(c);
      return Object.assign(c, { getContext: (_: '2d', options?: unknown) => { requested.push(options); return c.context; } });
    } } });
    const chart = createChart({ container: canvas, config: { wasm: false, data: data() } });
    chart.takeScreenshot();
    assert.deepEqual(requested, [undefined]);
    canvas.width = 500;
    const before = canvas.context.countCalls('save');
    const shot = chart.takeScreenshot();
    assert.ok(canvas.context.countCalls('save') > before);
    assert.equal(shot.width, 500);
    canvas.height = 250;
    assert.equal(chart.takeScreenshot().height, 250);
    // The snapshot context is requested with the live context's attributes.
    Object.assign(canvas.context, { getContextAttributes: () => ({ colorSpace: 'display-p3' }) });
    chart.takeScreenshot();
    assert.deepEqual(requested.at(-1), { colorSpace: 'display-p3' });
    // Only the color space carries over: an opaque (alpha:false) live context
    // must not make a transparent-background snapshot opaque.
    Object.assign(canvas.context, { getContextAttributes: () =>
      ({ alpha: false, colorSpace: 'srgb', desynchronized: true, willReadFrequently: false }) });
    chart.takeScreenshot({ background: 'transparent' });
    assert.deepEqual(requested.at(-1), { colorSpace: 'srgb' });
    Object.assign(canvas.context, { getContextAttributes: () => ({ alpha: false }) });
    chart.takeScreenshot({ background: 'transparent' });
    assert.equal(requested.at(-1), undefined);
    assert.equal(created.length, 6);
    chart.destroy();
  });

  it('throws for a destroyed chart, a missing 2D context or an invalid ratio', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: data() } });
    for (const pixelRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => chart.takeScreenshot({ pixelRatio }), /^Error: chart-ts: invalid snapshot pixelRatio/);
    }
    chart.destroy();
    assert.throws(() => chart.takeScreenshot(), /^Error: chart-ts: cannot take a screenshot of a destroyed chart$/);

    const noContext = { width: 200, height: 100, getContext: () => null } as ChartCanvas;
    const blind = createChart({ container: noContext, config: { wasm: false, data: data() } });
    assert.throws(() => blind.takeScreenshot(), /^Error: chart-ts: cannot take a screenshot without a 2D context$/);
    blind.destroy();

    let flakyCount = 0;
    const flaky = createChart({ document: { createCanvas: (width, height) => (flakyCount++ === 0 ? new MockCanvas(width, height) : { width, height, getContext: () => null }) },
      config: { wasm: false, data: data() } });
    assert.throws(() => flaky.takeScreenshot(), /^Error: chart-ts: the snapshot canvas has no 2D context$/);
    flaky.destroy();
  });
});

describe('Chart.toBlob and toDataURL', () => {
  it('encodes the snapshot, then releases its backing store', async () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, pixelRatio: 2, config: { wasm: false, width: 300, height: 200, data: data() } });
    assert.deepEqual(await chart.toBlob(), { size: 600 * 400 * 4, type: 'image/png' });
    assert.deepEqual([doc.created[1]!.width, doc.created[1]!.height], [0, 0]);
    assert.ok(texts(doc.created[1]!).length > 0);
    assert.deepEqual(await chart.toBlob({ type: 'image/jpeg', quality: 0.8, pixelRatio: 1 }), { size: 300 * 200 * 4, type: 'image/jpeg' });
    assert.equal(chart.toDataURL(), 'data:image/png;mock,600x400');
    assert.equal(chart.toDataURL({ type: 'image/webp', pixelRatio: 1, watermark: { visible: true, text: 'W' } }), 'data:image/webp;mock,300x200');
    assert.ok(texts(doc.created.at(-1)!).includes('W'));
    assert.equal(doc.created.at(-1)!.width, 0);
    chart.destroy();
  });

  it('passes type and quality through to the canvas', async () => {
    const seen: unknown[] = [];
    const canvas = { width: 2, height: 2, getContext: () => new MockContext2D(),
      toBlob: (cb: (b: unknown) => void, type?: string, quality?: number) => { seen.push(['blob', type, quality]); cb('blob'); },
      toDataURL: (type?: string, quality?: number) => { seen.push(['url', type, quality]); return 'data:x'; } };
    assert.equal(await canvasToBlob(canvas, 'image/jpeg', 0.5), 'blob');
    assert.equal(canvasToDataURL(canvas, 'image/webp', 0.25), 'data:x');
    assert.equal(await canvasToBlob(canvas), 'blob');
    assert.deepEqual(seen, [['blob', 'image/jpeg', 0.5], ['url', 'image/webp', 0.25], ['blob', undefined, undefined]]);
    assert.equal(await snapshotToBlob(canvas, { quality: 1 }), 'blob');
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
    canvas.width = 5;
    assert.equal(snapshotToDataURL(canvas, {}), 'data:x');
    assert.equal(canvas.width, 0);
  });

  it('rejects when encoding yields null or the canvas cannot encode', async () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, width: 300, height: 200, data: data() } });
    // A sub-pixel ratio rounds to an empty bitmap, which encodes to null.
    await assert.rejects(chart.toBlob({ pixelRatio: 0.001 }), /^Error: chart-ts: the canvas produced no image$/);
    assert.equal(chart.toDataURL({ pixelRatio: 0.001 }), 'data:,');
    await assert.rejects(chart.toBlob({ pixelRatio: 0 }), /invalid snapshot pixelRatio/);
    chart.destroy();
    await assert.rejects(chart.toBlob(), /destroyed chart/);

    const plain = { width: 300, height: 150, getContext: () => new MockContext2D() };
    const { canvas } = ownedCanvas();
    Object.assign(canvas, { ownerDocument: { createElement: () => ({ ...plain }) } });
    const legacy = createChart({ container: canvas, config: { wasm: false, data: data() } });
    await assert.rejects(legacy.toBlob(), /^Error: chart-ts: this canvas does not support toBlob$/);
    assert.throws(() => legacy.toDataURL(), /^Error: chart-ts: this canvas does not support toDataURL$/);
    legacy.destroy();
  });

  it('keeps snapshot options structurally optional', () => {
    const options: SnapshotOptions = {};
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: data() } });
    assert.equal(chart.takeScreenshot(options).width, 800);
    chart.destroy();
  });
});
