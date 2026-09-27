/**
 * Display metadata for the TradingView-style studies: human labels, input
 * (param) constraints and per-plot style slots. Exported next to each
 * definition as `<name>Meta` so settings UIs can render the study without
 * hard-coding it, and spread into that definition, so its
 * {@link IndicatorDef.label}/`shortName`/`inputs`/`styles` are the same
 * objects. The types narrow the engine's {@link IndicatorInputDef} and
 * {@link IndicatorStyleDef}, so every `<name>Meta` is valid definition
 * metadata.
 *
 * @module
 */

import type { IndicatorDef, IndicatorInputDef, IndicatorStyleDef } from './types.js';

/** One selectable value of an enumerated numeric input. */
export interface StudyInputOption {
  /** Param value stored in `IndicatorConfig.params`. */
  readonly value: number;
  readonly label: string;
}

/** One numeric input of a study, keyed like its `defaultParams` entry. */
export interface StudyInputMeta extends IndicatorInputDef {
  /** When present, the input is a choice between these values. */
  readonly options?: StudyInputOption[];
}

/**
 * One styled plot of a study: an output line, a reference level (CCI ±100,
 * MFI 80/20) or a band fill (VWAP bands); `colorIndex` indexes its colors array.
 */
export interface StudyStyleMeta extends IndicatorStyleDef {
  readonly kind: 'line' | 'level' | 'fill';
}

/** Display metadata of one study definition. */
export interface StudyMeta extends Required<Pick<IndicatorDef, 'label' | 'shortName'>> {
  readonly inputs: StudyInputMeta[];
  readonly styles: StudyStyleMeta[];
}
