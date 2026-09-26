import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, MockContext2D, MockDocument } from '../dist/dom.js';

describe('MockDocument / MockCanvas', () => {
  it('creates canvases with requested sizes and tracks them', () => {
    const doc = new MockDocument();
    const a = doc.createCanvas(100, 50);
    const b = doc.createCanvas(200, 100);
    assert.equal(doc.created.length, 2);
    assert.equal(a.width, 100);
    assert.equal(b.height, 100);
  });
  it('getContext returns the recording context for 2d', () => {
    const canvas = new MockCanvas(10, 10);
    const ctx = canvas.getContext('2d');
    assert.ok(ctx instanceof MockContext2D);
  });
  it('getContext returns null for other kinds', () => {
    const canvas = new MockCanvas();
    assert.equal(canvas.getContext('webgl' as '2d'), null);
  });
});

describe('MockContext2D', () => {
  it('records method calls with args', () => {
    const ctx = new MockContext2D();
    ctx.fillRect(1, 2, 3, 4);
    ctx.fillRect(5, 6, 7, 8);
    ctx.moveTo(0, 0);
    assert.equal(ctx.countCalls('fillRect'), 2);
    assert.deepEqual(ctx.callsNamed('fillRect')[0], ['fillRect', 1, 2, 3, 4]);
    assert.equal(ctx.calls[2]?.[0], 'moveTo');
  });
  it('records the full drawing surface', () => {
    const ctx = new MockContext2D();
    ctx.save();
    ctx.restore();
    ctx.clearRect(0, 0, 1, 1);
    ctx.beginPath();
    ctx.closePath();
    ctx.lineTo(1, 1);
    ctx.rect(0, 0, 1, 1);
    ctx.stroke();
    ctx.fill();
    ctx.setLineDash([1, 2]);
    ctx.fillText('hi', 0, 0);
    ctx.drawImage({ width: 4, height: 4 }, 0, 0, 2, 2);
    ctx.translate(1, 1);
    ctx.rotate(0.5);
    ctx.scale(2, 2);
    const names = ctx.calls.map((c) => c[0]);
    assert.deepEqual(names, [
      'save', 'restore', 'clearRect', 'beginPath', 'closePath', 'lineTo', 'rect',
      'stroke', 'fill', 'setLineDash', 'fillText', 'drawImage', 'translate', 'rotate', 'scale',
    ]);
  });
  it('measureText returns a width and records the call', () => {
    const ctx = new MockContext2D();
    const m = ctx.measureText('abc');
    assert.equal(m.width, 18);
    assert.deepEqual(ctx.calls[0], ['measureText', 'abc']);
  });
  it('exposes mutable style properties with defaults', () => {
    const ctx = new MockContext2D();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = '12px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.5;
    assert.equal(ctx.fillStyle, '#fff');
    assert.equal(ctx.strokeStyle, '#000');
    assert.equal(ctx.lineWidth, 3);
    assert.equal(ctx.font, '12px serif');
    assert.equal(ctx.textAlign, 'center');
    assert.equal(ctx.textBaseline, 'middle');
    assert.equal(ctx.globalAlpha, 0.5);
  });
});
