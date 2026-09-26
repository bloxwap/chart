import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { basePath, siteUrl } from '@/lib/site';

export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  // Every page is regenerated on each deploy, so the build time is each page's last modification.
  const lastModified = new Date();
  return ['/', ...source.getPages().map((page) => page.url + '/')].map((path) => ({ url: `${siteUrl}${basePath}${path}`, lastModified }));
}
