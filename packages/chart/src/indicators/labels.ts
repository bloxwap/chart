/**
 * Display labels for indicator plots, derived from a definition's style
 * metadata: the status line names each line by them instead of its raw key.
 *
 * @module
 */

import { indicatorLineKeys, type IndicatorDef } from './types.js';

/**
 * The label of style entries sharing one key: the words all their labels
 * start with ("Histogram positive" + "Histogram negative" → "Histogram"), else
 * all of them ("Up trend / Down trend").
 */
export function indicatorStyleLabel(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0];
  const words = labels.map((label) => label.split(' '));
  const common: string[] = [];
  for (let i = 0; words.every((w) => w.length > i + 1 && w[i] === words[0][i]); i++) common.push(words[0][i]);
  return common.length > 0 ? common.join(' ') : labels.join(' / ');
}

const cache = new WeakMap<object, ReadonlyMap<string, string>>();

/**
 * Status-line labels by output line key: a single-line study's short name
 * ("RSI", "Supertrend"), else each line's style label ("MACD", "Signal").
 * Keys without line/dots style metadata are absent, so callers fall back to
 * the key. Cached per definition object.
 */
export function indicatorLineLabels(def: Pick<IndicatorDef, 'styles' | 'shortName'>): ReadonlyMap<string, string> {
  let labels = cache.get(def);
  if (labels === undefined) {
    const keys = indicatorLineKeys(def);
    const map = new Map<string, string>();
    for (const key of keys) {
      map.set(key, keys.length === 1 && def.shortName !== undefined
        ? def.shortName
        : indicatorStyleLabel(def.styles!.filter((style) => style.key === key).map((style) => style.label)));
    }
    labels = map;
    cache.set(def, labels);
  }
  return labels;
}
