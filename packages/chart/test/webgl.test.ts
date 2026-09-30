import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockCanvas, MockContext2D, MockContextWebGL2, MockDocument, MockGLCanvas, MockGLDocument } from '../dist/dom.js';
import type { ChartCanvas } from '../dist/dom.js';
import { GLBackend } from '../dist/render/gl/backend.js';
import { parseColor } from '../dist/color.js';
import type { Candle } from '../dist/core/data.js';
import type { DepthBook } from '../dist/core/depth.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig } from '../dist/config.js';
import { drawCandlesticks } from '../dist/series/candlestick.js';
import { packCandleQuads } from '../dist/render/gl/candles.js';
import { heatmapRamp, heatmapRampRGBA, HEATMAP_RAMP_STEPS } from '../dist/render/heatmap.js';

const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
  time: 1700000000 + i * 60,
  open: 100 + i * 0.1,
  high: 101.5 + i * 0.1,
  low: 98.5 + i * 0.1,
  close: 100.5 + i * 0.1 * (i % 2 === 0 ? 1 : -1),
  volume: 1000 + i,
}));

function book(timeMs: number): DepthBook {
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];
  for (let j = 0; j < 10; j++) {
    bids.push([103.5 - j * 0.5, (j + 1) * 3]);
    asks.push([104.5 + j * 0.5, (j + 1) * 2]);
  }
  return { bids, asks, time: timeMs };
}

function glInstances(gl: { callsNamed(name: string): readonly (readonly [string, ...unknown[]])[] }): number {
  return gl.callsNamed('drawArraysInstanced').reduce((sum, call) => sum + (call[4] as number), 0);
}

