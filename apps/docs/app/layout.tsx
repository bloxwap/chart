import type { Metadata } from 'next';
import { BloxwapSans as sans } from '@bloxwap/font/sans';
import { BloxwapMono as mono } from '@bloxwap/font/mono';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { basePath, siteUrl } from '@/lib/site';
import { homeSocial, socialImagePath, socialMetadata } from '@/lib/social';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}${basePath}/`),
  title: { default: '@bloxwap/chart — Financial charts for your interface', template: '%s · @bloxwap/chart' },
  description: 'Build financial charts with TypeScript, Canvas and WebAssembly. Guides, working examples and API documentation for @bloxwap/chart.',
  icons: { icon: `${basePath}/icon.svg` },
  ...socialMetadata({ ...homeSocial, path: '/', imagePath: socialImagePath() }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} dark`}>
    <body className="flex min-h-screen flex-col antialiased">
      <link rel="service-desc" type="application/json" href={`${basePath}/openapi.json`} />
      <Provider>{children}</Provider>
    </body>
  </html>;
}
