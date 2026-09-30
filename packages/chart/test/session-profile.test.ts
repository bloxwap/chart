import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';
import {
  computeTpoProfile,
  computeVolumeProfile,
  profileRowAt,
  sessionRanges,
  tpoProfileRows,
  valueArea,
  volumeProfileRows,
  DEFAULT_SESSION_MS,
} from '../dist/core/profile.js';
import {
  attachSessionProfile,
  createSessionLevelsPrimitive,
  createSessionProfilePrimitive,
  DEFAULT_SESSION_PROFILE_WIDTH,
} from '../dist/render/session-profile.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';

function candles(n: number, start = 1700000000, step = 3600): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1000 + i * 10,
  }));
}

describe('volumeProfileRows', () => {
  it('bins volume over the bar range and splits by direction', () => {
    const data = candles(10);
    const prof = volumeProfileRows(data, 0, 9, 10)!;
    assert.equal(prof.lo, 99);
    assert.equal(prof.hi, 111);
    const total = data.reduce((s, c) => s + (c.volume ?? 0), 0);
    const binned = prof.up.reduce((s, x) => s + x, 0) + prof.down.reduce((s, x) => s + x, 0);
    assert.ok(Math.abs(binned - total) < 1e-9);
    assert.ok(prof.up.every((v) => v >= 0));
  });

  it('returns null for empty or invalid ranges', () => {
    assert.equal(volumeProfileRows([], 0, 5, 10), null);
    assert.equal(volumeProfileRows(candles(5), 3, 1, 10) === null, false); // swapped bounds are normalized
    assert.equal(volumeProfileRows(candles(5), 0, 4, 0), null);
  });

  it('returns null when the whole range lies beyond the data', () => {
    assert.equal(volumeProfileRows(candles(5), 10, 20, 10), null);
    assert.equal(tpoProfileRows(candles(5), 10, 20, 10), null);
  });

  it('treats a missing volume as zero and bins falling bars into down', () => {
    const data: Candle[] = [
      { time: 1, open: 12, high: 13, low: 10, close: 11 }, // falling, no volume
      { time: 2, open: 13, high: 14, low: 11, close: 12, volume: 90 }, // falling
      { time: 3, open: 11, high: 13, low: 10, close: 12, volume: 30 }, // rising
    ];
    const prof = volumeProfileRows(data, 0, 2, 4)!;
    const up = prof.up.reduce((s, x) => s + x, 0);
    const down = prof.down.reduce((s, x) => s + x, 0);
    assert.equal(up, 30);
    assert.equal(down, 90);
  });

  it('falls back to a unit step when all bars are flat', () => {
    const flat: Candle[] = Array.from({ length: 4 }, (_, i) => ({
      time: 1700000000 + i * 3600,
      open: 50,
      high: 50,
      low: 50,
      close: 50,
      volume: 10,
    }));
    const vol = computeVolumeProfile(flat, 0, 3, 8)!;
    assert.equal(vol.step, 1);
    const tpo = computeTpoProfile(flat, 0, 3, 8)!;
    assert.equal(tpo.step, 1);
    assert.equal(tpo.totals[0], 4);
  });
});

describe('tpoProfileRows', () => {
  it('counts one TPO per bar covering a row', () => {
    const data: Candle[] = [
      { time: 1, open: 10, high: 11.5, low: 10, close: 11 },
      { time: 2, open: 11, high: 13, low: 11, close: 12 },
    ];
    const prof = tpoProfileRows(data, 0, 1, 3)!;
    assert.equal(prof.lo, 10);
    assert.equal(prof.hi, 13);
    assert.deepEqual(prof.counts, [1, 2, 1]);
  });
});

