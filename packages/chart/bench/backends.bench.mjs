/** Real Canvas2D/WebGL2 pan/zoom, with a full day of time-bucketed depth. */
export async function runBackends({ frames = 90 } = {}) {
  if (!Number.isInteger(frames) || frames < 3) throw new Error('frames must be an integer >= 3');
  const { createChart, attachHeatmap, DepthHistory } = await import('/dist/index.js');
  const data = Array.from({ length: 1440 }, (_, i) => ({
    time: 1700000040 + i * 60, open: 100, high: 113, low: 87,
    close: 100 + Math.sin(i / 10), volume: 100,
  }));
  const summarize = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
  };
  const results = [];
  for (const buckets of [10, 500, 1440]) for (const renderer of ['canvas2d', 'webgl2']) {
    const canvas = document.createElement('canvas');
    canvas.width = 1264; canvas.height = 900;
    document.body.append(canvas);
    const chart = createChart({ container: canvas, renderer, pixelRatio: 1,
      config: { data, wasm: false, heatmap: { enabled: false, bucketMs: 60000, maxBuckets: buckets, maxLevels: 50 } } });
    const history = new DepthHistory({ bucketMs: 60000, maxBuckets: buckets, maxLevels: 50 });
    const heatmap = attachHeatmap(chart, { history });
    try {
      if (chart.renderBackend !== renderer) throw new Error(`Requested ${renderer}, got ${chart.renderBackend}`);
      chart.batch(() => {
        for (let i = 0; i < buckets; i++) {
          const bids = [], asks = [];
          for (let j = 0; j < 50; j++) {
            bids.push([99.75 - j * .25, 1 + (i * 7 + j * 11) % 100]);
            asks.push([100.25 + j * .25, 1 + (i * 11 + j * 7) % 100]);
          }
          const book = { time: data[data.length - buckets + i].time * 1000, bids, asks };
          history.record(book);
          chart.setDepth(book);
        }
      });
      chart.scale.zoomToRange(data.length - buckets, data.length - 1);
      if (history.length !== buckets) throw new Error('Incomplete retained depth history');
      for (const [workload, run] of Object.entries({
        pan: i => chart.scale.scrollBy(i % 2 ? 1 : -1),
        zoom: i => chart.scale.zoom(i % 2 ? 1.01 : 1 / 1.01, 600),
      })) {
        for (let i = 0; i < 10; i++) run(i);
        const cpu = [], intervals = [];
        let previous;
        for (let i = 0; i < frames; i++) await new Promise(resolve => requestAnimationFrame(time => {
          if (previous !== undefined) intervals.push(time - previous);
          previous = time;
          const start = performance.now(); run(i); cpu.push(performance.now() - start);
          resolve();
        }));
        const frameIntervalMs = summarize(intervals);
        results.push({ renderer, workload, retainedDepthPoints: buckets * 100, buckets,
          bucketMs: 60000, sessionHours: buckets / 60, visibleBars: chart.scale.visibleRange().to - chart.scale.visibleRange().from,
          cpuMs: summarize(cpu), frameIntervalMs,
          animationFps: 1000 / (intervals.reduce((sum, ms) => sum + ms, 0) / intervals.length),
          framesOver25Ms: intervals.filter(ms => ms > 25).length });
      }
    } finally { heatmap.remove(); chart.destroy(); canvas.remove(); }
  }
  return { userAgent: navigator.userAgent, frames, pixelRatio: 1,
    measurement: 'CPU submission and animation-frame cadence; not compositor FPS or GPU raster time', results };
}
