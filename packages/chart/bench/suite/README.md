# Node benchmark suite

Run from the repository root with Node 24:

```sh
npm run build
npm run bench:suite --workspace @bloxwap/chart
npm run bench:suite --workspace @bloxwap/chart -- --samples=5 --json=/tmp/chart-suite.json
npm run bench:suite --workspace @bloxwap/chart -- --filter='indicators/.*sma' --sizes=10000,100000
```

No library source changes or additional dependencies are needed. The suite imports
built output through the existing harness `load()` helper; `CHART_BENCH_DIST` can
select an alternate build. Bundle measurements use that same build, but the
esbuild binary is discovered in this repository's root node_modules/.bin.

All numeric times are milliseconds per operation. Each case has one calibration
operation, three warmup operations, then 15 independent timed samples by default.
For operations calibrated below 0.05 ms, samples contain 2–64 synchronous operations
and report elapsed time divided by that batch size. Setup/reset and teardown are
outside the timer; asynchronous paging is awaited inside it. Million-bar cases
cap the requested sample count at five. Median is the middle value (mean of the
two middle values for even counts), p95 is nearest-rank, and min is the smallest
sample. JSON retains every per-operation sample, batch size, parameters, canvas
call counts, configuration and machine/git metadata. Run on an idle machine and
compare multiple runs on the same machine/build settings. No forced GC is used;
allocation and natural GC costs can appear in samples.

The xorshift32 random walk uses seed 0x12345678 and epoch-aligned one-minute OHLCV
bars; each size is a prefix of the same series. Unsorted ingestion uses a seeded
Fisher–Yates shuffle. Every registered built-in indicator is discovered from
BUILTIN_INDICATORS and computed with its default parameters. A proxy probe detects
which definitions actually invoke kernels; only those receive a WASM comparison.
Speedup is scalar median / WASM median, including marshalling for indicators.
The raw kernel group covers all six function exports, typed-array JS equivalents
for the five algorithms, wrapper costs, object extraction and each copy direction.
JS rolling extrema use a linear monotonic queue, not a quadratic window scan.
JS calculations use double intermediates and WASM uses f32, so timings do not imply
bit-identical numerical results. Minmax's scalar WASM export is shown separately.

Ingestion separates DataStore from chart append/prepend work, page normalization,
full-history pagination, and datafeed-chart loadMore. The immediate mock fetcher
slices exactly the requested time window, without network latency. Each loadMore
sample starts with the same retained history; feed/chart construction and initial
history loading are excluded. Single-bar append streams grow by at most the
warmups and timed batch operations; chart prepend resets its history each time.

The `live` group (sizes >=100k) builds one chart per built-in indicator and
replaces the last bar with `appendData`, the path a streaming feed takes on every
tick. Cases are labelled `(no update hook)` when the definition has no
`IndicatorDef.update`, i.e. the tick recomputes the full history.
Example: `npm run bench:suite --workspace @bloxwap/chart -- --filter='^live/' --sizes=100000,1000000`.
`normalizeCandles sorted` measures the common already-ordered feed page case.

Rendering uses candlesticks plus SMA/BOLL/KDJ/VOL at 200/1000/5000 requested visible
bars, for selected sizes >=100k. Chart cases use scalar indicators (`wasm: false`);
the indicator group measures WASM separately. Actual range (including overscan) is in JSON.
Each operation clears all recording contexts; counts include every recorded canvas
call, including style assignments, across the chart's contexts. Pan and zoom
alternate direction to keep the viewport bounded. Live updates replace the final
bar. These are mock-canvas CPU submission times, **not browser raster time or FPS**.
Drawing cases scan mixed primitives and exercise the chart's public drawingAt
pointer hit path (cached geometry from the last render), both varied probes and
full miss scans, at 10/100/1000 mixed drawings. A pointer test excludes repaint.

Bundle output includes all dist files (including types/maps), embedded base64
payload bytes and decoded WASM bytes. esbuild uses browser ESM, ES2022, minification,
no source maps, and gzip level 9. Full namespace exports are retained through a
global assignment; minimal cases retain only createChart, SMA, or the datafeed
namespace. esbuild absence produces an explicit skip; no dependency is installed.
Bundle sizes are static measurements, not timed cases. `--filter` matches
`group/case` as a JavaScript regular expression; `--sizes` controls data sizes,
while drawing counts and static bundle cases remain independent of bar sizes.
