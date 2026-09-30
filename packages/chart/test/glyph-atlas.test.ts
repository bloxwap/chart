import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GlyphAtlas } from '../dist/render/gl/glyph-atlas.js';
import { GLBackend } from '../dist/render/gl/backend.js';
import { MockCanvas, MockContext2D, MockContextWebGL2, MockGLCanvas, MockGLDocument } from '../dist/dom.js';
import { createChart, createFootprintSeries } from '../dist/index.js';

describe('footprint glyph atlas', () => {
  it('rasterizes a bounded character set once per ratio and centers its quads', () => {
    const canvas = new MockCanvas(1, 1);
    const atlas = GlyphAtlas.create(canvas)!;
    assert.equal(atlas.prepare(1), true);
    assert.equal(atlas.prepare(1), false);
    assert.equal(canvas.context.countCalls('fillText'), 15);
    const quads: number[][] = [];
    assert.equal(atlas.draw('1×2', 50, 30, (...quad) => quads.push(quad)), true);
    assert.equal(quads.length, 3);
    const advance = canvas.context.measureText('1').width;
    assert.equal(quads[0]![0], 50 - advance * 1.5 - 2);
    assert.equal(quads[0]![1], 18);
    assert.equal(quads[2]![0] - quads[0]![0], advance * 2);
    quads.length = 0;
    assert.equal(atlas.draw('oops', 0, 0, (...quad) => quads.push(quad)), false);
    assert.equal(quads.length, 0);
    assert.equal(atlas.draw('', 0, 0, (...quad) => quads.push(quad)), true);
    assert.equal(atlas.prepare(2), true);
    assert.equal(canvas.height, 48);
    atlas.dispose();
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  });

  it('keeps labels on Canvas2D when there is no atlas canvas or 2D context', () => {
    class NoContext extends MockCanvas {
      override getContext(): null { return null; }
    }
    assert.equal(GlyphAtlas.create(new NoContext()), null);
    for (const factory of [undefined, () => undefined, () => new NoContext()]) {
      const canvas = new MockGLCanvas(100, 100);
      const backend = GLBackend.create(canvas, factory)!;
      const frame = backend.beginFrame(1, 100, 100);
      assert.equal(frame.text!('1×2', 50, 50, '#ffffff', 1), false);
      assert.equal(frame.text!('1×2', 50, 50, '#ffffff', 1), false);
      backend.dispose();
    }
  });

  it('uploads once per ratio, rejects unsupported labels/colors, and releases the texture', () => {
    const canvas = new MockGLCanvas(100, 100);
    const atlasCanvas = new MockCanvas(1, 1);
    const backend = GLBackend.create(canvas, () => atlasCanvas)!;
    let frame = backend.beginFrame(1, 100, 100);
    assert.equal(frame.text!('1', 50, 50, 'no-such-color', 1), false);
    assert.equal(frame.text!('1×2', 50, 50, '#ffffff', .5), true);
    assert.equal(frame.text!('2×1', 50, 60, 'color(display-p3 1 0 0)', 1), true);
    assert.equal(frame.text!('unknown', 0, 0, '#ffffff', 1), false);
    assert.equal(canvas.gl.countCalls('texImage2D'), 1);
    const ctx = new MockContext2D();
    frame.composite(ctx);
    assert.equal(canvas.gl.callsNamed('drawArraysInstanced').at(-1)![4], 6);
    frame = backend.beginFrame(2, 100, 100);
    frame.text!('1', 50, 50, '#ffffff', 1);
    frame.composite(ctx);
    assert.equal(canvas.gl.countCalls('texImage2D'), 2);
    assert.equal(ctx.countCalls('drawImage'), 2);
    backend.dispose();
    assert.equal(canvas.gl.countCalls('deleteTexture'), 1);
    assert.equal(atlasCanvas.width, 0);
  });

  it('falls back without leaking an atlas when texture allocation fails', () => {
    class NoTexture extends MockContextWebGL2 {
      override createTexture(): null { return null; }
    }
    const glCanvas = new MockGLCanvas(100, 100);
    Object.defineProperty(glCanvas, 'gl', { value: new NoTexture() });
    const atlasCanvas = new MockCanvas(1, 1);
    const backend = GLBackend.create(glCanvas, () => atlasCanvas)!;
    const frame = backend.beginFrame(1, 100, 100);
    assert.equal(frame.text!('1', 50, 50, '#ffffff', 1), false);
    assert.equal(frame.text!('1', 50, 50, '#ffffff', 1), false);
    assert.equal(atlasCanvas.width, 0);
    assert.equal(atlasCanvas.height, 0);
    backend.dispose();
  });

  for (const fromOwner of [false, true]) it(`renders a registered footprint (${fromOwner ? 'owner document' : 'injected document'}) through GPU labels and keeps axes on Canvas2D`, () => {
    const doc = new MockGLDocument();
    const host = fromOwner
      ? { container: Object.assign(doc.createCanvas(640, 400), {
        ownerDocument: { createElement: () => doc.createCanvas(1, 1) },
      }) }
      : { document: doc };
    const chart = createChart({ ...host, renderer: 'webgl2', config: {
      width: 640, height: 400, wasm: false,
      data: [{ time: 1, open: 100, high: 102, low: 98, close: 101 }],
      series: { type: 'footprint' },
    } });
    chart.registerSeries('footprint', createFootprintSeries({ bar: () => ({
      time: 1000, buySize: 2, sellSize: 1,
      levels: [{ price: 100, buySize: 2, sellSize: 1 }],
    }) }, { lodThresholds: { textBarWidth: 0, textCellHeight: 0 } }));
    const gl = doc.created[1]!.gl;
    assert.equal(gl.countCalls('texImage2D'), 1);
    assert.ok(gl.countCalls('drawArraysInstanced') > 0);
    assert.ok(doc.created[0]!.context.countCalls('fillText') > 0);
    chart.render();
    assert.equal(gl.countCalls('texImage2D'), 1);
    chart.destroy();
  });
});
