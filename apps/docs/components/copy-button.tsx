'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** A quiet icon button that copies `text`, with a check mark and a screen-reader status on success. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(() => setResult(null), result === 'copied' ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(text);
      setResult('copied');
    } catch {
      setResult('failed');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="btn btn--ghost btn--icon" aria-label={label} disabled={busy} aria-busy={busy} title={result === 'copied' ? 'Copied!' : label} onClick={copy}>
      {result === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
    <span role="status" className={result === 'failed' ? 'copy-feedback' : 'sr-only'}>
      {result === 'copied' ? 'Code copied to clipboard.' : result === 'failed' ? 'Could not copy. Select the code to copy it manually.' : ''}
    </span>
  </>;
}
