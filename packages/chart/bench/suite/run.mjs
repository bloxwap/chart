/** Reproducible Node CPU suite. See README.md for scope and interpretation. */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, readdir, stat, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { load } from '../harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const match = /^--(samples|sizes|filter|json)=(.+)$/.exec(a);
  if (!match) throw new Error(`Unknown argument: ${a}; use --samples=N --sizes=10000,100000,1000000 --filter=regex --json=path`);
  return [match[1], match[2]];
}));
const samples = Number(args.samples ?? 15);
const sizes = (args.sizes ?? '10000,100000,1000000').split(',').map(Number);
if (!Number.isInteger(samples) || samples < 1 || sizes.some(n => !Number.isSafeInteger(n) || n < 100)) throw new Error('Invalid samples or sizes');
const filter = new RegExp(args.filter ?? '');
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
const report = { env: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, os: `${os.type()} ${os.release()} ${os.arch()}`, commit, date: new Date().toISOString(), dist: process.env.CHART_BENCH_DIST ?? 'packages/chart/dist' }, options: { samples, sizes, filter: filter.source, seed: 0x12345678 }, results: [], skips: [] };
const skip = message => { report.skips.push(message); console.log(`SKIP: ${message}`); };
let sink;
function random(seed) { return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }; }
function candles(n) {
  const rand = random(0x12345678); let price = 100;
  return Array.from({ length: n }, (_, i) => { const open = price; price = Math.max(1, price + (rand() - .5) * 2); return { time: 1700000040 + i * 60, open, close: price, high: Math.max(open, price) + rand(), low: Math.min(open, price) - rand(), volume: 100 + Math.floor(rand() * 10000) }; });
}
const wanted = (group, name) => filter.test(`${group}/${name}`);
let lastGroup;
async function bench(group, name, op, { n = 0, setup, teardown, calls, extra = {}, batchable = true } = {}) {
  if (!wanted(group, name)) return null;
  if (group !== lastGroup) { console.log(`\n${group}\n${'case'.padEnd(65)} median ms    p95 ms    min ms   N batch calls/frame speedup`); lastGroup = group; }
  const invoke = async () => { await setup?.(); const t = performance.now(); const value = op(); sink = value?.then ? await value : value; const elapsed = performance.now() - t; await teardown?.(); return elapsed; };
  await invoke();
  let probe;
  for (let i = 0; i < 3; i++) probe = await invoke();
  const batch = batchable && !setup && !teardown && probe < .05 ? Math.min(64, Math.max(2, Math.ceil(.1 / Math.max(probe, .001)))) : 1;
  const times = [], callCounts = [];
  const count = n >= 1e6 ? Math.min(samples, 5) : samples;
  for (let i = 0; i < count; i++) {
    if (batch === 1) times.push(await invoke());
    else { const t = performance.now(); for (let j = 0; j < batch; j++) sink = op(); times.push((performance.now() - t) / batch); }
    if (calls) callCounts.push(calls());
  }
  const sorted = [...times].sort((a,b) => a-b);
  const median = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length/2-1] + sorted[sorted.length/2])/2;
  const result = { group, name, ...extra, medianMs: median, p95Ms: sorted[Math.ceil(count * .95)-1], minMs: sorted[0], samples: count, batch, timingsMs: times, ...(calls ? { canvasCallsPerFrame: callCounts } : {}) };
  if (extra.scalarMedianMs) result.speedup = extra.scalarMedianMs / median;
  report.results.push(result);
  console.log(`${name.padEnd(65)} ${median.toFixed(4).padStart(9)} ${result.p95Ms.toFixed(4).padStart(9)} ${result.minMs.toFixed(4).padStart(9)} ${String(count).padStart(3)} ${String(batch).padStart(5)} ${calls ? String(callCounts.at(-1)).padStart(11) : '          -'} ${result.speedup?.toFixed(2) ?? '-'}${result.speedup ? 'x' : ''}`);
  return result;
}
const [{ createChart }, { MockDocument }, indicators, wasm, feed, { DataStore }, { olderCandles }, { hitTest }] = await Promise.all(['index.js','dom.js','indicators/index.js','wasm/loader.js','datafeed/index.js','core/data.js','core/prepend.js','drawings/hit.js'].map(load));
const kernels = await wasm.initWasm();
console.log(`Node ${process.version}; ${report.env.cpu}; samples=${samples}; seed=${report.options.seed}; WASM=${!!kernels}`);
const configs = ['sma','boll','kdj','vol'].map(name => ({ id: name, name, params: { period: 20 }, colors: [], visible: true, pane: ['sma','boll'].includes(name) ? 'main' : 'sub' }));
function chartFor(data, visible = 200, studies = false) {
  const document = new MockDocument();
  const chart = createChart({ document, config: { width: Math.max(1264, visible/2+64), height: 900, data, wasm: false, series: { type: 'candlestick' }, indicators: studies ? configs : [] } });
  chart.scale.zoomToRange(data.length-visible, data.length-1);
  const contexts = () => document.created.filter(c => c.context).map(c => c.context);
  return { chart, clear: () => contexts().forEach(c => { c.calls.length = 0; }), calls: () => contexts().reduce((s,c) => s+c.calls.length,0) };
}
for (const n of sizes) {
  const data = candles(n);
  for (const def of indicators.BUILTIN_INDICATORS) {
    const name = `${n} ${def.name}`;
    // Discover actual kernel use rather than guessing from indicator names.
    let used = false;
    if (kernels && (wanted('indicators', `${name} JS`) || wanted('indicators', `${name} WASM incl marshal`))) def.compute(data.slice(0,100), def.defaultParams, [], new Proxy(kernels, { get(target,key) { const v = target[key]; return typeof v === 'function' ? (...a) => { used = true; return v(...a); } : v; } }));
    const scalar = await bench('indicators', `${name} JS`, () => def.compute(data, def.defaultParams, [], null), { n, extra: { params: def.defaultParams } });
    if (used) await bench('indicators', `${name} WASM incl marshal`, () => def.compute(data, def.defaultParams, [], kernels), { n, extra: { scalarMedianMs: scalar?.medianMs, params: def.defaultParams } });
  }
  await kernelCases(data);
  const store = new DataStore();
  await bench('ingestion', `${n} setData sorted`, () => store.setData(data), { n });
  const shuffled = data.slice(); const rand = random(42);
  for (let i = n-1; i > 0; i--) { const j = Math.floor(rand()*(i+1)); [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]]; }
  await bench('ingestion', `${n} setData shuffled`, () => store.setData(shuffled), { n });
  store.setData(data); let tick = 0;
  await bench('ingestion', `${n} DataStore single bar append`, () => store.append({ ...data.at(-1), time: data.at(-1).time + ++tick*60 }), { n });
  const page = data.slice(0, Math.min(5000,n/2)); const tail = data.slice(page.length);
  await bench('ingestion', `${n} olderCandles page normalization`, () => olderCandles(page, tail[0].time), { n });
  await bench('ingestion', `${n} normalizeCandles sorted`, () => feed.normalizeCandles(data), { n });
  await bench('ingestion', `${n} normalizeCandles shuffled`, () => feed.normalizeCandles(shuffled), { n });
  if (['prependData 5000 max','appendData streaming'].some(job => wanted('ingestion', `${n} chart ${job}`))) {
    const c = chartFor(tail);
    await bench('ingestion', `${n} chart prependData 5000 max`, () => { c.clear(); return c.chart.prependData(page); }, { n, setup: () => c.chart.setData(tail), calls: c.calls });
    await bench('ingestion', `${n} chart appendData streaming`, () => { c.clear(); c.chart.appendData({ ...data.at(-1), time: data.at(-1).time + ++tick*60 }); }, { n, calls: c.calls });
    c.chart.destroy();
  }
  const fetchBars = async ({ fromMs, toMs }) => data.slice(Math.max(0,Math.ceil((fromMs/1000-data[0].time)/60)), Math.min(n,Math.floor((toMs/1000-data[0].time)/60)+1));
  await bench('ingestion', `${n} loadHistory all pages immediate`, async () => { const bars = await feed.loadHistory({ fetchBars, symbol: 'BENCH', intervalMs: 60000, fromMs: data[0].time*1000, toMs: data.at(-1).time*1000, countBack: n }); if (bars.length !== n) throw new Error('History length mismatch'); return bars; }, { n, batchable: false });
  if (wanted('ingestion', `${n} datafeed-chart loadMore immediate`)) {
    let session, c;
    await bench('ingestion', `${n} datafeed-chart loadMore immediate`, async () => { c.clear(); const added = await session.loadMore(page.length); if (added !== page.length || session.error) throw new Error('Paging failed'); }, { n, batchable: false, setup: async () => { c = chartFor([]); session = feed.attachDatafeed(c.chart, { fetchBars, initialBars: tail.length, pageBars: page.length, lazyLoadThreshold: 0, now: () => data.at(-1).time*1000 }); await session.setSymbol('BENCH',60000); if (session.error) throw session.error; }, teardown: () => { session.destroy(); c.chart.destroy(); } });
  }
  // Live last-bar replacement per indicator: exposes indicators without IndicatorDef.update (full O(n) recompute per tick).
  if (n >= 100000) for (const def of indicators.BUILTIN_INDICATORS) {
    const label = `${n} live tick ${def.name}${def.update ? '' : ' (no update hook)'}`;
    if (!wanted('live', label)) continue;
    const document = new MockDocument();
    const chart = createChart({ document, config: { width: 1264, height: 900, data, wasm: false, series: { type: 'candlestick' }, indicators: [{ id: def.name, name: def.name, params: def.defaultParams, colors: [], visible: true, pane: def.defaultPane }] } });
    chart.scale.zoomToRange(n - 200, n - 1); chart.render();
    const clear = () => document.created.forEach(c => { if (c.context) c.context.calls.length = 0; });
    let k = 0;
    await bench('live', label, () => { clear(); chart.appendData({ ...data.at(-1), close: data.at(-1).close + (++k % 10) * .01 }); }, { n, batchable: false, extra: { hasUpdateHook: !!def.update } });
    chart.destroy();
  }
  if (n >= 100000) for (const visible of [200,1000,5000]) {
    if (!['redraw','crosshair','pan','zoom','live'].some(job => wanted('render',`${n} stored ${visible} visible ${job}`))) continue;
    const c = chartFor(data,visible,true); await c.chart.ready;
    const range = c.chart.scale.visibleRange(); let i = 0;
    const jobs = { redraw: () => c.chart.render(), crosshair: () => c.chart.setCrosshair(100+(++i%800),200), pan: () => c.chart.scale.scrollBy(++i%2 ? 1 : -1), zoom: () => c.chart.scale.zoom(++i%2 ? 1.01 : 1/1.01,600), live: () => c.chart.appendData({ ...data.at(-1), close: data.at(-1).close + (++i%10)*.01 }) };
    for (const [job, fn] of Object.entries(jobs)) await bench('render',`${n} stored ${visible} visible ${job}`, () => { c.clear(); fn(); }, { n, calls: c.calls, extra: { actualVisible: range.to-range.from }, batchable: false });
    c.chart.destroy();
  }
}

