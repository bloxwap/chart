import { createChart } from '../dist/index.js';

/** Real-canvas CPU submission timings. These do not measure compositor FPS. */
export async function runBrowserBenchmark() {
  const data = Array.from({ length: 100_000 }, (_, i) => {
    const base = 100 + Math.sin(i / 25) * 20 + Math.cos(i / 7) * 3;
    return { time: 1700000000 + i * 60, open: base, high: base + 1.5, low: base - 1.5,
      close: base + (i % 2 ? -0.4 : 0.4), volume: 1000 + (i % 500) };
  });
  const results = [];
  const measure = async (label, fn) => {
    for (let i = 0; i < 5; i++) fn();
    const samples = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      for (let i = 0; i < 10; i++) fn();
      samples.push((performance.now() - start) / 10);
    }
    samples.sort((a, b) => a - b);
    results.push({ label, medianMs: samples[2], minMs: samples[0], maxMs: samples[4] });
  };
  for (const visible of [200, 5000]) {
    const canvas = document.createElement('canvas');
    canvas.width = visible === 5000 ? 2564 : 1264;
    canvas.height = 900;
    canvas.style.width = '100%';
    document.body.append(canvas);
    const chart = createChart({ container: canvas, config: { data, wasm: true,
      indicators: ['sma', 'boll', 'kdj', 'vol'].map((name) => ({ id: name, name,
        params: { period: 50 }, colors: [], visible: true,
        pane: name === 'sma' || name === 'boll' ? 'main' : 'sub' })),
    } });
    await chart.ready;
    chart.scale.zoomToRange(data.length - visible, data.length - 1);
    chart.addDrawing({ name: 'fib', points: [{ index: data.length - 100, price: 80 }, { index: data.length - 1, price: 125 }] });
    let x = 0;
    await measure(`${visible} bars: redraw`, () => chart.render());
    await measure(`${visible} bars: pointer`, () => chart.setCrosshair(++x % 1000, 200));
    if (visible === 200) {
      await measure('200 bars: pan', () => chart.scale.scrollBy(++x % 2 ? 1 : -1));
      await measure('200 bars: live last-bar update', () => chart.appendData({ ...data[data.length - 1], close: 100 + (++x % 10) / 10 }));
      await measure('200 bars: theme update', () => chart.updateConfig({ theme: { background: ++x % 2 ? '#ffffff' : '#fefefe' } }));
    }
    const pixel = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
    if (pixel[3] !== 255) throw new Error('Canvas did not paint an opaque background');
    chart.destroy();
    canvas.remove();
  }
  return { userAgent: navigator.userAgent, storedCandles: data.length, results };
}
