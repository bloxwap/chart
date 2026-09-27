/**
 * Indicator subsystem: registry, types, styling, and the built-ins.
 *
 * @module
 */

export type { IndicatorDef, IndicatorLine, IndicatorBars, IndicatorOutput } from './types.js';
export type { IndicatorFill, IndicatorLevel, IndicatorInputDef, IndicatorStyleDef } from './types.js';
export { UP_COLOR, DOWN_COLOR, resolveIndicatorColors, indicatorLineKeys, indicatorStyleColors } from './types.js';
export { normalizeIndicatorConfig, applyIndicatorPatch, styleIndicatorOutput } from './style.js';
export { indicatorLineLabels, indicatorStyleLabel } from './labels.js';
export type { ResolvedIndicatorConfig, IndicatorPatch } from './style.js';
export { rollingMaxValues, rollingMinValues, smaSparseValues } from './rolling.js';
export { IndicatorRegistry, createIndicatorRegistry, BUILTIN_INDICATORS } from './registry.js';
export { smaIndicator, smaValues, smaWasm } from './sma.js';
export { emaIndicator, emaValues, emaWasm } from './ema.js';
export { bollIndicator, stddevValues } from './boll.js';
export { macdIndicator } from './macd.js';
export { rsiIndicator, rsiValues } from './rsi.js';
export { kdjIndicator, kdjValues } from './kdj.js';
export { volIndicator } from './vol.js';
export type { StudyMeta, StudyInputMeta, StudyInputOption, StudyStyleMeta } from './study-meta.js';
export { vwapIndicator, vwapMeta, vwapValues } from './vwap.js';
export { adxIndicator, adxMeta, adxValues } from './adx.js';
export { cciIndicator, cciMeta, cciValues } from './cci.js';
export { mfiIndicator, mfiMeta, mfiValues } from './mfi.js';
export { obvIndicator, obvMeta, obvValues } from './obv.js';
export { maRibbonIndicator, maRibbonMeta } from './ma-ribbon.js';
export { atrIndicator, atrValues, trueRangeValues, rmaValues } from './atr.js';
export { supertrendIndicator, supertrendValues } from './supertrend.js';
export { ichimokuIndicator, ichimokuValues } from './ichimoku.js';
export type { IchimokuValues } from './ichimoku.js';
export { donchianIndicator, donchianValues } from './donchian.js';
export { stochIndicator, stochValues } from './stoch.js';
export { stochRsiIndicator, stochRsiValues } from './stochrsi.js';
export { psarIndicator, psarValues } from './psar.js';
