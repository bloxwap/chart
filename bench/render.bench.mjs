/** CPU submission time on a recording canvas, NOT browser rasterization/FPS. */
import { bench, candles, load } from './harness.mjs';
const { createChart } = await load('index.js');
const { MockDocument } = await load('dom.js');
const data = candles(100_000);
console.log('\nRender CPU benchmark (100k stored candles; bounded recording buffer):');

for (const visible of [200, 5000]) {
  // The minimum spacing is 0.5px/bar; 5000 bars need at least 2500px.
  const doc = new MockDocument();
  const chart = createChart({ document: doc, config: {
    width: visible === 5000 ? 2564 : 1264, height: 900, data, wasm: true,
    indicators: ['sma', 'boll', 'kdj', 'vol'].map((name) => ({
      id: name, name, params: { period: 50 }, colors: [], visible: true,
      pane: name === 'sma' || name === 'boll' ? 'main' : 'sub',
    })),
  } });
  await chart.ready;
  chart.scale.zoomToRange(data.length - visible, data.length - 1);
  chart.addDrawing({ name: 'fib', points: [{ index: data.length - 100, price: 80 }, { index: data.length - 1, price: 125 }] });
  const ctx = doc.created[0].context;
  const range = chart.scale.visibleRange();
  console.log(`  requested ${visible} bars; actual range ${range.from}..${range.to} (${range.to - range.from} including edge overscan)`);
  const run = (fn) => () => { ctx.calls.length = 0; fn(); };
  bench(`${visible} bars: full redraw + 4 indicators`, run(() => chart.render()));
  let x = 0;
  bench(`${visible} bars: crosshair + 4 indicators`, run(() => chart.setCrosshair(++x % 1000, 200)));
  chart.destroy();
}

const doc = new MockDocument();
const chart = createChart({ document: doc, config: { width: 1264, height: 900, data, wasm: false, series: { type: 'histogram' } } });
const ctx = doc.created[0].context;
bench('200 bars: volume series, 100k history', () => { ctx.calls.length = 0; chart.render(); });
chart.destroy();
