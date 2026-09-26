import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { ChartPreview } from '@/components/chart-preview';
import { InstallCommand } from '@/components/install-command';

export default function Home() {
  return <HomeLayout {...baseOptions()}>
    <main className="home">
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow"><span className="status-dot" /> DEVELOPER PREVIEW · v0.1</p>
          <h1>Financial charts.<br /><span>Your interface.</span></h1>
        </div>
        <div className="hero-intro">
          <p className="hero-description">Your next trading interface starts here. Try the full chart below: draw a trend line, add indicators, change timeframes, and make it your own.</p>
          <div className="hero-actions"><a href="#playground" className="primary-link">Play with the chart <span aria-hidden="true">↓</span></a><Link href="/docs/getting-started" className="secondary-link">Start building →</Link></div>
          <InstallCommand />
        </div>
      </section>
      <section id="playground" className="hero-preview" aria-label="Interactive chart playground">
        <ChartPreview />
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
        ].map(([href, number, title, description]) => <Link href={href} key={href}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><span>↗</span></Link>)}</div>
      </section>
    </main>
    <footer className="site-footer"><span>© Bloxwap · MIT licensed</span><span>Documentation built with <a href="https://www.fumadocs.dev">Fumadocs</a></span></footer>
  </HomeLayout>;
}
