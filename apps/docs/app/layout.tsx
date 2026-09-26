import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { basePath, siteUrl } from '@/lib/site';
import { homeSocial, socialImagePath, socialMetadata } from '@/lib/social';
import './global.css';

const sans = localFont({
  src: '../fonts/Nunito-Latin.woff2', weight: '200 1000',
  variable: '--font-docs-sans', display: 'swap',
});
const mono = localFont({
  src: '../fonts/MapleMono.woff2', weight: '100 800',
  variable: '--font-docs-mono', display: 'swap',
});
const display = localFont({
  src: '../fonts/SpaceGrotesk-Bold.ttf', weight: '700',
  variable: '--font-docs-display', display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}${basePath}/`),
  title: { default: '@bloxwap/chart — Financial charts for your interface', template: '%s · @bloxwap/chart' },
  description: 'Build financial charts with TypeScript, Canvas and WebAssembly. Guides, working examples and API documentation for @bloxwap/chart.',
  icons: { icon: `${basePath}/icon.svg` },
  ...socialMetadata({ ...homeSocial, path: '/', imagePath: socialImagePath() }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${display.variable} dark`}>
    <body className="flex min-h-screen flex-col antialiased"><Provider>{children}</Provider></body>
  </html>;
}
