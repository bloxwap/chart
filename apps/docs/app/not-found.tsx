import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { assetUrl } from '@/lib/site';

const RESOURCES: [string, string][] = [
  ['Documentation', '/docs'],
  ['llms.txt', '/llms.txt'],
  ['Sitemap', '/sitemap.xml'],
  ['Markdown version of this error', '/404.md'],
];

export default function NotFound() {
  return <main className="not-found">
    <link rel="alternate" type="text/markdown" href={assetUrl('/404.md')} />
    <p className="eyebrow">404 / OFF THE CHART</p>
    <h1>That page is missing.</h1>
    <p>The page you requested does not exist on this site. It may have moved, or the URL may be wrong. Head back to the documentation to find your next step, or use one of the machine-readable indexes below.</p>
    <Link href="/docs" className="btn">Open documentation <ArrowRight aria-hidden="true" /></Link>
    <nav className="not-found-links" aria-label="Site indexes">
      {RESOURCES.map(([label, href]) => <a key={href} href={assetUrl(href)}>{label}</a>)}
    </nav>
  </main>;
}
