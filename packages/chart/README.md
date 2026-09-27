# @bloxwap/chart

Zero-dependency, WASM+SIMD-accelerated candlestick/financial charting library in strict TypeScript, with an injected DOM so it runs in browsers, workers, SSR, and tests.

## Documentation

Read the [documentation and interactive playground](https://bloxwap.github.io/chart/)
for guides, an API reference, and the complete chart controls.

Install it with `npm install @bloxwap/chart`. `0.0.1` is an early developer
preview; expect breaking changes before `1.0`.

The library lives in `packages/chart`, the Fumadocs app in `apps/docs`, and the
standalone playground in `apps/playground`. Run `npm run docs:dev` from the
repository root to open the docs at http://localhost:3902, or `npm run demo`
to open the playground at http://localhost:8641/demo/ (requires Bun).

## Features

- **Zero runtime dependencies** — pure ESM, `sideEffects: false`, tree-shakable
- **WASM + SIMD kernels** for hot math paths with automatic scalar-JS fallback
- **One consolidated config** — a single `ChartConfig` object describes data, panes, series, indicators, drawings, axes, crosshair, grid, theme, watermark, and formatters
- **Injected DOM ("ABI document injection")** — the library never touches global `document`/`window`; inject a canvas or a `ChartDocument`
- **Display-P3 wide-gamut colors** — `color(display-p3 r g b / a)`, hex, and rgb(a) flow straight to the canvas
- **Automatic label contrast** — boxed drawing labels and crosshair badges choose black or white text using relative luminance, including Display-P3 colors. Explicit drawing text colors and `crosshair.labelColor` override the automatic default (`'auto'`).
- **Series** — candlestick, hollow candles, Heikin Ashi, OHLC bars, line, area, and histogram, plus a volume overlay in the price pane
- **20 indicators** — SMA, EMA, BOLL, VWAP, MA ribbon, Supertrend, Ichimoku, Donchian, Parabolic SAR, MACD, RSI, KDJ, VOL, ADX, CCI, MFI, OBV, ATR, Stochastic and Stochastic RSI, with TradingView-style metadata, per-plot colors/widths/visibility (`updateIndicator`), fills and levels, plus a registry for custom ones
- **Paging datafeed** (`@bloxwap/chart/datafeed`) — one `fetchBars` function loads history, pages older bars in as the user scrolls (`prependData`), aborts superseded reads and folds live ticks into bars with gap backfill; the drop-in for a TradingView UDF datafeed
- **Brand presets** — `preset: 'bloxwapDark'` layers under `theme` and `config`; independent scale fonts; CSS custom properties for every UI surface
- **Price lines and markers** — `chart.series.createPriceLine` for mark/entry/liquidation levels and `setMarkers` for fills and signals
- **Events** — visible range, crosshair, data load and layout subscriptions with re-entrancy-safe delivery
- **Time-continuous axis** — `timeScale.continuous` shows weekends and outages as gaps (bar-indexed by default)
- **Snapshots and countdown** — `takeScreenshot`/`toBlob`/`toDataURL`, and a bar-close countdown in the status line and on the price label
- **TradingView-style UI** — header bar with timeframes, chart types and Auto/%/Log toggles, indicator picker and settings dialog, right-click context menus, and touch gestures (pan, pinch, fling, long-press crosshair)
- **89 drawing tools** in TradingView's toolbar groups — lines, channels, pitchforks, Fibonacci, Gann, harmonic/chart patterns, Elliott waves, cycles, long/short positions, forecasting, anchored VWAP, fixed range volume profile, measurers, brushes, shapes, arrows, text/notes/callouts/tables, images, emoji — plus a registry for custom models
- **Interactive editing API** — live draft preview, hit-testing, selection handles, point dragging, translation, magnet snapping (weak/strong), hide/clear, per-drawing color/width/line style/text/lock
- **Cursor modes** — cross, dot, arrow and presenter halo (`crosshair.mode`)
- **Watermark** — text and/or image layer rendered under the series
- **Test coverage** — line, branch, and function coverage measured by `npm run coverage`, with a 100% target

## Entry points

| Import | Contents |
| --- | --- |
| `@bloxwap/chart` | `createChart`, `Chart`, config, presets and themes, events, snapshots, scales, registries, canvas abstractions |
| `@bloxwap/chart/config` | `defineConfig`, `resolveConfig`, `DEFAULT_CONFIG` |
| `@bloxwap/chart/color` | Color parsing and contrast helpers |
| `@bloxwap/chart/dom` | Canvas/document interfaces and recording mocks |
| `@bloxwap/chart/indicators` | Indicator registry, built-ins and calculation helpers |
| `@bloxwap/chart/drawings` | Drawing registry, catalog and built-ins |
| `@bloxwap/chart/wasm` | WASM initialization |
| `@bloxwap/chart/ui` | Drawing toolbar, settings card, header, scale buttons, indicator dialog, context menu, touch gestures, countdown ticker |
| `@bloxwap/chart/icons` | `ICONS`, `icon(name, size?)` |
| `@bloxwap/chart/react` | `<Chart>` component |
| `@bloxwap/chart/datafeed` | `createDatafeedChart`, `attachDatafeed`, `loadHistory`, `createLiveBarFolder` and paging helpers |

Migrating from the TradingView Charting Library? See the
[migration guide](https://bloxwap.github.io/chart/docs/guides/tradingview-migration/).

## Quick start

In React:

```tsx
import { Chart } from '@bloxwap/chart/react';

<Chart data={candles} height={360} />; // follows the system theme
```

Anywhere else:

```ts
import { createChart, defineConfig } from '@bloxwap/chart';

const config = defineConfig({
  data: candles, // [{ time, open, high, low, close, volume? }] — UNIX seconds
  series: { type: 'candlestick', upColor: 'color(display-p3 0 1 0.5)', downColor: '#ef5350' },
  watermark: { visible: true, text: 'ACME', opacity: 0.08 },
});

// autoResize fills the canvas's parent (give it a height) and follows its size and pixel ratio.
const chart = createChart({ container: document.querySelector('canvas')!, autoResize: true, theme: 'dark', config });
await chart.ready; // WASM kernels live (or JS fallback chosen)

chart.addIndicator({ name: 'sma', params: { period: 20 } });
chart.addIndicator({ name: 'macd' }); // own sub-pane
chart.addDrawing({ name: 'fib', points: [{ index: 10, price: 95 }, { index: 90, price: 110 }] });

chart.scale.zoom(1.2, 300); // pinch/scroll handlers call these
chart.scale.scrollBy(5);
chart.setCrosshair(x, y); // pointermove
chart.resize(w, h, window.devicePixelRatio); // manual sizing, when not using autoResize (CSS px in, HiDPI handled)
chart.destroy();
```

Headless (SSR/tests/workers):

```ts
import { createChart, MockDocument } from '@bloxwap/chart';
const chart = createChart({ document: new MockDocument(), config: { data: candles } });
```

Paged history and live ticks (`@bloxwap/chart/datafeed`):

```ts
import { createDatafeedChart } from '@bloxwap/chart/datafeed';

const { chart, datafeed, destroy } = createDatafeedChart({
  container: canvas,
  autoResize: true,
  preset: 'bloxwapDark',
  // Bars opening within [fromMs, toMs], both inclusive; pass `signal` to fetch.
  fetchBars: ({ symbol, intervalMs, fromMs, toMs, signal }) => readCandles(symbol, intervalMs, fromMs, toMs, signal),
  symbol: 'BTC',
  intervalMs: 15 * 60_000,
});
priceFeed.subscribe('BTC', (mid) => datafeed.pushTick(mid, 'BTC'));
await datafeed.setSymbol('ETH', 60_000); // aborts BTC reads, loads 500 ETH bars
```

Pass `scheduler: createFrameScheduler(window, (update) => chart.batch(update))`
(from `@bloxwap/chart/ui`) to fold every tick at once but render them once per
frame, together with pointer work; `startCountdownTicker({ chart, window, scheduler })`
shares the same frame. `createAbortController` swaps the global `AbortController`
behind each symbol's reads. The React `<Chart>` runs the countdown ticker by
itself whenever its config shows a countdown.

Price lines, markers, events and snapshots:

```ts
const mark = chart.series.createPriceLine({ price: 64_250, color: '#35b5ff', lineStyle: 'dashed', title: 'mark' });
mark.applyOptions({ price: 64_300 });
chart.series.setMarkers([{ time: 1700003600, position: 'belowBar', shape: 'arrowUp', color: '#00ff3f', text: 'Buy' }]);

const off = chart.subscribeVisibleRangeChange(({ barsBefore }) => { if (barsBefore < 50) loadOlder(); });
chart.subscribeCrosshairMove(({ candle }) => showLegend(candle));
chart.subscribeConfigChange(({ keys }) => { if (keys.includes('indicators')) saveStudies(); });

const png = await chart.toBlob({ type: 'image/png' });
```

Header, indicator dialog and context menu (`@bloxwap/chart/ui`):

```ts
import { createChartHeader, createIndicatorsDialog, createDrawingToolbar, BLOXWAP_HEADER_THEME } from '@bloxwap/chart/ui';
import { presetChartTheme } from '@bloxwap/chart';

const indicators = createIndicatorsDialog({ chart, document });
const toolbar = createDrawingToolbar({
  chart, document, canvas, rail, overlay,
  chartTheme: presetChartTheme('bloxwapDark'), // keep the preset's colors
  contextMenu: { onIndicatorSettings: (id) => indicators.openSettings(id) }, // the dialog follows the menu's edits
});
const header = createChartHeader({
  chart, document, container: headerEl, datafeed,
  flyouts: toolbar.flyouts, tokens: BLOXWAP_HEADER_THEME, // bloxwap.pro look on dark; setTheme swaps it
  onIndicators: () => indicators.openPicker(),
});
```

Custom indicators and drawings:

```ts
chart.indicators.register({ name: 'my-ind', defaultParams: {}, defaultColors: ['#fff'], defaultPane: 'sub', compute: (candles, params, colors, kernels) => ({ pane: 'sub', lines: [/* ... */] }) });
chart.drawings.register({ name: 'my-drawing', minPoints: 2, geometry: (points, view) => [/* pixel primitives */] });
```

Text primitives with `inside: true` slide back into the plot instead of clipping at the price axis; built-in measurement labels set it while their drawing is on screen (`spansPlot`).

## Library icons

The toolbar's SVG icons ship with the library and are available independently
of the toolbar:

```ts
import { ICONS, icon } from '@bloxwap/chart/icons';

button.innerHTML = icon('trendline', 20);
button.setAttribute('aria-label', 'Trend line');
// ICONS.trendline contains the original SVG markup.
```

Icons inherit their host's CSS `color` through `currentColor`. The same exports
remain available from `@bloxwap/chart/ui`. Edit source SVGs in `assets/icons` —
the set is fully repo-local (no icon packages or CDN references) and follows a
24×24 Lucide-style grid with a 1.5px stroke; all coordinates sit on a 0.25
crispness grid. `npm run lint:icons` enforces those rules, `npm run build:icons`
regenerates the shared icon module, and `npm run preview:icons` renders a
contact sheet (`assets/icons/preview.html`) at 16–32px on light and dark
surfaces for visual review.

## Chart settings

The demo's bottom-left gear opens one scrollable settings card. Candle body,
border and wick visibility/colors, previous-close coloring, precision, status
line, scale modes, ratio locking, axis placement, labels, reference lines and
canvas appearance update live. The scale's optional plus button adds an undoable
horizontal price line. Alt/Option+I inverts the scale; Alt/Option+P and L toggle
percent and logarithmic modes.

Use the search field to filter settings by name, section, or option. It accepts
partial names and common typos, such as `gird` for grid or `log scale` for scale
mode. Matching controls stay editable. Escape clears a search first, then closes
the card; the clear button and section shortcuts also restore the full list.

Hosts can attach the same card to their own button:

```ts
import { createChartSettings } from '@bloxwap/chart/ui';

const settings = createChartSettings({ chart, document, trigger: settingsButton,
  onOpen: () => toolbar.flyouts.close(),
  onChange: () => toolbar.refreshViewport(),
});
settings.setTheme('light'); // match the host's UI theme
// settings.destroy() removes the card and its listeners.
```

For an embedded chart whose theme is controlled by the host, use a locked theme
control. It creates no day/night/system button or menu and does not follow OS
theme changes or a saved user preference:

```ts
import { createThemeControl } from '@bloxwap/chart/ui';

const themeControl = createThemeControl({
  document,
  flyouts: toolbar.flyouts,
  lockedTheme: 'dark', // 'light' also works; omit to show the theme picker
  onChange(theme) {
    toolbar.setTheme(theme); // applies chart colors and toolbar chrome
    settings.setTheme(theme);
  },
});
if (themeControl.element) controls.append(themeControl.element);
themeControl.setTheme('light'); // host updates remain available while locked
// Call themeControl.destroy() before destroying the toolbar.
```

Unlocked controls default to `theme: 'system'`; `onSelect(mode)` can persist
user choices. The playground accepts `?lockedTheme=dark` or `?lockedTheme=light`.
Core and React charts without this UI already use their host-supplied `theme`.

Settings live in the chart config and remain selected when the card reopens.
Reset restores the initial appearance without changing data, indicators or
drawings. Percent and indexed scales use the first visible close as their
reference. Disabling Auto holds the current price range; a locked ratio keeps
scale units per bar constant while zooming or resizing. The idle navigation
hint fades after three seconds; active drawing instructions stay visible.

## Drawing tools

`TOOL_GROUPS` lists every built-in tool the way a trading terminal's drawing
toolbar groups them (group → section → tool); the demo builds its rail and
flyout submenus straight from it.

| Group | Tools |
|---|---|
| Trend line tools | trend line, ray, info line, extended line, trend angle, horizontal line/ray, vertical line, cross line · parallel channel, regression trend, flat top/bottom, disjoint channel · pitchfork, Schiff, modified Schiff, inside pitchfork |
| Gann and Fibonacci | retracement, trend-based extension, channel, time zone, speed resistance fan, trend-based time, circles, spiral, speed resistance arcs, wedge, pitchfan · Gann box, square fixed, square, fan |
| Patterns | XABCD, cypher, head and shoulders, ABCD, triangle, three drives · Elliott impulse, correction, triangle, double combo, triple combo · cyclic lines, time cycles, sine line |
| Forecasting and measurement | long/short position, forecast, bars pattern, ghost feed, projection · anchored VWAP, fixed range volume profile · price, date, date and price range |
| Geometric shapes | brush, highlighter · arrow marker, arrow, arrow mark up/down · rectangle, rotated rectangle, path, circle, ellipse, polyline, triangle, arc, curve, double curve |
| Annotation | text, anchored text, note, anchored note, price note, pin, table, callout, comment, price label, signpost, flag mark · image |
| Icons | emoji, sticker, icon |

```ts
import { TOOL_GROUPS } from '@bloxwap/chart';

// Placing a tool: preview while the pointer moves, commit on the last click.
chart.setDraft({ name: 'pitchfork', points: [...placed, chart.snapPoint(x, y, 'weak')] });
const id = chart.addDrawing({ name: 'pitchfork', points: placed, color: '#089981' });

// Editing: select, drag handles, move, restyle.
const hit = chart.drawingAt(x, y);          // topmost drawing under the pointer
chart.selectDrawing(hit);                   // paints anchor handles
const handle = chart.handleAt(x, y);        // anchor index or -1
chart.moveDrawingPoint(hit, handle, chart.snapPoint(x, y, 'strong'));
chart.translateDrawing(hit, dx, dy);
chart.updateDrawing(hit, { lineStyle: 'dashed', lineWidth: 2, text: 'Retest' });
chart.setDrawingsHidden(true);
chart.clearDrawings();
chart.scale.zoomToRange(fromIndex, toIndex); // box zoom
```

## Scripts

Run these commands from the repository root or this package directory.

- `npm run build` — validate/generate icons, compile WASM (wabt → embedded base64) + TypeScript
- `npm run build:icons` — lint `assets/icons/*.svg` and regenerate the library icon module
- `npm run lint:icons` — enforce the icon crispness/consistency rules (0.25 coordinate grid, repo-local)
- `npm run preview:icons` — render `assets/icons/preview.html`, a contact sheet at 16–32px on light/dark
- `npm test` — build and run the test suite (node:test)
- `npm run coverage` — tests with 100% line/branch/function threshold enforcement
- `npm run bench` — indicator math, rolling-window algorithms, data ingestion and render CPU benchmarks
- `npm run bench:browser --workspace @bloxwap/chart` — real Chrome canvas/frame benchmarks (Chrome must be installed)
- `npm run bench:browser --workspace @bloxwap/chart -- --verify=true` — browser pixel, theme-lock and input-scheduling checks

## Performance

Indicator results are reused across zoom, scroll, drawing and theme changes.
Crosshair moves also reuse the prepared layout and drawing geometry. Browser
canvases lazily cache the static pixels, repainting only status text and the
crosshair while the viewport stays unchanged. `createChart({ crosshairCache: false, ... })`
disables this extra canvas when memory is more important. Transparent or
unparsed background colors and injected canvases without a canvas factory use
the full renderer. Data,
parameter, color and indicator-definition changes invalidate the affected work.
Use `setData`/`appendData` to change candles and `updateConfig` to change configuration.
Custom indicator `compute` functions must be pure; cached outputs are read-only.
VOL and KDJ update only changed tail values during streaming; large KDJ batches
use the full linear calculation. Other indicators retain full recomputation.
Custom indicators may opt into `IndicatorDef.update` to mutate their chart-owned
cached output; returning `undefined` falls back to `compute`. Historical edits,
replacement data, parameter/color changes and WASM initialization invalidate it.

Group related synchronous changes to paint once (nested batches are supported):

```ts
chart.batch(() => {
  chart.setCrosshair(x, y);
  chart.moveDrawingPoint(id, anchor, chart.snapPoint(x, y, 'strong'));
});
```

Scale layout and drawing hit-test geometry are refreshed when the outer batch
finishes. Query those results after the batch. For display-rate scheduling, the
host can call `batch` inside its own `requestAnimationFrame` callback.

For smooth wheel/trackpad zoom, inject the host's animation clock:

```ts
import { SmoothZoom } from '@bloxwap/chart';

const zoom = new SmoothZoom(chart.scale, {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
}, {
  timeConstant: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 55,
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoom.wheel(event, event.clientX - rect.left, rect.height);
}, { passive: false });
// Call zoom.cancel() before dragging/resizing, and zoom.destroy() on teardown.
```

Wheel magnitudes and units are normalized; tiny trackpad deltas stay small.
Input accumulates once per frame with a bounded zoom target, a stable cursor
anchor, and easing based on elapsed time. `timeConstant: 0` keeps frame batching
while disabling easing. The demo shares its frame scheduler between zoom and
pointer movements so they paint together, retaining every freehand/eraser sample.

The toolbar also eases navigation-arrow paging. `toolbar.setScrollArrows(false)`
hides the arrows independently of wheel and drag navigation; the demo exposes
this under **Settings → Display → Navigation arrows** and remembers the choice.
Call `toolbar.cancelNavigation()` before replacing data or resizing.

To animate indicator overlays and pane heights, share a clock with the toolbar:

```ts
import { createDrawingToolbar, createFrameScheduler } from '@bloxwap/chart/ui';

const frames = createFrameScheduler(window, (update) => chart.batch(update));
const chart = createChart({ container: canvas, config, animation: {
  scheduler: frames,
  duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
} });
const toolbar = createDrawingToolbar({ chart, document, canvas, rail, overlay, scheduler: frames });
```

Adding/removing indicators or changing their visibility fades overlays and
expands/collapses sub-panes. Live price/volume updates ease the vertical scale
into its new range without changing the horizontal framing. Reusing an indicator
id reverses an unfinished transition. Indicator calculations remain cached
throughout the animation. Replacing the dataset resets its scale immediately.
Live candle bodies and wicks also ease toward incoming prices; rapid updates
retarget the current visual position while stored data and indicators use the
latest real values. The idle toolbar hint fades out after three seconds.

See [PERFORMANCE.md](PERFORMANCE.md) for measured before/after results, remaining
costs, and instructions for the real-canvas browser benchmark.

## License

MIT
