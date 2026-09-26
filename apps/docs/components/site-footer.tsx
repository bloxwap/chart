import { assetUrl } from '@/lib/site';

/** Link columns mirror the bloxwap.com footer (monorepo workers/www), so both sites point at the same places. */
const COLUMNS: [string, [string, string][]][] = [
  ['Product', [['Home', 'https://bloxwap.com'], ['Web', 'https://bloxwap.com'], ['Pro', 'https://bloxwap.pro'], ['App', 'https://bloxwap.com/#app']]],
  ['Social', [['X', 'https://x.com/bloxwap'], ['Telegram', 'https://t.me/bloxwap'], ['Discord', 'https://discord.com/invite/cEfkcg6JHT'], ['Reddit', 'https://www.reddit.com/r/Bloxwap/']]],
  ['Company', [['Blog', 'https://bloxwap.com/blog'], ['Docs', 'https://bloxwap.com/docs'], ['GitHub', 'https://github.com/bloxwap'], ['Contact', 'mailto:support@bloxwap.com']]],
];

/** The Bloxwap site footer: brand, three link columns, and the legal row. */
export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-grid">
      <div className="footer-brand">
        <a className="footer-lockup" href="https://bloxwap.com" aria-label="Bloxwap">
          {/* Supplied Bloxwap artwork (brand/marks); the marks are never redrawn. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl('/logos/bloxwap-icon-green.svg')} alt="" width={36} height={36} className="footer-icon" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl('/logos/bloxwap-wordmark-white-greenx.svg')} alt="" width={117} height={32} className="footer-wordmark" />
        </a>
        <p>The easiest way to trade.</p>
      </div>
      {COLUMNS.map(([title, links]) => <nav className="footer-col" key={title} aria-label={title}>
        <h2>{title}</h2>
        {links.map(([label, href]) => <a href={href} key={label}>{label}</a>)}
      </nav>)}
    </div>
    <div className="footer-base">
      <span>© {new Date().getFullYear()} Bloxwap, Inc.</span>
      <nav className="footer-legal" aria-label="Legal">
        <a href="https://bloxwap.com/docs/terms">Terms</a>
        <span aria-hidden="true">•</span>
        <a href="https://bloxwap.com/docs/privacy">Privacy</a>
        <span aria-hidden="true">•</span>
        <a href={assetUrl('/llms.txt')}>llms.txt</a>
      </nav>
    </div>
  </footer>;
}
