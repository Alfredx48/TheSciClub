import { useEffect, useState } from 'react';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { matchesSearch, searchWords } from '@/lib/search';
import { getSupabase } from '@/lib/supabase';

/**
 * Finding words said in conversations (the owner, 2026-11-19): across every
 * conversation the member is in, from Chat's search, or inside one, from its
 * header.
 *
 * A plain read of chat_messages, so its select policy decides what can be
 * found: only conversations the member is in, never a blocked member's words.
 * A taken-back message has no words left, and a notice ("Jan added Sam") is not
 * something anybody said, so neither is searched.
 *
 * The database narrows by "contains" (ilike); the words then have to start a
 * word, as every search box here matches (search.ts).
 */

export interface MessageHit {
  id: string;
  threadId: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

interface HitRow {
  id: string;
  thread_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

/** How many the database is asked for, and how many are shown. */
const READ_AT_MOST = 200;
export const SHOW_AT_MOST = 50;

/** A typed word as a LIKE pattern: its own % and _ are only themselves. */
export function containsPattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Newest first, every typed word starting a word of the message. */
export async function searchMessages(
  query: string,
  options: { threadId?: string | undefined; signal?: AbortSignal | undefined } = {},
): Promise<{ ok: true; hits: MessageHit[] } | { ok: false; error: string }> {
  const words = searchWords(query);
  if (words.length === 0) return { ok: true, hits: [] };
  try {
    let request = getSupabase()
      .from('chat_messages')
      .select('id, thread_id, author_id, body, created_at')
      .is('removed_at', null)
      .is('notice', null);
    for (const word of words) request = request.ilike('body', containsPattern(word));
    if (options.threadId) request = request.eq('thread_id', options.threadId);
    let ordered = request
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(READ_AT_MOST);
    if (options.signal) ordered = ordered.abortSignal(options.signal);
    const { data, error } = (await ordered) as { data: HitRow[] | null; error: Failure | null };
    if (error) return { ok: false, error: describeError(error, 'Could not search the messages.') };
    const hits = (data ?? [])
      .filter((row) => matchesSearch(row.body, words))
      .slice(0, SHOW_AT_MOST)
      .map((row) => ({
        id: row.id,
        threadId: row.thread_id,
        authorId: row.author_id,
        body: row.body,
        createdAt: row.created_at,
      }));
    return { ok: true, hits };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'Could not search the messages.') };
  }
}

export interface MessageSearchState {
  hits: MessageHit[];
  /** A search is on its way for what is typed now. */
  searching: boolean;
  error: string | null;
}

/** What was typed, searched a moment after typing stops; the last one wins. */
export function useMessageSearch(query: string, threadId?: string): MessageSearchState {
  const [state, setState] = useState<MessageSearchState>({
    hits: [],
    searching: false,
    error: null,
  });
  useEffect(() => {
    if (searchWords(query).length === 0) {
      setState({ hits: [], searching: false, error: null });
      return;
    }
    setState((was) => ({ ...was, searching: true }));
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchMessages(query, { threadId, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        setState(
          result.ok
            ? { hits: result.hits, searching: false, error: null }
            : { hits: [], searching: false, error: result.error },
        );
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, threadId]);
  return state;
}

/**
 * The part of a long message around the first word found, with … where it was
 * cut. Short messages come whole.
 */
export function snippetAround(body: string, query: string, around = 60): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= around * 2) return flat;
  const first = searchWords(query)[0];
  const lower = flat.toLocaleLowerCase();
  const at = first ? Math.max(0, lower.indexOf(first)) : 0;
  const start = Math.max(0, at - around);
  const end = Math.min(flat.length, at + around);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}
