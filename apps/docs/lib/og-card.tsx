import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { socialImageSize } from './social';

// A GitHub-style card: white canvas, title and description top left, the
// Bloxwap mark where GitHub puts the owner avatar, package facts along the
// bottom, and the brand palette as the language bar.
const palette = ['#00ff3f', '#35b5ff', '#b300ff', '#ff479c', '#fffb38'];
const ink = '#1f2328';
const muted = '#59636e';
const assets = Promise.all([
  readFile(join(process.cwd(), 'fonts/Nunito-Regular.ttf')),
  readFile(join(process.cwd(), 'fonts/Nunito-Bold.ttf')),
  readFile(join(process.cwd(), 'public/logos/bloxwap-icon-green.svg'), 'utf8'),
  readFile(join(process.cwd(), '../../packages/chart/package.json'), 'utf8'),
]);

function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('');
}

/** The mark as a plain SVG data URI; the renderer ignores the file's C2PA metadata and P3 styles. */
function markUri(svg: string): string {
  const plain = svg.replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/\sstyle="[^"]*"/g, '');
  return `data:image/svg+xml;base64,${Buffer.from(plain).toString('base64')}`;
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
  const [regular, bold, mark, manifest] = await assets;
  const pkg = JSON.parse(manifest) as { version: string; license: string; dependencies?: Record<string, string> };
  const facts: [string, string][] = [
    [`v${pkg.version}`, 'Latest'],
    [pkg.license, 'License'],
    [String(Object.keys(pkg.dependencies ?? {}).length), 'Dependencies'],
  ];
  const title = clamp(options.title, 80);
  const description = clamp(options.description, 150);
  const fontSize = title.length <= 24 ? 72 : title.length <= 48 ? 60 : 52;

  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#ffffff', color: ink, fontFamily: 'Nunito' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '80px 80px 56px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 64 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {options.home ? (
              <div style={{ display: 'flex', fontSize: 72, lineHeight: 1.15 }}>
                <span style={{ fontWeight: 400 }}>bloxwap/</span>
                <span style={{ fontWeight: 700 }}>chart</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: 30, color: muted }}>
                  <span style={{ fontWeight: 400 }}>bloxwap/</span>
                  <span style={{ fontWeight: 700 }}>chart</span>
                  <span style={{ fontWeight: 400, margin: '0 12px' }}>·</span>
                  <span style={{ fontWeight: 400 }}>{categoryLabel(options.category)}</span>
                </div>
                <div style={{ display: 'flex', marginTop: 16, fontSize, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
              </div>
            )}
            <div style={{ display: 'flex', marginTop: 28, fontSize: 30, fontWeight: 400, lineHeight: 1.4, color: muted }}>{description}</div>
          </div>
          <img src={markUri(mark)} width={128} height={128} alt="Bloxwap" />
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', gap: 48, fontSize: 28 }}>
          {facts.map(([value, label]) => (
            <div key={label} style={{ display: 'flex', gap: 10 }}>
              <span style={{ fontWeight: 700 }}>{value}</span>
              <span style={{ fontWeight: 400, color: muted }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', height: 16 }}>
        {palette.map((color) => <div key={color} style={{ display: 'flex', flex: 1, background: color }} />)}
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: 'Nunito', data: regular, weight: 400, style: 'normal' },
        { name: 'Nunito', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
