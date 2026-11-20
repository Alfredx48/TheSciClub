import { useEffect, useState } from 'react';
import type { ChatPost } from '@/lib/chat/types';
import { describeError, type Failure } from '@/lib/describe-error';
import type { StrikeRule } from '@/lib/strike-rules';
import { getSupabase } from '@/lib/supabase';

/**
 * Anonymous topics and posts (20261120100000, 20261120110000).
 *
 * The owner, 2026-11-20: "Can we add an option to ask questions and reply
 * anonymously?" Other members see "Anonymous", and so do administrators: only
 * the writer knows it is them. The asker answering under their own anonymous
 * question is "Anonymous · Asker". Not in the Marketplace, where a buyer has
 * to reach the seller. Administrators flag an anonymous post instead of
 * seeing whose it is. A flag is a strike, and pauses the writer's anonymous
 * posting for a month, then three; a pause for strikes ends it for good.
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

/** Under an anonymous name, to the only one who knows who wrote it: the writer. */
export function anonymousNote(writer: { you: boolean } | undefined) {
  return writer?.you ? 'You · nobody else can see it is you' : null;
}

interface Result<T> {
  data: T | null;
  error: Failure | null;
}

/** Who wrote an anonymous post, as far as the reader may know. */
export interface AnonymousWriter {
  memberId: string;
  displayName: string | null;
}

/**
 * The reader's own anonymous posts in a topic, by post id: nobody is told
 * anybody else's (20261120110000). Empty when the topic has none, without asking.
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

// ---------------------------------------------------------------- flags

/** Whether the member may post anonymously (my_anonymous_standing, 20261120110000). */
export interface AnonymousStanding {
  state: 'ok' | 'paused' | 'ended';
  /** When a pause ends. */
  pausedUntil: string | null;
  /** Their flags in the last year. */
  flags: number;
}

const STANDING_CHANGED = 'sciclub:anonymous-standing';
let standing: AnonymousStanding | null = null;
let standingAsked: Promise<void> | null = null;

function askStanding(): Promise<void> {
  standingAsked ??= (async () => {
    const { data } = (await getSupabase().rpc('my_anonymous_standing')) as Result<
      { state: AnonymousStanding['state']; paused_until: string | null; flags: number }[]
    >;
    const row = data?.[0];
    // Unknown is allowed: the database refuses in a sentence if it is not.
    standing = row
      ? { state: row.state, pausedUntil: row.paused_until, flags: row.flags }
      : { state: 'ok', pausedUntil: null, flags: 0 };
    window.dispatchEvent(new Event(STANDING_CHANGED));
  })().finally(() => {
    standingAsked = null;
  });
  return standingAsked;
}

/** Asked again: after the database refused an anonymous post, say. */
export function forgetAnonymousStanding(): void {
  standing = null;
  void askStanding();
}

/** The reader's standing, asked once a session; null until known. */
export function useAnonymousStanding(): AnonymousStanding | null {
  const [known, setKnown] = useState(standing);
  useEffect(() => {
    const changed = () => {
      setKnown(standing);
    };
    window.addEventListener(STANDING_CHANGED, changed);
    if (standing === null) void askStanding();
    else changed();
    return () => {
      window.removeEventListener(STANDING_CHANGED, changed);
    };
  }, []);
  return known;
}

/** "May 20, 2027", the day a pause ends, as the database says it. */
export function pauseEnds(at: string): string {
  return new Date(at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

/** Why the member cannot post anonymously now, or null when they can. */
export function standingRefusal(known: AnonymousStanding | null): string | null {
  if (known?.state === 'paused' && known.pausedUntil) {
    return `You can post anonymously again on ${pauseEnds(known.pausedUntil)}.`;
  }
  if (known?.state === 'ended') {
    return 'You can no longer post anonymously: your membership was paused for strikes.';
  }
  return null;
}

/**
 * An administrator flags an anonymous post: hidden, a strike against its
 * writer, who is told the reason. Returns the files to delete, as a removal.
 */
export async function flagAnonymousPost(
  postId: string,
  reason: string,
  rule: StrikeRule,
): Promise<{ ok: true; value: string[] } | { ok: false; error: string }> {
  const { data, error } = (await getSupabase().rpc('chat_flag_anonymous_post', {
    post: postId,
    reason,
    flag_rule: rule,
  })) as Result<string[]>;
  if (error) return { ok: false, error: describeError(error, 'The post was not flagged.') };
  return { ok: true, value: data ?? [] };
}

/** What a flag cost its writer (chat_flag_anonymous_post). */
export type FlagCost = 'month' | 'three_months' | 'paused' | 'ended';

const COSTS: readonly string[] = ['month', 'three_months', 'paused', 'ended'];

/** A flag notice's detail: what it cost, a colon, the reason. */
export function readFlag(detail: string | null): { cost: FlagCost | null; reason: string } {
  const text = detail ?? '';
  const at = text.indexOf(':');
  const cost = at > 0 ? text.slice(0, at) : '';
  if (!COSTS.includes(cost)) return { cost: null, reason: text };
  return { cost: cost as FlagCost, reason: text.slice(at + 1) };
}

/** What follows a flag, in the writer's notice. */
export function flagConsequence(cost: FlagCost | null): string {
  switch (cost) {
    case 'month':
      return 'It counts as a strike, and you can’t post anonymously for a month.';
    case 'three_months':
      return 'It counts as a strike, and you can’t post anonymously for three months.';
    case 'paused':
      return 'It was your third strike, so your membership is paused for 30 days, and you can no longer post anonymously.';
    default:
      return 'It counts as a strike.';
  }
}
