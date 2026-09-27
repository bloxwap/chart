# Performance measurements

## Rendering and interaction audit — September 26, 2026

Compared commit `9acee8d` with this working tree on the same Apple M3 Max
machine (128 GiB RAM, macOS 27.0), Node 24.10.0, Chrome 153 (headless). Browser workloads use 100,000
stored candles, 201 or 5,001 visible candles including edge overscan, SMA/BOLL/
KDJ/VOL plus a Fibonacci drawing and hover status text. Each workload has ten
warmup operations followed by 90 animation frames. Both 1× and 2× backing pixel
ratios are measured. The 5,001-bar case needs a 2,564 × 900 CSS-pixel canvas.

These are **CPU submission times and requestAnimationFrame intervals**, not
GPU raster time, compositor FPS, device input latency or Core Web Vitals.
Timers are quantized and machine load varies. Repeated runs consistently showed
large pointer/streaming gains; redraw/pan/zoom differences were not reliable.
The recorded 1× small-viewport pair is slower after the change (0.3 to 0.5–0.7 ms);
earlier runs measured 0.6–0.7 ms before and 0.7–0.8 ms after. No pan/zoom speedup
is claimed.
The full before/after matrix, including tails, initialization and first-pointer
costs, is in [the CSV results](bench/results/2026-09-26-browser.csv).

### Browser results

Median CPU milliseconds per operation, with p95 in parentheses:

| Workload | 1× before | 1× after | 2× before | 2× after |
|---|---:|---:|---:|---:|
| 201 bars: redraw | 0.3 (0.4) | 0.5 (0.9) | 0.4 (0.8) | 0.5 (0.7) |
| 201 bars: pointer | 0.3 (0.4) | 0.2 (0.5) | 0.6 (0.8) | 0.2 (0.3) |
| 201 bars: pan | 0.3 (0.4) | 0.6 (1.1) | 0.6 (0.9) | 0.6 (0.7) |
| 201 bars: zoom | 0.3 (0.4) | 0.7 (1.1) | 0.6 (0.9) | 0.6 (0.9) |
| 201 bars: drawing | 0.3 (0.4) | 0.7 (1.2) | 0.7 (1.0) | 0.6 (0.9) |
| 201 bars: live | 7.8 (12.6) | 3.7 (8.6) | 7.8 (12.5) | 3.7 (7.4) |
| 201 bars: theme | 0.3 (0.4) | 0.6 (0.9) | 0.6 (0.8) | 0.6 (0.8) |
| 5001 bars: redraw | 2.1 (2.3) | 2.4 (5.2) | 2.4 (5.6) | 2.3 (5.4) |
| 5001 bars: pointer | 2.0 (2.1) | 0.2 (0.4) | 2.3 (5.6) | 0.3 (0.4) |
| 5001 bars: pan | 2.1 (2.2) | 2.7 (3.5) | 2.4 (5.8) | 2.3 (5.7) |
| 5001 bars: zoom | 2.1 (2.2) | 2.7 (5.1) | 2.4 (5.8) | 2.2 (5.6) |
| 5001 bars: drawing | 2.2 (5.2) | 2.9 (5.3) | 2.4 (5.9) | 2.3 (5.6) |
| 5001 bars: live | 9.7 (14.8) | 5.2 (5.6) | 10.3 (28.6) | 5.6 (5.8) |
| 5001 bars: theme | 2.3 (5.4) | 2.7 (3.7) | 2.7 (5.5) | 2.3 (5.6) |

At 2× with 5,001 bars, pointer CPU fell from 2.3 to 0.3 ms (about 87%), and
live updates fell from 10.3 to 5.6 ms (about 46%). The live-update p95 fell from
28.6 to 5.8 ms. Across the four live workloads, frame intervals above 25 ms
fell from nine to zero in the recorded runs. All workload p95 frame intervals
remained about 16.7–16.8 ms; these runs do not establish a display-FPS increase.

Initialization remained roughly 19–49 ms with no consistent improvement.
The first pointer frame builds the cache: 0.7–4.2 ms after, compared with
0.2–2.7 ms before. Subsequent moves reuse it. This cost occurs again after a
viewport, data, theme, drawing or other full-render invalidation.

The [all-series/all-indicator Node matrix](bench/results/2026-09-26-node.csv)
separates streaming costs: KDJ fell from 4.5462 to 0.0787 ms/update, and VOL from
1.7787 to 0.0561 ms/update, each with 100,000 candles and a recording canvas.
SMA/EMA/BOLL/MACD/RSI continue to recompute and showed no consistent improvement.
These mock timings must not be compared directly with the browser table.

### Implemented changes

- Lazily raster-cache static layers on browser canvases. Pointer frames copy
  those pixels and redraw only hover-dependent status text and the crosshair.
  Full redraws, pan, zoom and streaming do not populate the cache. Resize and
  full renders invalidate it; context restoration rebuilds it; destroy releases
  the backing store. Context color space is preserved. Transparent/unparsed
  background colors and canvas adapters without a factory keep the full renderer.
