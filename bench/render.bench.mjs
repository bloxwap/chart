/**
 * Render-loop benchmark: frames/sec drawing 5k visible candles (plus SMA, VOL,
 * and a Fibonacci drawing) into a recording MockDocument canvas.
 */
import { performance } from 'node:perf_hooks';
import { createChart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';

const N = 5000;
const candles = Array.from({ length: N }, (_, i) => {
  const base = 100 + Math.sin(i / 25) * 20 + Math.cos(i / 7) * 3;
  return { time: 1700000000 + i * 60, open: base, high: base + 1.5, low: base - 1.5, close: base + 0.4, volume: 1000 + (i % 500) };
});

const doc = new MockDocument();
const chart = createChart({
  document: doc,
  config: {
    width: 1600,
    height: 900,
    wasm: true,
    data: candles,
    watermark: { visible: true, text: 'BENCH' },
  },
});
await chart.ready;
chart.addIndicator({ name: 'sma', params: { period: 50 } });
chart.addIndicator({ name: 'vol' });
chart.addDrawing({ name: 'fib', points: [{ index: 100, price: 80 }, { index: 4900, price: 125 }] });

const FRAMES = 300;
// warmup
for (let i = 0; i < 10; i++) chart.render();
const start = performance.now();
for (let i = 0; i < FRAMES; i++) chart.render();
const elapsed = performance.now() - start;
const fps = (FRAMES / elapsed) * 1000;
console.log(`render bench: ${N.toLocaleString()} visible candles at 1600x900\n`);
console.log(`${'full frame (all layers)'.padEnd(28)} ${fps.toFixed(1).padStart(12)} frames/sec  (${FRAMES} frames in ${elapsed.toFixed(0)}ms)`);

// zoomed render (200 bars) for comparison
chart.scale.zoom(25);
for (let i = 0; i < 10; i++) chart.render();
const start2 = performance.now();
for (let i = 0; i < FRAMES; i++) chart.render();
const elapsed2 = performance.now() - start2;
console.log(`${'200-bar zoomed frame'.padEnd(28)} ${((FRAMES / elapsed2) * 1000).toFixed(1).padStart(12)} frames/sec  (${FRAMES} frames in ${elapsed2.toFixed(0)}ms)`);
chart.destroy();
