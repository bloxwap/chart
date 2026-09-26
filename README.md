# chart-ts

Zero-dependency, WASM+SIMD-accelerated candlestick/financial charting library in strict TypeScript, with an injected DOM so it runs in browsers, workers, SSR, and tests.

## Features

- **Zero runtime dependencies** — pure ESM, `sideEffects: false`, tree-shakable
- **WASM + SIMD kernels** for hot math paths with automatic scalar-JS fallback
- **One consolidated config** — a single `ChartConfig` object describes data, panes, series, indicators, drawings, axes, crosshair, grid, theme, watermark, and formatters
- **Injected DOM ("ABI document injection")** — the library never touches global `document`/`window`; inject a canvas or a `ChartDocument`
- **Display-P3 wide-gamut colors** — `color(display-p3 r g b / a)`, hex, and rgb(a) flow straight to the canvas
- **Indicators** — SMA, EMA, BOLL, MACD, RSI, KDJ, VOL built in, plus a registry for custom ones
- **Drawings** — trend line, horizontal line, rectangle, Fibonacci retracement, plus a registry for custom models
- **Watermark** — text and/or image layer rendered under the series
- **100% test coverage** enforced by `npm run coverage`

## Quick start

```ts
import { createChart, defineConfig } from 'chart-ts';

const config = defineConfig({
  data: candles, // [{ time, open, high, low, close, volume? }] — UNIX seconds
  series: { type: 'candlestick', upColor: 'color(display-p3 0 1 0.5)', downColor: '#ef5350' },
  watermark: { visible: true, text: 'ACME', opacity: 0.08 },
});

const chart = createChart({ container: document.querySelector('canvas')!, config });
await chart.ready; // WASM kernels live (or JS fallback chosen)

chart.addIndicator({ name: 'sma', params: { period: 20 } });
chart.addIndicator({ name: 'macd' }); // own sub-pane
chart.addDrawing({ name: 'fib', points: [{ index: 10, price: 95 }, { index: 90, price: 110 }] });

chart.scale.zoom(1.2, 300); // pinch/scroll handlers call these
chart.scale.scrollBy(5);
chart.setCrosshair(x, y); // pointermove
chart.resize(w, h, window.devicePixelRatio); // ResizeObserver — CSS px in, HiDPI handled
chart.destroy();
```

Headless (SSR/tests/workers):

```ts
import { createChart, MockDocument } from 'chart-ts';
const chart = createChart({ document: new MockDocument(), config: { data: candles } });
```

Custom indicators and drawings:

```ts
chart.indicators.register({ name: 'my-ind', defaultParams: {}, defaultColors: ['#fff'], defaultPane: 'sub', compute: (candles, params, colors, kernels) => ({ pane: 'sub', lines: [/* ... */] }) });
chart.drawings.register({ name: 'my-drawing', minPoints: 2, geometry: (points, view) => [/* pixel primitives */] });
```

## Scripts

- `npm run build` — compile WASM (wabt → embedded base64) + TypeScript
- `npm test` — build and run the test suite (node:test)
- `npm run coverage` — tests with 100% line/branch/function threshold enforcement
- `npm run bench` — indicator math (WASM vs scalar) and render-loop benchmarks

## License

MIT