- Update only changed VOL/KDJ tail entries during live updates. Batched appends
  preserve the earliest dirty index. Historical changes and configuration changes
  recompute. Large KDJ tails use its linear full pass. The optional
  `IndicatorDef.update` hook lets custom indicators opt in; existing plugins
  retain their pure compute behavior.
- Avoid redundant candlestick fill-style assignments and duplicate OHLC bar
  coordinate conversions. Their pixel output is unchanged; isolated timing gains
  are too small/noisy to claim from this run.
- Fix the existing left-axis crosshair bug: snapshot getter-backed coordinates
  before applying the plot offset.
- Add reusable `createThemeControl({ lockedTheme: 'dark' | 'light', ... })`.
  Locked controls allocate no theme button/menu, ignore system changes and user
  preferences, and still accept host-driven `setTheme`. The playground exposes
  this through `?lockedTheme=dark` or `?lockedTheme=light`.

### Verification and costs that remain

- Full build and 661 tests pass; all line, branch and function coverage remains
  at 100% across the enforced files.
- 936 exact pixel comparisons in Chrome and Safari Technology Preview cover
  1×/2× pixels, left/right axes, sRGB/Display-P3, every series type, all cursor
  modes, scale modes, panes, drawings, themes, data changes, clear and resize.
  Comparisons use the same software raster backend on both canvases: repeated
  pixel readbacks otherwise switch only one canvas away from the GPU backend.
- Browser tests check locked dark/light and unlocked controls, stored preference
  precedence, OS theme changes, and error-free page execution. Twenty pointer
  events produce zero synchronous paints and one queued paint; wheel animation
  paints at most once per frame (24 frames in this run).
- Independent full-recompute comparisons cover incremental warmup, appends,
  replacements, batches, missing/nonfinite extrema, defaults and fallbacks.
  Mock tests cover cache reuse, invalidation, opt-out, failed contexts and disposal.
- The extra RGBA cache costs about 4.3 MiB at 1,264 × 900 / 1×, or 35.2 MiB at
  2,564 × 900 / 2×, excluding browser/GPU bookkeeping. It is allocated on the
  first pointer move. Set `crosshairCache: false` to avoid this memory. Hosts
  using externally animated images/fonts should call `render()` when they change.
- SMA, EMA, BOLL, MACD, RSI and custom indicators without an updater still
  recompute over history on live changes. Full viewport paints still scale with
  visible candles, indicator lines and drawing geometry. There is no lossy
  sampling or claim that arbitrary drawing counts/low-end devices stay within
  a particular frame budget.

### Reproduce this audit

```sh
npm run coverage
npm run bench
# Chrome must be installed, or set CHART_BENCH_BROWSER to a Chromium executable.
npm run bench:browser --workspace @bloxwap/chart -- --output=/tmp/chart-current.json
npm run bench:browser --workspace @bloxwap/chart -- --verify=true
# Use the same workload against a saved baseline dist directory:
node packages/chart/bench/run-browser.mjs --baseline=/path/to/baseline/dist --output=/tmp/chart-baseline.json
CHART_BENCH_DIST=/path/to/baseline/dist node packages/chart/bench/workloads.bench.mjs
```

`--headed=true` opens a visible Chrome window; `--frames=180` extends sampling.
Run versions sequentially on an otherwise idle machine. The Node benchmarks
measure recording-context CPU, not browser graphics. They cover all five series
and streaming all seven built-in indicators in addition to scalar/WASM math,
rolling algorithms and ingestion. Browser benchmarks have no runtime library
dependency; Playwright is a development-only runner.

## Earlier measurements (before this follow-up)

Measured locally on Apple Silicon, Node v24.10.0 and Safari Technology Preview
(reporting Safari 27.0), September 25, 2026. The baseline is the working tree
at the start of this optimization, including the existing drawing-tool changes.
Both versions ran the same benchmark workloads on the same machine.

### Real canvas in Safari

100,000 stored candles, SMA/BOLL/KDJ with period 50, VOL, and a Fibonacci drawing.
Numbers are median milliseconds per operation across five samples of ten
operations, after warmup. Canvas pixel ratio is 1. These measure synchronous CPU
submission to the real Canvas 2D context, **not display FPS, GPU raster time,
Core Web Vitals, or input latency**. Safari's timer precision limits the small
measurements; treat 0.1–0.2 ms results as approximate.

| Workload | Before | After |
|---|---:|---:|
| 200 bars: redraw | 19.6 ms | 0.2 ms |
| 200 bars: pointer move | 19.8 ms | 0.2 ms |
| 200 bars: pan | 19.8 ms | 0.1 ms |
| 200 bars: live last-bar update | 19.6 ms | 4.7 ms |
| 200 bars: theme update | 24.6 ms | 0.2 ms |
| 5,000 bars: redraw | 22.9 ms | 3.6 ms |
| 5,000 bars: pointer move | 22.8 ms | 3.6 ms |

The scale includes one extra candle at the edge: actual ranges are 201 and
5,001 bars. The larger case uses a 2,564 × 900 canvas so the minimum 0.5-pixel
bar spacing can accommodate the requested range.

