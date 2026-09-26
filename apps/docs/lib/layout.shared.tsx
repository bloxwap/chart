import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { assetUrl, repository } from './site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand">
        {/* Use the supplied Bloxwap artwork (brand/marks/bloxwap-icon-green.svg); the mark is never redrawn. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl('/logos/bloxwap-icon-green.svg')} alt="Bloxwap" width={28} height={28} />
        <span className="brand-product">Chart SDK</span>
      </span>,
      url: '/',
    },
    themeSwitch: { enabled: false },
    githubUrl: repository,
  };
}
