import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { DEFAULT_CONFIG, type WatermarkConfig } from '../dist/config.js';
import { drawWatermark } from '../dist/watermark.js';

const SANS = 'Test Sans, system-ui';

function wm(partial: Partial<WatermarkConfig>): WatermarkConfig {
  return { ...DEFAULT_CONFIG.watermark, ...partial };
}

describe('drawWatermark', () => {
  it('draws nothing when hidden', () => {
    const ctx = new MockContext2D();
    drawWatermark(ctx, wm({ visible: false, text: 'HI' }), 400, 300, SANS);
    assert.equal(ctx.calls.length, 0);
  });
  it('draws nothing when visible but empty', () => {
    const ctx = new MockContext2D();
    drawWatermark(ctx, wm({ visible: true, text: '', image: null }), 400, 300, SANS);
    assert.equal(ctx.calls.length, 0);
  });
  it('draws centered text with applied opacity and the inherited theme family', () => {
    const ctx = new MockContext2D();
    drawWatermark(ctx, wm({ visible: true, text: 'ACME', color: '#808080', opacity: 0.5, fontSize: 40 }), 400, 300, SANS);
    const texts = ctx.callsNamed('fillText');
    assert.equal(texts.length, 1);
    assert.deepEqual(texts[0], ['fillText', 'ACME', 200, 150]);
    assert.equal(ctx.font, `40px ${SANS}`);
    assert.equal(ctx.fillStyle, 'rgba(128, 128, 128, 0.5)');
    assert.equal(ctx.countCalls('save'), 1);
    assert.equal(ctx.countCalls('restore'), 1);
  });
  it('an explicit watermark fontFamily wins over the theme family', () => {
    const ctx = new MockContext2D();
    drawWatermark(ctx, wm({ visible: true, text: 'X', fontFamily: 'Custom Serif' }), 400, 300, SANS);
    assert.equal(ctx.font, '48px Custom Serif');
  });
  it('draws an image scaled to half the plot', () => {
    const ctx = new MockContext2D();
    const image = { width: 2000, height: 1000 };
    drawWatermark(ctx, wm({ visible: true, image }), 400, 300, SANS);
    const draws = ctx.callsNamed('drawImage');
    assert.equal(draws.length, 1);
    // scale = min(1, 200/2000, 150/1000) = 0.1 → 200×100 centered.
    assert.deepEqual(draws[0]?.slice(1), [image, 100, 100, 200, 100]);
  });
  it('draws image and text stacked when both present', () => {
    const ctx = new MockContext2D();
    const image = { width: 100, height: 100 };
    drawWatermark(ctx, wm({ visible: true, text: 'X', image, fontSize: 20 }), 400, 300, SANS);
    assert.equal(ctx.countCalls('drawImage'), 1);
    assert.equal(ctx.countCalls('fillText'), 1);
    // Image shifts up, text shifts down.
    const draw = ctx.callsNamed('drawImage')[0];
    const text = ctx.callsNamed('fillText')[0];
    assert.ok((draw?.[3] as number) < 150 - 50);
    assert.ok((text?.[2] as number) > 150);
  });
});
