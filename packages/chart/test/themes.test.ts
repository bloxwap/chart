import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_THEMES, type ThemeName } from '../dist/index.js';
import { relativeLuminance } from '../dist/color.js';

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)!;
  const lb = relativeLuminance(b)!;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('chart themes', () => {
  it('contrasts series colors with the theme background', () => {
    for (const name of ['dark', 'light'] as ThemeName[]) {
      const theme = CHART_THEMES[name];
      const background = theme.theme!.background!;
      for (const color of [theme.series!.upColor!, theme.series!.downColor!]) {
        // WCAG non-text contrast minimum for meaningful graphics.
        assert.ok(contrastRatio(color, background) >= 3, `${name} ${color} on ${background}`);
      }
    }
  });
});
