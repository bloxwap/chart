'use client';

import { useState } from 'react';
import { Button } from '@bloxwap/hig-react/button';
import { Tabs } from '@bloxwap/hig-react/navigation';
import { Surface } from '@bloxwap/hig-react/surface';
import { useClipboard } from '@/lib/clipboard';

const managers = [
  { name: 'bun', command: 'bun add @bloxwap/chart' },
  { name: 'npm', command: 'npm install @bloxwap/chart' },
  { name: 'pnpm', command: 'pnpm add @bloxwap/chart' },
  { name: 'yarn', command: 'yarn add @bloxwap/chart' },
];

/*
 * The HIG `InstallCommand` recipe (command + host clipboard adapter, "Copied" / manual-selection recovery),
 * composed from the same HIG primitives. `@bloxwap/hig-react/recipes` also bundles the overlay entry, which
 * needs the Radix dropdown-menu and tooltip peers this site does not otherwise install; switch to the recipe
 * import once HIG ships it without those peers (exception recorded in docs/hig-adoption/README.md).
 */
function Command({ command, onCopy }: { command: string; onCopy: () => Promise<void> }) {
  const [status, setStatus] = useState('');
  return <Surface>
    <pre tabIndex={0}><code>{command}</code></pre>
    <Button intent="secondary" onClick={() => {
      Promise.resolve().then(onCopy).then(() => setStatus('Copied')).catch(() => setStatus('Copy failed. Select the command and copy manually.'));
    }}>Copy install command</Button>
    <p role="status">{status}</p>
  </Surface>;
}

/** HIG Tabs (arrow/Home/End keys) around one install command per package manager. */
export function InstallCommand() {
  const copy = useClipboard();
  return <div className="package-install" data-hig-density="compact">
    <Tabs
      label="Package manager"
      items={managers.map(({ name, command }) => ({ value: name, label: name, content: <Command command={command} onCopy={() => copy(command)} /> }))}
    />
    <p className="install-platforms">Bun · Node.js · Browsers · Workers</p>
  </div>;
}
