import { useContext, useEffect, useRef, useState } from 'react';
import { AccountContext } from '@/lib/account-context';
import { AUTHOR_COLUMNS, type ChatAuthorRow, rememberChatAuthors } from '@/lib/chat/authors';
import { type ChatRoomRow, toRoom } from '@/lib/chat/rooms';
import { POST_COLUMNS, type PostRow, toPost } from '@/lib/chat/topics';
import type { ChatPost, ChatRoom } from '@/lib/chat/types';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { HOME_TOPIC_LIMIT, readHomeFeed } from '@/lib/home/feed-read';
import {
  DEFAULT_HOME_VIEW,
  type HomeReply,
  type HomeReplyRef,
  type HomeTopic,
  type HomeTopicSummary,
  type HomeView,
} from '@/lib/home/types';
import { useKeptRead } from '@/lib/kept-reads';
import { getSupabase } from '@/lib/supabase';

/**
 * Recent topics across every open room, for Home: one read (two until 2026-10-14), RLS the filter.
 * The newest forty topics, each embedding `opening` and `replies`; embeds obey the same
 * `chat_room_is_readable` policies.
 *
 * `opening` is the earliest post, unfiltered: filtering out a removed question would present
 * its first reply as the question. `replies` are standing answers to the topic: made in the open
 * (`replyTo` null) or with Reply on the opening post itself, which is how a first reply is often
 * made, and a card that skipped those said "2 replies" and showed none (the owner, 2026-11-18;
 * 20261118210000 for the ranking). A reply to a reply is a side-conversation and is not quoted.
 * Read without that filter, which names no post, and chosen in `toHomeTopics`; two suffice, as a
 * standing opener is the first of them.
 *
 * Closed rooms: administrators can read them, so `toHomeTopics` drops them against the rooms list
 * (as `continue-in-room.tsx` does), or an administrator's Home would look busier than a member's.
 *
 * Since 20261118190000 `home_topics_ranked` says which forty and in what order, and which replies
 * each card quotes. Since 20261118220000 that order is the same for every member: last activity,
 * a little newer for votes and a boost; and the replies are the top one and the latest. The
 * topics are then read as before, by id, with those replies. A database without the function
 * gets the read above.
 *
 * Since 20261118260000 all of it is one request, `home_feed`: which posts, in what order, and
 * each with its author, opening post and replies, in the shape the read of `chat_topics` gave
 * (the owner, 2026-11-18: the posts were asked for only once the ranking had answered, and their
 * text waited for both). A database without that function is read as above, in two requests.
 */

export { HOME_TOPIC_LIMIT } from '@/lib/home/feed-read';

const TOPIC_COLUMNS =
  'id, room_id, title, author_id, created_at, last_post_at, reply_count, is_question';

interface TopicRow {
  id: string;
  room_id: string;
  title: string;
  author_id: string | null;
  created_at: string;
  last_post_at: string;
  reply_count: number;
  /** Absent from a database before 20261010010000. */
  is_question?: boolean;
  opening?: PostRow[] | null;
  replies?: (PostRow & { author?: ChatAuthorRow | null })[] | null;
  author?: ChatAuthorRow | null;
}

/** A card of `home_feed`: the topic as above, with its place and the replies the ranking chose. */
interface FeedRow extends TopicRow {
  room?: ChatRoomRow;
  ord: number;
  /** Null for a chosen Show or Sort: the card quotes the first reply. */
  previews: HomeReplyRef[] | null;
}

function toSummary(row: TopicRow, ranked?: RankedRow, order?: number): HomeTopicSummary {
  return {
    // An order without the replies to quote is a chosen Show or Sort
    // (`home_topics_shown`): the card quotes the first reply, as before the ranking.
    ...(order !== undefined ? { order } : {}),
    ...(ranked ? { previewIds: ranked.previews } : {}),
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    authorId: row.author_id,
    createdAt: row.created_at,
    lastPostAt: row.last_post_at,
    replyCount: row.reply_count,
    isQuestion: row.is_question === true,
  };
}

