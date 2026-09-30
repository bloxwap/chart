import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, MockContext2D, MockContextWebGL2, MockDocument, MockGLCanvas, MockGLDocument } from '../dist/dom.js';

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

describe('MockContextWebGL2', () => {
  it('reports shader compile status and info log for success and failure', () => {
    const gl = new MockContextWebGL2();
    const shader = gl.createShader(gl.VERTEX_SHADER);
    assert.equal(gl.getShaderParameter(shader, gl.COMPILE_STATUS), true);
    assert.equal(gl.getShaderInfoLog(shader), null);
    gl.compileStatus = false;
    assert.equal(gl.getShaderParameter(shader, gl.COMPILE_STATUS), false);
    assert.equal(gl.getShaderInfoLog(shader), 'mock compile error');
    assert.equal(gl.countCalls('getShaderInfoLog'), 2);
  });
  it('reports program link status and info log for success and failure', () => {
    const gl = new MockContextWebGL2();
    const program = gl.createProgram();
    assert.equal(gl.getProgramParameter(program, gl.LINK_STATUS), true);
    assert.equal(gl.getProgramInfoLog(program), null);
    gl.linkStatus = false;
    assert.equal(gl.getProgramParameter(program, gl.LINK_STATUS), false);
    assert.equal(gl.getProgramInfoLog(program), 'mock link error');
    assert.deepEqual(gl.callsNamed('getProgramInfoLog').map((c) => c[0]), ['getProgramInfoLog', 'getProgramInfoLog']);
  });
  it('records enable, disable and blend state calls', () => {
    const gl = new MockContextWebGL2();
    gl.enable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, 10, 10);
    gl.scissor(1, 2, 3, 4);
    const names = gl.calls.map((c) => c[0]);
    assert.deepEqual(names, ['enable', 'disable', 'blendFunc', 'clearColor', 'clear', 'viewport', 'scissor']);
    assert.deepEqual(gl.callsNamed('disable')[0], ['disable', gl.SCISSOR_TEST]);
  });
});

describe('MockGLCanvas / MockGLDocument', () => {
  it('getContext returns the GL context for webgl2, 2d context for 2d, null otherwise', () => {
    const canvas = new MockGLCanvas(20, 10);
    assert.ok(canvas.getContext('webgl2') instanceof MockContextWebGL2);
    assert.ok(canvas.getContext('2d') instanceof MockContext2D);
    assert.equal(canvas.getContext('webgl' as '2d'), null);
    assert.equal(canvas.width, 20);
    assert.equal(canvas.height, 10);
  });
  it('honors compile/link options for every combination', () => {
    const fallback = new MockGLCanvas(0, 0, {});
    assert.equal(fallback.gl.compileStatus, true);
    assert.equal(fallback.gl.linkStatus, true);
    const noCompile = new MockGLCanvas(0, 0, { compile: false });
    assert.equal(noCompile.gl.compileStatus, false);
    assert.equal(noCompile.gl.linkStatus, true);
    const noLink = new MockGLCanvas(0, 0, { link: false });
    assert.equal(noLink.gl.compileStatus, true);
    assert.equal(noLink.gl.linkStatus, false);
    const explicit = new MockGLCanvas(0, 0, { compile: true, link: true });
    assert.equal(explicit.gl.compileStatus, true);
    assert.equal(explicit.gl.linkStatus, true);
  });
  it('MockGLDocument creates tracked canvases with default options', () => {
    const doc = new MockGLDocument();
    const canvas = doc.createCanvas(8, 6);
    assert.equal(doc.created.length, 1);
    assert.ok(canvas instanceof MockGLCanvas);
    assert.equal(doc.created[0]!.gl.compileStatus, true);
    assert.equal(doc.created[0]!.gl.linkStatus, true);
  });
  it('MockGLDocument forwards compile/link options to created canvases', () => {
    const doc = new MockGLDocument({ compile: false, link: false });
    const canvas = doc.createCanvas(8, 6);
    assert.equal(doc.created.length, 1);
    assert.equal((canvas as MockGLCanvas).gl.compileStatus, false);
    assert.equal((canvas as MockGLCanvas).gl.linkStatus, false);
  });
});
