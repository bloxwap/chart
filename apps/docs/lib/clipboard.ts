'use client';

import { useRef } from 'react';

/**
 * One clipboard write at a time: a repeat activation while a write is pending joins it instead of
 * starting another. Rejections (denied permission, insecure context) reach the caller's recovery text.
 */
export function useClipboard(): (text: string) => Promise<void> {
  const pending = useRef<Promise<void> | null>(null);
  return (text) => {
    pending.current ??= Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .finally(() => { pending.current = null; });
    return pending.current;
  };
}
