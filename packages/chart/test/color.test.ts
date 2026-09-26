import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, serializeColor, isValidColor, withAlpha, relativeLuminance, contrastingTextColor } from '../dist/color.js';

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

describe('relative luminance and label contrast', () => {
  it('linearizes sRGB channels and uses the correct primary weights', () => {
    assert.equal(relativeLuminance('#000'), 0);
    assert.equal(relativeLuminance('#fff'), 1);
    assert.equal(relativeLuminance('#f00'), 0.2126);
    assert.equal(relativeLuminance('#0f0'), 0.7152);
    assert.equal(relativeLuminance('#00f'), 0.0722);
    assert.ok(Math.abs(relativeLuminance('#808080')! - 0.2158605001) < 1e-9);
    assert.ok(Math.abs(relativeLuminance('rgb(10 10 10)')! - (10 / 255 / 12.92)) < 1e-12);
    assert.equal(relativeLuminance('rgb(-100 300 0)'), 0.7152);
    assert.equal(relativeLuminance('var(--accent)'), null);
  });

  it('uses Display-P3 primaries instead of treating them as sRGB', () => {
    assert.ok(Math.abs(relativeLuminance('color(display-p3 1 0 0)')! - 0.2289745641) < 1e-9);
    assert.ok(Math.abs(relativeLuminance('color(display-p3 0 1 0)')! - 0.6917385218) < 1e-9);
    assert.ok(Math.abs(relativeLuminance('color(display-p3 0 0 1)')! - 0.0792869141) < 1e-9);
    assert.equal(contrastingTextColor('color(display-p3 0 1 0.55)'), '#000000');
    assert.equal(contrastingTextColor('color(display-p3 0 0 1)'), '#ffffff');
    // This pair straddles the black/white contrast crossover in the two spaces.
    assert.equal(contrastingTextColor('rgb(0 54% 0)'), '#000000');
    assert.equal(contrastingTextColor('color(display-p3 0 0.54 0)'), '#ffffff');
  });

  it('chooses the greater contrast ratio, including near the crossover', () => {
    for (const fill of ['#ffffff', '#00ff00', '#787b86', '#f23645', '#767676']) {
      assert.equal(contrastingTextColor(fill), '#000000', fill);
    }
    for (const fill of ['#000000', '#2962ff', '#0000ff', '#757575']) {
      assert.equal(contrastingTextColor(fill), '#ffffff', fill);
    }
    assert.equal(contrastingTextColor('var(--accent)'), '#ffffff');
  });

  it('composites translucent labels over the chart theme before choosing text', () => {
    assert.equal(contrastingTextColor('#ffffff40', '#000000'), '#ffffff');
    assert.equal(contrastingTextColor('#ffffff40', '#ffffff'), '#000000');
    assert.equal(contrastingTextColor('#0000'), '#000000');
    assert.equal(contrastingTextColor('#0000', '#000000'), '#ffffff');
    assert.equal(contrastingTextColor('#ffffff40', 'unsupported'), '#000000');
    assert.equal(contrastingTextColor('color(display-p3 1 1 1 / 0.2)', '#000'), '#ffffff');
    assert.equal(contrastingTextColor('color(display-p3 0 0 0 / 0.2)', '#fff'), '#000000');
    assert.equal(contrastingTextColor('#fff3', 'color(display-p3 0 0 0)'), '#ffffff');
    assert.equal(contrastingTextColor('#0003', 'color(display-p3 1 1 1)'), '#000000');
    assert.equal(contrastingTextColor('color(display-p3 1 1 1 / 0.2)', 'color(display-p3 0 0 0)'), '#ffffff');
    assert.equal(contrastingTextColor('rgba(0,0,0,0.6)', '#ff0000'), '#ffffff');
  });

  it('keeps contrast correct across a changing palette and repeated frame reads', () => {
    for (const backdrop of ['#000', '#fff']) {
      for (let gray = 0; gray < 256; gray++) {
        const fill = `rgb(${gray} ${gray} ${gray})`;
        const text = contrastingTextColor(fill, backdrop);
        const light = relativeLuminance(fill)!;
        const ratio = text === '#000000' ? (light + 0.05) / 0.05 : 1.05 / (light + 0.05);
        assert.ok(ratio >= 4.5, `gray ${gray} contrast ${ratio}`);
        assert.equal(contrastingTextColor(fill, backdrop), text);
      }
    }
  });
});