interface Result<T> {
  data: T | null;
  error: Failure | null;
}

/** A row of `home_topics_ranked`. */
interface RankedRow {
  topic_id: string;
  previews: HomeReplyRef[];
}

/** No reply has this id: an `in` filter that matches nothing. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** Earliest first, with the id to break a tie so two reads agree. */
function byPostTime(a: ChatPost, b: ChatPost): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The topics a card can be drawn from, newest activity first. Pure, so the header's rules are
 * tested without a database; a photo topic's opening post has a photograph.
 */
export function toHomeTopics(
  topics: readonly HomeTopicSummary[],
  posts: readonly ChatPost[],
  rooms: readonly ChatRoom[],
): HomeTopic[] {
  const open = new Map(
    rooms
      .filter((room) => room.openedAt !== null && room.showInHome)
      .map((room) => [room.id, room]),
  );

  const byTopic = new Map<string, ChatPost[]>();
  for (const post of posts) {
    const list = byTopic.get(post.topicId);
    if (list) list.push(post);
    else byTopic.set(post.topicId, [post]);
  }

  const cards = [...topics]
    .sort(
      (a, b) =>
        (a.order !== undefined && b.order !== undefined ? a.order - b.order : 0) ||
        b.lastPostAt.localeCompare(a.lastPostAt) ||
        a.id.localeCompare(b.id),
    )
    .flatMap((topic) => {
      const room = open.get(topic.roomId);
      if (!room) return [];
      const list = [...(byTopic.get(topic.id) ?? [])].sort(byPostTime);
      const first = list[0];
      const opening = first?.removedAt === null ? first : null;
      const firstReply =
        list
          .slice(1)
          .find(
            (post) =>
              post.removedAt === null && (post.replyTo === null || post.replyTo === first?.id),
          ) ?? null;
      return [
        {
          ...topic,
          room,
          opening,
          firstReply,
          replies: topic.previewIds
            ? pickedReplies(topic.previewIds, list)
            : firstReply
              ? [{ post: firstReply, kind: 'first' as const }]
              : [],
          photo: opening !== null && opening.attachments.length > 0,
        },
      ];
    });
  // Spread only the default order: a chosen one is shown as asked for.
  return topics.some((topic) => topic.previewIds !== undefined) ? spreadRuns(cards) : cards;
}

/**
 * The replies the ranking picked, those that came back standing: the top one first, or with no
 * top one, oldest first, so two read as the conversation went.
 */
function pickedReplies(refs: readonly HomeReplyRef[], posts: readonly ChatPost[]): HomeReply[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const picked = refs.flatMap((ref): HomeReply[] => {
    const post = byId.get(ref.id);
    return post?.removedAt === null ? [{ post, kind: ref.kind }] : [];
  });
  if (picked.some((reply) => reply.kind === 'top')) return picked.slice(0, 2);
  return picked.sort((a, b) => byPostTime(a.post, b.post)).slice(0, 2);
}

/**
 * At most two in a row from one room or one member (the plan the owner approved, 2026-11-18):
 * a third is put after the next card that is neither, keeping the order otherwise.
 */
export function spreadRuns<T extends { roomId: string; authorId: string | null }>(
  items: readonly T[],
): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const [a, b] = out.slice(-2);
    const third = (item: T) =>
      a !== undefined &&
      b !== undefined &&
      ((a.roomId === item.roomId && b.roomId === item.roomId) ||
        (item.authorId !== null && a.authorId === item.authorId && b.authorId === item.authorId));
    const at = rest.findIndex((item) => !third(item));
    out.push(...rest.splice(at === -1 ? 0 : at, 1));
  }
  return out;
}

/**
 * The reader's order and each card's replies, or null to read as before: a database without
 * `home_topics_ranked`, or any failure, which the read after it reports if it fails too.
 */
