import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BUILTIN_DRAWINGS } from '@bloxwap/chart/drawings';
import { BUILTIN_INDICATORS } from '@bloxwap/chart/indicators';
import { socialImageSize } from './social';

// Modeled on GitHub's repository cards, in the site's dark theme (the same card as bloxwap/sfx): the Bloxwap black
// canvas, owner/repo title, muted description, the logo tile top right, a stats row, and a color bar along the
// bottom (the Bloxwap brand palette).
const ink = '#fafafa'; // --foreground
const muted = '#a1a1a1'; // --muted-foreground
const bar: [color: string, share: number][] = [['#00ff3f', 62], ['#35b5ff', 14], ['#b300ff', 10], ['#ff479c', 8], ['#fffb38', 6]];
const assets = Promise.all([
  readFile(join(process.cwd(), 'fonts/Nunito-Bold.ttf')),
  readFile(join(process.cwd(), 'fonts/Nunito-Black.ttf')),
  readFile(join(process.cwd(), '../../packages/chart/package.json'), 'utf8'),
]);

/** Lucide-style 24px stroke icons, inlined so the renderer needs no icon font or component. */
const icons: Record<string, string[]> = {
  indicators: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'],
  drawings: [
    'M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13', 'm8 6 2-2', 'm18 16 2-2',
    'm17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17',
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4',
  ],
  dependencies: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
  version: ['M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', 'M7.5 7.5h.01'],
  docs: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'],
};

function Icon({ name }: { name: string }) {
  return <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {icons[name].map((d) => <path key={d} d={d} />)}
  </svg>;
}

function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('');
}

/** Sentence-cases the route's category label, e.g. `API REFERENCE` → `API reference`. */
function categoryLabel(category: string): string {
  return category.startsWith('API') ? `API${category.slice(3).toLowerCase()}` : category.charAt(0) + category.slice(1).toLowerCase();
}

export async function renderSocialCard(options: {
  title: string;
  description: string;
  category: string;
  home?: boolean;
}): Promise<ImageResponse> {
  const [bold, black, manifest] = await assets;
  const pkg = JSON.parse(manifest) as { version: string; dependencies?: Record<string, string> };
  const stats: [icon: string, value: string, label: string][] = [
    ['indicators', String(BUILTIN_INDICATORS.length), 'Indicators'],
    ['drawings', String(BUILTIN_DRAWINGS.length), 'Drawing tools'],
    ['dependencies', String(Object.keys(pkg.dependencies ?? {}).length), 'Dependencies'],
    ['version', `v${pkg.version}`, 'Latest'],
  ];
  const title = clamp(options.title, 60);
  const description = clamp(options.description, 150);
  const fontSize = options.home || title.length <= 20 ? 84 : title.length <= 34 ? 72 : 60;

  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0a0a0a', color: ink, fontFamily: 'Nunito' }}>
      <div style={{ display: 'flex', flex: 1, padding: '76px 80px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 64 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', fontSize, lineHeight: 1.12, letterSpacing: -1 }}>
            {options.home
              ? <><span style={{ fontWeight: 700, color: muted }}>bloxwap/</span><span style={{ fontWeight: 900 }}>chart</span></>
              : <span style={{ fontWeight: 900 }}>{title}</span>}
          </div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 34, fontWeight: 700, lineHeight: 1.4, color: muted }}>{description}</div>
        </div>
        <svg width={200} height={200} viewBox="0 0 100 100">
          <rect width="100" height="100" rx="22.37" fill="#00ff3f" />
          <g fill="none" stroke="#0a0a0a" strokeWidth="16" strokeLinecap="round">
            <path d="M25 75L75 25" /><path d="M24 24L35 35" /><path d="M65 65L76 76" />
          </g>
        </svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 56, padding: '0 80px 52px' }}>
        {options.home
          ? stats.map(([icon, value, label]) => <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, fontWeight: 700 }}><Icon name={icon} />{value}</div>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: muted }}>{label}</div>
          </div>)
          : <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 700, color: muted }}>
            <Icon name="docs" /><span style={{ color: ink }}>bloxwap/chart</span><span>·</span><span>{categoryLabel(options.category)}</span>
          </div>}
      </div>
      <div style={{ display: 'flex', height: 24 }}>
        {bar.map(([color, share]) => <div key={color} style={{ display: 'flex', flex: share, background: color }} />)}
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: 'Nunito', data: bold, weight: 700, style: 'normal' },
        { name: 'Nunito', data: black, weight: 900, style: 'normal' },
      ],
    },
  );
}
