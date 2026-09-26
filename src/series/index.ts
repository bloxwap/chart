/**
 * Series renderers and the type-string registry.
 *
 * @module
 */

import type { SeriesType } from '../config.js';
import type { SeriesDrawFn } from './types.js';
import { drawCandlesticks } from './candlestick.js';
import { drawLine } from './line.js';
import { drawArea } from './area.js';
import { drawBars } from './bar.js';
import { drawHistogram } from './histogram.js';

export type { SeriesDrawFn } from './types.js';
export { drawCandlesticks } from './candlestick.js';
export { drawLine } from './line.js';
export { drawArea } from './area.js';
export { drawBars } from './bar.js';
export { drawHistogram, drawHistogramBars } from './histogram.js';

/** Maps {@link SeriesType} strings to their pure draw functions. */
export const SERIES_RENDERERS: Record<SeriesType, SeriesDrawFn> = {
  candlestick: drawCandlesticks,
  line: drawLine,
  area: drawArea,
  bar: drawBars,
  histogram: drawHistogram,
};