async function readRanked(signal: AbortSignal): Promise<RankedRow[] | null> {
  try {
    const { data, error } = (await getSupabase()
      .rpc('home_topics_ranked', { max_rows: HOME_TOPIC_LIMIT })
      .abortSignal(signal)) as Result<RankedRow[]>;
    return error || !Array.isArray(data) ? null : data;
  } catch {
    return null;
  }
}

/**
 * Which posts, in order, for a Show or Sort other than the default, or null on any failure:
 * the read after it then says so.
 */
async function readShown(view: HomeView, signal: AbortSignal): Promise<string[] | null> {
  try {
    const { data, error } = (await getSupabase()
      .rpc('home_topics_shown', {
        p_show: view.show,
        p_sort: view.sort,
        max_rows: HOME_TOPIC_LIMIT,
      })
      .abortSignal(signal)) as Result<{ topic_id: string; ord: number }[]>;
    if (error || !Array.isArray(data)) return null;
    return [...data].sort((a, b) => a.ord - b.ord).map((row) => row.topic_id);
  } catch {
    return null;
  }
}

export interface HomeTopicsState {
  topics: HomeTopicSummary[];
  rooms?: ChatRoom[];
  /** The posts each card needs, a removed opener included. See the header. */
  posts: ChatPost[];
  loading: boolean;
  error: string | null;
  /** `performance.now()` when what is held landed, for debug mode; null until then. */
  readAt: number | null;
}

const ATTEMPT = 'Could not load the posts.';

/**
 * Read once, on arrival. Home does not subscribe to changes; the page's header
 * says why.
 */
