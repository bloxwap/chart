import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  defineConfig,
  defaultPriceFormatter,
  defaultTimeFormatter,
  mergeDeep,
  resolveConfig,
} from '../dist/config.js';

describe('resolveConfig', () => {
  it('returns defaults for undefined and empty partial', () => {
    assert.deepEqual(resolveConfig(), DEFAULT_CONFIG);
    assert.deepEqual(resolveConfig({}), DEFAULT_CONFIG);
  });
  it('deep-merges nested objects without touching siblings', () => {
    const cfg = resolveConfig({ series: { type: 'area' }, watermark: { visible: true, text: 'ACME' } });
    assert.equal(cfg.series.type, 'area');
    assert.equal(cfg.series.upColor, DEFAULT_CONFIG.series.upColor);
    assert.equal(cfg.watermark.visible, true);
    assert.equal(cfg.watermark.text, 'ACME');
    assert.equal(cfg.watermark.fontSize, DEFAULT_CONFIG.watermark.fontSize);
  });
  it('replaces arrays wholesale', () => {
    const candles = [{ time: 1, open: 1, high: 1, low: 1, close: 1 }];
    const cfg = resolveConfig({ data: candles, indicators: [] });
    assert.equal(cfg.data.length, 1);
    assert.deepEqual(cfg.indicators, []);
  });
  it('ignores undefined leaves', () => {
    assert.equal(
      mergeDeep(DEFAULT_CONFIG.series, { type: undefined }).type,
      DEFAULT_CONFIG.series.type,
    );
  });
  it('replaces functions', () => {
    const price = (v: number): string => `$${v}`;
    const cfg = resolveConfig({ formatters: { price } });
    assert.equal(cfg.formatters.price, price);
    assert.equal(cfg.formatters.time, DEFAULT_CONFIG.formatters.time);
  });
  it('accepts display-p3 theme colors verbatim', () => {
    const cfg = resolveConfig({ theme: { background: 'color(display-p3 1 1 1)' } });
    assert.equal(cfg.theme.background, 'color(display-p3 1 1 1)');
  });
  it('ships system-fallback typography defaults', () => {
    const cfg = resolveConfig();
    assert.equal(cfg.theme.fontFamily, 'system-ui, sans-serif');
    assert.equal(cfg.theme.monoFamily, 'ui-monospace, monospace');
    assert.equal(cfg.theme.fontSize, 12);
    assert.equal(cfg.watermark.fontFamily, ''); // inherits theme.fontFamily
    assert.equal(cfg.crosshair.labelBackground, '#2962ff');
    assert.equal(cfg.crosshair.labelColor, 'auto');
  });
  it('deep-merges typography and crosshair label overrides', () => {
    const cfg = resolveConfig({
      theme: { fontFamily: '"Geist", system-ui', monoFamily: '"Geist Mono", monospace', fontSize: 13 },
      crosshair: { labelBackground: '#000000' },
      watermark: { fontFamily: '"Geist"' },
    });
    assert.equal(cfg.theme.fontFamily, '"Geist", system-ui');
    assert.equal(cfg.theme.monoFamily, '"Geist Mono", monospace');
    assert.equal(cfg.theme.fontSize, 13);
    assert.equal(cfg.theme.background, DEFAULT_CONFIG.theme.background);
    assert.equal(cfg.crosshair.labelBackground, '#000000');
    assert.equal(cfg.crosshair.labelColor, 'auto');
    assert.equal(cfg.watermark.fontFamily, '"Geist"');
  });
});

describe('mergeDeep', () => {
  it('merges plain objects recursively', () => {
    assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 } }, { a: { b: 3 } }), { a: { b: 3, c: 2 } });
  });
  it('override scalar replaces object base', () => {
    assert.equal(mergeDeep({ a: 1 } as unknown, 5), 5);
  });
  it('override object replaces scalar base', () => {
    assert.deepEqual(mergeDeep(5 as unknown, { a: 1 }), { a: 1 });
  });
  it('null override replaces', () => {
    assert.equal(mergeDeep({ a: 1 } as unknown, null), null);
  });
  it('class instances are replaced, not merged', () => {
    class Foo {
      x = 1;
    }
    const foo = new Foo();
    assert.equal(mergeDeep({ a: { b: 1 } }, { a: foo }).a, foo);
  });
  it('object with null prototype merges', () => {
    const base = Object.create(null) as Record<string, number>;
    base['a'] = 1;
    assert.deepEqual(mergeDeep(base, { b: 2 }), { a: 1, b: 2 });
  });
});

describe('defineConfig', () => {
  it('is an identity helper', () => {
    const partial = { series: { type: 'line' as const } };
    assert.equal(defineConfig(partial), partial);
  });
});

describe('default formatters', () => {
  it('formats prices by magnitude', () => {
    assert.equal(defaultPriceFormatter(123.456), '123.46');
    assert.equal(defaultPriceFormatter(1.23456), '1.2346');
    assert.equal(defaultPriceFormatter(0), '0.00');
    assert.equal(defaultPriceFormatter(0.00012345), '0.000123');
    assert.equal(defaultPriceFormatter(-250.5), '-250.50');
  });
  it('formats time as UTC', () => {
    assert.equal(defaultTimeFormatter(0), '1970-01-01 00:00');
    assert.equal(defaultTimeFormatter(1700000000), '2023-11-14 22:13');
  });
});
