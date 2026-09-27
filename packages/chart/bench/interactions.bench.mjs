/** Real canvas and rAF measurements; frame intervals are not compositor FPS. */
export async function runInteractions({ base = '/dist/', frames = 90 } = {}) {
  const { createChart } = await import(`${base}index.js`);
  const data = Array.from({ length: 100_000 }, (_, i) => {
    const p = 100 + Math.sin(i / 25) * 20 + Math.cos(i / 7) * 3;
    return { time: 1700000000 + i * 60, open: p, high: p + 1.5, low: p - 1.5,
      close: p + (i % 2 ? -0.4 : 0.4), volume: 1000 + i % 500 };
  });
  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted.at(-1) };
  };
  const results = [];
  for (const pixelRatio of [1, 2]) for (const visible of [200, 5000]) {
    const canvas = document.createElement('canvas');
    const width = visible === 5000 ? 2564 : 1264, height = 900;
    canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;
    canvas.style.cssText = `width:${width}px;height:${height}px`;
    document.body.append(canvas);
    const start = performance.now();
    const chart = createChart({ container: canvas, pixelRatio, config: { data, wasm: true,
      statusLine: { visible: true, indicators: true },
      indicators: ['sma', 'boll', 'kdj', 'vol'].map(name => ({ id: name, name,
        params: { period: 50 }, colors: [], visible: true, pane: ['sma', 'boll'].includes(name) ? 'main' : 'sub' })),
    } });
    await chart.ready;
    const initializeMs = performance.now() - start;
    chart.scale.zoomToRange(data.length - visible, data.length - 1);
    const drawing = chart.addDrawing({ name: 'fib', points: [{ index: data.length - 100, price: 80 }, { index: data.length - 1, price: 125 }] });
    const range = chart.scale.visibleRange();
    const coldPointerStart = performance.now();
    chart.setCrosshair(100, 100);
    const coldPointerMs = performance.now() - coldPointerStart;
    chart.clearCrosshair();
    const jobs = {
      redraw: () => chart.render(),
      pointer: i => chart.setCrosshair(50 + i % 1000, 120 + i % 100),
      pan: i => chart.scale.scrollBy(i % 2 ? 1 : -1),
      zoom: i => chart.scale.zoom(i % 2 ? 1.01 : 1 / 1.01, width / 2),
      drawing: i => chart.batch(() => {
        chart.setCrosshair(100 + i, 200);
        chart.updateDrawing(drawing, { points: [{ index: data.length - 100, price: 80 + i % 10 / 10 }, { index: data.length - 1, price: 125 }] });
      }),
      live: i => chart.appendData({ ...data.at(-1), close: 100 + i % 10 / 10 }),
      theme: i => chart.updateConfig({ theme: { background: i % 2 ? '#ffffff' : '#fefefe' } }),
    };
    for (const [workload, fn] of Object.entries(jobs)) {
      for (let i = 0; i < 10; i++) fn(i);
      const cpu = [], intervals = [];
      let previous;
      for (let i = 0; i < frames; i++) await new Promise(resolve => requestAnimationFrame(time => {
        if (previous !== undefined) intervals.push(time - previous);
        previous = time;
        const before = performance.now(); fn(i); cpu.push(performance.now() - before);
        resolve();
      }));
      results.push({ pixelRatio, visible: range.to - range.from, workload, initializeMs, coldPointerMs,
        cpuMs: summarize(cpu), frameIntervalMs: summarize(intervals), framesOver25Ms: intervals.filter(ms => ms > 25).length });
    }
    if (canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] !== 255) throw new Error('Unpainted chart');
    chart.destroy(); canvas.remove();
  }
  return { userAgent: navigator.userAgent, storedCandles: data.length, frames, results };
}