describe('valueArea', () => {
  it('grows from the POC until the percent is covered', () => {
    const totals = [1, 2, 10, 3, 2, 1, 1];
    const va = valueArea(totals, 0.7);
    assert.equal(va.poc, 2);
    const covered = totals.slice(va.low, va.high + 1).reduce((s, x) => s + x, 0);
    assert.ok(covered >= 0.7 * totals.reduce((s, x) => s + x, 0));
    assert.ok(va.low <= va.poc && va.high >= va.poc);
  });

  it('handles an all-zero profile', () => {
    const va = valueArea([0, 0, 0]);
    assert.deepEqual(va, { poc: 0, low: 0, high: 0 });
  });

  it('handles empty totals', () => {
    assert.deepEqual(valueArea([]), { poc: 0, low: 0, high: 0 });
  });

  it('expands only upward when the POC is the first row', () => {
    assert.deepEqual(valueArea([10, 1, 1], 0.99), { poc: 0, low: 0, high: 2 });
  });

  it('expands downward when the POC is the last row', () => {
    assert.deepEqual(valueArea([1, 1, 10], 0.99), { poc: 2, low: 0, high: 2 });
  });

  it('prefers the lower side when it holds more than the row above', () => {
    const va = valueArea([5, 10, 8, 1], 0.9);
    assert.equal(va.poc, 1);
    assert.equal(va.low, 0);
    assert.ok(va.high >= 2);
  });
});

describe('computeVolumeProfile / computeTpoProfile', () => {
  it('prices the POC row and value-area bounds', () => {
    const data = candles(20);
    const prof = computeVolumeProfile(data, 0, 19, 20)!;
    assert.ok(prof.pocPrice >= prof.lo + prof.step * prof.poc);
    assert.ok(prof.pocPrice <= prof.lo + prof.step * (prof.poc + 1));
    assert.ok(prof.valueAreaLowPrice <= prof.pocPrice);
    assert.ok(prof.valueAreaHighPrice >= prof.pocPrice);
    assert.equal(prof.totals.length, 20);
    assert.equal(prof.up.length, 20);
  });

  it('builds a TPO profile with count totals', () => {
    const data = candles(12); // 99..113 → step 1 at 14 rows; bars span 4 rows, the last bar's high clamps to the top row
    const prof = computeTpoProfile(data, 0, 11, 14)!;
    assert.equal(prof.step, 1);
    assert.equal(prof.totals.reduce((s, x) => s + x, 0), 11 * 4 + 3);
    assert.equal(prof.totals[prof.poc], Math.max(...prof.totals));
  });

  it('returns null for empty data', () => {
    assert.equal(computeVolumeProfile([], 0, 5, 10), null);
    assert.equal(computeTpoProfile([], 0, 5, 10), null);
  });
});

describe('profileRowAt', () => {
  it('clamps to the row range', () => {
    assert.equal(profileRowAt(100, 2, 10, 99), 0);
    assert.equal(profileRowAt(100, 2, 10, 101), 0);
    assert.equal(profileRowAt(100, 2, 10, 103), 1);
    assert.equal(profileRowAt(100, 2, 10, 500), 9);
  });
});

describe('sessionRanges', () => {
  it('splits bars into daily sessions', () => {
    const data = candles(72, 1699920000); // 3 days of hourly bars from a UTC midnight
    const sessions = sessionRanges(data, 0, 71);
    assert.equal(sessions.length, 3);
    assert.deepEqual(sessions.map((s) => [s.from, s.to]), [
      [0, 23],
      [24, 47],
      [48, 71],
    ]);
    assert.equal(sessions[1]!.start - sessions[0]!.start, DEFAULT_SESSION_MS / 1000);
  });

  it('honors a custom session length and clamps the range', () => {
    const data = candles(48); // 2 days of hourly bars
    const sessions = sessionRanges(data, -10, 100, DEFAULT_SESSION_MS / 24); // hourly sessions
    assert.equal(sessions.length, 48);
    assert.equal(sessions[0]!.from, 0);
    assert.equal(sessions[47]!.to, 47);
  });
});

function fakeTarget(data: Candle[], width = 120, height = 400, min = 90, max = 130): PrimitiveDrawTarget {
  const priceScale = new PriceScale();
  priceScale.height = height;
  priceScale.setRange(min, max);
  return {
    width,
    height,
    priceScale,
    timeScale: new TimeScale(),
    range: { from: 0, to: data.length },
    candles: data,
    pixelRatio: 1,
  };
}

