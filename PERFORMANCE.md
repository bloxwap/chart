# Performance measurements

Measured locally on Apple Silicon, Node v24.10.0 and Safari Technology Preview
(reporting Safari 27.0), September 25, 2026. The baseline is the working tree
at the start of this optimization, including the existing drawing-tool changes.
Both versions ran the same benchmark workloads on the same machine.

## Real canvas in Safari

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

## Changes

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

## Reproduce

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
CHART_BENCH_DIST=/path/to/baseline/dist node bench/rolling.bench.mjs
CHART_BENCH_DIST=/path/to/baseline/dist node bench/render.bench.mjs
```

The render benchmark clears the recording buffer each iteration, explicitly fits
the viewport, and reports its actual visible range. The previous benchmark
claimed 5,000 visible candles while displaying about 257 and accumulated mock
canvas calls across frames. Its reported FPS is not a valid comparison.

## Validation and remaining costs

### Zoom interaction follow-up (September 26)

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

### Other validation and remaining costs

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
invalidated or destroyed. This pass does not introduce incremental indicator
state, an offscreen raster cache, lossy downsampling, or a production bundle.
