/** Pixel comparisons against the uncached renderer, on actual Canvas 2D. */
export async function verifyBrowser() {
  // Keep all comparison canvases on the same raster backend. Repeated
  // getImageData otherwise switches only the reference to software rendering.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, options) {
    return getContext.call(this, type, { ...options, willReadFrequently: true });
  };
  try {
  const { createChart } = await import('/dist/index.js');
  const data = Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 100 + i % 11,
    close: 100 + i % 13, high: 115, low: 90, volume: i * 10 }));
  let comparisons = 0;
  let maxChannelDelta = 0;
  for (const pixelRatio of [1, 2]) for (const position of ['left', 'right']) for (const colorSpace of ['srgb', 'display-p3']) {
    const make = crosshairCache => {
      const canvas = document.createElement('canvas');
      canvas.width = 640 * pixelRatio; canvas.height = 400 * pixelRatio;
      canvas.getContext('2d', { colorSpace });
      document.body.append(canvas);
      const chart = createChart({ container: canvas, pixelRatio, crosshairCache,
        config: { data, wasm: false, priceAxis: { position }, statusLine: { visible: true, indicators: true },
          indicators: [{ id: 'v', name: 'vol', params: {}, colors: [], pane: 'sub', visible: true }] } });
      chart.addDrawing({ id: 'line', name: 'trendline', points: [{ index: 155, price: 92 }, { index: 195, price: 110 }] });
      chart.selectDrawing('line');
      return { canvas, chart };
    };
    const cached = make(true), direct = make(false);
    const compare = label => {
      const a = cached.canvas.getContext('2d').getImageData(0, 0, cached.canvas.width, cached.canvas.height, { colorSpace }).data;
      const b = direct.canvas.getContext('2d').getImageData(0, 0, direct.canvas.width, direct.canvas.height, { colorSpace }).data;
      for (let i = 0; i < a.length; i++) {
        const delta = Math.abs(a[i] - b[i]);
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > 0) throw new Error(`Pixel mismatch: ${label}, DPR ${pixelRatio}, ${position}, byte ${i}: ${a[i]} != ${b[i]}`);
      }
      comparisons++;
    };
    const both = (fn, label) => {
      fn(cached.chart); fn(direct.chart);
      compare(label);
      cached.chart.setCrosshair(222, 100); direct.chart.setCrosshair(222, 100); compare(`${label} pointer`);
      cached.chart.setCrosshair(223, 101); direct.chart.setCrosshair(223, 101); compare(`${label} cached pointer`);
    };
    for (const mode of ['cross', 'arrow', 'dot', 'demonstration']) {
      both(chart => chart.updateConfig({ crosshair: { mode } }), mode);
      for (const [x, y] of [[120, 60], [300, 310], [600, 390], [-5, 30]]) {
        both(chart => chart.setCrosshair(x, y), `${mode} move`);
      }
      both(chart => chart.clearCrosshair(), `${mode} clear`);
    }
    for (const type of ['candlestick', 'bar', 'line', 'area', 'histogram']) both(chart => chart.updateConfig({ series: { type } }), type);
    both(chart => chart.scale.scrollBy(10), 'pan');
    both(chart => chart.scale.zoom(1.2, 180), 'zoom');
    both(chart => chart.appendData({ ...data.at(-1), close: 130 }), 'live');
    both(chart => chart.setData(data.slice(50)), 'replace');
    both(chart => chart.updateDrawing('line', { color: 'red' }), 'drawing');
    both(chart => chart.updateConfig({ theme: { background: '#ffffff' } }), 'theme');
    for (const mode of ['logarithmic', 'percent', 'indexed']) both(chart => chart.updateConfig({ priceAxis: { mode } }), mode);
    both(chart => chart.resize(700, 450, pixelRatio), 'resize');
    for (const { chart, canvas } of [cached, direct]) { chart.destroy(); canvas.remove(); }
  }
  return { pixelComparisons: comparisons, maxChannelDelta };
  } finally { HTMLCanvasElement.prototype.getContext = getContext; }
}
