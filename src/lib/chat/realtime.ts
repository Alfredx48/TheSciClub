import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { onPageReturn, pageHidden } from '@/lib/page-return';
import { getSupabase } from '@/lib/supabase';

/**
 * Live updates for every Chat surface (conversation, topic, room, Chat list, tab bar).
 *
 * Realtime reads tables and applies their select policy (not views, see 20260918120000); the
 * filter only narrows what RLS already allows.
 *
 * The event is a signal to refetch, not a payload to splice in: counts, unread state and faces
 * are computed in SQL and cannot be rebuilt from one row.
 *
 * **Must not be dropped:** every (re)subscribe and every focus refetches. Realtime does not
 * replay what it missed while the socket was down (sleep, tunnel, wifi handover), so a screen
 * that only listened would silently miss messages. While the page is hidden nothing is read;
 * the return (src/lib/page-return.ts) reads once.
 */

export interface RealtimeRowsOptions {
  /** The table to watch. It must be in the `supabase_realtime` publication. */
  table: string;
  /**
   * A PostgREST-style narrowing, e.g. `thread_id=eq.<uuid>`. One condition only
   * (`postgres_changes` limit); never what makes the subscription safe.
   */
  filter?: string | undefined;
  /** Re-read whatever the screen is showing. Called on every change. */
  onChange: () => void;
  /** False while the screen has nothing to watch yet (no id in the URL). */
  enabled?: boolean;
  /**
   * Given, a changed row goes here instead of to `onChange`, so a long list
   * can fetch just that row. Reconnects and focus still call `onChange`.
   */
  onRow?: (row: Record<string, unknown>, event: 'INSERT' | 'UPDATE') => void;
  /**
   * Given, a return calls this instead of `onChange`: for a read that goes
   * with the screen's own catch-up rather than beside it.
   */
  onReturn?: () => void;
  /**
   * Given, the first subscribe calls this instead of `onChange` (2026-11-23).
   * The screen's own first read was a moment ago, so the catch-up only has to
   * cover that moment: a cheaper read, such as the posts alone, which re-reads
   * the rest only if something did arrive. Reconnections still call
   * `onChange`: those cover a gap of any length.
   */
  onFirstSubscribe?: () => void;
}

/**
 * Channels are named per subscription, not per table: with a shared name, one watcher
 * unsubscribing would take the other's events with it.
 */
let channelCount = 0;

export function useRealtimeRows({
  table,
  filter,
  onChange,
  enabled = true,
  onRow,
  onReturn,
  onFirstSubscribe,
}: RealtimeRowsOptions) {
  // Callbacks held in refs so the socket is not rebuilt on every caller render.
  const latest = useRef(onChange);
  latest.current = onChange;
  const latestRow = useRef(onRow);
  latestRow.current = onRow;
  const latestReturn = useRef(onReturn);
  latestReturn.current = onReturn;
  const latestFirst = useRef(onFirstSubscribe);
  latestFirst.current = onFirstSubscribe;

  useEffect(() => {
    if (!enabled) return;

    const supabase = getSupabase();
    channelCount += 1;
    const channel = supabase.channel(`chat:${table}:${channelCount}`);
    let subscribed = false;

    const fire = () => {
      if (!pageHidden()) latest.current();
    };
    const changed =
      (event: 'INSERT' | 'UPDATE') => (payload?: { new?: Record<string, unknown> }) => {
        if (pageHidden()) return;
        const row = payload?.new;
        if (latestRow.current && row && typeof row === 'object') latestRow.current(row, event);
        else latest.current();
      };

    channel
      // No DELETE: removal is a soft UPDATE. The one real delete, a whole topic
      // (20260927040000), is not heard: Realtime cannot filter deletes; rooms catch up on focus.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, ...(filter ? { filter } : {}) },
        changed('INSERT'),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, ...(filter ? { filter } : {}) },
        changed('UPDATE'),
      )
      .subscribe((status) => {
        // First subscribe and every reconnection (see the header).
        if (status !== REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return;
        const first = !subscribed;
        subscribed = true;
        if (first && latestFirst.current) {
          if (!pageHidden()) latestFirst.current();
        } else fire();
      });

    // Focus or shown again, heard once (src/lib/page-return.ts).
    const stopReturn = onPageReturn(() => {
      if (latestReturn.current) latestReturn.current();
      else fire();
    });

    return () => {
      stopReturn();
      void supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}
