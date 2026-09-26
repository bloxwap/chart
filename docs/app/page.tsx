import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { ChartPreview } from '@/components/chart-preview';

export default function Home() {
  return <HomeLayout {...baseOptions()}>
    <main className="home">
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow"><span className="status-dot" /> DEVELOPER PREVIEW · v0.1</p>
          <h1>Financial charts.<br /><span>Your interface.</span></h1>
          <p className="hero-description">Candles, indicators, and drawing tools for your next trading interface. Built in TypeScript. Rendered on Canvas. Yours to compose.</p>
          <div className="hero-actions"><Link href="/docs/getting-started" className="primary-link">Start building <span>↗</span></Link><Link href="/docs/api/chart" className="secondary-link">Explore the API →</Link></div>
          <div className="install-command"><span>$</span><code>npm install @bloxwap/chart</code><span className="release-tag">coming to npm</span></div>
          <Link href="/docs/getting-started#install-from-source" className="source-install">Use the local package today →</Link>
        </div>
        <div className="hero-preview"><div className="preview-eyebrow"><span>01 / TRY IT</span><span>THIS IS A REAL CHART ↙</span></div><ChartPreview /></div>
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
