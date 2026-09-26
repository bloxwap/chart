import type { Metadata } from 'next';
import { basePath, siteUrl } from './site';

export const socialImageSize = { width: 1200, height: 630 };
export const homeSocial = {
  title: 'Financial charts. Your interface.',
  description: 'Build financial charts with TypeScript, Canvas and WebAssembly. Guides, working examples and API documentation for @bloxwap/chart.',
};

/** Explicit PNG paths work on GitHub Pages without a running image service. */
export function socialImageSegments(slugs?: string[]): string[] {
  if (!slugs) return ['home.png'];
  return ['docs', ...slugs.slice(0, -1), `${slugs.at(-1) ?? 'index'}.png`];
}

export function socialImagePath(slugs?: string[]): string {
  return `/og/${socialImageSegments(slugs).join('/')}`;
}

export function socialMetadata({ title, description, path, imagePath }: {
  title: string;
  description: string;
  path: string;
  imagePath: string;
}): Pick<Metadata, 'openGraph' | 'twitter' | 'alternates'> {
  const absolute = (pathname: string) => new URL(`${basePath}${pathname}`, siteUrl).href;
  const image = { url: absolute(imagePath), ...socialImageSize, alt: `@bloxwap/chart — ${title}` };
  const socialTitle = `${title} · @bloxwap/chart`;
  return {
    alternates: { canonical: absolute(path) },
    openGraph: {
      type: 'website', locale: 'en_US', siteName: '@bloxwap/chart',
      title: socialTitle, description, url: absolute(path),
      images: [{ ...image, type: 'image/png' }],
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description, images: [image] },
  };
}
