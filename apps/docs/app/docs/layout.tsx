import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsLayout {...baseOptions()} tree={source.getPageTree()} sidebar={{
    defaultOpenLevel: 1,
    footer: <div className="docs-sidebar-footer">
      <a href="https://bloxwap.app" className="docs-app-link">Open Bloxwap <span aria-hidden="true">↗</span></a>
    </div>,
  }}>{children}</DocsLayout>;
}
