import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { ChartPreview } from '@/components/chart-preview';
import { InstallCommand } from '@/components/install-command';
import { HeroCode } from '@/components/hero-code';
import { SiteFooter } from '@/components/site-footer';
import { homeStructuredData } from '@/lib/structured-data';

export default function Home() {
  return <HomeLayout {...baseOptions()}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData()) }} />
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> DEVELOPER PREVIEW · v0.0.1</p>
          <h1>Financial charts.<br /><span>Your interface.</span></h1>
          <p className="hero-description">Your next trading interface starts here. Try the full chart below: draw a trend line, add indicators, change timeframes, and make it your own.</p>
          <div className="hero-actions"><a href="#playground" className="btn">Play with the chart <ArrowDown aria-hidden="true" /></a><Link href="/docs/getting-started" className="btn btn--secondary">Start building <ArrowRight aria-hidden="true" /></Link></div>
          <InstallCommand />
        </div>
        <HeroCode />
      </section>
      <section id="playground" className="hero-preview" aria-labelledby="playground-title">
        <ChartPreview>
          <p className="eyebrow">SIMULATED LIVE DATA</p>
          <h2 id="playground-title">Chart playground</h2>
          <p>Draw, zoom, add indicators, and make it yours.</p>
        </ChartPreview>
      </section>
      <section className="principles" aria-label="Library features">
        <div><span className="feature-number">01</span><h2>One typed config.</h2><p>Data, series, scales, and styling live in one configuration. Update just the fields you need.</p></div>
        <div><span className="feature-number">02</span><h2>Your stack. Your DOM.</h2><p>Pass in a canvas. Add the UI when you need it. The chart has zero runtime dependencies.</p></div>
        <div><span className="feature-number">03</span><h2>Built for interaction.</h2><p>Pan, zoom, annotate, and stream candle updates. WASM math includes a JavaScript fallback.</p></div>
      </section>
      <section className="start-grid">
        <div><p className="eyebrow">A SMALL API. ROOM TO BUILD.</p><h2>From your first candle<br />to a complete workspace.</h2><p>Start with the core, then add indicators, drawing tools, and the settings your users need.</p></div>
        <div className="guide-links">{[
          ['/docs/getting-started', '01', 'Quick start', 'Install, render, resize, and clean up.'],
          ['/docs/guides/react', '02', 'Use it with React', 'A canvas component with a clear lifecycle.'],
          ['/docs/guides/toolbar-settings', '03', 'Build the chart workspace', 'Drawing tools, settings, and themes.'],
          ['/docs/api/configuration', '04', 'Configuration reference', 'Make every pixel fit your product.'],
        ].map(([href, number, title, description]) => <Link href={href} key={href}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowRight aria-hidden="true" /></Link>)}</div>
      </section>
    </main>
    <SiteFooter />
  </HomeLayout>;
}