describe('webgl2 backend selection', () => {
  it('falls back to canvas2d when the canvas has no webgl2 context, with identical 2D output', () => {
    const plain = new MockDocument();
    const plainChart = createChart({ document: plain, config: { width: 800, height: 500, data: candles, wasm: false } });
    const fallback = new MockDocument();
    const fallbackChart = createChart({ document: fallback, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
    assert.equal(fallbackChart.renderBackend, 'canvas2d');
    assert.deepEqual(fallback.created[0]!.context.calls, plain.created[0]!.context.calls);
    plainChart.destroy();
    fallbackChart.destroy();
  });

  it('selects webgl2 when the document provides a context', () => {
    const doc = new MockGLDocument();
    const chart = createChart({ document: doc, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
    assert.equal(chart.renderBackend, 'webgl2');
    assert.equal(doc.created.length, 2);
    const ctx = doc.created[0]!.context;
    const gl = doc.created[1]!.gl;
    ctx.calls.length = 0;
    gl.calls.length = 0;
    chart.render();
    const range = chart.scale.visibleRange();
    const visible = Math.ceil(range.to) - Math.floor(range.from);
    assert.equal(glInstances(gl), visible * 2); // wick + body per candle
    assert.equal(gl.countCalls('bufferData'), 1);
    assert.equal(ctx.countCalls('drawImage'), 1);
    assert.equal(ctx.countCalls('fillRect'), 1); // background only; candles are quads
    chart.destroy();
    assert.ok(gl.countCalls('deleteProgram') === 1);
    assert.ok(gl.countCalls('deleteBuffer') === 1);
    assert.ok(gl.countCalls('deleteVertexArray') === 1);
  });

  it('self-clears after compositing so repaints of one frame never stack quads', () => {
    const doc = new MockGLDocument();
    const chart = createChart({ document: doc, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
    const gl = doc.created[1]!.gl;
    gl.calls.length = 0;
    chart.render();
    chart.setCrosshair(100, 100); // repaints the cached view without a beginFrame
    const composites = gl.countCalls('drawArraysInstanced');
    assert.ok(composites >= 2);
    // One clear at beginFrame plus one after each composite.
    assert.equal(gl.countCalls('clear'), composites + 1);
    chart.destroy();
  });

  it('falls back to canvas2d when the GL pipeline fails to build', () => {
    for (const options of [{ compile: false }, { link: false }]) {
      const doc = new MockGLDocument(options);
      const chart = createChart({ document: doc, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
      assert.equal(chart.renderBackend, 'canvas2d');
      assert.ok(doc.created[0]!.context.countCalls('fillRect') > candles.length);
      chart.destroy();
    }
  });

  it("builds the GL canvas from the container's ownerDocument", () => {
    const glCanvases: MockGLCanvas[] = [];
    const container = Object.assign(new MockCanvas(800, 500), {
      ownerDocument: {
        createElement: (_tag: 'canvas') => {
          const canvas = new MockGLCanvas();
          glCanvases.push(canvas);
          return canvas;
        },
      },
    });
    const chart = createChart({ container, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
    assert.equal(chart.renderBackend, 'webgl2');
    assert.equal(glCanvases.length, 1);
    assert.ok(glInstances(glCanvases[0]!.gl) > 0);
    chart.destroy();
  });

  it('stays on canvas2d when neither the container nor an injected document can make a canvas', () => {
    const container = new MockCanvas(800, 500);
    const chart = createChart({ container, renderer: 'webgl2', config: { width: 800, height: 500, data: candles, wasm: false } });
    assert.equal(chart.renderBackend, 'canvas2d');
    assert.ok(container.context.countCalls('fillRect') > candles.length);
    chart.destroy();
  });

  it('keeps bordered candles and unparseable colors on the Canvas2D series path', () => {
    const bordered = new MockGLDocument();
    const borderedChart = createChart({
      document: bordered,
      renderer: 'webgl2',
      config: { width: 800, height: 500, data: candles, wasm: false, series: { borderVisible: true } },
    });
    assert.equal(borderedChart.renderBackend, 'webgl2');
    const ctx = bordered.created[0]!.context;
    assert.ok(ctx.countCalls('stroke') >= candles.length); // borders stroke per candle
    assert.ok(ctx.countCalls('fillRect') > candles.length); // bodies stay 2D
    assert.equal(ctx.countCalls('drawImage'), 0); // no quads, no composite
    borderedChart.destroy();

    const badColor = new MockGLDocument();
    const badColorChart = createChart({
      document: badColor,
      renderer: 'webgl2',
      config: { width: 800, height: 500, data: candles, wasm: false, series: { upColor: 'not-a-color' } },
    });
    assert.equal(badColorChart.renderBackend, 'webgl2');
    assert.ok(badColor.created[0]!.context.countCalls('fillRect') > candles.length);
    badColorChart.destroy();
  });
});

describe('webgl2 heatmap', () => {
  function feedHeatmap(doc: MockDocument | MockGLDocument, renderer?: 'webgl2') {
    const chart = createChart({
      document: doc,
      ...(renderer !== undefined ? { renderer } : {}),
      config: { width: 800, height: 500, data: candles, wasm: false, heatmap: { enabled: true } },
    });
    for (let k = 0; k < candles.length; k++) chart.setDepth(book((1700000000 + k * 60) * 1000 + 500));
    return chart;
  }

  it('emits one quad per Canvas2D heatmap run', () => {
    const plainDoc = new MockDocument();
    const plain = feedHeatmap(plainDoc);
    const glDoc = new MockGLDocument();
    const glChart = feedHeatmap(glDoc, 'webgl2');
    assert.equal(glChart.renderBackend, 'webgl2');

    const ctx = plainDoc.created[0]!.context;
    ctx.calls.length = 0;
    plain.render();
    const fills2d = ctx.countCalls('fillRect') - 1; // minus the background

    const glCtx = glDoc.created[0]!.context;
    const gl = glDoc.created[1]!.gl;
    glCtx.calls.length = 0;
    gl.calls.length = 0;
    glChart.render();
    assert.equal(glInstances(gl), fills2d);
    assert.equal(glCtx.countCalls('fillRect'), 1); // background only
    assert.equal(glCtx.countCalls('drawImage'), 1);
    plain.destroy();
    glChart.destroy();
  });
});

describe('packCandleQuads', () => {
  class RectRecorder extends MockContext2D {
    readonly rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    override fillRect(x: number, y: number, w: number, h: number): void {
      this.rects.push({ x, y, w, h, fill: this.fillStyle as string });
      super.fillRect(x, y, w, h);
    }
  }

  function scales() {
    const timeScale = new TimeScale(6, 0);
    timeScale.setViewport(500);
    const priceScale = new PriceScale();
    priceScale.height = 400;
    priceScale.setRange(90, 110);
    return { timeScale, priceScale };
  }

  it('mirrors drawCandlesticks geometry and colors quad-for-quad', () => {
    const { timeScale, priceScale } = scales();
    const config = resolveConfig({}).series;
    const range = { from: 0, to: candles.length };
    const liveCandle: Candle = { ...candles[candles.length - 1]!, close: 90 };

    const recorder = new RectRecorder();
    drawCandlesticks(recorder, candles, range, timeScale, priceScale, config, liveCandle);

    const quads: number[][] = [];
    const ok = packCandleQuads(
      { quad: (...q) => quads.push(q) },
      candles,
      range,
      timeScale,
      priceScale,
      config,
      liveCandle,
    );
    assert.equal(ok, true);
    assert.equal(quads.length, recorder.rects.length);
    assert.ok(quads.length > 0);
    for (const [i, rect] of recorder.rects.entries()) {
      const quad = quads[i]!;
      assert.deepEqual(quad.slice(0, 4), [rect.x, rect.y, rect.w, rect.h]);
      const parsed = parseColor(rect.fill)!;
      assert.ok(Math.abs(quad[4]! - parsed.r / 255) < 1e-6);
      assert.ok(Math.abs(quad[5]! - parsed.g / 255) < 1e-6);
      assert.ok(Math.abs(quad[6]! - parsed.b / 255) < 1e-6);
      assert.ok(Math.abs(quad[7]! - parsed.a) < 1e-6);
    }
  });

  it('returns false without emitting when a color is unparseable', () => {
    const { timeScale, priceScale } = scales();
    const config = { ...resolveConfig({}).series, upColor: 'not-a-color' };
    const quads: number[][] = [];
    const ok = packCandleQuads({ quad: (...q) => quads.push(q) }, candles, { from: 0, to: candles.length }, timeScale, priceScale, config);
    assert.equal(ok, false);
    assert.equal(quads.length, 0);
  });

  it('returns false when any one of down/wick colors is unparseable', () => {
    const { timeScale, priceScale } = scales();
    const variants = [
      { downColor: 'not-a-color' },
      { wickUpColor: 'not-a-color' },
      { wickDownColor: 'not-a-color' },
    ];
    for (const variant of variants) {
      const config = { ...resolveConfig({}).series, ...variant };
      const quads: number[][] = [];
      const ok = packCandleQuads({ quad: (...q) => quads.push(q) }, candles, { from: 0, to: candles.length }, timeScale, priceScale, config);
      assert.equal(ok, false);
      assert.equal(quads.length, 0);
    }
  });

  it('uses explicit wick colors when they are not empty strings', () => {
    const { timeScale, priceScale } = scales();
    const config = {
      ...resolveConfig({}).series,
      upColor: '#00ff00',
      downColor: '#ff0000',
      wickUpColor: '#0000ff',
      wickDownColor: '#ffff00',
    };
    const quads: number[][] = [];
    const ok = packCandleQuads({ quad: (...q) => quads.push(q) }, candles, { from: 0, to: candles.length }, timeScale, priceScale, config);
    assert.equal(ok, true);
    const wicks = quads.filter((q) => q[2] === 1); // wick quads are 1px wide
    assert.ok(wicks.length > 0);
    const blues = wicks.filter((q) => q[6] === 1).length; // wickUpColor blue channel
    const yellows = wicks.filter((q) => q[4] === 1 && q[5] === 1).length; // wickDownColor
    assert.ok(blues > 0);
    assert.ok(yellows > 0);
  });

  it('packs without a live candle, falling back to the candle at the last index', () => {
    const { timeScale, priceScale } = scales();
    const config = resolveConfig({}).series;
    const quads: number[][] = [];
    const ok = packCandleQuads({ quad: (...q) => quads.push(q) }, candles, { from: 0, to: candles.length }, timeScale, priceScale, config);
    assert.equal(ok, true);
    assert.equal(quads.length, candles.length * 2);
  });

  it('colors by the previous close when colorByPreviousClose is set', () => {
    const { timeScale, priceScale } = scales();
    const flat: Candle[] = [
      { time: 1, open: 100, high: 102, low: 98, close: 101, volume: 1 },
      { time: 2, open: 99, high: 103, low: 98, close: 100.5, volume: 1 }, // above open but below previous close
      { time: 3, open: 99, high: 103, low: 98, close: 100.5, volume: 1 }, // equal to previous close: up
    ];
    const base = resolveConfig({}).series;
    const plain: number[][] = [];
    packCandleQuads({ quad: (...q) => plain.push(q) }, flat, { from: 0, to: flat.length }, timeScale, priceScale, { ...base, wickVisible: false });
    const colored: number[][] = [];
    const ok = packCandleQuads(
      { quad: (...q) => colored.push(q) },
      flat,
      { from: 0, to: flat.length },
      timeScale,
      priceScale,
      { ...base, wickVisible: false, colorByPreviousClose: true },
    );
    assert.equal(ok, true);
    assert.equal(colored.length, flat.length);
    const up = parseColor(base.upColor)!;
    const down = parseColor(base.downColor)!;
    assert.equal(colored[0]![4], up.r / 255); // first candle has no previous close: compares to open
    assert.equal(colored[1]![4], down.r / 255); // close 100.5 < previous close 101
    assert.equal(colored[2]![4], up.r / 255); // close 100.5 >= previous close 100.5
    assert.equal(plain[1]![4], up.r / 255); // without the flag the same candle rises against its open
  });

  it('emits only wicks when bodyVisible is false and only bodies when wickVisible is false', () => {
    const { timeScale, priceScale } = scales();
    const base = resolveConfig({}).series;
    const range = { from: 0, to: candles.length };

    const wicksOnly: number[][] = [];
    const okWicks = packCandleQuads({ quad: (...q) => wicksOnly.push(q) }, candles, range, timeScale, priceScale, { ...base, bodyVisible: false });
    assert.equal(okWicks, true);
    assert.equal(wicksOnly.length, candles.length);
    assert.ok(wicksOnly.every((q) => q[2] === 1));

    const bodiesOnly: number[][] = [];
    const okBodies = packCandleQuads({ quad: (...q) => bodiesOnly.push(q) }, candles, range, timeScale, priceScale, { ...base, wickVisible: false });
    assert.equal(okBodies, true);
    assert.equal(bodiesOnly.length, candles.length);
    const bodyWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
    assert.ok(bodiesOnly.every((q) => q[2] === bodyWidth));
  });

  it('passes wide-gamut colors through with a channel divisor of 1', () => {
    const { timeScale, priceScale } = scales();
    const config = { ...resolveConfig({}).series, upColor: 'color(display-p3 0.25 0.5 0.75)' };
    const quads: number[][] = [];
    const one: Candle[] = [{ time: 1, open: 100, high: 102, low: 98, close: 101, volume: 1 }];
    const ok = packCandleQuads({ quad: (...q) => quads.push(q) }, one, { from: 0, to: 1 }, timeScale, priceScale, config);
    assert.equal(ok, true);
    const body = quads.find((q) => q[2] !== 1)!;
    assert.ok(Math.abs(body[4]! - 0.25) < 1e-6);
    assert.ok(Math.abs(body[5]! - 0.5) < 1e-6);
    assert.ok(Math.abs(body[6]! - 0.75) < 1e-6);
  });
});

describe('heatmapRampRGBA', () => {
  it('matches the string ramp step for step', () => {
    const strings = heatmapRamp('#2962ff', '#ffd54f', 0.85);
    const floats = heatmapRampRGBA('#2962ff', '#ffd54f', 0.85);
    assert.equal(strings.length, HEATMAP_RAMP_STEPS);
    for (let i = 0; i < HEATMAP_RAMP_STEPS; i++) {
      const parsed = parseColor(strings[i]!)!;
      assert.ok(Math.abs(floats[i * 4]! - parsed.r / 255) <= 0.5 / 255 + 1e-6);
      assert.ok(Math.abs(floats[i * 4 + 1]! - parsed.g / 255) <= 0.5 / 255 + 1e-6);
      assert.ok(Math.abs(floats[i * 4 + 2]! - parsed.b / 255) <= 0.5 / 255 + 1e-6);
      assert.ok(Math.abs(floats[i * 4 + 3]! - parsed.a) < 1e-6);
    }
    assert.equal(floats[3], 0); // step 0 is fully transparent
  });
});

describe('GLBackend.create failure modes', () => {
  function canvasWith(context: unknown): ChartCanvas {
    return {
      width: 16,
      height: 16,
      getContext: (contextId: string) => (contextId === 'webgl2' ? context : null),
    } as unknown as ChartCanvas;
  }

  it('returns null when the context is undefined or not a GL context', () => {
    assert.equal(GLBackend.create(canvasWith(undefined)), null);
    assert.equal(GLBackend.create(canvasWith({})), null); // no createShader method
  });

  it('returns null when only the fragment shader fails to compile', () => {
    class FragmentFailGL extends MockContextWebGL2 {
      private readonly shaderTypes = new Map<unknown, number>();
      override createShader(type: number): unknown {
        const shader = super.createShader(type);
        this.shaderTypes.set(shader, type);
        return shader;
      }
      override getShaderParameter(shader: unknown, pname: number): unknown {
        if (pname === this.COMPILE_STATUS) return this.shaderTypes.get(shader) !== this.FRAGMENT_SHADER;
        return super.getShaderParameter(shader, pname);
      }
    }
    assert.equal(GLBackend.create(canvasWith(new FragmentFailGL())), null);
  });

  it('returns null when pipeline setup throws', () => {
    class ThrowingGL extends MockContextWebGL2 {
      override createVertexArray(): unknown {
        throw new Error('context lost');
      }
    }
    assert.equal(GLBackend.create(canvasWith(new ThrowingGL())), null);
  });
});

describe('GLBackend frame lifecycle', () => {
  it('keeps the canvas size when resize is a no-op and composites nothing without quads', () => {
    const canvas = new MockGLCanvas(32, 24);
    const backend = GLBackend.create(canvas)!;
    assert.ok(backend !== null);
    backend.resize(32, 24); // same size: no backing-store reset
    assert.equal(canvas.width, 32);
    assert.equal(canvas.height, 24);
    backend.resize(40, 24); // width only
    backend.resize(40, 30); // height only
    assert.equal(canvas.width, 40);
    assert.equal(canvas.height, 30);
    backend.resize(32, 24);
    const frame = backend.beginFrame(1, 32, 24);
    const ctx = new MockContext2D();
    frame.composite(ctx); // no quads submitted: flush is a no-op, no drawImage
    assert.equal(ctx.countCalls('drawImage'), 0);
    backend.dispose();
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  });
});
