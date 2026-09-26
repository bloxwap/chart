import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Candle } from '../dist/core/data.js';
import type { ChartInstance, ChartProps } from '../dist/react/index.js';

const candles = (n: number, start = 10): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: 1700000000 + i * 60, open: start, high: start + 1, low: start - 1, close: start + 0.5 }));

type ReactModule = typeof import('react');
type Harness = {
  React: ReactModule;
  act: (fn: () => void) => void;
  Chart: typeof import('../dist/react/index.js').Chart;
  createRoot: typeof import('react-dom/client').createRoot;
  StrictMode: ReactModule['StrictMode'];
};
let h: Harness;

/** The DOM surface these tests read (the test build has no DOM lib; happy-dom provides it at runtime). */
type Box = { tagName: string; className: string; style: Record<string, string>; firstElementChild: Box | null; append(node: Box): void };
const page = () => (globalThis as unknown as { document: { createElement(tag: string): Box; body: Box } }).document;

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/', width: 1024, height: 768 });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Chart } = await import('../dist/react/index.js');
  h = { React, act: React.act as Harness['act'], Chart, createRoot, StrictMode: React.StrictMode };
});

after(async () => {
  await GlobalRegistrator.unregister();
});

function mount(props: ChartProps, strict = false) {
  const host = page().createElement('div');
  page().body.append(host);
  const root = h.createRoot(host as never);
  const ref = h.React.createRef<ChartInstance | null>();
  const render = (next: ChartProps): void => {
    const el = h.React.createElement(h.Chart, { ...next, ref });
    h.act(() => root.render(strict ? h.React.createElement(h.StrictMode, null, el) : el));
  };
  render(props);
  return { host, root, ref, render, unmount: () => h.act(() => root.unmount()) };
}

describe('<Chart />', () => {
  it('creates an auto-resizing chart in a box, exposes it, and cleans up', () => {
    let ready: ChartInstance | null = null;
    const m = mount({ data: candles(20), theme: 'dark', height: 360, config: { wasm: false }, onReady: (c) => { ready = c; } });
    const box = m.host.firstElementChild as Box;
    const canvas = box.firstElementChild as Box;
    assert.equal(box.tagName, 'DIV');
    assert.equal(box.style.height, '360px');
    assert.equal(box.style.position, 'relative');
    assert.equal(canvas.tagName, 'CANVAS');
    assert.equal(canvas.style.position, 'absolute', 'autoResize fills the box');
    const chart = m.ref.current!;
    assert.ok(chart !== null);
    assert.equal(ready, chart);
    assert.equal(chart.dataLength, 20);
    assert.equal(chart.getConfig().theme.background, '#0a0a0a');
    m.unmount();
    assert.equal(m.ref.current, null);
  });

  it('replaces data and follows theme changes without recreating the chart', () => {
    const first = candles(10);
    const m = mount({ data: first, theme: 'dark', config: { wasm: false } });
    const chart = m.ref.current!;
    m.render({ data: first, theme: 'dark', config: { wasm: false } }); // same props: no updates
    m.render({ data: candles(25, 20), theme: 'dark', config: { wasm: false } });
    assert.equal(m.ref.current, chart, 'same instance');
    assert.equal(chart.dataLength, 25);
    m.render({ data: candles(25, 20), theme: 'light', config: { wasm: false } });
    assert.equal(chart.getConfig().theme.background, '#ffffff');
    m.render({ data: candles(25, 20), config: { wasm: false } }); // theme removed: keeps the current colors
    assert.equal(chart.getConfig().theme.background, '#ffffff');
    m.unmount();
  });

  it('defaults the height, passes className and style through, and works without a theme', () => {
    const m = mount({ data: candles(5), className: 'price', style: { borderRadius: '12px' }, config: { wasm: false } });
    const box = m.host.firstElementChild as Box;
    assert.equal(box.className, 'price');
    assert.equal(box.style.height, '400px');
    assert.equal(box.style.borderRadius, '12px');
    assert.equal(m.ref.current!.getConfig().theme.background, '#ffffff');
    m.unmount();
  });

  it('survives Strict Mode double mounting', () => {
    const m = mount({ data: candles(8), theme: 'dark', config: { wasm: false } }, true);
    assert.equal(m.ref.current!.dataLength, 8);
    m.render({ data: candles(12), theme: 'dark', config: { wasm: false } });
    assert.equal(m.ref.current!.dataLength, 12);
    m.unmount();
  });

  it('mounts without a config', () => {
    const m = mount({ data: candles(3) });
    assert.equal(m.ref.current!.dataLength, 3);
    m.unmount();
  });
});
