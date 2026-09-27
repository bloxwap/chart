/** All built-in series and indicators, including the streaming path. Mock CPU only. */
import { bench, candles, load } from './harness.mjs';
const { createChart } = await load('index.js');
const { MockCanvas } = await load('dom.js');
const data = candles(100_000);
console.log('\nAll built-in series and streaming indicators (100k stored candles):');
for (const visible of [200, 5000]) for (const type of ['candlestick', 'bar', 'line', 'area', 'histogram']) {
  const canvas = new MockCanvas(visible === 5000 ? 2564 : 1264, 900);
  const chart = createChart({ container: canvas, config: { data, wasm: false, series: { type } } });
  chart.scale.zoomToRange(data.length - visible, data.length - 1);
  bench(`${visible} visible: ${type} redraw`, () => { canvas.context.calls.length = 0; chart.render(); });
  chart.destroy();
}
for (const name of ['sma', 'ema', 'boll', 'macd', 'rsi', 'kdj', 'vol']) {
  const canvas = new MockCanvas(1264, 900);
  const chart = createChart({ container: canvas, config: { data, wasm: true } });
  await chart.ready;
  chart.addIndicator({ name });
  let tick = 0;
  bench(`200 visible: live ${name}`, () => {
    canvas.context.calls.length = 0;
    chart.appendData({ ...data.at(-1), close: 100 + ++tick % 10 / 10 });
  });
  chart.destroy();
}