export function useHomeTopics(view: HomeView = DEFAULT_HOME_VIEW): HomeTopicsState {
  const [state, setState] = useState<HomeTopicsState>({
    topics: [],
    posts: [],
    loading: true,
    error: null,
    readAt: null,
  });
  const kept = useKeptRead();
  const takeInitialHomeFeed = useContext(AccountContext)?.takeInitialHomeFeed;
  const startingFeed = useRef<Promise<unknown[] | null> | undefined>(undefined);
  const { show, sort } = view;
  /** The choice the state now holds. */
  const held = useRef<string | null>(null);

  useEffect(() => {
    // Shown again within the minute, nothing changed (lib/kept-reads.ts).
    const key = `home:${show}:${sort}`;
    // Unless what is held is another choice's: a choice gone back to is read again.
    if (kept.fresh(key) && held.current === key) return;
    const controller = new AbortController();
    const aborted = () => controller.signal.aborted;
    const landed = kept.start(key);
    const chosen = show !== 'all' || sort !== 'ranking';
    // Another choice: the last one's cards go while its own are read. The
    // same choice read again (a kept tab shown after a minute) keeps its
    // cards until the new ones land: from 2026-11-18's filter until this,
    // every such read blanked Home to its placeholders for a second or two.
    if (held.current !== null && held.current !== key) {
      setState((before) => (before.loading ? before : { ...before, loading: true }));
    }
    const fail = (error: string) => {
      setState({ topics: [], posts: [], loading: false, error, readAt: null });
    };

    /** What came back, as the state: the posts once each, and their authors remembered. */
    function land(rows: readonly TopicRow[], topics: HomeTopicSummary[], rooms?: ChatRoom[]) {
      // The opener can be in both lists; once each.
      const byId = new Map<string, ChatPost>();
      for (const row of rows) {
        for (const post of [...(row.opening ?? []), ...(row.replies ?? [])]) {
          byId.set(post.id, toPost(post));
        }
      }
      // The cards' names and faces came with the topics: no second read.
      rememberChatAuthors(
        rows
          .flatMap((row) => [row.author, ...(row.replies ?? []).map((reply) => reply.author)])
          .filter((author): author is ChatAuthorRow => Boolean(author)),
      );
      setState({
        topics,
        ...(rooms ? { rooms } : {}),
        posts: [...byId.values()],
        loading: false,
        error: null,
        readAt: performance.now(),
      });
      held.current = key;
      landed();
    }

    async function load() {
      try {
        const supabase = getSupabase();
        if (!chosen) startingFeed.current ??= takeInitialHomeFeed?.();
        const initial = chosen ? undefined : startingFeed.current;
        const prefetched = initial ? await initial : null;
        if (aborted()) return;
        if (initial) startingFeed.current = undefined;
        const feed = (prefetched ?? (await readHomeFeed({ show, sort }, controller.signal))) as
          | FeedRow[]
          | null;
        if (aborted()) return;
        if (feed) {
          const byRoom = new Map<string, ChatRoom>();
          for (const row of feed) {
            if (row.room?.id === row.room_id && !byRoom.has(row.room_id)) {
              byRoom.set(row.room_id, toRoom(row.room));
            }
          }
          const rooms = feed.every((row) => byRoom.has(row.room_id))
            ? [...byRoom.values()].sort((a, b) => a.sortOrder - b.sortOrder)
            : undefined;
          land(
            feed,
            feed.map((row) =>
              toSummary(
                row,
                row.previews ? { topic_id: row.id, previews: row.previews } : undefined,
                row.ord,
              ),
            ),
            rooms,
          );
          return;
        }
        const ranked = chosen ? null : await readRanked(controller.signal);
        const shown = chosen ? await readShown({ show, sort }, controller.signal) : null;
        if (aborted()) return;
        if (chosen && shown === null) {
          fail(ATTEMPT);
          return;
        }
        const select = supabase
          .from('chat_topics')
          .select(
            `${TOPIC_COLUMNS}, author:chat_authors!chat_topics_author_id_fkey(${AUTHOR_COLUMNS}), chat_rooms!inner(show_in_home, opened_at), opening:chat_posts(${POST_COLUMNS}), replies:chat_posts(${POST_COLUMNS}, author:chat_authors!chat_posts_author_id_fkey(${AUTHOR_COLUMNS}))`,
          )
          .eq('chat_rooms.show_in_home', true)
          .not('chat_rooms.opened_at', 'is', null);
        const opening = (query: typeof select) =>
          query
            .order('created_at', { referencedTable: 'opening' })
            .order('id', { referencedTable: 'opening' })
            .limit(1, { referencedTable: 'opening' })
            .is('replies.removed_at', null)
            .order('created_at', { referencedTable: 'replies' })
            .order('id', { referencedTable: 'replies' });
        const replyIds = ranked?.flatMap((row) => row.previews.map((ref) => ref.id)) ?? [];
        const topicRows = (await (ranked
          ? opening(
              select.in('id', ranked.length > 0 ? ranked.map((row) => row.topic_id) : [NO_ID]),
            )
              .in('replies.id', replyIds.length > 0 ? replyIds : [NO_ID])
              .abortSignal(controller.signal)
          : shown
            ? opening(select.in('id', shown.length > 0 ? shown : [NO_ID]))
                .limit(2, { referencedTable: 'replies' })
                .abortSignal(controller.signal)
            : opening(select.order('last_post_at', { ascending: false }).limit(HOME_TOPIC_LIMIT))
                .limit(2, { referencedTable: 'replies' })
                .abortSignal(controller.signal))) as Result<TopicRow[]>;
        if (aborted()) return;
        if (topicRows.error) {
          fail(describeError(topicRows.error, ATTEMPT));
          return;
        }
        const rows = topicRows.data ?? [];
        const rankOf = new Map(ranked?.map((row, order) => [row.topic_id, { row, order }]));
        const shownAt = new Map(shown?.map((id, order) => [id, order]));
        const topics = rows.map((row) => {
          const at = rankOf.get(row.id);
          return toSummary(row, at?.row, at?.order ?? shownAt.get(row.id));
        });
        land(rows, topics);
      } catch (e) {
        if (aborted()) return;
        fail(describeThrown(e, ATTEMPT));
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [kept, show, sort, takeInitialHomeFeed]);

  return state;
}
