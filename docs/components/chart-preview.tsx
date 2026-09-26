'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, type Candle, type Chart, type SeriesType } from '@bloxwap/chart';
import { createDrawingToolbar, createChartSettings, type DrawingToolbar } from '@bloxwap/chart/ui';

function sampleCandles(): Candle[] {
  let price = 64200;
  return Array.from({ length: 180 }, (_, index) => {
    const open = price;
    price += Math.sin(index * 1.7) * 120 + Math.cos(index * 0.31) * 65 + 8;
    return { time: 1700000000 + index * 3600, open, close: price,
      high: Math.max(open, price) + 40 + (index % 5) * 9,
      low: Math.min(open, price) - 40 - (index % 7) * 8,
      volume: 500 + (index * 137) % 2000 };
  });
}

export function ChartPreview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const chart = useRef<Chart | null>(null);
  const toolbar = useRef<DrawingToolbar | null>(null);
  const [type, setType] = useState<SeriesType>('candlestick');
  const [rsi, setRsi] = useState(false);

  useEffect(() => {
    if (!canvas.current || !stage.current || !rail.current || !gear.current) return;
    const instance = createChart({ container: canvas.current, config: {
      data: sampleCandles(),
      // sRGB counterparts of the shared Bloxwap tokens, also used by color inputs.
      series: {
        upColor: '#00ff3f', downColor: '#ff479c', lineColor: '#00ff3f', areaFillColor: '#00ff3f',
        wickUpColor: '#00ff3f', wickDownColor: '#ff479c', borderUpColor: '#00ff3f', borderDownColor: '#ff479c',
      },
      theme: {
        background: '#0a0a0a', textColor: '#a1a1a1', borderColor: '#242424',
        fontFamily: getComputedStyle(document.body).fontFamily,
        monoFamily: getComputedStyle(document.body).getPropertyValue('--font-docs-mono').trim(), fontSize: 11,
      },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
      crosshair: { color: '#a1a1a1' },
      statusLine: { symbol: 'BTC / USD' },
      priceAxis: { width: 76, labels: { lastPrice: true }, lines: { lastPrice: true } },
      timeAxis: { tickCount: 3 },
      formatters: { time: (seconds) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(seconds * 1000)) },
    } });
    const tools = createDrawingToolbar({ chart: instance, document, canvas: canvas.current, rail: rail.current, overlay: stage.current, keyboard: false, favorites: [], applyChartTheme: false });
    const settings = createChartSettings({ chart: instance, document, trigger: gear.current,
      onOpen: () => { tools.cancelNavigation(); tools.flyouts.close(); },
      onChange: () => tools.refreshViewport(),
    });
    chart.current = instance; toolbar.current = tools;
    const resize = () => {
      if (!stage.current) return;
      tools.cancelNavigation();
      instance.resize(stage.current.clientWidth, stage.current.clientHeight, window.devicePixelRatio || 1);
      tools.refreshViewport();
    };
    const observer = new ResizeObserver(resize); observer.observe(stage.current); resize();
    instance.scale.zoomToRange(85, 179);
    return () => {
      observer.disconnect(); settings.destroy(); tools.destroy(); instance.destroy();
      chart.current = null; toolbar.current = null;
    };
  }, []);

  function selectType(value: SeriesType) { setType(value); chart.current?.updateConfig({ series: { type: value } }); }
  function toggleRsi() {
    if (!chart.current) return;
    if (rsi) chart.current.removeIndicator('preview-rsi');
    else chart.current.addIndicator({ id: 'preview-rsi', name: 'rsi' });
    setRsi(!rsi);
  }
  return <div className="chart-preview not-prose">
    <div className="preview-header"><div><strong>BTC / USD</strong><span className="preview-interval">1h</span></div><span className="demo-label"><span /> Sample data</span></div>
    <div className="preview-controls">
      <label>Series<select aria-label="Chart series" value={type} onChange={(event) => selectType(event.target.value as SeriesType)}>
        <option value="candlestick">Candlestick</option><option value="line">Line</option><option value="area">Area</option><option value="bar">OHLC bars</option>
      </select></label>
      <button type="button" aria-pressed={rsi} onClick={toggleRsi}>RSI {rsi ? '−' : '+'}</button>
      <button type="button" onClick={() => { toolbar.current?.cancelNavigation(); chart.current?.scale.zoomToRange(85, 179); toolbar.current?.refreshViewport(); }}>Reset view</button>
      <button ref={gear} type="button" className="preview-settings" title="Chart settings" aria-label="Chart settings">⚙</button>
    </div>
    <div className="preview-body"><div ref={rail} className="preview-rail" /><div ref={stage} className="preview-stage"><canvas ref={canvas} aria-label="Interactive candlestick chart with sample Bitcoin prices" /></div></div>
    <div className="preview-footer"><span>Drag to pan · scroll to zoom</span><span>Rendered by @bloxwap/chart</span></div>
  </div>;
}
