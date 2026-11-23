import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { searchWords } from '@/lib/search';
import { getSupabase } from '@/lib/supabase';

/**
 * Finding words said in conversations (the owner, 2026-11-19): across every
 * conversation the member is in, from Chat's search, or inside one, from its
 * header.
 *
 * search_my_messages does the matching, as search.ts does (each word starts
 * a word), under chat_messages' own select policy: only conversations the
 * member is in, never a blocked member's words, no taken-back messages or
 * notices. It reads a page at a time, so older matches are always reachable
 * (20261123120000).
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

/** How many come in one page. */
export const PAGE_SIZE = 50;

/** Newest first, every typed word starting a word; older than `after` when given. */
export async function searchMessages(
  query: string,
  options: {
    threadId?: string | undefined;
    after?: MessageHit | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<{ ok: true; hits: MessageHit[]; more: boolean } | { ok: false; error: string }> {
  const words = searchWords(query);
  if (words.length === 0) return { ok: true, hits: [], more: false };
  try {
    let request = getSupabase().rpc('search_my_messages', {
      p_words: words,
      p_thread_id: options.threadId ?? null,
      p_before_at: options.after?.createdAt ?? null,
      p_before_id: options.after?.id ?? null,
      // One over, to know whether there is another page.
      p_limit: PAGE_SIZE + 1,
    });
    if (options.signal) request = request.abortSignal(options.signal);
    const { data, error } = (await request) as { data: HitRow[] | null; error: Failure | null };
    if (error) return { ok: false, error: describeError(error, 'Could not search the messages.') };
    const rows = data ?? [];
    const hits = rows.slice(0, PAGE_SIZE).map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at,
    }));
    return { ok: true, hits, more: rows.length > PAGE_SIZE };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'Could not search the messages.') };
  }
}

export interface MessageSearchState {
  hits: MessageHit[];
  /** A search is on its way for what is typed now. */
  searching: boolean;
  error: string | null;
  /** Older matches are there to read. */
  more: boolean;
  /** The next page is on its way. */
  loadingMore: boolean;
}

const EMPTY: MessageSearchState = {
  hits: [],
  searching: false,
  error: null,
  more: false,
  loadingMore: false,
};

/** What was typed, searched a moment after typing stops; the last one wins. */
export function useMessageSearch(
  query: string,
  threadId?: string,
): MessageSearchState & { showMore: () => void } {
  const [state, setState] = useState<MessageSearchState>(EMPTY);
  // The search now showing; a newer one aborts it and any page it is reading.
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    if (searchWords(query).length === 0) {
      setState(EMPTY);
      return;
    }
    setState((was) => ({ ...was, searching: true, loadingMore: false }));
    const controller = new AbortController();
    current.current = controller;
    const timer = window.setTimeout(() => {
      void searchMessages(query, { threadId, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        setState(
          result.ok
            ? { ...EMPTY, hits: result.hits, more: result.more }
            : { ...EMPTY, error: result.error },
        );
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, threadId]);

  const showMore = useCallback(() => {
    const controller = current.current;
    const last = state.hits.at(-1);
    if (!controller || controller.signal.aborted || !last || !state.more || state.loadingMore) {
      return;
    }
    setState((was) => ({ ...was, loadingMore: true }));
    void searchMessages(query, { threadId, after: last, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState((was) =>
          result.ok
            ? { ...was, hits: [...was.hits, ...result.hits], more: result.more, loadingMore: false }
            : { ...was, loadingMore: false, error: result.error },
        );
      },
    );
  }, [query, threadId, state.hits, state.more, state.loadingMore]);

  return { ...state, showMore };
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
