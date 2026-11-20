const PREFIX = 'club:draft:';
const LOCAL_PREFIX = 'club:kept-draft:';

interface Draft {
  text: string;
  anonymous?: boolean | undefined;
  question?: boolean | undefined;
  room?: string | undefined;
  replyTo?: string | undefined;
}

export function memberDraftKey(member: string | null | undefined, place: string) {
  return member ? `${member}:${place}` : undefined;
}

export function readKeptDraft(key: string | undefined): Draft | null {
  if (!key) return null;
  // The session copy also works when persistent browser storage is disabled.
  for (const storage of ['sessionStorage', 'localStorage'] as const) {
    try {
      const raw = window[storage].getItem(LOCAL_PREFIX + key);
      if (!raw) continue;
      const draft = JSON.parse(raw) as Draft | null;
      if (typeof draft?.text === 'string') return draft;
    } catch {
      // A browser can refuse storage.
    }
  }
  return null;
}

export function readDraft(key: string): string {
  return readKeptDraft(key)?.text ?? '';
}

export function writeDraft(
  key: string,
  text: string,
  options?: Omit<Draft, 'text'>,
): 'device' | 'session' | null {
  const storageKey = LOCAL_PREFIX + key;
  const value = text.trim() ? JSON.stringify({ text, ...options }) : null;
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      if (value) {
        window[storage].setItem(storageKey, value);
        if (storage === 'localStorage') {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            // The persistent copy still saved.
          }
        }
        return storage === 'localStorage' ? 'device' : 'session';
      }
      window[storage].removeItem(storageKey);
    } catch {
      // A browser can refuse storage.
    }
  }
  return null;
}

/** Forget drafts and photo hand-offs on sign-out. */
export function forgetDrafts() {
  for (const storage of ['sessionStorage', 'localStorage'] as const) {
    try {
      const area = window[storage];
      for (const key of Object.keys(area)) {
        if (
          key.startsWith(LOCAL_PREFIX) ||
          key.startsWith(PREFIX) ||
          key.startsWith('club:quick-ask:')
        ) {
          area.removeItem(key);
        }
      }
    } catch {
      // A browser can refuse storage.
    }
  }
  handed.clear();
}

/** Check-in photos stay in memory until the member sends them. */
const handed = new Map<string, File[]>();

export function handPhotos(key: string, files: File[]) {
  handed.set(key, files);
}

export function handedPhotos(key: string | undefined): File[] {
  return key ? (handed.get(key) ?? []) : [];
}

export function forgetHandedPhotos(key: string) {
  handed.delete(key);
}
