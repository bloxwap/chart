import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';

/*
 * The homepage snippet is read from snippets/price-chart.tsx at build time. That file is part of
 * `docs:check`, so the code on the homepage is always code that type-checks against @bloxwap/chart.
 */
const SNIPPET_FILE = 'price-chart.tsx';

const KEYWORDS = new Set(['import', 'from', 'export', 'function', 'const', 'return', 'type', 'new']);
// Comments, strings, identifiers, then any single other character.
const TOKEN = /(\/\/[^\n]*)|('[^'\n]*')|([A-Za-z_$][\w$]*)|([\s\S])/g;

/** A tiny highlighter for this one snippet, in the Bloxwap code palette (keyword, string, type). */
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') out.push(plain);
    plain = '';
  };
  for (const [, comment, string, word, other] of code.matchAll(TOKEN)) {
    const cls = comment ? 'syntax-muted' : string ? 'syntax-string' : word && KEYWORDS.has(word) ? 'syntax-keyword'
      : word && /^[A-Z]/.test(word) ? 'syntax-type' : null;
    const text = comment ?? string ?? word ?? other ?? '';
    if (cls === null) {
      plain += text;
    } else {
      flush();
      out.push(<span key={out.length} className={cls}>{text}</span>);
    }
  }
  flush();
  return out;
}

export function HeroCode() {
  // Read per render (build time for the static export), so dev edits to the snippet show up.
  const source = readFileSync(join(process.cwd(), 'snippets', SNIPPET_FILE), 'utf8').trimEnd();
  return <figure className="code-window" aria-label="A React component that renders a default chart">
    <figcaption className="code-toolbar">
      <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{SNIPPET_FILE}</span>
      <span className="code-language">TSX</span>
    </figcaption>
    <pre><code>{highlight(source)}</code></pre>
    <p className="code-status"><span aria-hidden="true" /> A dark candlestick chart that fits its container</p>
  </figure>;
}