Node benchmarks at the same 100,000-candle history size also showed these
median CPU costs. Rendering here uses a recording mock, separate from Safari.

| Workload | Before | After |
|---|---:|---:|
| BOLL, period 500 | 71.63 ms | 3.27 ms |
| KDJ, period 500 | 56.65 ms | 4.04 ms |
| Load already sorted candles | 0.92 ms | 0.26 ms |
| Volume-series redraw, 200 visible bars | 1.28 ms | 0.034 ms |

### Changes

- Cache pure indicator outputs by instance and input parameters. Candle changes,
  parameter/color changes, replaced definitions and WASM initialization invalidate
  them. Removed and hidden instances release their cache entries.
- Reuse pane layout, price scales and drawing geometry for crosshair moves.
  Unchanged crosshair positions skip drawing. `batch()` coalesces related updates,
  including the demo's crosshair plus drawing/drag edits.
- Merge only changed configuration sections, avoiding a full history clone for
  a cursor, theme or drawing change. Reuse the scale API instead of allocating
  its object and closures for every access.
- Compute Bollinger standard deviation in linear time using block prefix/suffix
  Welford moments. Shifted moments retain precision at high price levels and
  avoid cancellation when an outlier leaves a window. Scratch storage is bounded
  by the period. KDJ uses monotonic queues with the same linear-time bound.
- Marshal SMA/EMA closes directly into typed arrays and unpack WASM results with
  indexed loops. MACD computes its signal and histogram together without copied
  tails. BOLL extracts closes once.
- Render the histogram series directly from visible candles. Sorted data skips
  sorting; chronological appends and last-candle replacements have constant-time
  store operations. Historical insertions retain ordered binary-search behavior.
- Scan candle price bounds in JavaScript: copying object candles to f32 WASM
  memory was slower and rounded prices. Typed-array SIMD kernels remain available.

### Reproduce

```sh
npm run bench
npm run coverage
npm run demo
```

For the real-canvas benchmark, open `/bench/browser.html` on the demo server
(default `http://localhost:8641/bench/browser.html`) and press **Run benchmark**.
Keep the browser and machine workload consistent between comparisons. It creates
and removes its own canvases and does not change the playground chart.

The Node rolling and rendering benchmarks accept `CHART_BENCH_DIST` pointing at
a saved build directory. This makes the same benchmark code usable against both
versions:

```sh
CHART_BENCH_DIST=/path/to/baseline/dist node packages/chart/bench/rolling.bench.mjs
CHART_BENCH_DIST=/path/to/baseline/dist node packages/chart/bench/render.bench.mjs
```

The render benchmark clears the recording buffer each iteration, explicitly fits
the viewport, and reports its actual visible range. The previous benchmark
claimed 5,000 visible candles while displaying about 257 and accumulated mock
canvas calls across frames. Its reported FPS is not a valid comparison.

### Validation and remaining costs

#### Zoom interaction follow-up (September 26)

The demo now combines wheel and pointer events in a shared animation-frame
queue. Wheel magnitude, pixel/line/page units, and Ctrl+wheel pinch gestures
drive a bounded logarithmic target rather than a fixed 10% jump per event.
`SmoothZoom` eases toward that target using elapsed time, preserves the cursor
anchor, and cancels on drag, resize, data replacement or external scale changes.
Zoom limits and unchanged canvas sizes skip redundant redraws. Reduced-motion
users retain event batching with easing disabled.

A Safari check injected 20 small wheel events and 20 pointer moves before the
next frame. It queued one animation callback and performed zero synchronous
paints. The animation settled over 21 supplied 60Hz frame timestamps, with one
paint per frame and less than 1e-9 CSS-pixel anchor drift. This checks scheduling
and geometry; it is not a measurement of the display's actual frame rate.
Deterministic tests also compare progress at 60Hz and 120Hz, direction reversal,
zoom limits, cancellation, and external viewport changes.

The drawing style bar now scrolls within the chart width and retains its scroll
position after edits. Overflowing tool columns expose hover/focus up/down buttons
with click/hold scrolling and edge indicators; unavailable directions disappear.

#### Other validation and remaining costs

The test suite checks cache invalidation, cached-frame equivalence, nested batches
and exception handling, high-price precision, nonfinite-window recovery,
independent reference calculations for rolling indicators/MACD, duplicate times,
and visible-only histogram reads. All line, branch and function coverage
thresholds remain at 100%. The demo was also exercised in Safari with pointer
movement, zoom and multiple indicator panes.

Live data changes still recompute indicators over the full history; arbitrary
custom indicators use the same pure compute interface. Rendering still paints
the full canvas and scales with visible bars, lines and drawing primitives.
Large data-driven drawings can remain expensive on viewport or data changes.
Cached indicator series and the latest prepared geometry remain in memory until
invalidated or destroyed. That earlier pass did not introduce incremental indicator
state, an offscreen raster cache, lossy downsampling, or a production bundle.
The September 26 follow-up above adds incremental VOL/KDJ tails and a pointer cache.
