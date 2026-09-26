import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_THEMES, createChart } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

const data: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time: 1700000000 + i * 60, open: 10, high: 11, low: 9, close: 10.5 }));

/** A canvas attached to a fake page: parent box, style, and a window whose ResizeObserver we drive. */
function attached(options: { width?: number; height?: number; dpr?: number; position?: string } = {}) {
  const observers: { callback: () => void; targets: unknown[]; disconnected: boolean }[] = [];
  class FakeResizeObserver {
    readonly entry: (typeof observers)[number];
    constructor(callback: () => void) {
      this.entry = { callback, targets: [], disconnected: false };
      observers.push(this.entry);
    }
    observe(target: unknown): void {
      this.entry.targets.push(target);
    }
    disconnect(): void {
      this.entry.disconnected = true;
    }
  }
  const parent = { clientWidth: options.width ?? 640, clientHeight: options.height ?? 360, style: { position: '' } };
  const view = {
    ResizeObserver: FakeResizeObserver,
    ...(options.dpr === undefined ? {} : { devicePixelRatio: options.dpr }),
    getComputedStyle: () => ({ position: options.position ?? 'static' }),
  };
  const canvas = Object.assign(new MockCanvas(), {
    ownerDocument: { defaultView: view },
    parentElement: parent,
    style: { position: '', inset: '', width: '', height: '', display: '' },
  });
  return { canvas, parent, observers };
}

describe('createChart theme option', () => {
  it('applies the theme under config, with config winning', () => {
    const dark = createChart({ container: new MockCanvas(800, 400), theme: 'dark', config: { wasm: false } });
    assert.equal(dark.getConfig().theme.background, CHART_THEMES.dark.theme!.background);
    const override = createChart({ container: new MockCanvas(800, 400), theme: 'dark', config: { wasm: false, theme: { background: '#123456' } } });
    assert.equal(override.getConfig().theme.background, '#123456');
    assert.equal(override.getConfig().theme.textColor, CHART_THEMES.dark.theme!.textColor);
    const bare = createChart({ container: new MockCanvas(800, 400), theme: 'light' });
    assert.equal(bare.getConfig().theme.background, CHART_THEMES.light.theme!.background);
    for (const c of [dark, override, bare]) c.destroy();
  });
});

describe('createChart autoResize', () => {
  it('fills the parent, sizes to it at the device pixel ratio, and follows resizes', () => {
    const { canvas, parent, observers } = attached({ dpr: 2 });
    const chart = createChart({ container: canvas, autoResize: true, config: { wasm: false, data } });
    assert.deepEqual(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    assert.equal(parent.style.position, 'relative', 'a static parent becomes the positioning context');
    assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
    assert.equal(observers.length, 1);
    assert.deepEqual(observers[0]!.targets, [parent]);
    parent.clientWidth = 500;
    parent.clientHeight = 300;
    observers[0]!.callback();
    assert.deepEqual([canvas.width, canvas.height], [1000, 600]);
    chart.destroy();
    assert.equal(observers[0]!.disconnected, true);
    chart.destroy(); // idempotent
  });
  it('keeps a positioned parent and defaults the pixel ratio to 1', () => {
    const { canvas, parent } = attached({ position: 'relative' });
    const chart = createChart({ container: canvas, autoResize: true, config: { wasm: false } });
    assert.equal(parent.style.position, '');
    assert.deepEqual([canvas.width, canvas.height], [640, 360]);
    chart.destroy();
  });
  it('explains what it needs when the canvas is not attached', () => {
    const message = /autoResize needs a container canvas attached to a parent/;
    assert.throws(() => createChart({ container: new MockCanvas(), autoResize: true, config: { wasm: false } }), message);
    const noObserver = attached();
    (noObserver.canvas.ownerDocument.defaultView as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    assert.throws(() => createChart({ container: noObserver.canvas, autoResize: true, config: { wasm: false } }), message);
    const detached = Object.assign(new MockCanvas(), { ownerDocument: { defaultView: attached().canvas.ownerDocument.defaultView }, parentElement: null });
    assert.throws(() => createChart({ container: detached, autoResize: true, config: { wasm: false } }), message);
    const noStyle = Object.assign(new MockCanvas(), { ownerDocument: attached().canvas.ownerDocument, parentElement: attached().parent });
    assert.throws(() => createChart({ container: noStyle, autoResize: true, config: { wasm: false } }), message);
    const noDocument = Object.assign(new MockCanvas(), { ownerDocument: null, parentElement: attached().parent });
    assert.throws(() => createChart({ container: noDocument, autoResize: true, config: { wasm: false } }), message);
  });
});