async function kernelCases(data) {
  if (!kernels) return skip('WASM kernels unavailable');
  const { KERNELS_BASE64 } = await load('wasm/kernels.base64.js');
  const raw = (await WebAssembly.instantiate(wasm.decodeBase64(KERNELS_BASE64), {})).instance.exports;
  const n = data.length, bytes = n*4;
  raw.memory.grow(Math.max(0,Math.ceil(bytes*3/65536)-1));
  const src = Float32Array.from(data,c => c.close), resident = new Float32Array(raw.memory.buffer,0,n), out = new Float32Array(n), queue = new Int32Array(n); resident.set(src);
  const js = {
    minmax: () => { let min=Infinity,max=-Infinity; for (let i=0;i<n;i++) { min=Math.min(min,src[i]); max=Math.max(max,src[i]); } return [min,max]; },
    sma: () => { let sum=0; out.fill(NaN); for(let i=0;i<n;i++) { sum+=src[i]; if(i>=20) sum-=src[i-20]; if(i>=19) out[i]=sum/20; } return out; },
    ema: () => { out.fill(NaN); let v=0; for(let i=0;i<20;i++) v+=src[i]; v/=20; out[19]=v; for(let i=20;i<n;i++) out[i]=v=src[i]*(2/21)+v*(19/21); return out; },
  };
  for (const [method,max] of [['rollingMax',true],['rollingMin',false]]) js[method] = () => { let head=0,tail=0; out.fill(NaN); for(let i=0;i<n;i++) { while(head<tail && queue[head]<=i-20) head++; while(head<tail && (max ? src[queue[tail-1]]<=src[i] : src[queue[tail-1]]>=src[i])) tail--; queue[tail++]=i; if(i>=19) out[i]=src[queue[head]]; } return out; };
  const exports = { minmax: 'minmax_f32', sma: 'sma_f32', ema: 'ema_f32', rollingMax: 'rolling_max_f32', rollingMin: 'rolling_min_f32' };
  for(const [method, exp] of Object.entries(exports)) {
    const scalar = await bench('wasm-kernels',`${n} ${method} JS typed array loop`,js[method],{ n });
    const fn = () => method==='minmax' ? raw[exp](0,n) : method.startsWith('rolling') ? raw[exp](0,bytes,bytes*2,n,20) : raw[exp](0,bytes,n,20);
    await bench('wasm-kernels',`${n} ${exp} resident`,fn,{ n, extra: { scalarMedianMs: scalar?.medianMs } });
    await bench('wasm-kernels',`${n} ${method} wrapper incl copies`,() => kernels[method](src,20),{ n });
  }
  await bench('wasm-kernels',`${n} minmax_f32_scalar resident`,() => raw.minmax_f32_scalar(0,n),{ n });
  await bench('wasm-kernels',`${n} marshal objects to f32`,() => Float32Array.from(data,c=>c.close),{ n });
  await bench('wasm-kernels',`${n} marshal input copy`,() => resident.set(src),{ n });
  await bench('wasm-kernels',`${n} marshal output copy`,() => new Float32Array(raw.memory.buffer,bytes,n).slice(),{ n });
}

