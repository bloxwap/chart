/**
 * Toolbar catalog: every built-in drawing tool grouped the way trading
 * terminals present them (group → section → tool). Hosts render their
 * drawing toolbar and flyout submenus from this data.
 *
 * @module
 */

/** One tool entry: the registry name plus a human label. */
export interface ToolEntry {
  /** Drawing registry name, passed to `chart.addDrawing({ name })`. */
  readonly name: string;
  readonly label: string;
}

/** A titled run of tools inside a group's submenu. */
export interface ToolSection {
  readonly title: string;
  readonly tools: readonly ToolEntry[];
}

/** One toolbar button and its flyout submenu. */
export interface ToolGroup {
  readonly id: string;
  readonly label: string;
  readonly sections: readonly ToolSection[];
}

const t = (name: string, label: string): ToolEntry => ({ name, label });

/** All drawing tool groups, in toolbar order. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: 'lines',
    label: 'Trend line tools',
    sections: [
      {
        title: 'Lines',
        tools: [
          t('trendline', 'Trend line'),
          t('ray', 'Ray'),
          t('info-line', 'Info line'),
          t('extended-line', 'Extended line'),
          t('trend-angle', 'Trend angle'),
          t('hline', 'Horizontal line'),
          t('horizontal-ray', 'Horizontal ray'),
          t('vertical-line', 'Vertical line'),
          t('cross-line', 'Cross line'),
        ],
      },
      {
        title: 'Channels',
        tools: [
          t('parallel-channel', 'Parallel channel'),
          t('regression-trend', 'Regression trend'),
          t('flat-top-bottom', 'Flat top/bottom'),
          t('disjoint-channel', 'Disjoint channel'),
        ],
      },
      {
        title: 'Pitchforks',
        tools: [
          t('pitchfork', 'Pitchfork'),
          t('schiff-pitchfork', 'Schiff pitchfork'),
          t('modified-schiff-pitchfork', 'Modified Schiff pitchfork'),
          t('inside-pitchfork', 'Inside pitchfork'),
        ],
      },
    ],
  },
  {
    id: 'fib',
    label: 'Gann and Fibonacci tools',
    sections: [
      {
        title: 'Fibonacci',
        tools: [
          t('fib', 'Fib retracement'),
          t('fib-extension', 'Trend-based fib extension'),
          t('fib-channel', 'Fib channel'),
          t('fib-time-zone', 'Fib time zone'),
          t('fib-speed-fan', 'Fib speed resistance fan'),
          t('fib-time', 'Trend-based fib time'),
          t('fib-circles', 'Fib circles'),
          t('fib-spiral', 'Fib spiral'),
          t('fib-speed-arcs', 'Fib speed resistance arcs'),
          t('fib-wedge', 'Fib wedge'),
          t('pitchfan', 'Pitchfan'),
        ],
      },
      {
        title: 'Gann',
        tools: [
          t('gann-box', 'Gann box'),
          t('gann-square-fixed', 'Gann square fixed'),
          t('gann-square', 'Gann square'),
          t('gann-fan', 'Gann fan'),
        ],
      },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns',
    sections: [
      {
        title: 'Chart patterns',
        tools: [
          t('xabcd', 'XABCD pattern'),
          t('cypher', 'Cypher pattern'),
          t('head-shoulders', 'Head and shoulders'),
          t('abcd', 'ABCD pattern'),
          t('triangle-pattern', 'Triangle pattern'),
          t('three-drives', 'Three drives pattern'),
        ],
      },
      {
        title: 'Elliott waves',
        tools: [
          t('elliott-impulse', 'Elliott impulse wave (12345)'),
          t('elliott-correction', 'Elliott correction wave (ABC)'),
          t('elliott-triangle', 'Elliott triangle wave (ABCDE)'),
          t('elliott-double-combo', 'Elliott double combo wave (WXY)'),
          t('elliott-triple-combo', 'Elliott triple combo wave (WXYXZ)'),
        ],
      },
      {
        title: 'Cycles',
        tools: [t('cyclic-lines', 'Cyclic lines'), t('time-cycles', 'Time cycles'), t('sine-line', 'Sine line')],
      },
    ],
  },
  {
    id: 'forecasting',
    label: 'Forecasting and measurement tools',
    sections: [
      {
        title: 'Projection',
        tools: [
          t('long-position', 'Long position'),
          t('short-position', 'Short position'),
          t('forecast', 'Forecast'),
          t('bars-pattern', 'Bars pattern'),
          t('ghost-feed', 'Ghost feed'),
          t('projection', 'Projection'),
        ],
      },
      {
        title: 'Volume-based',
        tools: [t('anchored-vwap', 'Anchored VWAP'), t('volume-profile', 'Fixed range volume profile')],
      },
      {
        title: 'Measurer',
        tools: [t('price-range', 'Price range'), t('date-range', 'Date range'), t('date-price-range', 'Date and price range')],
      },
    ],
  },
  {
    id: 'shapes',
    label: 'Geometric shapes',
    sections: [
      { title: 'Brushes', tools: [t('brush', 'Brush'), t('highlighter', 'Highlighter')] },
      {
        title: 'Arrows',
        tools: [
          t('arrow-marker', 'Arrow marker'),
          t('arrow', 'Arrow'),
          t('arrow-up', 'Arrow mark up'),
          t('arrow-down', 'Arrow mark down'),
        ],
      },
      {
        title: 'Shapes',
        tools: [
          t('rect', 'Rectangle'),
          t('rotated-rect', 'Rotated rectangle'),
          t('path', 'Path'),
          t('circle', 'Circle'),
          t('ellipse', 'Ellipse'),
          t('polyline', 'Polyline'),
          t('triangle', 'Triangle'),
          t('arc', 'Arc'),
          t('curve', 'Curve'),
          t('double-curve', 'Double curve'),
        ],
      },
    ],
  },
  {
    id: 'annotation',
    label: 'Annotation tools',
    sections: [
      {
        title: 'Text and notes',
        tools: [
          t('text', 'Text'),
          t('anchored-text', 'Anchored text'),
          t('note', 'Note'),
          t('anchored-note', 'Anchored note'),
          t('price-note', 'Price note'),
          t('pin', 'Pin'),
          t('table', 'Table'),
          t('callout', 'Callout'),
          t('comment', 'Comment'),
          t('price-label', 'Price label'),
          t('signpost', 'Signpost'),
          t('flag-mark', 'Flag mark'),
        ],
      },
      { title: 'Content', tools: [t('image', 'Image')] },
    ],
  },
  {
    id: 'icons',
    label: 'Icons',
    sections: [{ title: 'Icons', tools: [t('emoji', 'Emoji'), t('sticker', 'Sticker'), t('icon', 'Icon')] }],
  },
];

/** Pointer modes offered by the cursor group (the crosshair `mode` values plus the eraser). */
export const CURSOR_MODES: readonly ToolEntry[] = [
  t('cross', 'Cross'),
  t('dot', 'Dot'),
  t('arrow', 'Arrow'),
  t('demonstration', 'Demonstration'),
  t('eraser', 'Eraser'),
];

/** Looks up a tool entry by registry name. */
export function findTool(name: string): ToolEntry | undefined {
  for (const g of TOOL_GROUPS) {
    for (const s of g.sections) {
      const hit = s.tools.find((tool) => tool.name === name);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}
