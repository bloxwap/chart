'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@bloxwap/hig-react/button';
import { useClipboard } from '@/lib/clipboard';

/** HIG icon button that copies `text`, with a check mark, a screen-reader status and visible failure recovery. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const copyText = useClipboard();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(() => setResult(null), result === 'copied' ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy() {
    if (busy) return;
    setBusy(true);
    try {
      await copyText(text);
      setResult('copied');
    } catch {
      setResult('failed');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <IconButton intent="ghost" className="docs-icon-button" label={label} busy={busy} title={result === 'copied' ? 'Copied' : label} onClick={copy}>
      {result === 'copied' ? <Check /> : <Copy />}
    </IconButton>
    <span role="status" className={result === 'failed' ? 'copy-feedback' : 'hig-sr-only'}>
      {result === 'copied' ? 'Code copied to clipboard.' : result === 'failed' ? 'Could not copy. Select the code to copy it manually.' : ''}
    </span>
  </>;
}
