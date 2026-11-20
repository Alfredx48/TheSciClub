import { useEffect, useRef, useState } from 'react';
import {
  draftMediaGeneration,
  mayHaveDraftMedia,
  readDraftMedia,
  writeDraftMedia,
} from '@/lib/draft-media';

export type DraftMediaStatus =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'saved'
  | 'restored'
  | 'read-error'
  | 'write-error';

const nonempty = (files: readonly unknown[]) => files.length > 0;

export function useDraftMedia<T>(
  key: string | undefined,
  createInitial: () => T,
  hasFiles: (value: T) => boolean,
) {
  const [initial] = useState(createInitial);
  const [scope] = useState(draftMediaGeneration);
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<DraftMediaStatus>(() =>
    key && mayHaveDraftMedia(key) ? 'loading' : 'idle',
  );
  const loading = status === 'loading';
  const [recover] = useState(loading);
  const written = useRef(initial);
  const revision = useRef(0);
  const hadDraft = useRef(recover);

  useEffect(() => {
    if (!key || !recover) return;
    let closed = false;
    void readDraftMedia(key).then(
      (record) => {
        const saved = record as T | undefined;
        if (closed || scope !== draftMediaGeneration()) return;
        if (saved === undefined) {
          setStatus('read-error');
          return;
        }
        written.current = saved;
        setValue((current) => (current === initial ? saved : current));
        setStatus('restored');
      },
      () => {
        if (!closed && scope === draftMediaGeneration()) setStatus('read-error');
      },
    );
    return () => {
      closed = true;
    };
  }, [initial, key, recover, scope]);

  useEffect(() => {
    if (!key || loading || value === written.current || scope !== draftMediaGeneration()) return;
    const present = hasFiles(value);
    written.current = value;
    if (!present && !hadDraft.current) return;
    hadDraft.current = present;
    const write = ++revision.current;
    setStatus(present ? 'saving' : 'idle');
    void writeDraftMedia(key, present ? value : undefined, scope).then((ok) => {
      if (write === revision.current && scope === draftMediaGeneration())
        setStatus(ok ? (present ? 'saved' : 'idle') : 'write-error');
    });
  }, [hasFiles, key, loading, scope, value]);

  function clear() {
    revision.current += 1;
    if (key && (hadDraft.current || hasFiles(value))) void writeDraftMedia(key, undefined, scope);
    hadDraft.current = false;
    written.current = initial;
    setValue(initial);
    setStatus('idle');
  }

  return { value, setValue, loading, status, clear };
}

export function useDraftFiles(key: string | undefined) {
  return useDraftMedia<File[]>(key, () => [], nonempty);
}
