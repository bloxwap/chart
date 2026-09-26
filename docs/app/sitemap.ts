import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { basePath, siteUrl } from '@/lib/site';

export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', ...source.getPages().map((page) => page.url + '/')].map((path) => ({ url: `${siteUrl}${basePath}${path}` }));
}
