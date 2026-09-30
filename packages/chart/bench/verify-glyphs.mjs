/** Pixel checks on real WebGL2: label placement, alpha and atlas reuse at 1×/2×. */
export async function verifyGlyphs() {
  const { GLBackend } = await import('/dist/render/gl/backend.js');
  for (const ratio of [1, 2]) {
    const gpuCanvas = document.createElement('canvas');
    const backend = GLBackend.create(gpuCanvas, () => document.createElement('canvas'));
    if (!backend) throw new Error('WebGL2 unavailable');
    backend.resize(300 * ratio, 80 * ratio);
    const host = document.createElement('canvas');
    host.width = 300 * ratio; host.height = 80 * ratio;
    const ctx = host.getContext('2d');
    ctx.scale(ratio, ratio);
    const reference = document.createElement('canvas');
    reference.width = host.width; reference.height = host.height;
    const ref = reference.getContext('2d');
    ref.scale(ratio, ratio);
    ref.font = '10px sans-serif'; ref.textAlign = 'center'; ref.textBaseline = 'middle';
    ref.fillStyle = '#ff0000'; ref.globalAlpha = .5;
    ref.fillText('12.40×3.50K', 150, 40);
    const bounds = canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, maxAlpha = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4;
        if (pixels[at + 3] > 10) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
          maxAlpha = Math.max(maxAlpha, pixels[at + 3]);
          if (pixels[at] < 250 || pixels[at + 1] > 5 || pixels[at + 2] > 5) throw new Error('Incorrect glyph color');
        }
      }
      return [left, right, top, bottom, maxAlpha];
    };
    try {
      const expected = bounds(reference);
      for (let i = 0; i < 2; i++) {
        ctx.clearRect(0, 0, 300, 80);
        const frame = backend.beginFrame(ratio, 300, 80);
        if (!frame.text('12.40×3.50K', 150, 40, '#ff0000', .5)) throw new Error('Glyph fallback');
        frame.composite(ctx);
        const actual = bounds(host);
        if (actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 2 * ratio)) {
          throw new Error(`Glyph pixel mismatch at ${ratio}×: ${actual} vs ${expected}`);
        }
        if (gpuCanvas.getContext('webgl2').getError() !== 0) throw new Error('WebGL error');
      }
    } finally { backend.dispose(); }
  }
  return 'GPU glyph placement, color, alpha and repeated-frame checks passed at 1×/2×';
}