describe('createSessionProfilePrimitive', () => {
  it('paints volume rows and a POC marker per session', () => {
    const ctx = new MockContext2D();
    const primitive = createSessionProfilePrimitive();
    primitive.draw(ctx, fakeTarget(candles(72)));
    assert.ok(ctx.countCalls('fillRect') > 24);
  });

  it('paints one composite column over all visible sessions', () => {
    const ctx = new MockContext2D();
    createSessionProfilePrimitive({ composite: true }).draw(ctx, fakeTarget(candles(72)));
    const pocLines = ctx.callsNamed('fillRect').filter((c) => c[4] === 1 && c[3] === 120 * 0.95);
    assert.equal(pocLines.length, 1);
  });

  it('draws nothing for empty data', () => {
    const ctx = new MockContext2D();
    createSessionProfilePrimitive().draw(ctx, fakeTarget([]));
    assert.equal(ctx.countCalls('fillRect'), 0);
    assert.equal(ctx.countCalls('fillText'), 0);
  });

  it('draws TPO letters when the columns are wide enough', () => {
    const ctx = new MockContext2D();
    createSessionProfilePrimitive({ mode: 'tpo', sessionMs: DEFAULT_SESSION_MS * 3 }).draw(ctx, fakeTarget(candles(72), 800));
    assert.ok(ctx.countCalls('fillText') > 0);
    const letters = new Set(ctx.callsNamed('fillText').map((c) => c[1]));
    assert.ok(letters.has('A') && letters.has('B'));
  });

  it('falls back to TPO blocks in narrow columns', () => {
    const ctx = new MockContext2D();
    createSessionProfilePrimitive({ mode: 'tpo', rows: 6 }).draw(ctx, fakeTarget(candles(72, 1699920000), 30));
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.ok(ctx.countCalls('fillRect') > 0);
  });

  it('draws nothing when the visible range lies beyond the data', () => {
    const ctx = new MockContext2D();
    const target = { ...fakeTarget(candles(24)), range: { from: 100, to: 200 } };
    createSessionProfilePrimitive().draw(ctx, target);
    assert.equal(ctx.countCalls('fillRect'), 0);
  });

  it('paints the down segment of rows with falling-bar volume', () => {
    const ctx = new MockContext2D();
    const falling: Candle[] = Array.from({ length: 24 }, (_, i) => ({
      time: 1699920000 + i * 3600,
      open: 102 + i,
      high: 103 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 50,
    }));
    createSessionProfilePrimitive({ composite: true, showPoc: false }).draw(ctx, fakeTarget(falling, 120, 400, 95, 135));
    // Every row fill comes from the down branch: up volume is zero everywhere.
    assert.ok(ctx.countCalls('fillRect') > 0);
  });

  it('skips zero-volume rows and falls back to a unit max', () => {
    const ctx = new MockContext2D();
    const silent: Candle[] = Array.from({ length: 24 }, (_, i) => ({
      time: 1699920000 + i * 3600,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 0,
    }));
    createSessionProfilePrimitive({ composite: true, showPoc: false }).draw(ctx, fakeTarget(silent, 120, 400, 95, 135));
    assert.equal(ctx.countCalls('fillRect'), 0);
  });

  it('falls back to a unit TPO max when no bar has a finite range', () => {
    const ctx = new MockContext2D();
    const blank: Candle[] = Array.from({ length: 24 }, (_, i) => ({
      time: 1699920000 + i * 3600,
      open: 100,
      high: Number.NaN,
      low: Number.NaN,
      close: 100,
      volume: 10,
    }));
    createSessionProfilePrimitive({ mode: 'tpo', composite: true, showPoc: false }).draw(ctx, fakeTarget(blank, 800));
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 0);
  });

  it('clips rows outside the visible price range', () => {
    const data = candles(24, 1699920000);
    const above = new MockContext2D();
    createSessionProfilePrimitive({ composite: true, showPoc: false }).draw(above, fakeTarget(data, 120, 400, 200, 300));
    assert.equal(above.countCalls('fillRect'), 0);
    const below = new MockContext2D();
    createSessionProfilePrimitive({ composite: true, showPoc: false }).draw(below, fakeTarget(data, 120, 400, 0, 50));
    assert.equal(below.countCalls('fillRect'), 0);
  });
});

