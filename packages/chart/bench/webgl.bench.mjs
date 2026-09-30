/**
 * CPU submission time of the Canvas2D vs WebGL2 backends on recording
 * contexts (MockContext2D / MockContextWebGL2), NOT GPU raster time or
 * display FPS. The WebGL2 numbers cover quad packing and buffer staging; in a
 * browser the rasterization the recording canvas skips here moves to the GPU.
 */
import { bench, candles, load } from './harness.mjs';
const { createChart } = await load('index.js');
const { MockDocument, MockGLDocument } = await load('dom.js');

const data = candles(100_000);
console.log('\nBackend benchmark (CPU submission; recording 2D context vs mock GL):');

function depthBook(timeMs) {
  const bids = [];
  const asks = [];
  for (let j = 0; j < 50; j++) {
    bids.push([103.5 - j * 0.25, (j + 1) * 3]);
    asks.push([104.5 + j * 0.25, (j + 1) * 2]);
  }
  return { bids, asks, time: timeMs };
}

for (const visible of [200, 5000, 20000]) {
  // The minimum spacing is 0.5px/bar; size the canvas for the requested range.
  const width = Math.max(1264, Math.ceil(visible * 0.5) + 64);
  for (const [label, makeDoc, renderer] of [
    ['canvas2d', () => new MockDocument(), undefined],
    ['webgl2', () => new MockGLDocument(), 'webgl2'],
  ]) {
    const doc = makeDoc();
    const chart = createChart({ document: doc, ...(renderer !== undefined ? { renderer } : {}),
      config: { width, height: 900, data, wasm: false } });
    chart.scale.zoomToRange(data.length - visible, data.length - 1);
    const ctx = doc.created[0].context;
    if (renderer !== undefined && chart.renderBackend !== 'webgl2') throw new Error('expected the webgl2 backend');
    bench(`${visible} bars ${label}: full redraw`, () => { ctx.calls.length = 0; chart.render(); });
    chart.destroy();
  }
}

console.log('\nBackend benchmark with heatmap (500 buckets x 2 x 50 levels visible):');
for (const [label, makeDoc, renderer] of [
  ['canvas2d', () => new MockDocument(), undefined],
  ['webgl2', () => new MockGLDocument(), 'webgl2'],
]) {
  const doc = makeDoc();
  const chart = createChart({ document: doc, ...(renderer !== undefined ? { renderer } : {}),
    config: { width: 2564, height: 900, data, wasm: false, heatmap: { enabled: true } } });
  chart.scale.zoomToRange(data.length - 500, data.length - 1);
  const end = data[data.length - 1].time * 1000;
  for (let k = 500; k >= 1; k--) chart.setDepth(depthBook(end - k * 1000));
  const ctx = doc.created[0].context;
  bench(`heatmap ${label}: full redraw`, () => { ctx.calls.length = 0; chart.render(); });
  chart.destroy();
}
