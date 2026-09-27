<h1 align="center">Chart</h1>

<p align="center">
  <strong>Zero-dependency, WASM + SIMD-accelerated
    <a href="https://bloxwap.github.io/chart/">financial charts</a> in TypeScript</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bloxwap/chart"><img alt="npm version" src="https://img.shields.io/npm/v/@bloxwap/chart?color=blue&style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@bloxwap/chart"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@bloxwap/chart.svg?style=flat-square"></a>
  <a href="https://codecov.io/gh/bloxwap/chart"><img alt="Codecov coverage" src="https://img.shields.io/codecov/c/github/bloxwap/chart?branch=main&style=flat-square"></a>
  <a href="https://bundlejs.com/?q=@bloxwap/chart"><img alt="Bundle size" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdeno.bundlejs.com%2F%3Fq%3D%40bloxwap%2Fchart&amp;query=%24.size.compressedSize&amp;label=minzipped+size&amp;style=flat-square&amp;color=blue"></a>
</p>

## Features

- **Zero runtime dependencies** — pure ESM, `sideEffects: false`, tree-shakable.
- **WASM + SIMD kernels** — hot math paths with automatic scalar-JS fallback.
- **Cross-environment** — injected DOM means the library never touches global
  `document`/`window`; it runs in browsers, workers, SSR, and tests.
- **One consolidated config** — a single `ChartConfig` describes data, panes,
  series, indicators, drawings, axes, crosshair, grid, theme, and watermark.
- **20 indicators** — moving averages, Bollinger Bands, VWAP, Ichimoku,
  Supertrend, MACD, RSI, Stochastic, ADX, volume and more, with per-plot
  styling, an indicator dialog, and a registry for custom ones.
- **Paging datafeed** — `@bloxwap/chart/datafeed` pages history in as the user
  scrolls and folds live ticks into bars, replacing a TradingView UDF datafeed.
- **TradingView parity** — header bar, context menus, touch gestures, price
  lines and markers, Heikin Ashi and hollow candles, and brand presets. See the
  [migration guide](https://bloxwap.github.io/chart/docs/guides/tradingview-migration/).
- **89 drawing tools** — TradingView-style groups: lines, channels, pitchforks,
  Fibonacci, Gann, harmonic patterns, Elliott waves, shapes, and annotations.
- **Display-P3 colors** — wide-gamut colors flow straight to the canvas, with
  automatic label contrast.
- **Tested** — line, branch, and function coverage measured by `npm run coverage`, with a 100% target.

## Documentation

Browse the [documentation and interactive playground](https://bloxwap.github.io/chart/)
for guides, an API reference, and the complete chart controls.

## Installation

```sh
npm install @bloxwap/chart
```

`0.0.1` is an early developer preview; expect breaking changes before `1.0`.

## Quick Example

```ts
// 1. Import module
import { createChart, defineConfig } from '@bloxwap/chart';

// 2. Describe the chart in one config object
const config = defineConfig({
  data: candles, // [{ time, open, high, low, close, volume? }] — UNIX seconds
  series: { type: 'candlestick', upColor: 'color(display-p3 0 1 0.5)', downColor: '#ef5350' },
  watermark: { visible: true, text: 'ACME', opacity: 0.08 },
});

// 3. Create the chart on a canvas
const chart = createChart({ container: document.querySelector('canvas')!, config });
await chart.ready; // WASM kernels live (or JS fallback chosen)

// Indicators, drawings, and interaction
chart.addIndicator({ name: 'sma', params: { period: 20 } });
chart.addIndicator({ name: 'macd' }); // own sub-pane
chart.addDrawing({ name: 'fib', points: [{ index: 10, price: 95 }, { index: 90, price: 110 }] });
```

Headless (SSR/tests/workers):

```ts
import { createChart, MockDocument } from '@bloxwap/chart';
const chart = createChart({ document: new MockDocument(), config: { data: candles } });
```

For custom indicators and drawings, icons, the settings card, and performance
tuning, see the [library API and features](packages/chart/README.md) and the
[performance measurements](packages/chart/PERFORMANCE.md).

## Repository layout

| Workspace | Purpose |
| --- | --- |
| [`packages/chart`](packages/chart) | Published library, tests, icons, fonts, benchmarks, and build scripts |
| [`apps/docs`](apps/docs) | Fumadocs documentation and GitHub Pages site |
| [`apps/playground`](apps/playground) | Full interactive chart demo, also embedded in the docs |

The repository uses npm workspaces with one root lockfile. Each workspace declares
its own dependencies; the chart package has no runtime dependencies.

## Development

Use Node.js 24 or newer. Run commands from the repository root:

```sh
npm ci
npm run docs:dev
```

Open http://localhost:3902. For the standalone playground, run `npm run demo`
(requires Bun) and open http://localhost:8641/demo/.

| Command | Purpose |
| --- | --- |
| `npm run build` | Generate icons, compile embedded WASM, and build the library |
| `npm test` | Build and run the library tests |
| `npm run coverage` | Check library test coverage |
| `npm run bench` | Run calculation and rendering benchmarks |
| `npm run demo` | Build and serve the interactive playground |
| `npm run docs:dev` | Build the embedded demo and start the docs dev server |
| `npm run docs:check` | Check documentation types |
| `npm run docs:build` | Export the docs and validate local links and assets |
| `npm run docs:preview` | Serve the exported site locally |
| `npm run pack:chart` | Build and package the library into `packages/chart/*.tgz` |

## GitHub Pages

The [documentation workflow](.github/workflows/docs.yml) validates pull requests
and deploys pushes to `main`. To check the project path locally:

```sh
NEXT_PUBLIC_BASE_PATH=/chart npm run docs:build
npm run docs:preview
```

The static preview opens at http://localhost:3902/chart/. Stop the docs dev server
first, or use `PORT=3902 npm run docs:preview` to preview alongside it. See
[the docs development guide](apps/docs/README.md) for editing and deployment details.

## License

[MIT](LICENSE)
