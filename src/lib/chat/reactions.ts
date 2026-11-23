import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnnounce } from '@/lib/announce';
import { useRealtimeRows } from '@/lib/chat/realtime';
import { announcePostViewsChanged } from '@/lib/chat/views';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { onReturnSettled, pageHidden } from '@/lib/page-return';
import { readInBatches } from '@/lib/read-pages';
import { getSupabase } from '@/lib/supabase';

export const REACTIONS = [
  { emoji: '👍', name: 'Thumbs up' },
  { emoji: '❤️', name: 'Love' },
  { emoji: '😂', name: 'Laugh' },
  { emoji: '😮', name: 'Surprised' },
  { emoji: '😢', name: 'Sad' },
  { emoji: '🙏', name: 'Thank you' },
  { emoji: '🎉', name: 'Celebrate' },
  { emoji: '💪', name: 'Strength' },
] as const;
/** One of the eight, or any other single emoji from the + (2026-11-14). */
export type ReactionEmoji = string;
/** The database's `is_reaction_emoji` (20261114090000), kept in step. */
const EMOJI_ONLY =
  /^(?:[0-9#*\u00A9\u00AE\u2000-\u200C\u200E-\u20CF\u2100-\u33FF\u{1F000}-\u{1FAFF}\u{E0020}-\u{E007F}]|\u200D|\u20E3|\uFE0F){1,12}$/u;
export function isReactionEmoji(value: string): boolean {
  return (
    EMOJI_ONLY.test(value) &&
    /[^0-9#*]/.test(value) &&
    (!/[0-9#*]/.test(value) || value.includes('\u20E3'))
  );
}
/** A reaction's name for a screen reader: the eight have words, others are read as the emoji. */
export function reactionName(emoji: string): string {
  return REACTIONS.find((r) => r.emoji === emoji)?.name ?? emoji;
}
export type ReactionKind = 'post' | 'message';
export interface ReactionRow {
  target_id: string;
  member_id: string;
  emoji: ReactionEmoji | null;
}
export interface ReactionsState {
  rows: readonly ReactionRow[];
  loading: boolean;
  error: string | null;
  pending: ReadonlySet<string>;
  failure: { target: string; message: string } | null;
  choose: (target: string, emoji: ReactionEmoji | null) => Promise<boolean>;
  reload: () => void;
  /** Targets not read yet: the reader's own reaction there is unknown. */
  unread?: ReadonlySet<string>;
}

/** One read/subscription per screen, shared by all its posts or messages.
 * Each target is read once; a longer list reads only the new ones, and a live
 * change updates just its row. Writes are serialized per target and counts
 * move only after confirmation. A new kind or account starts empty. */
export function useReactions(
  kind: ReactionKind,
  ids: readonly string[],
  memberId: string | null,
  /** Off for Home, which reads once and does not follow the club live. `within`
   * is the conversation or topic on screen: only its reactions are heard. */
  { live = true, within }: { live?: boolean; within?: string | undefined } = {},
): ReactionsState {
  const key = [...new Set(ids)].sort().join(',');
  const wanted = useMemo(() => (key ? key.split(',') : []), [key]);
  const scope = `${kind}:${memberId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const wantedNow = useRef(wanted);
  wantedNow.current = wanted;
  const table = kind === 'post' ? 'chat_post_reactions' : 'chat_message_reactions';
  const announce = useAnnounce();
  const [store, setStore] = useState<{
    scope: string;
    byTarget: ReadonlyMap<string, ReactionRow[]>;
  }>({ scope, byTarget: new Map() });
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReactionsState['failure']>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(new Set<string>());
  // Targets read or being read in this scope, and writes per target, so a
  // read that overlapped a write does not overwrite it.
  const asked = useRef({ scope, ids: new Set<string>() });
  const written = useRef(new Map<string, number>());
  const storeNow = useRef(store);
  storeNow.current = store;
  const controllers = useRef(new Set<AbortController>());
  // Back from hidden: everything is read again, once, with the screen's own
  // catch-up (its new messages or posts in the same read).
  const catchUp = useRef(false);

  const read = useCallback(
    async (targets: readonly string[]) => {
      if (!memberId || targets.length === 0) return;
      const readScope = scope;
      for (const target of targets) asked.current.ids.add(target);
      const versions = new Map(targets.map((t) => [t, written.current.get(t) ?? 0]));
      const controller = new AbortController();
      controllers.current.add(controller);
      const forget = () => {
        if (asked.current.scope === readScope)
          for (const target of targets) asked.current.ids.delete(target);
      };
      try {
        // Supabase caps a response at 1,000 rows, and a hundred targets at a
        // time keeps each URL short enough to send.
        const { data: rows, error: failed } = await readInBatches<ReactionRow>(
          targets,
          async (batch) => {
            const found: ReactionRow[] = [];
            for (let offset = 0; ; offset += 1000) {
              const { data, error: pageFailed } = (await getSupabase()
                .from(table)
                .select('target_id,member_id,emoji')
                .in('target_id', batch)
                .order('target_id')
                .order('member_id')
                .range(offset, offset + 999)
                .abortSignal(controller.signal)) as {
                data: ReactionRow[] | null;
                error: Failure | null;
              };
              if (pageFailed) return { data: null, error: pageFailed };
              found.push(...(data ?? []));
              if (!data || data.length < 1000) return { data: found, error: null };
            }
          },
        );
        if (controller.signal.aborted || currentScope.current !== readScope) return;
        if (failed) {
          forget();
          setError(describeError(failed, 'Could not load reactions.'));
          return;
        }
        setError(null);
        setStore((old) => {
          if (old.scope !== readScope) return old;
          const next = new Map(old.byTarget);
          const fresh = targets.filter((t) => (written.current.get(t) ?? 0) === versions.get(t));
          for (const target of fresh) next.set(target, []);
          for (const row of rows ?? []) next.get(row.target_id)?.push(row);
          return { scope: readScope, byTarget: next };
        });
      } catch (e) {
        if (controller.signal.aborted || currentScope.current !== readScope) return;
        forget();
        setError(describeThrown(e, 'Could not load reactions.'));
      } finally {
        controllers.current.delete(controller);
      }
    },
    [memberId, scope, table],
  );

  // Only targets not yet read; a new scope drops everything first.
  useEffect(() => {
    if (asked.current.scope !== scope) {
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      asked.current = { scope, ids: new Set() };
      written.current = new Map();
      setStore({ scope, byTarget: new Map() });
      setError(null);
    }
    catchUp.current = false;
    void read(wanted.filter((t) => !asked.current.ids.has(t)));
  }, [scope, wanted, read]);

  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort();
    },
    [],
  );

  // Retry, reconnect or focus: read the current targets again, quietly.
  const reload = useCallback(() => {
    void read(wantedNow.current);
  }, [read]);

  // On return, read nothing yet: the screen's list changing reads it all, or,
  // with no change, the return's end does.
  const readOnReturn = useCallback(() => {
    asked.current.ids.clear();
    catchUp.current = true;
  }, []);
  useEffect(
    () =>
      onReturnSettled(() => {
        if (!catchUp.current || pageHidden()) return;
        catchUp.current = false;
        void read(wantedNow.current.filter((t) => !asked.current.ids.has(t)));
      }),
    [read],
  );

  // A live change is applied as its row; one that is not shaped as expected
  // is read again instead.
  const onRow = useCallback(
    (raw: Record<string, unknown>) => {
      const target = raw.target_id;
      const member = raw.member_id;
      if (typeof target !== 'string' || !wantedNow.current.includes(target)) return;
      const emoji = raw.emoji ?? null;
      const valid =
        typeof member === 'string' &&
        (emoji === null || (typeof emoji === 'string' && isReactionEmoji(emoji)));
      if (!valid || busy.current.has(`${scope}:${target}`)) {
        void read([target]);
        return;
      }
      setStore((old) => {
        if (old.scope !== scope || !old.byTarget.has(target)) return old;
        const next = new Map(old.byTarget);
        next.set(target, [
          ...(old.byTarget.get(target) ?? []).filter((r) => r.member_id !== member),
          { target_id: target, member_id: member, emoji: emoji },
        ]);
        return { scope, byTarget: next };
      });
    },
    [scope, read],
  );
  // Filtered by the column 20261105103000 adds, not by RLS alone.
  const filter = within ? `${kind === 'post' ? 'topic_id' : 'thread_id'}=eq.${within}` : undefined;
  useRealtimeRows({
    table,
    filter,
    onChange: reload,
    onRow,
    onReturn: readOnReturn,
    // Reactions, not messages: the screen has just read them (2026-11-23: read
    // twice on every opening). A change or a return reads them again.
    onFirstSubscribe: () => undefined,
    enabled: live && Boolean(within && memberId && key),
  });

  const choose = useCallback(
    async (target: string, emoji: ReactionEmoji | null) => {
      const token = `${scope}:${target}`;
      if (!memberId || !wanted.includes(target) || busy.current.has(token)) return false;
      // Not before this target is read: the write would be a guess at the reader's own.
      const now = storeNow.current;
      if (now.scope !== scope || !now.byTarget.has(target)) return false;
      busy.current.add(token);
      const bump = () => {
        written.current.set(target, (written.current.get(target) ?? 0) + 1);
      };
      bump();
      setPending(new Set(busy.current));
      setFailure(null);
      try {
        const { error: failed } = await getSupabase().rpc('chat_set_reaction', {
          kind,
          target,
          reaction: emoji,
        });
        bump();
        if (currentScope.current !== scope) return false;
        if (failed) {
          setFailure({ target, message: describeError(failed, 'Your reaction was not saved.') });
          void read([target]);
          return false;
        }
        setStore((old) => {
          if (old.scope !== scope) return old;
          const next = new Map(old.byTarget);
          next.set(target, [
            ...(old.byTarget.get(target) ?? []).filter((r) => r.member_id !== memberId),
            { target_id: target, member_id: memberId, emoji },
          ]);
          return { scope, byTarget: next };
        });
        announce(emoji ? 'Reaction saved.' : 'Reaction removed.');
        // A reaction to a post is a view (20261019000000).
        if (kind === 'post') announcePostViewsChanged();
        void read([target]);
        return true;
      } catch (e) {
        if (currentScope.current === scope)
          setFailure({ target, message: describeThrown(e, 'Your reaction was not saved.') });
        return false;
      } finally {
        busy.current.delete(token);
        setPending(new Set(busy.current));
      }
    },
    [scope, memberId, wanted, kind, announce, read],
  );

  const own = store.scope === scope ? store.byTarget : null;
  const rows = useMemo(() => (own ? wanted.flatMap((t) => own.get(t) ?? []) : []), [own, wanted]);
  const unread = useMemo(() => new Set(wanted.filter((t) => !own?.has(t))), [own, wanted]);
  return {
    rows,
    // Some target not read yet. Nothing waits on this: React stays usable.
    loading: Boolean(memberId) && error === null && wanted.some((t) => !own?.has(t)),
    error,
    failure,
    pending: new Set(
      [...pending]
        .filter((token) => token.startsWith(`${scope}:`))
        .map((token) => token.slice(scope.length + 1)),
    ),
    choose,
    reload,
    unread,
  };
}
