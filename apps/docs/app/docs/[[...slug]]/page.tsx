import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle, EditOnGitHub } from 'fumadocs-ui/layouts/docs/page';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import { repository } from '@/lib/site';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;
  return <DocsPage toc={page.data.toc}>
    <DocsTitle>{page.data.title}</DocsTitle>
    <DocsDescription>{page.data.description}</DocsDescription>
    <DocsBody><MDX components={getMDXComponents()} /></DocsBody>
    <EditOnGitHub href={`${repository}/blob/main/apps/docs/content/docs/${page.path}`} />
  </DocsPage>;
}

export function generateStaticParams() { return source.generateParams(); }
export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
