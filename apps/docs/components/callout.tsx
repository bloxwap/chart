import type { ReactNode } from 'react';
import { Callout as HigCallout } from '@bloxwap/hig-react/status';

type FumadocsType = 'info' | 'note' | 'idea' | 'success' | 'warn' | 'warning' | 'error';
const severity = { info: 'info', note: 'info', idea: 'info', success: 'success', warn: 'warning', warning: 'warning', error: 'error' } as const;
const fallbackTitle = { info: 'Note', success: 'Success', warning: 'Warning', error: 'Error' } as const;

/** MDX `<Callout>` keeps the Fumadocs props and renders the HIG callout. Static content is not announced. */
export function Callout({ type = 'info', title, children }: { type?: FumadocsType; title?: ReactNode; children?: ReactNode }) {
  const level = severity[type] ?? 'info';
  return <div className="docs-callout">
    <HigCallout title={typeof title === 'string' ? title : fallbackTitle[level]} severity={level} announce={false}>
      <div className="docs-callout-body">{children}</div>
    </HigCallout>
  </div>;
}
