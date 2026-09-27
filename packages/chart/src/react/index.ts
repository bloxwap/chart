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
 * A brand `preset` keeps its colors: without a `theme` prop the chart does not follow the system
 * color scheme, since a built-in theme would replace the preset's colors (`preset` < `theme` < `config`).
 *
 * While the config shows a bar-close countdown (`statusLine.countdown` or
 * `priceAxis.labels.countdown`, also when turned on later), the component runs a countdown ticker
 * on the page's timers, so the countdown stays live in a quiet market.
 *
 * ```tsx
 * <Chart data={data} preset="bloxwapDark" />
 * ```
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
import { Chart as ChartInstance, createChart, type CreateChartOptions } from '../core/chart.js';
import type { ChartConfig, DeepPartial } from '../config.js';
import type { ChartPresetName } from '../presets.js';
import type { Candle } from '../core/data.js';
import type { ChartCanvas } from '../dom.js';
import { CHART_THEMES, type ThemeName } from '../themes.js';
import { startCountdownTicker, type CountdownTicker, type CountdownTickerOptions } from '../ui/countdown.js';

export type { ChartInstance };

/** A theme for {@link Chart}: a built-in theme, or `'system'` to follow the page's color scheme. */
export type ChartTheme = ThemeName | 'system';

/** The window members `'system'` reads, taken from the canvas's own document. */
interface ColorSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}
/** The canvas's window: color scheme and countdown timers. */
type CanvasView = CountdownTickerOptions['window'] & { matchMedia?(query: string): ColorSchemeQuery };
type ReactCanvas = ChartCanvas & {
  readonly ownerDocument?: { readonly defaultView: CanvasView | null } | null;
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

/**
 * Runs a countdown ticker on `view`'s timers while the chart's config shows a countdown, following
 * each rendered `statusLine` or `priceAxis` change (`Chart.subscribeConfigChange`), not resizes or
 * other sections. Returns its stop function.
 */
function followCountdown(chart: ChartInstance, view: CanvasView): () => void {
  let ticker: CountdownTicker | null = null;
  const sync = (): void => {
    const { statusLine, priceAxis } = chart.getConfig();
    if (statusLine.countdown || priceAxis.labels.countdown) ticker ??= startCountdownTicker({ chart, window: view });
    else {
      ticker?.stop();
      ticker = null;
    }
  };
  sync();
  const off = chart.subscribeConfigChange(({ keys }) => {
    if (keys.includes('statusLine') || keys.includes('priceAxis')) sync();
  });
  return () => {
    off();
    ticker?.stop();
  };
}

/** `createChart` options for the mount-time props that are set. */
function mountOptions(theme: ThemeName | null, preset: ChartProps['preset'], now: ChartProps['now']): Partial<Pick<CreateChartOptions, 'theme' | 'preset' | 'now'>> {
  return { ...(theme !== null ? { theme } : {}), ...(preset !== undefined ? { preset } : {}), ...(now !== undefined ? { now } : {}) };
}

/** Props for {@link Chart}. */
export interface ChartProps {
  /** Candles to display; a new array replaces the data. */
  data: readonly Candle[];
  /**
   * Color theme; changes are applied live. Default `'system'`, which follows the color scheme,
   * or none when a `preset` was set at mount (so the preset keeps its colors).
   */
  theme?: ChartTheme;
  /**
   * A named brand preset or config partial, applied once at mount under `theme` and `config`
   * (`preset` < `theme` < `config`).
   */
  preset?: ChartPresetName | DeepPartial<ChartConfig>;
  /** Initial configuration, applied once at mount. Use the chart instance for later changes. */
  config?: DeepPartial<ChartConfig>;
  /** Wall clock in ms for the bar-close countdown, read at mount. Default `() => Date.now()`. */
  now?: () => number;
  /**
   * Repaints the bar-close countdown every second while the config shows one, on the canvas
   * window's timers. Read at mount. Default `true`; `false` when you run your own `startCountdownTicker`.
   */
  countdownTicker?: boolean;
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
  // The theme default follows the preset read at mount, like the preset itself, not a later prop.
  const mountedPreset = useRef(props.preset !== undefined).current;
  const { data, preset, now, countdownTicker = true, theme = mountedPreset ? undefined : 'system', config, height = DEFAULT_CHART_HEIGHT, className, style, onReady } = props;
  const canvasRef = useRef<ReactCanvas | null>(null);
  const appliedTheme = useRef<ThemeName | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  // Create in a layout effect so the canvas exists and `ref` resolves to the instance on first commit.
  useLayoutEffect(() => {
    appliedTheme.current = theme === undefined ? null : resolveTheme(theme, colorSchemeQuery(canvasRef));
    const chart = createChart({
      container: canvasRef.current!,
      autoResize: true,
      ...mountOptions(appliedTheme.current, preset, now),
      config: { ...config, data: [...data] },
    });
    chartRef.current = chart;
    // `autoResize` has already required the canvas's window.
    const stopCountdown = countdownTicker ? followCountdown(chart, canvasRef.current!.ownerDocument!.defaultView!) : null;
    onReady?.(chart);
    return () => {
      stopCountdown?.();
      chart.destroy();
      chartRef.current = null;
    };
    // Mount-only on purpose: data and theme have their own effects below; preset, config, now and countdownTicker are initial by design.
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
    if (theme === undefined) return; // a preset without a theme keeps its colors
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
