import { useEffect, useState } from 'react';
import { afterFirstContent } from '@/lib/page-speed';

/** Runs `task` when the page is idle; returns a cancel. */
export function whenIdle(task: () => void): () => void {
  // Safari before 26 has no requestIdleCallback.
  if (typeof (window.requestIdleCallback as unknown) === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 4000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(task, 2000);
  return () => {
    window.clearTimeout(id);
  };
}

/**
 * True once the first screen shows its content and the page is then idle: for work that should
 * not compete with what is on screen, such as Peers' later photos (the owner, 2026-11-22: "when
 * everything is loaded silently load the rest").
 */
export function useAfterSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    let cancel: (() => void) | null = null;
    let stopped = false;
    void afterFirstContent().then(() => {
      if (!stopped)
        cancel = whenIdle(() => {
          setSettled(true);
        });
    });
    return () => {
      stopped = true;
      cancel?.();
    };
  }, [settled]);
  return settled;
}
