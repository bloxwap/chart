# Chart playground

The complete interactive demo for `@bloxwap/chart`. The documentation landing
page and the playground guide both embed this same HTML.

From the repository root:

```sh
npm ci
npm run demo
```

This needs Node.js 24+ and Bun. The command builds the library, then starts the
server at http://localhost:8641/demo/. Set `PORT` to use a different port.

Edit `index.html` for the demo and `packages/chart/src` for library behavior.
After changing the library, run `npm run build` and refresh the browser. The
server maps `/dist/`, `/assets/` and `/bench/` to the library workspace, so the
same relative imports work in the standalone app and in the exported docs.

## What it shows

The page is a thin host, built only from the public API, set up the way
bloxwap.pro uses the chart:

- **Data:** `createDatafeedChart` from `@bloxwap/chart/datafeed` loads BTC
  perpetual candles from Hyperliquid (`candleSnapshot`). It starts with the latest
  500 bars and loads older 1,000-bar pages as you scroll toward the left edge.
  Hyperliquid keeps about 5,000 bars per interval.
- **Live prices:** the page subscribes to Hyperliquid's `allMids` websocket and
  passes each BTC mid price to `datafeed.pushTick`. The datafeed folds each tick
  into the current bar, opens a new bar when a bucket closes, and backfills any
  missed buckets. The datafeed shares the page's frame scheduler (its
  `scheduler` option): each tick folds into its bucket as it arrives, and the
  bars reach the chart once per animation frame, in the same render as pointer
  work. A hidden tab gets no frames, so it catches up in one render when shown.
- **Price lines:** a dashed blue `mark` line follows the live mid price. A dotted
  `last` line shows the latest close when data loads, then moves to the previous
  bar's close each time a new bar opens. These two lines replace the built-in
  last-price line; the built-in axis label still shows.
- **Offline:** if Hyperliquid can't be reached, the page switches to a
  deterministic random walk. The walk is served through the same paging
  datafeed, with 5,000 bars of history and ticks once a second. The **Datasets**
  section of the settings card switches between BTC, the random walk (1m or 1d)
  and **Gaps (1h)**. Gaps (1h) turns on `timeScale.continuous`, so missing
  buckets show as gaps.
- **Header:** `createChartHeader` shows the symbol and the 1m–1M timeframes.
  Picking a timeframe calls `datafeed.setSymbol`. The header also has the
  chart-type menu (including Heikin Ashi and hollow candles), an **Indicators**
  button that opens the picker from `createIndicatorsDialog`, the Auto / % / Log
  scale toggles, and a snapshot button. The snapshot button saves
  `chart.toBlob()` as a PNG. `createScaleButtons` puts the same toggles at the
  foot of the price axis.
- **Chart:** the chart uses the `bloxwapDark` preset. Volume shows as an overlay
  at the bottom of the price pane, and you can still add the Volume sub-pane from
  the picker. The status line shows a bar-close countdown, driven by
  `startCountdownTicker` through the same frame scheduler. The ticker starts and
  stops as `chart.subscribeConfigChange` reports the countdown shown or hidden.
  Two demo markers, a Fibonacci retracement and a long position are added at
  startup.
- **Drawing toolbar:** undo/redo, favorites, scroll arrows, touch gestures, and
  right-click menus. **Chart settings…** in a menu opens the settings card. An
  indicator's **Settings…** opens its study dialog, and a drawing's opens its
  style bar. Right-clicking an indicator sub-pane offers that study's actions.
  The header, the scale toggles and the indicators dialog follow every change
  through `chart.subscribeConfigChange`, with no refresh wiring.
- **Themes:** the theme control's Dark maps to the bloxwapDark colors, through
  `presetChartTheme('bloxwapDark')` passed as the toolbar's and the settings
  card's `chartTheme`. Light and System also work. On dark, the chrome uses the
  bloxwap.pro palette: borderless surfaces, a `#262626` hover fill and a
  `#00ff3f` accent. The header and the on-chart scale toggles get it from
  `BLOXWAP_HEADER_THEME`, which their `setTheme` clears on light. With no saved
  choice, the page starts on dark.
- **Narrow screens (under 600px):** the control rail hides and its buttons move
  into the header. When the header is too wide, it collapses the timeframes into
  a dropdown and wraps onto a second row. The drawing rail starts collapsed. The
  status line wraps onto more rows instead of running under the price axis. On
  touch devices, a one-finger drag pans even across the demo drawings: tap one
  to select it, then drag it or its handles.

## Embedding and QA

To lock the chart to its host's theme and remove the day/night/system control,
open `/demo/?lockedTheme=dark` or `/demo/?lockedTheme=light`. The lock overrides
the saved choice and the OS theme without changing the saved preference. Hosts
can do the same through `createThemeControl({ lockedTheme, ... })` from
`@bloxwap/chart/ui`.

`window.__chartStats()` checks the loaded bars one bucket at a time. It returns
`{ symbol, intervalMs, bars, duplicates, missingBuckets, exhausted, loading, error,
firstTime, lastTime }`. For example, if you scroll BTC 15m back to the start of
its history, it should report about 5,000 bars, `duplicates: 0`,
`missingBuckets: 0` and `exhausted: true`. `chart`, `datafeed`, `toolbar`,
`header`, `indicators` and `settings` are also exposed on `window` for the
console.

The real-canvas benchmark is at http://localhost:8641/bench/browser.html.
`npm run bench:browser --workspace @bloxwap/chart -- --verify=true` also runs
the playground checks: locked themes and frame-coalesced input. Those checks
block external requests, so they use the random walk.

For the docs, `apps/docs/scripts/prepare-demo.mjs` copies the playground HTML,
the compiled library and the fonts into the docs public directory before a dev
run or a build. After changing playground or library files, restart
`npm run docs:dev` to refresh that copy.
