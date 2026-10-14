'use client';

import { useId, useState } from 'react';
import { CopyButton } from './copy-button';

const managers = [
  { name: 'bun', command: 'bun add @bloxwap/chart' },
  { name: 'npm', command: 'npm install @bloxwap/chart' },
  { name: 'pnpm', command: 'pnpm add @bloxwap/chart' },
  { name: 'yarn', command: 'yarn add @bloxwap/chart' },
];

export function InstallCommand() {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const { command } = managers[selected];

  function select(index: number) {
    setSelected(index);
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
      <CopyButton key={command} text={command} label="Copy install command" />
    </div>
    <p className="install-platforms">Bun · Node.js · Browsers · Workers</p>
  </div>;
}
