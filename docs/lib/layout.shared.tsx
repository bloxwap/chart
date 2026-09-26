import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { assetUrl, repository } from './site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand">
        {/* Use the supplied Bloxwap artwork; the wordmark is never typeset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl('/logos/bloxwap-wordmark-white.svg')} alt="Bloxwap" width={112} height={31} />
        <span className="brand-product">chart</span>
      </span>,
      url: '/',
    },
    themeSwitch: { enabled: false },
    githubUrl: repository,
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      { text: 'Playground', url: '/docs/playground' },
    ],
  };
}
