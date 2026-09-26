import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { socialImageSize } from './social';

// Match monorepo/packages/og: Nunito headlines, Space Grotesk labels, a drawn
// wordmark, black canvas, and a 24px rail from the Bloxwap sRGB brand palette.
const palette = ['#00ff3f', '#35b5ff', '#b300ff', '#ff479c', '#fffb38'];
const assets = Promise.all([
  readFile(join(process.cwd(), 'fonts/Nunito-Bold.ttf')),
  readFile(join(process.cwd(), 'fonts/Nunito-Black.ttf')),
  readFile(join(process.cwd(), 'fonts/SpaceGrotesk-Bold.ttf')),
  readFile(join(process.cwd(), 'public/logos/bloxwap-wordmark-white.svg')),
]);

function accentFor(title: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) hash = Math.imul(hash ^ title.charCodeAt(i), 0x01000193);
  return palette[(hash >>> 0) % palette.length];
}

function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('');
}

export async function renderSocialCard(options: {
  title: string;
  description: string;
  category: string;
  home?: boolean;
}): Promise<ImageResponse> {
  const [bold, black, display, wordmark] = await assets;
  const title = clamp(options.title, 90);
  const description = clamp(options.description, 180);
  const accent = options.home ? palette[0] : accentFor(title);
  const fontSize = title.length <= 14 ? 148 : title.length <= 28 ? 116 : title.length <= 46 ? 92 : title.length <= 66 ? 72 : 58;

  return new ImageResponse(
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', color: '#f5f7fa', fontFamily: 'Nunito', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 24, height: '100%', background: accent }} />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '56px 72px 54px 78px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={`data:image/svg+xml;base64,${wordmark.toString('base64')}`} width={190} height={52} alt="Bloxwap" />
            <span style={{ fontFamily: 'Space Grotesk', fontSize: 26, color: '#636363' }}>·</span>
            <span style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, letterSpacing: 5, color: accent }}>CHART</span>
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: '#a1a1a1' }}>{options.category}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize, fontWeight: 900, letterSpacing: fontSize >= 116 ? -4 : -2, lineHeight: 1 }}>
            {options.home ? ['Financial charts.', 'Your interface.'].map((line) => <div key={line} style={{ display: 'flex' }}>{line}</div>) : title}
          </div>
          <div style={{ display: 'flex', maxWidth: 960, marginTop: 34, fontSize: 28, fontWeight: 700, lineHeight: 1.3, color: '#a1a1a1' }}>{description}</div>
        </div>
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: 'Nunito', data: bold, weight: 700, style: 'normal' },
        { name: 'Nunito', data: black, weight: 900, style: 'normal' },
        { name: 'Space Grotesk', data: display, weight: 700, style: 'normal' },
      ],
    },
  );
}