for(const count of [10,100,1000]) {
  const primitives = Array.from({ length: count },(_,i) => [
    { type:'line',x1:i%800,y1:100,x2:i%800+20,y2:200 },
    { type:'rect',x:i%800,y:100,w:20,h:100 },
    { type:'ellipse',cx:i%800,cy:200,rx:10,ry:20 },
    { type:'path',points:[i%800,100,i%800+30,200,i%800+10,250] },
  ][i%4]); let i=0;
  await bench('drawings',`${count} mixed primitives miss scan`,() => { let hits=0; for(const p of primitives) hits+=Number(hitTest(p,900+(++i%10),700,6,1200)); return hits; });
  if (['mixed probes','miss'].some(job => wanted('drawings',`${count} chart pointer drawingAt ${job}`))) {
    const data=candles(10000), c=chartFor(data,1000);
    c.chart.batch(() => { for(let j=0;j<count;j++) c.chart.addDrawing({ name:['trendline','rect','ellipse','fib'][j%4], points:[{ index:9100+j%500,price: data[9100+j%500].close },{ index:9150+j%500,price:data[9150+j%500].close+2 }] }); });
    c.clear();
    await bench('drawings',`${count} chart pointer drawingAt mixed probes`,() => c.chart.drawingAt(100+(++i%1000),100+(i*37%600)));
    await bench('drawings',`${count} chart pointer drawingAt miss`,() => c.chart.drawingAt(1200,850));
    c.chart.destroy();
  }
}

