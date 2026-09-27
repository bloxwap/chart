import type { Canvas2DLike } from '../dom.js';
import type { RenderView } from './renderer.js';
import { contrastingTextColor } from '../color.js';
import { scaleFont } from './scale-font.js';
import { barIsUp } from '../series/direction.js';
import { pushCountdownSegment, type StatusSegment } from './countdown.js';
import { lastDisplayedBar, priceBadgeHeight, priceBadgeTop } from './price-badge.js';
import { indicatorRightEdge, lineColorAt, lineValueAt } from './indicator-draw.js';

/** Reference lines and axis badges share the main pane's active transform. */
export function drawPriceReferences(ctx: Canvas2DLike, view: RenderView): void {
  const pane = view.panes[0];
  if (!pane || view.candles.length === 0) return;
  const { config, range, plotWidth } = view, candles = view.displayCandles ?? view.candles;
  const { priceAxis: axis } = config;
  const axisWidth = view.canvasWidth - plotWidth;
  const { bar: last, color } = lastDisplayedBar(view);
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
    // Each line's badge reads its last plotted bar in view (offsets applied).
    const to = indicatorRightEdge(range, view.timeScale, candles.length);
    for (const output of pane.indicators) for (const line of output.lines) {
      const at = Math.min(to, line.values.length + (line.offset ?? 0)) - 1;
      const value = lineValueAt(line, at);
      if (value != null && at >= range.from) entries.push({ value, color: lineColorAt(line, at), line: false, label: true });
    }
  }
  ctx.save();
  ctx.font = scaleFont(config.theme);
  ctx.textBaseline = 'middle';
  const labelHeight = priceBadgeHeight(config.theme);
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
      const top = priceBadgeTop(y, pane.layout.height, labelHeight);
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

/** Inset (CSS px) of the status line from the plot's top-left corner. */
const STATUS_INSET = 12;

/**
 * The status line follows the hovered candle, falling back to the latest bar.
 * Segments whose text would cross the plot's right edge (where the line is
 * clipped) wrap onto further rows (never splitting one, and keeping the
 * countdown with the segment before it), so a phone-width chart shows every
 * value; indicator rows follow. A line that fits draws as one row.
 */
export function drawStatusLine(ctx: Canvas2DLike, view: RenderView): void {
  const { config } = view, candles = view.displayCandles ?? view.candles;
  const status = config.statusLine;
  if (!status.visible || candles.length === 0) return;
  const index = view.crosshair.active
    ? Math.min(candles.length - 1, Math.max(0, view.timeScale.xToIndex(view.crosshair.x, candles.length)))
    : candles.length - 1;
  const candle = (index === candles.length - 1 ? view.liveCandle : undefined) ?? candles[index];
  const precision = config.priceAxis.precision;
  const format = (value: number): string => precision === null ? config.formatters.price(value) : value.toFixed(Math.max(0, Math.min(12, precision)));
  const direction = barIsUp(config.series, candles, index, candle) ? config.series.upColor : config.series.downColor;
  const segments: StatusSegment[] = [];
  if (status.symbolVisible) segments.push({ text: status.symbol, color: config.theme.textColor, gap: '   ' });
  if (status.ohlc) {
    segments.push({ text: `O ${format(candle.open)}`, color: direction, gap: ' ' });
    segments.push({ text: `H ${format(candle.high)}`, color: direction, gap: ' ' });
    segments.push({ text: `L ${format(candle.low)}`, color: direction, gap: ' ' });
    segments.push({ text: `C ${format(candle.close)}`, color: direction, gap: '   ' });
  }
  if (status.change) {
    const base = candles[index - 1]?.close ?? candle.open;
    const change = candle.close - base;
    const percent = base === 0 ? '—' : `${change >= 0 ? '+' : ''}${(change / Math.abs(base) * 100).toFixed(2)}%`;
    segments.push({ text: `${change >= 0 ? '+' : ''}${format(change)} (${percent})`, color: change >= 0 ? config.series.upColor : config.series.downColor, gap: '   ' });
  }
  if (status.volume) segments.push({ text: `Volume ${Number((candle.volume ?? 0).toFixed(2))}`, color: config.theme.textColor, gap: '' });
  if (status.countdown) pushCountdownSegment(segments, view);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, view.plotWidth, view.panes[0]?.layout.height ?? view.plotHeight); ctx.clip();
  ctx.font = `${config.theme.fontSize}px ${config.theme.monoFamily}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const rowHeight = config.theme.fontSize + 6;
  // Each segment's advance (text and gap) is measured once per frame, as the single-row layout always did.
  const advances = segments.map((segment) => ctx.measureText(segment.text + segment.gap).width);
  let x = STATUS_INSET;
  let top = STATUS_INSET;
  for (let start = 0; start < segments.length;) {
    // A segment and the ones attached after it share a row; a group whose text would cross the clip starts the next.
    let end = start + 1;
    let span = advances[start]!;
    while (segments[end]?.attach === true) span += advances[end++]!;
    // The trailing gap is only measured apart when the group overflows with it.
    if (x > STATUS_INSET && x + span > view.plotWidth && x + span - advances[end - 1]! + ctx.measureText(segments[end - 1]!.text).width > view.plotWidth) {
      x = STATUS_INSET;
      top += rowHeight;
    }
    for (let i = start; i < end; i++) {
      ctx.fillStyle = segments[i]!.color;
      ctx.fillText(segments[i]!.text, x, top);
      x += advances[i]!;
    }
    start = end;
  }
  if (status.indicators) {
    let y = top + config.theme.fontSize + 8;
    for (const pane of view.panes) for (let i = 0; i < pane.indicators.length; i++) {
      const labels = pane.indicatorLabels?.[i];
      for (const line of pane.indicators[i].lines) {
        const value = lineValueAt(line, index);
        if (value == null) continue;
        ctx.fillStyle = lineColorAt(line, index);
        ctx.fillText(`${labels?.get(line.key) ?? line.key.toUpperCase()}  ${format(value)}`, STATUS_INSET, y);
        y += rowHeight;
      }
    }
  }
  ctx.restore();
}
