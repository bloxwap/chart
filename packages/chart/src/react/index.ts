'use client';

/**
 * `@bloxwap/chart/react` — a React component for the chart. React is an optional peer dependency;
 * the core package stays dependency-free.
 *
 * ```tsx
 * import { Chart } from '@bloxwap/chart/react';
 *
 * export function PriceChart({ data }) {
 *   return <Chart data={data} theme="dark" height={360} />;
 * }
 * ```
 *
 * The component creates the chart after mount, fits it to its box (`autoResize`), replaces the data
 * when `data` changes, follows `theme`, and destroys the chart on unmount. Pass a `ref` (or
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

/** Props for {@link Chart}. */
export interface ChartProps {
  /** Candles to display; a new array replaces the data. */
  data: readonly Candle[];
  /** Built-in color theme; changes are applied live. */
  theme?: ThemeName;
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
  const { data, theme, config, height = DEFAULT_CHART_HEIGHT, className, style, onReady } = props;
  const canvasRef = useRef<ChartCanvas | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  // Create in a layout effect so the canvas exists and `ref` resolves to the instance on first commit.
  useLayoutEffect(() => {
    const chart = createChart({
      container: canvasRef.current!,
      autoResize: true,
      ...(theme !== undefined ? { theme } : {}),
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

  const appliedTheme = useRef(theme);
  useEffect(() => {
    if (theme === appliedTheme.current) return;
    appliedTheme.current = theme;
    if (theme !== undefined) chartRef.current?.updateConfig(CHART_THEMES[theme]);
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
