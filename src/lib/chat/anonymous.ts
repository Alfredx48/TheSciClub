import { useEffect, useState } from 'react';
import type { ChatPost } from '@/lib/chat/types';
import type { Failure } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * Anonymous topics and posts (20261120100000).
 *
 * The owner, 2026-11-20: "Can we add an option to ask questions and reply
 * anonymously?" Other members see "Anonymous"; an administrator can see who
 * wrote it; the asker answering under their own anonymous question is
 * "Anonymous · Asker". Not in the Marketplace, where a buyer has to reach the
 * seller.
 *
 * An anonymous row has no author at all, the same as a member who has left,
 * so a screen that only has the author id cannot tell the two apart. The
 * topic page reads `anonymous` with the posts. Home and a shared post do not
 * carry it, so they ask here, once per row a session (it never changes).
 */

export const ANONYMOUS = 'Anonymous';

/** The name an anonymous post goes by. */
export function anonymousName(byAsker: boolean | undefined): string {
  return byAsker ? 'Anonymous · Asker' : ANONYMOUS;
}

/**
 * Under an anonymous name, to the two who know who wrote it: the writer, and
 * an administrator. Nobody else is told anything.
 */
export function anonymousNote(writer: { you: boolean; name: string | null } | undefined) {
  if (writer?.you) return 'You · administrators can still see it is you';
  return writer?.name ? `By ${writer.name} · hidden from other members` : null;
}

interface Result<T> {
  data: T | null;
  error: Failure | null;
}

/** Who wrote an anonymous post, as far as the reader may know. */
export interface AnonymousWriter {
  memberId: string;
  /** Only to an administrator; the writer knows it is them. */
  displayName: string | null;
}

/**
 * The reader's own anonymous posts in a topic, or every one of them for an
 * administrator, by post id. Empty when the topic has none, without asking.
 */
export function useAnonymousWriters(
  topicId: string | undefined,
  posts: readonly ChatPost[],
): ReadonlyMap<string, AnonymousWriter> {
  // Asked again when an anonymous post arrives: the reader's own just sent
  // is theirs to edit at once.
  const key = posts
    .filter((post) => post.anonymous)
    .map((post) => post.id)
    .join(',');
  const [found, setFound] = useState<{ key: string; writers: Map<string, AnonymousWriter> }>({
    key: '',
    writers: new Map(),
  });

  useEffect(() => {
    if (!topicId || !key) return;
    const run = { live: true };
    void (async () => {
      const { data } = (await getSupabase().rpc('chat_anonymous_writers', {
        topic: topicId,
      })) as Result<{ post_id: string; member_id: string; display_name: string | null }[]>;
      if (!run.live) return;
      // A failure leaves the page as it would be for anybody else: every
      // anonymous post simply Anonymous.
      setFound({
        key,
        writers: new Map(
          (data ?? []).map((row) => [
            row.post_id,
            { memberId: row.member_id, displayName: row.display_name },
          ]),
        ),
      });
    })();
    return () => {
      run.live = false;
    };
  }, [topicId, key]);

  return key && found.key === key ? found.writers : EMPTY;
}

const EMPTY: ReadonlyMap<string, AnonymousWriter> = new Map();

// ---------------------------------------------------------------- Home and shares

export interface Anonymity {
  anonymous: boolean;
  byAsker: boolean;
}

type Kind = 'topic' | 'post';

const known = new Map<string, Anonymity>();
const waiting = new Map<string, Set<() => void>>();
const asked = new Set<string>();
const queued: Record<Kind, Set<string>> = { topic: new Set(), post: new Set() };
let flushing = false;

const cacheKey = (kind: Kind, id: string) => `${kind}:${id}`;

/** One read per table for every row asked about in the same moment. */
function flush(): void {
  flushing = false;
  for (const kind of ['topic', 'post'] as const) {
    const ids = [...queued[kind]];
    queued[kind].clear();
    if (ids.length === 0) continue;
    void (async () => {
      const supabase = getSupabase();
      const { data } =
        kind === 'topic'
          ? ((await supabase.from('chat_topics').select('id, anonymous').in('id', ids)) as Result<
              { id: string; anonymous?: boolean }[]
            >)
          : ((await supabase
              .from('chat_posts')
              .select('id, anonymous, by_asker')
              .in('id', ids)) as Result<{ id: string; anonymous?: boolean; by_asker?: boolean }[]>);
      const rows = new Map((data ?? []).map((row) => [row.id, row]));
      for (const id of ids) {
        const row = rows.get(id) as { anonymous?: boolean; by_asker?: boolean } | undefined;
        // Unread (a failure, or a row the reader cannot see) is the old
        // answer: a member who has left.
        known.set(cacheKey(kind, id), {
          anonymous: row?.anonymous === true,
          byAsker: row?.by_asker === true,
        });
        const listeners = waiting.get(cacheKey(kind, id));
        waiting.delete(cacheKey(kind, id));
        listeners?.forEach((listener) => {
          listener();
        });
      }
    })();
  }
}

/**
 * Whether a row with no author is anonymous rather than a member who has
 * left. Undefined while it is being asked; null id asks nothing.
 */
export function useAnonymity(kind: Kind, id: string | null): Anonymity | undefined {
  const [, redraw] = useState(0);
  const answer = id ? known.get(cacheKey(kind, id)) : undefined;

  useEffect(() => {
    if (!id || known.has(cacheKey(kind, id))) return;
    const listener = () => {
      redraw((n) => n + 1);
    };
    const k = cacheKey(kind, id);
    const listeners = waiting.get(k) ?? new Set();
    listeners.add(listener);
    waiting.set(k, listeners);
    if (!asked.has(k)) {
      asked.add(k);
      queued[kind].add(id);
      if (!flushing) {
        flushing = true;
        queueMicrotask(flush);
      }
    }
    return () => {
      listeners.delete(listener);
    };
  }, [kind, id]);

  return answer;
}

/** For tests: forget what was learned. */
export function forgetAnonymity(): void {
  known.clear();
  waiting.clear();
  asked.clear();
  queued.topic.clear();
  queued.post.clear();
}
