import { source } from '@/lib/source';
import { renderSocialCard } from '@/lib/og-card';
import { homeSocial, socialImageSegments } from '@/lib/social';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: socialImageSegments() },
    ...source.getPages().map((page) => ({ slug: socialImageSegments(page.slugs) })),
  ];
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const key = slug.join('/');
  if (key === 'home.png') return renderSocialCard({ ...homeSocial, category: 'TYPESCRIPT · WASM', home: true });

  const page = source.getPages().find((entry) => socialImageSegments(entry.slugs).join('/') === key);
  if (!page) return new Response('Not found', { status: 404 });
  const category = page.slugs[0] === 'api' ? 'API REFERENCE'
    : page.slugs[0] === 'guides' ? 'GUIDES'
    : page.slugs[0] === 'playground' ? 'PLAYGROUND' : 'DOCUMENTATION';
  return renderSocialCard({ title: page.data.title, description: page.data.description ?? '', category });
}
