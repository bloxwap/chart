import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { InstallCommand } from '@/components/install-command';
import { SiteFooter } from '@/components/site-footer';
import { assetUrl, repository } from '@/lib/site';
import { socialImagePath, socialMetadata } from '@/lib/social';

const title = 'Developers';
const description = 'Everything an agent or developer needs to build with @bloxwap/chart: install quickstart, API reference, machine-readable indexes, and a live sandbox.';

export const metadata: Metadata = {
  title,
  description,
  ...socialMetadata({ title, description, path: '/developers/', imagePath: socialImagePath() }),
};

const GUIDES: [string, string, string, string][] = [
  ['/docs/getting-started', '01', 'Quick start', 'Install, render, resize, and clean up.'],
  ['/docs/api/chart', '02', 'Chart API', 'Data updates, studies, drawings, rendering.'],
  ['/docs/api/configuration', '03', 'Configuration reference', 'One typed object for every option.'],
  ['/docs/playground', '04', 'Sandbox playground', 'The full chart with a simulated live feed.'],
];

const RESOURCES: [string, string, string, string][] = [
  ['/llms.txt', '01', 'llms.txt', 'Agent-oriented index of the library and every docs page.'],
  ['/openapi.json', '02', 'openapi.json', 'OpenAPI 3.1 spec of this site’s machine-readable endpoints.'],
  ['/search.json', '03', 'search.json', 'Full-text search index over all documentation.'],
  ['/sitemap.xml', '04', 'sitemap.xml', 'Every public page, with last modification dates.'],
];

export default function Developers() {
  return <HomeLayout {...baseOptions()}>
    <main className="home">
      <section className="hero hero--single">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> DEVELOPER PORTAL</p>
          <h1>Build with the<br /><span>Chart SDK.</span></h1>
          <p className="hero-description">Zero-dependency financial charts for your interface. Install the package, render your first candlestick chart in minutes, and let agents discover the API through the machine-readable resources below.</p>
          <div className="hero-actions"><Link href="/docs/getting-started" className="btn">Start building <ArrowRight aria-hidden="true" /></Link><a href={repository} className="btn btn--secondary">Source on GitHub <ArrowRight aria-hidden="true" /></a></div>
          <InstallCommand />
        </div>
      </section>
      <section className="start-grid">
        <div><p className="eyebrow">GUIDES AND REFERENCE</p><h2>From install<br />to integration.</h2><p>Guides, the typed API reference, and a sandbox that runs the complete chart in your browser.</p></div>
        <div className="guide-links">{GUIDES.map(([href, number, name, summary]) => <Link href={href} key={href}><span>{number}</span><div><h3>{name}</h3><p>{summary}</p></div><ArrowRight aria-hidden="true" /></Link>)}</div>
      </section>
      <section className="start-grid">
        <div><p className="eyebrow">MACHINE-READABLE</p><h2>Built for agents.</h2><p>Structured indexes that let LLMs, crawlers, and tooling understand the library and this site without scraping HTML.</p></div>
        <div className="guide-links">{RESOURCES.map(([href, number, name, summary]) => <a href={assetUrl(href)} key={href}><span>{number}</span><div><h3>{name}</h3><p>{summary}</p></div><ArrowRight aria-hidden="true" /></a>)}</div>
      </section>
    </main>
    <SiteFooter />
  </HomeLayout>;
}
