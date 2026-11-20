import { useEffect, useRef, useState } from 'react';
import { readKeptDraft, writeDraft } from '@/lib/chat/drafts';

export function useFormDraft<T extends object>(
  key: string | undefined,
  createInitial: () => T,
  restore?: (value: T) => T,
) {
  const [initial] = useState(createInitial);
  const [pristine] = useState(() => (key ? JSON.stringify({ version: 1, value: initial }) : null));
  const [recovered] = useState(() => {
    try {
      const stored = readKeptDraft(key);
      if (!stored) return null;
      const saved = JSON.parse(stored.text) as { version?: unknown; value?: unknown } | null;
      if (saved?.version !== 1 || !saved.value || typeof saved.value !== 'object') return null;
      const value = saved.value as T;
      return { ...stored, value: restore ? restore(value) : value };
    } catch {
      // Ignore an unreadable draft.
    }
    return null;
  });
  const [value, setValue] = useState(recovered?.value ?? initial);
  const [storage, setStorage] = useState<ReturnType<typeof writeDraft>>(recovered?.storage ?? null);
  const lastWritten = useRef<string | null>(recovered?.text ?? null);
  const complete = useRef(false);

  useEffect(() => {
    if (!key || complete.current || value === recovered?.value) return;
    const serialized = JSON.stringify({ version: 1, value });
    if (serialized === pristine) {
      if (lastWritten.current && readKeptDraft(key)?.text === lastWritten.current)
        writeDraft(key, '');
      lastWritten.current = null;
      setStorage(null);
      return;
    }
    const saved = writeDraft(key, serialized);
    lastWritten.current = saved ? serialized : null;
    setStorage(saved);
  }, [key, pristine, recovered, value]);

  function discard() {
    if (key) writeDraft(key, '');
    lastWritten.current = null;
    setValue(initial);
    setStorage(null);
  }

  function finish() {
    complete.current = true;
    if (key && lastWritten.current && readKeptDraft(key)?.text === lastWritten.current)
      writeDraft(key, '');
    setStorage(null);
  }

  return { value, setValue, storage, restored: value === recovered?.value, discard, finish };
}
