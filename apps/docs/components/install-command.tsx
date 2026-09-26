'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const managers = [
  { name: 'bun', command: 'bun add @bloxwap/chart' },
  { name: 'npm', command: 'npm install @bloxwap/chart' },
  { name: 'pnpm', command: 'pnpm add @bloxwap/chart' },
  { name: 'yarn', command: 'yarn add @bloxwap/chart' },
];

export function InstallCommand() {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [copyResult, setCopyResult] = useState<{ command: string; success: boolean } | null>(null);
  const { command } = managers[selected];
  const result = copyResult?.command === command ? copyResult : null;

  useEffect(() => {
    if (!copyResult) return;
    const timer = window.setTimeout(() => setCopyResult(null), copyResult.success ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [copyResult]);

  function select(index: number) {
    setSelected(index);
    setCopyResult(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyResult({ command, success: true });
    } catch {
      setCopyResult({ command, success: false });
    }
  }

  return <div className="package-install">
    <div className="install-tabs" role="tablist" aria-label="Package manager">
      {managers.map(({ name }, index) => <button
        key={name}
        type="button"
        role="tab"
        id={`${id}-tab-${index}`}
        aria-controls={`${id}-command`}
        aria-selected={selected === index}
        tabIndex={selected === index ? 0 : -1}
        onClick={() => select(index)}
        onKeyDown={(event) => {
          let next: number;
          if (event.key === 'ArrowRight') next = (index + 1) % managers.length;
          else if (event.key === 'ArrowLeft') next = (index + managers.length - 1) % managers.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = managers.length - 1;
          else return;
          event.preventDefault();
          select(next);
          document.getElementById(`${id}-tab-${next}`)?.focus();
        }}
      >{name}</button>)}
    </div>
    <div className="install-command" role="tabpanel" id={`${id}-command`} aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
      <span className="install-prompt" aria-hidden="true">$</span>
      <code>{command}</code>
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Copy install command" title={result?.success ? 'Copied!' : 'Copy command'} onClick={copy}>
        {result?.success ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
    </div>
    <span role="status" className={result && !result.success ? 'install-feedback' : 'sr-only'}>
      {result ? result.success ? 'Command copied to clipboard.' : 'Could not copy. Select the command to copy it manually.' : ''}
    </span>
    <p className="install-platforms">Bun · Node.js · Browsers · Workers</p>
  </div>;
}
