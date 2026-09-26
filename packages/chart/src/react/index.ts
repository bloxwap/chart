'use client';

/**
 * `@bloxwap/chart/react` — a React component for the chart. React is an optional peer dependency;
 * the core package stays dependency-free.
 *
 * ```tsx
 * import { Chart } from '@bloxwap/chart/react';
 *
 * export function PriceChart({ data }) {
 *   return <Chart data={data} height={360} />;
 * }
 * ```
 *
 * The component creates the chart after mount, fits it to its box (`autoResize`), replaces the data
 * when `data` changes, follows `theme` (the system color scheme by default), and destroys the chart on unmount. Pass a `ref` (or
 * `onReady`) to reach the {@link ChartInstance} for indicators, drawings, and streaming updates.
 *
 * @module
 */

import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type RefObject,
  type CSSProperties,
  type ForwardedRef,
  type ReactElement,
} from 'react';
import { Chart as ChartInstance, createChart } from '../core/chart.js';
import type { ChartConfig, DeepPartial } from '../config.js';
import type { Candle } from '../core/data.js';
import type { ChartCanvas } from '../dom.js';
import { CHART_THEMES, type ThemeName } from '../themes.js';

export type { ChartInstance };

/** A theme for {@link Chart}: a built-in theme, or `'system'` to follow the page's color scheme. */
export type ChartTheme = ThemeName | 'system';

/** The window members `'system'` reads, taken from the canvas's own document. */
interface ColorSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}
type ReactCanvas = ChartCanvas & {
  readonly ownerDocument?: { readonly defaultView: { matchMedia?(query: string): ColorSchemeQuery } | null } | null;
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

function colorSchemeQuery(canvas: RefObject<ReactCanvas | null>): ColorSchemeQuery | undefined {
  return canvas.current?.ownerDocument?.defaultView?.matchMedia?.(DARK_QUERY);
}

/** Resolves `'system'` to the built-in theme matching the color scheme; light when it cannot be read. */
function resolveTheme(theme: ChartTheme, query: ColorSchemeQuery | undefined): ThemeName {
  if (theme !== 'system') return theme;
  return query?.matches ? 'dark' : 'light';
}

/** Props for {@link Chart}. */
export interface ChartProps {
  /** Candles to display; a new array replaces the data. */
  data: readonly Candle[];
  /** Color theme; changes are applied live. Default `'system'`, which follows the color scheme. */
  theme?: ChartTheme;
  /** Initial configuration, applied once at mount. Use the chart instance for later changes. */
  config?: DeepPartial<ChartConfig>;
  /** Height of the chart box (CSS length or pixels). Default `400`. The width fills the parent. */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Called once with the chart instance after it is created. */
  onReady?: (chart: ChartInstance) => void;
}

/** Default chart height in CSS pixels. */
export const DEFAULT_CHART_HEIGHT = 400;

function ChartComponent(props: ChartProps, ref: ForwardedRef<ChartInstance | null>): ReactElement {
  const { data, theme = 'system', config, height = DEFAULT_CHART_HEIGHT, className, style, onReady } = props;
  const canvasRef = useRef<ReactCanvas | null>(null);
  const appliedTheme = useRef<ThemeName | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  // Create in a layout effect so the canvas exists and `ref` resolves to the instance on first commit.
  useLayoutEffect(() => {
    appliedTheme.current = resolveTheme(theme, colorSchemeQuery(canvasRef));
    const chart = createChart({
      container: canvasRef.current!,
      autoResize: true,
      theme: appliedTheme.current,
      config: { ...config, data: [...data] },
    });
    chartRef.current = chart;
    onReady?.(chart);
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
    // Mount-only on purpose: data and theme have their own effects below; config is initial by design.
  }, []);

  useImperativeHandle<ChartInstance | null, ChartInstance | null>(ref, () => chartRef.current, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    chartRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    const query = colorSchemeQuery(canvasRef);
    const apply = (): void => {
      const name = resolveTheme(theme, query);
      if (name === appliedTheme.current) return;
      appliedTheme.current = name;
      chartRef.current?.updateConfig(CHART_THEMES[name]);
    };
    apply();
    if (theme !== 'system' || !query) return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);

  return createElement(
    'div',
    { className, style: { position: 'relative', width: '100%', height, ...style } },
    createElement('canvas', { ref: canvasRef as never }),
  );
}

/** A financial chart that fills its box. See the module docs for usage. */
export const Chart = forwardRef<ChartInstance | null, ChartProps>(ChartComponent);
Chart.displayName = 'Chart';
