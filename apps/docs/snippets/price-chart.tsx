'use client';

import { useEffect, useRef } from 'react';
import { CHART_THEMES, createChart } from '@bloxwap/chart';
import type { Candle } from '@bloxwap/chart';

export function PriceChart({ data }: { data: Candle[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const chart = createChart({
      container: el,
      config: { data, ...CHART_THEMES.dark },
    });
    const fit = () =>
      chart.resize(el.clientWidth, el.clientHeight, devicePixelRatio);
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [data]);

  return <canvas ref={canvas} style={{ width: '100%', height: 360 }} />;
}
