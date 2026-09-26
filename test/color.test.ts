import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, serializeColor, isValidColor, withAlpha } from '../dist/color.js';

describe('parseColor: hex', () => {
  it('parses #rgb', () => {
    assert.deepEqual(parseColor('#f00'), { space: 'srgb', r: 255, g: 0, b: 0, a: 1 });
  });
  it('parses #rgba', () => {
    assert.deepEqual(parseColor('#ff000080'), { space: 'srgb', r: 255, g: 0, b: 0, a: 128 / 255 });
    assert.deepEqual(parseColor('#f008'), { space: 'srgb', r: 255, g: 0, b: 0, a: 136 / 255 });
  });
  it('parses #rrggbb', () => {
    assert.deepEqual(parseColor('#26a69a'), { space: 'srgb', r: 38, g: 166, b: 154, a: 1 });
  });
  it('parses #rrggbbaa', () => {
    const c = parseColor('#26a69a80');
    assert.equal(c?.a, 128 / 255);
  });
  it('rejects bad hex', () => {
    assert.equal(parseColor('#12'), null);
    assert.equal(parseColor('#12345'), null);
    assert.equal(parseColor('#gggggg'), null);
  });
});

describe('parseColor: rgb/rgba', () => {
  it('parses comma form', () => {
    assert.deepEqual(parseColor('rgb(1, 2, 3)'), { space: 'srgb', r: 1, g: 2, b: 3, a: 1 });
  });
  it('parses rgba comma form with alpha', () => {
    assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { space: 'srgb', r: 1, g: 2, b: 3, a: 0.5 });
  });
  it('parses space form with slash alpha', () => {
    assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), { space: 'srgb', r: 1, g: 2, b: 3, a: 0.5 });
  });
  it('parses percentage channels', () => {
    assert.deepEqual(parseColor('rgb(100%, 0%, 50%)'), { space: 'srgb', r: 255, g: 0, b: 127.5, a: 1 });
  });
  it('clamps alpha into 0-1', () => {
    assert.equal(parseColor('rgba(1,2,3, 5)')?.a, 1);
  });
  it('rejects malformed rgb', () => {
    assert.equal(parseColor('rgb(1, 2)'), null);
    assert.equal(parseColor('rgb(1, 2, x)'), null);
    assert.equal(parseColor('rgb(1 2 3 / )'), null);
    assert.equal(parseColor('rgb(1 2 3 / 0.5 / 0.5)'), null);
    assert.equal(parseColor('rgb(1 2 3 / x)'), null);
    assert.equal(parseColor('rgb(1 2 3 / x%)'), null);
    assert.equal(parseColor('rgb(1,,2,3)'), null);
    assert.equal(parseColor('rgb(100%, x%, 0%)'), null);
    assert.equal(parseColor('rgba(1, 2, 3, 0.4 / 0.5)'), null);
  });
});

describe('parseColor: display-p3', () => {
  it('parses color(display-p3 r g b)', () => {
    assert.deepEqual(parseColor('color(display-p3 1 0.5 0)'), {
      space: 'display-p3',
      r: 1,
      g: 0.5,
      b: 0,
      a: 1,
    });
  });
  it('parses with slash alpha', () => {
    assert.deepEqual(parseColor('color(display-p3 1 0 0 / 0.25)'), {
      space: 'display-p3',
      r: 1,
      g: 0,
      b: 0,
      a: 0.25,
    });
  });
  it('rejects malformed p3', () => {
    assert.equal(parseColor('color(display-p3 1 0)'), null);
    assert.equal(parseColor('color(display-p3 1 0 x)'), null);
    assert.equal(parseColor('color(display-p3 1 0 0 / x)'), null);
    assert.equal(parseColor('color(display-p3 1 0 0 /)'), null);
  });
  it('rejects unknown syntax entirely', () => {
    assert.equal(parseColor('hsl(0 100% 50%)'), null);
    assert.equal(parseColor('red'), null);
    assert.equal(parseColor(''), null);
  });
});

describe('serializeColor', () => {
  it('serializes opaque srgb as rgb()', () => {
    assert.equal(serializeColor({ space: 'srgb', r: 1.4, g: 2, b: 3, a: 1 }), 'rgb(1, 2, 3)');
  });
  it('serializes translucent srgb as rgba()', () => {
    assert.equal(serializeColor({ space: 'srgb', r: 1, g: 2, b: 3, a: 0.5 }), 'rgba(1, 2, 3, 0.5)');
  });
  it('serializes p3 back to color(display-p3 ...)', () => {
    assert.equal(
      serializeColor({ space: 'display-p3', r: 1, g: 0.5, b: 0, a: 0.8 }),
      'color(display-p3 1 0.5 0 / 0.8)',
    );
  });
});

describe('isValidColor / withAlpha', () => {
  it('validates', () => {
    assert.equal(isValidColor('#fff'), true);
    assert.equal(isValidColor('color(display-p3 1 0 0)'), true);
    assert.equal(isValidColor('nope'), false);
  });
  it('withAlpha rewrites alpha', () => {
    assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
    assert.equal(withAlpha('color(display-p3 1 0 0)', 0.5), 'color(display-p3 1 0 0 / 0.5)');
  });
  it('withAlpha clamps and passes through unknown colors', () => {
    assert.equal(withAlpha('#ff0000', 7), 'rgb(255, 0, 0)');
    assert.equal(withAlpha('#ff0000', -1), 'rgba(255, 0, 0, 0)');
    assert.equal(withAlpha('var(--x)', 0.5), 'var(--x)');
  });
});
