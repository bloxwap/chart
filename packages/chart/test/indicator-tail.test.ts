import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_INDICATORS, createIndicatorRegistry } from '../dist/indicators/index.js';
import { createChart, type Candle, type IndicatorOutput } from '../dist/index.js';
import { MockCanvas, MockDocument } from '../dist/dom.js';
import { initWasm } from '../dist/wasm/loader.js';
import { updateSma } from '../dist/indicators/sma.js';
import { updateEma } from '../dist/indicators/ema.js';
import { updateRsi } from '../dist/indicators/rsi.js';
import { stochRsiValues } from '../dist/indicators/stochrsi.js';
import { updateSparse } from '../dist/indicators/rolling.js';

const names = ['sma', 'ema', 'boll', 'macd', 'rsi', 'ma-ribbon', 'supertrend', 'stoch', 'stochrsi', 'psar'];
const defs = BUILTIN_INDICATORS.filter(def => names.includes(def.name));

function walk(length: number, seed: number, flat = false): Candle[] {
  let close = 100;
  return Array.from({ length }, (_, time) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const open = close;
    close += flat ? 0 : seed / 4294967296 - 0.5;
    return { time, open, close, high: Math.max(open, close) + (flat ? 0 : 1), low: Math.min(open, close) - (flat ? 0 : 1), volume: seed % 100 };
  });
}

const variants = [
  {},
  { period: 1, fast: 1, slow: 2, signal: 1, rsi: 1, stoch: 1, k: 1, d: 1, smoothK: 1, smoothD: 1, len1: 1, len2: 2, len3: 0, len4: 0 },
  { period: 7, fast: 3, slow: 9, signal: 4, rsi: 5, stoch: 6, k: 2, d: 4, smoothK: 3, smoothD: 2, type: 0, len1: 3, len2: 7, len3: 11, len4: 0, mult: 1.3, multiplier: 1.7, start: 0.03, increment: 0.04, max: 0.3 },
];