async function bundleCases() {
  const dist = process.env.CHART_BENCH_DIST ? resolve(process.env.CHART_BENCH_DIST) : resolve(root,'packages/chart/dist');
  const walk = async path => { let total=0; for(const entry of await readdir(path,{withFileTypes:true})) total += entry.isDirectory() ? await walk(resolve(path,entry.name)) : (await stat(resolve(path,entry.name))).size; return total; };
  const { KERNELS_BASE64 } = await load('wasm/kernels.base64.js');
  const totals = { group:'bundle', name:'dist and embedded wasm', distBytes:await walk(dist), wasmBase64Bytes:Buffer.byteLength(KERNELS_BASE64), wasmDecodedBytes:wasm.decodeBase64(KERNELS_BASE64).length };
  report.results.push(totals); console.log('\nbundle (bytes)'); console.table([totals]);
  const executable=resolve(root,'node_modules/.bin/esbuild');
  try { await access(executable); } catch { return skip('esbuild absent at node_modules/.bin/esbuild; bundle cases skipped'); }
  const cases = { full:`import * as chart from './index.js'; globalThis.chart = chart;`, createChart:`import {createChart} from './index.js'; globalThis.chart = createChart;`, indicator:`import {smaIndicator} from './indicators/index.js'; globalThis.chart = smaIndicator;`, datafeed:`import * as feed from './datafeed/index.js'; globalThis.chart = feed;` };
  const rows=[];
  for(const [name,input] of Object.entries(cases)) {
    if(!wanted('bundle',name)) continue;
    const bytes=execFileSync(executable,['--bundle','--minify','--format=esm','--platform=browser','--target=es2022',`--sourcefile=${resolve(dist,'suite-entry.js')}`],{ cwd:dist,input,maxBuffer:32*1024*1024 });
    rows.push({ group:'bundle',name,minifiedBytes:bytes.length,gzipBytes:gzipSync(bytes,{level:9}).length });
  }
  report.results.push(...rows); console.table(rows);
}
if(['full','createChart','indicator','datafeed','dist and embedded wasm'].some(name => wanted('bundle',name))) await bundleCases();
if(args.json) { const path=resolve(args.json); await mkdir(dirname(path),{recursive:true}); await writeFile(path,JSON.stringify(report,null,2)+'\n'); console.log(`JSON: ${path}`); }
// Retain operation results through the timing loop.
void sink;
