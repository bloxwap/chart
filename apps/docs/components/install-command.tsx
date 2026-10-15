'use client';

import { Tabs } from '@bloxwap/hig-react/navigation';
import { InstallCommand as HigInstallCommand } from '@bloxwap/hig-react/recipes/install-command';
import { useClipboard } from '@/lib/clipboard';

const managers = [
  { name: 'bun', command: 'bun add @bloxwap/chart' },
  { name: 'npm', command: 'npm install @bloxwap/chart' },
  { name: 'pnpm', command: 'pnpm add @bloxwap/chart' },
  { name: 'yarn', command: 'yarn add @bloxwap/chart' },
];

/**
 * HIG Tabs (arrow/Home/End keys) around one HIG `InstallCommand` recipe per package manager. The recipe entry
 * imports no overlay, so it needs no Radix peer; the command's focusable `pre` is the panel's only tab stop.
 */
export function InstallCommand() {
  const copy = useClipboard();
  return <div className="package-install" data-hig-density="compact">
    <Tabs
      label="Package manager"
      items={managers.map(({ name, command }) => ({ value: name, label: name, content: <HigInstallCommand command={command} onCopy={() => copy(command)} /> }))}
    />
    <p className="install-platforms">Bun · Node.js · Browsers · Workers</p>
  </div>;
}
