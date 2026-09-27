/** `<Chart preset now>`: a brand preset keeps its colors unless a theme is asked for. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Candle } from '../dist/core/data.js';
import type { ChartInstance, ChartProps } from '../dist/react/index.js';
import { CHART_THEMES } from '../dist/themes.js';

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: T0 + i * 60, open: 10, high: 11, low: 9, close: 10.5 }));

type ReactModule = typeof import('react');
type Harness = {
  React: ReactModule;
  act: (fn: () => void) => void;
  Chart: typeof import('../dist/react/index.js').Chart;
  createRoot: typeof import('react-dom/client').createRoot;
};
let h: Harness;

type Box = { append(node: Box): void };
const page = () => (globalThis as unknown as { document: { createElement(tag: string): Box; body: Box } }).document;

/** A controllable `(prefers-color-scheme: dark)` query. */
const listeners = new Set<() => void>();
const scheme = { matches: false, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) };
let original: unknown;

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/', width: 1024, height: 768 });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const view = globalThis as unknown as { matchMedia: unknown };
  original = view.matchMedia;
  view.matchMedia = () => scheme;
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Chart } = await import('../dist/react/index.js');
  h = { React, act: React.act as Harness['act'], Chart, createRoot };
});

after(async () => {
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = original;
  await GlobalRegistrator.unregister();
});

function mount(props: ChartProps) {
  const host = page().createElement('div');
  page().body.append(host);
  const root = h.createRoot(host as never);
  const ref = h.React.createRef<ChartInstance | null>();
  const render = (next: ChartProps): void => h.act(() => root.render(h.React.createElement(h.Chart, { ...next, ref })));
  render(props);
  return { ref, render, unmount: () => h.act(() => root.unmount()) };
}

describe('<Chart preset>', () => {
  it('keeps the preset colors without a theme prop and ignores the system scheme', () => {
    scheme.matches = true;
    const m = mount({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    const chart = m.ref.current!;
    assert.equal(chart.getConfig().theme.background, '#171717');
    assert.equal(chart.getConfig().series.upColor, '#00ff3f');
    assert.equal(chart.getConfig().volume.overlay, true);
    assert.equal(listeners.size, 0, 'no color-scheme listener');
    scheme.matches = false;
    m.render({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    assert.equal(chart.getConfig().theme.background, '#171717');
    m.unmount();
  });

  it('layers preset < theme < config, and a theme prop added later applies live', () => {
    const m = mount({ data: candles(5), preset: 'bloxwapDark', theme: 'light', config: { wasm: false, grid: { color: '#123456' } } });
    const chart = m.ref.current!;
    const config = chart.getConfig();
    assert.equal(config.theme.background, CHART_THEMES.light.theme!.background, 'the theme beats the preset');
    assert.equal(config.grid.color, '#123456', 'config beats both');
    assert.equal(config.theme.scaleFontSize, 11, 'preset-only tokens survive');
    m.unmount();

    const later = mount({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    const live = later.ref.current!;
    later.render({ data: candles(5), preset: 'bloxwapDark', theme: 'light', config: { wasm: false } });
    assert.equal(live.getConfig().theme.background, CHART_THEMES.light.theme!.background);
    later.render({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    assert.equal(live.getConfig().theme.background, CHART_THEMES.light.theme!.background, 'removing the theme leaves the colors as they are');
    later.unmount();
  });

  it('keys the default theme on the preset given at mount, as the preset itself is', () => {
    scheme.matches = false;
    const m = mount({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    const chart = m.ref.current!;
    m.render({ data: candles(5), config: { wasm: false } });
    assert.deepEqual([chart.getConfig().theme.background, chart.getConfig().series.upColor], ['#171717', '#00ff3f'],
      'dropping the preset prop does not bring in the system theme');
    assert.equal(listeners.size, 0);
    m.unmount();

    const plain = mount({ data: candles(5), config: { wasm: false } });
    const live = plain.ref.current!;
    assert.equal(listeners.size, 1);
    plain.render({ data: candles(5), preset: 'bloxwapDark', config: { wasm: false } });
    assert.equal(listeners.size, 1, 'a preset added later is never applied, so the chart keeps following the scheme');
    assert.equal(live.getConfig().theme.background, CHART_THEMES.light.theme!.background);
    scheme.matches = true;
    for (const l of listeners) l();
    assert.equal(live.getConfig().theme.background, CHART_THEMES.dark.theme!.background);
    plain.unmount();
    assert.equal(listeners.size, 0);
  });

  it('follows the system scheme over a preset when theme is "system"', () => {
    scheme.matches = true;
    const m = mount({ data: candles(5), preset: 'bloxwapDark', theme: 'system', config: { wasm: false } });
    const chart = m.ref.current!;
    assert.equal(chart.getConfig().theme.background, CHART_THEMES.dark.theme!.background);
    assert.equal(listeners.size, 1);
    scheme.matches = false;
    for (const l of listeners) l();
    assert.equal(chart.getConfig().theme.background, CHART_THEMES.light.theme!.background);
    m.unmount();
    assert.equal(listeners.size, 0);
  });

  it('accepts a preset config partial', () => {
    const m = mount({ data: candles(5), preset: { theme: { background: '#010203' } }, config: { wasm: false } });
    assert.equal(m.ref.current!.getConfig().theme.background, '#010203');
    m.unmount();
  });
});

describe('<Chart now>', () => {
  it('passes the clock through for the bar-close countdown', () => {
    const now = (T0 + 4 * 60 + 15) * 1000;
    const m = mount({ data: candles(5), theme: 'dark', now: () => now, config: { wasm: false } });
    assert.equal(m.ref.current!.now(), now);
    m.unmount();
  });
});
