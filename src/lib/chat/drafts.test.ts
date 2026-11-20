import { describe, expect, it } from 'vitest';
import { forgetDrafts, memberDraftKey, readDraft, writeDraft } from '@/lib/chat/drafts';

// Privacy: the next person to sign in on a shared device reads nothing unsent.
describe('drafts on sign-out', () => {
  it('forgets every draft, the ask box too, and nothing else', () => {
    sessionStorage.clear();
    localStorage.clear();
    const key = memberDraftKey('alice', 'thread:a') ?? '';
    const other = memberDraftKey('bob', 'thread:a') ?? '';
    writeDraft(key, 'private words');
    expect(readDraft(other)).toBe('');
    localStorage.setItem('club:other', 'kept');
    sessionStorage.setItem('club:quick-ask:home', 'a question');
    sessionStorage.setItem('club:other', 'kept');
    forgetDrafts();
    expect(readDraft(key)).toBe('');
    expect(localStorage.getItem('club:other')).toBe('kept');
    expect(sessionStorage.getItem('club:quick-ask:home')).toBeNull();
    expect(sessionStorage.getItem('club:other')).toBe('kept');
  });
});