describe('createSessionLevelsPrimitive', () => {
  it('projects POC and value-area lines with labels for the latest session', () => {
    const ctx = new MockContext2D();
    createSessionLevelsPrimitive().draw(ctx, fakeTarget(candles(72), 640, 400, 140, 180));
    assert.equal(ctx.countCalls('stroke'), 3);
    const labels = ctx.callsNamed('fillText').map((c) => String(c[1]));
    assert.ok(labels.some((t) => t.startsWith('POC ')));
    assert.ok(labels.some((t) => t.startsWith('VAH ')));
    assert.ok(labels.some((t) => t.startsWith('VAL ')));
  });

  it('projects more sessions on request and supports TPO mode', () => {
    const ctx = new MockContext2D();
    createSessionLevelsPrimitive({ sessions: 3, mode: 'tpo', showLabels: false }).draw(ctx, fakeTarget(candles(72), 640, 400, 95, 180));
    assert.equal(ctx.countCalls('stroke'), 9);
    assert.equal(ctx.countCalls('fillText'), 0);
  });

  it('skips level lines outside the visible price range', () => {
    const ctx = new MockContext2D();
    createSessionLevelsPrimitive().draw(ctx, fakeTarget(candles(72), 640, 400, 500, 600));
    assert.equal(ctx.countCalls('stroke'), 0);
    assert.equal(ctx.countCalls('fillText'), 0);
  });

  it('draws nothing without visible bars', () => {
    const ctx = new MockContext2D();
    createSessionLevelsPrimitive().draw(ctx, fakeTarget([]));
    assert.equal(ctx.countCalls('stroke'), 0);
  });
});

describe('attachSessionProfile', () => {
  it('docks an auto-updating profile pane sharing the main price scale', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(72), width: 640, height: 400 } });
    const fullWidth = chart.plotArea.width;
    const api = attachSessionProfile(chart);
    assert.equal(api.pane.id, 'session-profile');
    assert.equal(chart.plotArea.width, fullWidth - DEFAULT_SESSION_PROFILE_WIDTH);
    const mainSeen: PrimitiveDrawTarget[] = [];
    chart.attachPrimitive({ draw: (_ctx, t) => { mainSeen.push(t); } });
    const paneSeen: PrimitiveDrawTarget[] = [];
    api.pane.attachPrimitive({ draw: (_ctx, t) => { paneSeen.push(t); } });
    assert.equal(paneSeen[0]!.priceScale.minPrice, mainSeen[0]!.priceScale.minPrice);
    assert.equal(paneSeen[0]!.priceScale.maxPrice, mainSeen[0]!.priceScale.maxPrice);
    assert.equal(paneSeen[0]!.width, DEFAULT_SESSION_PROFILE_WIDTH);
    // The pane drew profile rows and the main pane projected labeled levels.
    const ctx = doc.created[0]!.context;
    assert.ok(ctx.callsNamed('fillText').some((c) => String(c[1]).startsWith('POC ')));
    api.remove();
    assert.equal(chart.plotArea.width, fullWidth);
    chart.destroy();
  });

  it('updates options and dock width live', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(72), width: 640, height: 400 } });
    const fullWidth = chart.plotArea.width;
    const api = attachSessionProfile(chart, { mode: 'tpo', composite: true });
    assert.doesNotThrow(() => api.update({ mode: 'volume', showPoc: false }));
    api.update({ width: 60 });
    assert.equal(chart.plotArea.width, fullWidth - 60);
    api.remove();
    chart.destroy();
  });

  it('skips the main-pane projections when projectLevels is false', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(72), width: 640, height: 400 } });
    const api = attachSessionProfile(chart, { projectLevels: false });
    const ctx = doc.created[0]!.context;
    assert.ok(!ctx.callsNamed('fillText').some((c) => String(c[1]).startsWith('POC ')));
    api.update({ projectLevels: true });
    assert.ok(ctx.callsNamed('fillText').some((c) => String(c[1]).startsWith('POC ')));
    api.remove();
    chart.destroy();
  });

  it('rejects a duplicate pane id', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(72), width: 640, height: 400 } });
    const api = attachSessionProfile(chart);
    assert.throws(() => attachSessionProfile(chart), /duplicate pane/);
    api.remove();
    attachSessionProfile(chart).remove();
    chart.destroy();
  });
});
