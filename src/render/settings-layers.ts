import type { Canvas2DLike } from '../dom.js';
import type { RenderView } from './renderer.js';
import { contrastingTextColor } from '../color.js';

/** Reference lines and axis badges share the main pane's active transform. */
export function drawPriceReferences(ctx: Canvas2DLike, view: RenderView): void {
  const pane = view.panes[0];
  if (!pane || view.candles.length === 0) return;
  const { config, candles, range, plotWidth } = view;
  const { priceAxis: axis } = config;
  const axisWidth = view.canvasWidth - plotWidth;
  const last = view.liveCandle ?? candles[candles.length - 1];
  const color = last.close >= last.open ? config.series.upColor : config.series.downColor;
  const entries: { value: number; color: string; line: boolean; label: boolean; prefix?: string }[] = [
    { value: last.close, color, line: axis.lines.lastPrice, label: axis.labels.lastPrice },
  ];
  const previous = candles[candles.length - 2];
  if (previous && axis.lines.previousClose) entries.push({ value: previous.close, color: config.crosshair.color, line: true, label: false });
  if (axis.lines.highLow || axis.labels.highLow) {
    let high = -Infinity, low = Infinity;
    for (let i = range.from; i < range.to; i++) {
      high = Math.max(high, candles[i].high);
      low = Math.min(low, candles[i].low);
    }
    entries.push(
      { value: high, color: config.series.upColor, line: axis.lines.highLow, label: axis.labels.highLow, prefix: 'H ' },
      { value: low, color: config.series.downColor, line: axis.lines.highLow, label: axis.labels.highLow, prefix: 'L ' },
    );
  }
  if (axis.labels.indicator) {
    for (const output of pane.indicators) for (const line of output.lines) {
      const value = line.values[Math.min(range.to, line.values.length) - 1];
      if (value != null) entries.push({ value, color: line.color, line: false, label: true });
    }
  }
  ctx.save();
  ctx.font = `${config.theme.fontSize}px ${config.theme.monoFamily}`;
  ctx.textBaseline = 'middle';
  const labelHeight = config.theme.fontSize + 8;
  for (const entry of entries) {
    const y = pane.priceScale.priceToY(entry.value);
    if (!Number.isFinite(y) || y < 0 || y > pane.layout.height) continue;
    if (entry.line) {
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();
    }
    if (entry.label && axis.visible) {
      const text = (entry.prefix ?? '') + pane.priceScale.format(entry.value, config.formatters.price, axis.precision);
      const x = axis.position === 'left' ? -axisWidth : plotWidth;
      const top = Math.max(0, Math.min(pane.layout.height - labelHeight, y - labelHeight / 2));
      ctx.fillStyle = entry.color;
      ctx.fillRect(x, top, axisWidth, labelHeight);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, top, axisWidth, labelHeight); ctx.clip();
      ctx.fillStyle = contrastingTextColor(entry.color, config.theme.background);
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 4, top + labelHeight / 2);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The status line follows the hovered candle, falling back to the latest bar. */
export function drawStatusLine(ctx: Canvas2DLike, view: RenderView): void {
  const { config, candles } = view;
  const status = config.statusLine;
  if (!status.visible || candles.length === 0) return;
  const index = view.crosshair.active
    ? Math.min(candles.length - 1, Math.max(0, view.timeScale.xToIndex(view.crosshair.x, candles.length)))
    : candles.length - 1;
  const candle = (index === candles.length - 1 ? view.liveCandle : undefined) ?? candles[index];
  const precision = config.priceAxis.precision;
  const format = (value: number): string => precision === null ? config.formatters.price(value) : value.toFixed(Math.max(0, Math.min(12, precision)));
  const parts: string[] = [];
  if (status.symbolVisible) parts.push(status.symbol);
  if (status.ohlc) parts.push(`O ${format(candle.open)}  H ${format(candle.high)}  L ${format(candle.low)}  C ${format(candle.close)}`);
  if (status.change) {
    const base = candles[index - 1]?.close ?? candle.open;
    const change = candle.close - base;
    parts.push(`${change >= 0 ? '+' : ''}${format(change)} (${base === 0 ? '—' : (change / Math.abs(base) * 100).toFixed(2) + '%'})`);
  }
  if (status.volume) parts.push(`Vol ${candle.volume ?? 0}`);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, view.plotWidth, view.panes[0]?.layout.height ?? view.plotHeight); ctx.clip();
  ctx.font = `${config.theme.fontSize}px ${config.theme.monoFamily}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = config.theme.textColor;
  ctx.fillText(parts.join('   '), 12, 12);
  if (status.indicators) {
    let y = 12 + config.theme.fontSize + 8;
    for (const pane of view.panes) for (const output of pane.indicators) for (const line of output.lines) {
      const value = line.values[index];
      if (value == null) continue;
      ctx.fillStyle = line.color;
      ctx.fillText(`${line.key.toUpperCase()}  ${format(value)}`, 12, y);
      y += config.theme.fontSize + 6;
    }
  }
  ctx.restore();
}