// node:assert/strict's deep comparison uses Object.is for number leaves,
// distinguishing signed zero, preserving NaN, and checking every null slot.
describe('bit-exact indicator tails', () => {
  for (const def of defs) it(def.name, async () => {
    for (const kernels of [null, await initWasm()]) for (const seed of [1, 47, 901]) {
      for (const params of variants) for (const initial of [0, 3, 1000]) {
        const pool = walk(initial + 300, seed, seed === 47);
        const candles = pool.slice(0, initial);
        let output = def.compute(candles, params, [], kernels);
        for (let tick = 0; tick < 36; tick++) {
          let from = candles.length;
          if (tick % 6 < 3 && candles.length) {
            from--;
            const c = candles[from]!;
            const close = seed === 901 && tick % 3 === 0 ? NaN : c.close + (tick % 2 ? 0.123 : -0.321);
            candles[from] = { ...c, close };
          } else {
            const count = tick % 6 === 5 ? 31 : 1;
            if (count === 31 && candles.length) {
              from--;
              candles[from] = { ...candles[from]!, close: candles[from]!.close + 0.017 };
            }
            candles.push(...pool.slice(candles.length, candles.length + count));
          }
          output = def.update!(output, candles, from, params, [], kernels) ?? def.compute(candles, params, [], kernels);
          assert.deepEqual(output, def.compute(candles, params, [], kernels), `${def.name}, seed ${seed}, length ${initial}, tick ${tick}, ${JSON.stringify(params)}`);
        }
      }
    }
  });

  it('returns the output for normal WASM appends and replacements for all ten hooks', async () => {
    const kernels = await initWasm();
    assert.ok(kernels);
    for (const def of defs) {
      const candles = walk(1001, 17);
      const next = candles.pop()!;
      const output = def.compute(candles, {}, [], kernels);
      candles[999] = { ...candles[999]!, close: 101.123 };
      assert.equal(def.update!(output, candles, 999, {}, [], kernels), output, def.name);
      candles.push(next);
      assert.equal(def.update!(output, candles, 1000, {}, [], kernels), output, def.name);
      assert.deepEqual(output, def.compute(candles, {}, [], kernels));
    }
  });

  it('also checks the ten existing hooks through mixed live operations', () => {
    for (const def of BUILTIN_INDICATORS.filter(def => !names.includes(def.name))) {
      for (const seed of [17, 31]) {
        const pool = walk(1200, seed);
        const candles = pool.slice(0, 1000);
        let output = def.compute(candles, {}, [], null);
        for (let tick = 0; tick < 30; tick++) {
          const from = candles.length - 1;
          candles[from] = { ...candles[from]!, close: candles[from]!.close + 0.003 * tick };
          if (tick % 3 === 0) candles.push(...pool.slice(candles.length, candles.length + 7));
          output = def.update!(output, candles, from, {}, [], null) ?? def.compute(candles, {}, [], null);
          assert.deepEqual(output, def.compute(candles, {}, [], null), def.name);
        }
      }
    }
  });

  it('resumes StochRSI while its RSI lookback still contains warmup nulls', async () => {
    for (const kernels of [null, await initWasm()]) {
      const def = defs.find(def => def.name === 'stochrsi')!;
      const candles = walk(15, 59);
      const output = def.compute(candles, {}, [], kernels);
      candles.push(walk(16, 59)[15]!);
      assert.equal(def.update!(output, candles, 15, {}, [], kernels), output);
      assert.deepEqual(output, def.compute(candles, {}, [], kernels));
    }
  });

  it('preserves sparse helper outputs for invalid stochastic lengths', () => {
    const closes = walk(40, 42).map(c => c.close);
    for (const [stoch, k] of [[0, 3], [NaN, 3], [Infinity, 3], [14, 0], [14, NaN], [14, Infinity]]) {
      const output = stochRsiValues(closes, 14, stoch!, k!, 3);
      assert.deepEqual(output, { k: new Array(40).fill(null), d: new Array(40).fill(null) });
    }
  });

  it('rejects unavailable state, early/deep edits, large batches and unsupported periods', () => {
    const candles = walk(1000, 32);
    for (const def of defs) {
      for (const params of [{}, { period: Infinity, signal: Infinity }, { period: NaN, signal: NaN }, { type: 0 }, { len1: 10000 }, { rsi: 2000 }, { smoothK: 2000 }, { k: 2000 }]) {
        for (const from of [-1, 0, 1, 50, 998, 999, 1000]) {
          const input = candles.slice();
          const output = def.compute(input, params, [], null);
          if (from >= 0 && from < input.length) input[from] = { ...input[from]!, close: Infinity };
          const updated = def.update!(output, input, from, params, [], null);
          assert.deepEqual(updated ?? def.compute(input, params, [], null), def.compute(input, params, [], null), def.name);
        }
      }
      const output = def.compute(candles, {}, [], null);
      // Rewrapped arrays deliberately have no private checkpoints.
      const unknown = { ...output, lines: output.lines.map(line => ({ ...line, values: [...line.values] })) };
      const result = def.update!(unknown, candles, 999, {}, [], null);
      assert.deepEqual(result ?? def.compute(candles, {}, [], null), def.compute(candles, {}, [], null));
      const grown = [...candles, ...walk(4000, 5)];
      assert.equal(def.update!(output, grown, 1000, {}, [], null), undefined);
    }
    assert.equal(updateSma([], candles, 999, 20), false);
    assert.equal(updateEma([], candles, 999, 20), false);
    assert.equal(updateRsi([], candles, 999, 14), false);
    assert.equal(updateSparse([], [], 1, 3), false);
  });

  for (const wasm of [false, true]) it(`renders exact tails through appendData and uses every hook (wasm: ${wasm})`, async () => {
    const kernels = wasm ? await initWasm() : null;
    const registry = createIndicatorRegistry(false);
    const counts = new Map<string, number>();
    for (const def of defs) registry.register({ ...def,
      update(...args) {
        const result = def.update!(...args);
        assert.equal(result, args[0], `${def.name} must stay incremental`);
        counts.set(def.name, (counts.get(def.name) ?? 0) + 1);
        return result;
      },
    });
    const candles = walk(1100, 28).slice(0, 1000);
    const chart = createChart({ container: new MockCanvas(900, 700), document: new MockDocument(),
      registries: { indicators: registry }, config: { wasm, data: candles } });
    await chart.ready;
    const colors = ['#123456', '#654321', '#246810', '#135791', '#abcdef', '#fedcba', '#112233', '#445566'];
    for (const def of defs) chart.addIndicator({ name: def.name, colors });
    for (let tick = 0; tick < 40; tick++) {
      if (tick % 4 === 0) candles.push(walk(1100, 28)[candles.length]!);
      else {
        const last = candles.at(-1)!;
        candles[candles.length - 1] = { ...last, close: last.close + 0.12 };
      }
      chart.appendData(candles.at(-1)!);
      const renderedIndicators = (chart as unknown as { lastIndicators: { cfg: { name: string }; output: IndicatorOutput }[] }).lastIndicators;
      for (const def of defs) {
        const rendered = renderedIndicators.find(item => item.cfg.name === def.name)!.output;
        const expected = def.compute(candles, def.defaultParams, colors, kernels);
        assert.deepEqual(rendered, expected, def.name);
      }
    }
    for (const def of defs) assert.equal(counts.get(def.name), 40);
    chart.destroy();
  });
});
