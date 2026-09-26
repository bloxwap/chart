import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SmoothZoom, type FrameScheduler, type SmoothZoomOptions } from '../dist/core/zoom.js';
import { TimeScale, MIN_BAR_SPACING, MAX_BAR_SPACING } from '../dist/core/scale.js';
import { createChart } from '../dist/core/chart.js';
import { MockCanvas } from '../dist/dom.js';

class Frames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = this.seq++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 1000 / 60) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) {
      if (this.callbacks.delete(id)) callback(this.time);
    }
  }
  settle() {
    let count = 0;
    while (this.callbacks.size > 0 && count++ < 200) this.tick();
    assert.equal(this.callbacks.size, 0, 'animation must settle');
  }
}

function fixture(options?: SmoothZoomOptions) {
  const frames = new Frames();
  const scale = new TimeScale(6, 1200);
  scale.scrollOffset = 1000;
  let paints = 0;
  const zoom = new SmoothZoom({
    indexToX: (i) => scale.indexToX(i, 100_000),
    zoom: (factor, anchor) => { scale.zoom(factor, 100_000, anchor); paints++; },
  }, frames, options);
  return { frames, scale, zoom, paints: () => paints };
}
const close = (actual: number, expected: number, eps = 1e-8) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} vs ${expected}`);

describe('SmoothZoom', () => {
  it('coalesces a wheel burst into one eased step per frame', () => {
    const { zoom, frames, scale, paints } = fixture();
    for (let i = 0; i < 20; i++) zoom.wheel({ deltaY: -2, deltaMode: 0 }, 600, 800);
    assert.equal(paints(), 0);
    assert.equal(frames.callbacks.size, 1);
    frames.tick();
    assert.equal(paints(), 1);
    assert.ok(scale.barSpacing > 6 && scale.barSpacing < 6 * Math.exp(0.08));
    frames.settle();
    close(scale.barSpacing, 6 * Math.exp(0.08));
  });

  it('preserves the fractional bar under the cursor throughout a zoom and its inverse', () => {
    const { zoom, frames, scale } = fixture();
    const anchor = 417.25;
    const index = scale.xToFloatIndex(anchor, 100_000);
    zoom.zoomBy(2, anchor);
    for (let i = 0; i < 50; i++) {
      frames.tick();
      close(scale.indexToX(index, 100_000), anchor);
    }
    close(scale.barSpacing, 12);
    zoom.zoomBy(0.5, anchor);
    frames.settle();
    close(scale.barSpacing, 6);
    close(scale.indexToX(index, 100_000), anchor);
  });

  it('normalizes pixel, line, page, and pinch input with reciprocal directions', () => {
    for (const [deltaY, deltaMode] of [[-32, 0], [-2, 1], [-0.04, 2], [-32, 99]]) {
      const { zoom, frames, scale } = fixture({ timeConstant: 0 });
      zoom.wheel({ deltaY: deltaY!, deltaMode: deltaMode! }, 400, 800);
      frames.tick();
      close(scale.barSpacing, 6 * Math.exp(0.064));
      zoom.wheel({ deltaY: -deltaY!, deltaMode: deltaMode! }, 400, 800);
      frames.tick();
      close(scale.barSpacing, 6);
    }
    const { zoom, frames, scale } = fixture({ timeConstant: 0 });
    zoom.wheel({ deltaY: -8, deltaMode: 0, ctrlKey: true }, 400, 800);
    frames.tick();
    close(scale.barSpacing, 6 * Math.exp(0.064));
  });

  it('bounds huge wheel events and ignores zero/nonfinite events', () => {
    const { zoom, frames, scale } = fixture({ timeConstant: 0 });
    for (const deltaY of [0, NaN, Infinity, -Infinity]) zoom.wheel({ deltaY, deltaMode: 0 }, 400, 800);
    for (const factor of [0, 1, -1, NaN, Infinity]) zoom.zoomBy(factor, 400);
    zoom.zoomBy(2, NaN);
    assert.equal(frames.callbacks.size, 0);
    zoom.wheel({ deltaY: -1e8, deltaMode: 0 }, 400, 800);
    frames.tick();
    close(scale.barSpacing, 6 * Math.exp(0.24));
    zoom.wheel({ deltaY: 1e8, deltaMode: 0 }, 400, 800);
    frames.tick();
    close(scale.barSpacing, 6);
  });

  it('uses elapsed time, giving equal progress at 60Hz and 120Hz', () => {
    const a = fixture(), b = fixture();
    a.zoom.zoomBy(2, 600); b.zoom.zoomBy(2, 600);
    for (let i = 0; i < 6; i++) a.frames.tick(1000 / 60);
    for (let i = 0; i < 12; i++) b.frames.tick(1000 / 120);
    close(a.scale.barSpacing, b.scale.barSpacing);
    a.frames.settle(); b.frames.settle();
    close(a.scale.barSpacing, 12); close(b.scale.barSpacing, 12);
  });

  it('reverses immediately after movement without accumulating overshoot at limits', () => {
    const { zoom, frames, scale } = fixture();
    zoom.zoomBy(2, 500);
    frames.tick();
    const beforeReverse = scale.barSpacing;
    zoom.zoomBy(0.9, 500);
    frames.tick();
    assert.ok(scale.barSpacing < beforeReverse);
    frames.settle();
    close(scale.barSpacing, beforeReverse * 0.9);
    for (const target of [MAX_BAR_SPACING, MIN_BAR_SPACING]) {
      zoom.zoomBy(target / scale.barSpacing, 500);
      frames.settle();
      close(scale.barSpacing, target);
      zoom.zoomBy(target === MAX_BAR_SPACING ? 10 : 0.1, 500);
      assert.equal(frames.callbacks.size, 0);
    }
    zoom.zoomBy(1.1, 500);
    frames.tick();
    assert.ok(scale.barSpacing > MIN_BAR_SPACING);
  });

  it('cancels opposite deltas before the first frame', () => {
    const { zoom, frames, paints } = fixture();
    zoom.zoomBy(2, 500); zoom.zoomBy(0.5, 500);
    assert.equal(frames.callbacks.size, 0);
    assert.equal(paints(), 0);
  });

  it('supports explicit cancellation and destruction, including stale callbacks', () => {
    const { zoom, frames, scale, paints } = fixture();
    zoom.zoomBy(2, 500);
    zoom.cancel(); zoom.cancel();
    frames.tick();
    assert.equal(paints(), 0);
    zoom.zoomBy(2, 500);
    const callback = [...frames.callbacks.values()][0]!;
    zoom.destroy();
    callback(100);
    zoom.zoomBy(2, 500);
    frames.tick();
    assert.equal(paints(), 0);
    assert.equal(scale.barSpacing, 6);
  });

  it('honors external zooms and resynchronizes on fresh input', () => {
    const { zoom, frames, scale, paints } = fixture();
    zoom.zoomBy(2, 500);
    scale.zoom(3, 100_000, 500);
    frames.tick();
    assert.equal(paints(), 0);
    close(scale.barSpacing, 18);
    zoom.zoomBy(2, 500);
    scale.zoom(0.5, 100_000, 500);
    zoom.zoomBy(2, 500);
    frames.settle();
    close(scale.barSpacing, 18);
    zoom.zoomBy(2, 500);
    scale.scroll(10, 100_000);
    const painted = paints();
    frames.tick();
    assert.equal(paints(), painted);
    assert.equal(frames.callbacks.size, 0);
  });

  it('does no work at a zero elapsed frame and settles after a long pause', () => {
    const { zoom, frames, scale, paints } = fixture();
    zoom.zoomBy(2, 500);
    frames.tick(0);
    assert.equal(paints(), 0);
    frames.tick(50_000);
    assert.equal(paints(), 1);
    close(scale.barSpacing, 12);
    assert.equal(frames.callbacks.size, 0);
  });

  it('supports onFrame cancellation, destruction and new zoom requests', () => {
    const a = fixture({ onFrame: () => a.zoom.cancel() });
    a.zoom.zoomBy(2, 500); a.frames.tick();
    assert.equal(a.frames.callbacks.size, 0);
    const b = fixture({ onFrame: () => b.zoom.destroy() });
    b.zoom.zoomBy(2, 500); b.frames.tick();
    assert.equal(b.frames.callbacks.size, 0);
    let called = false;
    const c = fixture({ onFrame: () => {
      if (!called) { called = true; c.zoom.zoomBy(0.8, 500); }
    } });
    c.zoom.zoomBy(2, 500); c.frames.tick();
    assert.equal(c.frames.callbacks.size, 1);
    c.frames.settle();
  });

  it('rejects invalid easing and ignores invalid scale geometry', () => {
    for (const timeConstant of [-1, NaN, Infinity]) {
      assert.throws(() => fixture({ timeConstant }), /timeConstant/);
    }
    for (const spacing of [0, NaN, Infinity, -1]) {
      const frames = new Frames();
      const zoom = new SmoothZoom({ indexToX: (i) => i * spacing, zoom: () => assert.fail() }, frames);
      zoom.zoomBy(2, 500);
      assert.equal(frames.callbacks.size, 0);
    }
    for (const spacing of [0, NaN]) {
      const { zoom, scale, frames, paints } = fixture();
      zoom.zoomBy(2, 500);
      scale.barSpacing = spacing;
      frames.tick();
      assert.equal(paints(), 0);
      assert.equal(frames.callbacks.size, 0);
    }
  });
});

describe('zoom render bounds', () => {
  it('batched eraser samples hit the next drawing without repainting between samples', () => {
    const canvas = new MockCanvas(800, 400);
    const chart = createChart({ container: canvas, config: { wasm: false } });
    const lower = chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 0.5 }] });
    const upper = chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 0.5 }] });
    const y = chart.scale.priceToY(0.5);
    canvas.context.calls.length = 0;
    chart.batch(() => {
      assert.equal(chart.drawingAt(100, y), upper);
      chart.removeDrawing(upper);
      assert.equal(chart.drawingAt(100, y), lower);
      chart.clearDrawings();
      assert.equal(chart.drawingAt(100, y), null);
      assert.equal(canvas.context.calls.length, 0);
    });
    assert.equal(canvas.context.countCalls('scale'), 1);
    chart.destroy();
  });

  it('does not paint unchanged/invalid zooms, clamped zooms, or unchanged sizes', () => {
    const canvas = new MockCanvas(800, 400);
    const chart = createChart({ container: canvas, config: { wasm: false } });
    canvas.context.calls.length = 0;
    for (const factor of [1, 0, -1, NaN, Infinity]) chart.scale.zoom(factor, 200);
    chart.scale.zoom(2, NaN);
    chart.resize(800, 400);
    assert.equal(canvas.context.calls.length, 0);
    chart.scale.zoom(1e6);
    canvas.context.calls.length = 0;
    chart.scale.zoom(2);
    assert.equal(canvas.context.calls.length, 0);
    chart.scale.zoom(1e-6);
    canvas.context.calls.length = 0;
    chart.scale.zoom(0.5);
    assert.equal(canvas.context.calls.length, 0);
    chart.resize(400, 200, 2); // Same backing size, different CSS viewport.
    assert.ok(canvas.context.calls.length > 0);
    chart.resize(401, 200, 2);
    chart.resize(401, 201, 2);
    chart.destroy();
  });
});
