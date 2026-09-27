import { after, before, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Window } from 'happy-dom';
import type { Candle } from '../dist/core/data.js';
import type { ChartInstance, ChartProps } from '../dist/react/index.js';

const T0 = 1_700_000_100;
const candles: Candle[] = [0, 1, 2].map((i) => ({ time: T0 - (2 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));

type ReactModule = typeof import('react');
let React: ReactModule;
let act: (fn: () => void) => void;
let createRoot: typeof import('react-dom/client').createRoot;
let Chart: typeof import('../dist/react/index.js').Chart;

type Box = { append(node: Box): void };
const page = () => (globalThis as unknown as { document: { createElement(tag: string): Box; body: Box } }).document;

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/', width: 1024, height: 768 });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  act = React.act as typeof act;
  ({ createRoot } = await import('react-dom/client'));
  ({ Chart } = await import('../dist/react/index.js'));
});

after(async () => {
  await GlobalRegistrator.unregister();
});

/** Mounts `<Chart>` on a clock the test moves, counting overlay repaints of each chart it creates. */
function mount(t: TestContext, props: Omit<ChartProps, 'data' | 'now'>, strict = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the page window's timers, which the ticker reads
  let nowMs = T0 * 1000 + 400;
  const refreshes: number[] = [];
  const onReady = (chart: ChartInstance): void => {
    const slot = refreshes.push(0) - 1;
    const refresh = chart.refreshOverlay.bind(chart);
    chart.refreshOverlay = () => {
      refreshes[slot]!++;
      refresh();
    };
  };
  const host = page().createElement('div');
  page().body.append(host);
  const root = createRoot(host as never);
  const ref = React.createRef<ChartInstance | null>();
  const el = React.createElement(Chart, { ...props, data: candles, now: () => nowMs, onReady, ref });
  act(() => root.render(strict ? React.createElement(React.StrictMode, null, el) : el));
  return {
    ref, refreshes,
    /** Moves the chart clock and the page's timers on together by `ms` (a multiple of 100). */
    advance(ms: number): void {
      for (let step = 0; step < ms; step += 100) {
        nowMs += 100;
        t.mock.timers.tick(100);
      }
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe('<Chart> countdown ticker', () => {
  it('repaints a configured countdown every second on the page timers, following config changes', (t) => {
    const m = mount(t, { theme: 'dark', config: { wasm: false, statusLine: { visible: true, countdown: true } } });
    const chart = m.ref.current!;
    assert.deepEqual(m.refreshes, [0]);
    m.advance(600); // to the next whole second of the chart clock
    assert.deepEqual(m.refreshes, [1]);
    m.advance(1000);
    assert.deepEqual(m.refreshes, [2]);

    chart.updateConfig({ statusLine: { countdown: false } });
    m.advance(5000);
    assert.deepEqual(m.refreshes, [2], 'no countdown shown: the ticker stopped');

    chart.updateConfig({ priceAxis: { labels: { countdown: true } } });
    chart.updateConfig({ priceAxis: { labels: { lastPrice: true } } }); // still shown: one ticker
    m.advance(1000);
    assert.deepEqual(m.refreshes, [3], 'the price-label countdown starts it again');

    m.unmount();
    m.advance(5000);
    assert.deepEqual(m.refreshes, [3], 'unmount stops it');
  });

  it('starts nothing while no countdown is configured, until one is turned on', (t) => {
    const m = mount(t, { theme: 'dark', config: { wasm: false } });
    m.advance(5000);
    assert.deepEqual(m.refreshes, [0]);
    m.ref.current!.updateConfig({ statusLine: { visible: true, countdown: true } });
    m.advance(1000);
    assert.deepEqual(m.refreshes, [1]);
    m.unmount();
  });

  it('leaves the countdown to the host with countdownTicker={false}', (t) => {
    const m = mount(t, { theme: 'dark', countdownTicker: false, config: { wasm: false, statusLine: { visible: true, countdown: true } } });
    m.advance(5000);
    assert.deepEqual(m.refreshes, [0]);
    m.unmount();
  });

  it('runs one ticker per live chart under Strict Mode', (t) => {
    const m = mount(t, { theme: 'dark', config: { wasm: false, priceAxis: { labels: { countdown: true } } } }, true);
    assert.equal(m.refreshes.length, 2, 'mounted twice');
    m.advance(3000);
    assert.deepEqual(m.refreshes, [0, 3], 'the discarded chart\'s ticker stopped with it');
    m.unmount();
    m.advance(3000);
    assert.deepEqual(m.refreshes, [0, 3]);
  });

  it('arms its timers on the canvas\'s own window, not the global one', async (t) => {
    // Under GlobalRegistrator the page window is the global: a separate window tells them apart.
    t.mock.timers.enable({ apis: ['setTimeout'] }); // a ticker on the global timers would park its timer here
    const view = new Window({ url: 'http://localhost/', width: 1024, height: 768 });
    const armed = new Map<number, () => void>();
    const cleared: number[] = [];
    let seq = 0;
    Object.assign(view, {
      setTimeout: (handler: () => void) => {
        armed.set(++seq, handler);
        return seq;
      },
      clearTimeout: (id: number) => {
        cleared.push(id);
        armed.delete(id);
      },
    });
    let nowMs = T0 * 1000 + 400, refreshes = 0;
    const onReady = (chart: ChartInstance): void => {
      const refresh = chart.refreshOverlay.bind(chart);
      chart.refreshOverlay = () => {
        refreshes++;
        refresh();
      };
    };
    const host = view.document.createElement('div');
    view.document.body.appendChild(host);
    const root = createRoot(host as never);
    act(() => root.render(React.createElement(Chart, {
      data: candles, theme: 'dark', now: () => nowMs, onReady,
      config: { wasm: false, statusLine: { visible: true, countdown: true } },
    })));
    assert.equal(armed.size, 1, 'the first second is armed on the canvas window');
    t.mock.timers.tick(5000);
    assert.equal(refreshes, 0, 'nothing waits on the global timers');

    const [[first, tick]] = [...armed];
    armed.delete(first);
    nowMs += 600;
    tick();
    assert.equal(refreshes, 1);
    assert.equal(armed.size, 1, 'and re-armed there');

    const [[pending]] = [...armed];
    act(() => root.unmount());
    assert.deepEqual(cleared, [pending], 'unmount clears it on the same window');
    assert.equal(armed.size, 0);
    await view.happyDOM.close();
  });
});
