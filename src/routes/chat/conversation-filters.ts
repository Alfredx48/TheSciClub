import { threadTitle } from '@/lib/chat/threads';
import type { ChatAuthor, ChatThread } from '@/lib/chat/types';
import { matchesSearch } from '@/lib/search';

/**
 * Keeping a long Chat list short (the owner, 2026-11-05: "I have too many
 * chats open", then "cap the lists at 3 each").
 *
 * The three latest direct chats and the three latest groups are listed; the
 * rest wait behind More direct chats and More group chats. One with something
 * unread is listed whatever its place: hiding what somebody has not read yet
 * is hiding the point.
 */
export const SHOWN_EACH = 3;

/** `threads` newest first, as chat_my_threads returns them. */
export function splitShown(threads: ChatThread[]): {
  shown: ChatThread[];
  more: Record<'direct' | 'group', ChatThread[]>;
} {
  const seen = { direct: 0, group: 0 };
  const shown: ChatThread[] = [];
  const more: Record<'direct' | 'group', ChatThread[]> = { direct: [], group: [] };
  for (const thread of threads) {
    seen[thread.kind] += 1;
    if (seen[thread.kind] <= SHOWN_EACH || thread.unread) shown.push(thread);
    else more[thread.kind].push(thread);
  }
  return { shown, more };
}

/**
 * Every word somewhere in its name: the group's, or the other member's name
 * or @name.
 */
export function matchesChatSearch(
  thread: ChatThread,
  other: ChatAuthor | null,
  search: string,
): boolean {
  return matchesSearch([threadTitle(thread, other?.displayName ?? null), other?.username], search);
}
