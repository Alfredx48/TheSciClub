import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '@/lib/account';
import { MAX_ATTACHMENTS } from '@/lib/chat/attachments';
import { toLinkPreview } from '@/lib/chat/link-preview';
import { POST_MAX_WORDS } from '@/lib/chat/post-length';
import { useRealtimeRows } from '@/lib/chat/realtime';
import { flushTopicRead, markTopicRead } from '@/lib/chat/topic-read-mark';
import type { ChatPost, ChatTopic, RoomSort } from '@/lib/chat/types';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { missingFunction } from '@/lib/device';
import { holdReturn } from '@/lib/page-return';
import { readPages } from '@/lib/read-pages';
import { getSupabase } from '@/lib/supabase';

/**
 * Topics and posts: the forum half of Chat.
 *
 * ---------------------------------------------------------------------------
 * The topic list comes from a function, not a table
 * ---------------------------------------------------------------------------
 * `chat_topics_for(room)` is `security definer` and returns the view count and
 * the unread flag alongside each topic. Both are counted from
 * `chat_topic_reads`, which a member may only read their own rows of, so no
 * arrangement of client-side queries could produce them. It also does the
 * room-visibility check itself, which is why a closed room comes back as an
 * empty list rather than as an error.
 *
 * ---------------------------------------------------------------------------
 * Reading and writing are separate paths on purpose
 * ---------------------------------------------------------------------------
 * Posts are read straight from `chat_posts` and written straight to it; only
 * the things that touch somebody else's rows — the counts, marking read,
 * removing — go through a function. A removed post comes back with an empty
 * body because the database blanked the column, so there is no client-side
 * rule about what to show and no way for the text to arrive and be hidden.
 */

/**
 * What a supabase call hands back, named so that the rpc results can be cast
 * to it. `rpc()` is untyped without generated database types, and an untyped
 * result spreads `any` through every line that touches it — which is exactly
 * the kind of value the strict lint rules here exist to stop.
 */
interface Result<T> {
  data: T | null;
  error: Failure | null;
}

interface TopicRow {
  id: string;
  room_id: string;
  title: string;
  author_id: string | null;
  created_at: string;
  last_post_at: string;
  reply_count: number;
  view_count: number | string;
  unread: boolean;
  participant_ids: string[] | null;
}

function toTopic(row: TopicRow): ChatTopic {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    authorId: row.author_id,
    createdAt: row.created_at,
    lastPostAt: row.last_post_at,
    replyCount: row.reply_count,
    // bigint: a string once it passes 2^53, a number before that.
    viewCount: Number(row.view_count),
    unread: row.unread,
    participantIds: row.participant_ids ?? [],
  };
}

/** Exported with `toPost` for Home, which reads posts across topics. */
export interface PostRow {
  id: string;
  topic_id: string;
  author_id: string | null;
  body: string;
  attachments: string[] | null;
  created_at: string;
  removed_at: string | null;
  removed_by_admin: boolean;
  edited_at: string | null;
  reply_to: string | null;
  link_preview: unknown;
}

export const POST_COLUMNS =
  'id, topic_id, author_id, body, attachments, created_at, removed_at, removed_by_admin, edited_at, reply_to, link_preview';

export function toPost(row: PostRow): ChatPost {
  return {
    id: row.id,
    topicId: row.topic_id,
    authorId: row.author_id,
    body: row.body,
    attachments: row.attachments ?? [],
    createdAt: row.created_at,
    removedAt: row.removed_at,
    removedByAdmin: row.removed_by_admin,
    editedAt: row.edited_at,
    replyTo: row.reply_to,
    linkPreview: toLinkPreview(row.link_preview),
  };
}

/**
 * The topic list in one of its three orders.
 *
 * Pure, so the sort bar is tested without a database. Every order falls back to
 * activity, because ties are the ordinary case in a club this size — a room
 * where nine topics have one reply each would otherwise shuffle itself on every
 * read, and a list that reorders while you look at it is a list you lose your
 * place in.
 */
export function sortTopics(topics: ChatTopic[], sort: RoomSort): ChatTopic[] {
  // Top is ranked by the database, so the list is already in its order.
  if (sort === 'top') return [...topics];
  const byActivity = (a: ChatTopic, b: ChatTopic) => b.lastPostAt.localeCompare(a.lastPostAt);
  return [...topics].sort((a, b) => {
    if (sort === 'replies' && a.replyCount !== b.replyCount) return b.replyCount - a.replyCount;
    if (sort === 'views' && a.viewCount !== b.viewCount) return b.viewCount - a.viewCount;
    return byActivity(a, b);
  });
}

/**
 * Where to open a topic: the first post the reader has not seen, or the top.
 *
 * Returns an index into `posts`, or 0 when everything is new or nothing is.
 * A reader arriving at a topic for the first time starts at the beginning —
 * "first unread" for somebody who has read none of it is the first post, which
 * is the top, and jumping them past the question would be absurd.
 */
export function firstUnreadIndex(posts: ChatPost[], lastReadAt: string | null): number {
  if (!lastReadAt) return 0;
  const index = posts.findIndex((post) => post.createdAt > lastReadAt);
  return index === -1 ? 0 : index;
}

/** A top-level post and the replies filed under it, each in time order. */
export interface PostThread {
  post: ChatPost;
  replies: PostThread[];
}

/** Earliest first, with the id to break a tie so two reads agree. */
function byPostTime(a: ChatPost, b: ChatPost): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Each reply stays under the post it answers. Missing parents become roots.
 * Break malformed cycles rather than losing their posts or recursing forever. */
export function threadPosts(posts: readonly ChatPost[]): PostThread[] {
  const sorted = [...posts].sort(byPostTime);
  const nodes = new Map<string, PostThread>(sorted.map((post) => [post.id, { post, replies: [] }]));
  const parents = new Map<string, string>();
  const roots: PostThread[] = [];
  for (const post of sorted) {
    const node = nodes.get(post.id);
    if (!node) continue;
    const parent = post.replyTo ? nodes.get(post.replyTo) : undefined;
    let ancestor = parent?.post.id;
    const seen = new Set([post.id]);
    while (ancestor && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    if (parent && !ancestor) {
      parents.set(post.id, parent.post.id);
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Count all descendants, including those inside another reply's branch. */
export function replyCount(thread: PostThread): number {
  return thread.replies.reduce((count, reply) => count + 1 + replyCount(reply), 0);
}

/** The first root with unread words anywhere in its conversation. */
export function firstUnreadThread(
  threads: readonly PostThread[],
  lastReadAt: string | null,
): number {
  if (!lastReadAt) return 0;
  const unread = (thread: PostThread): boolean =>
    thread.post.createdAt > lastReadAt || thread.replies.some(unread);
  const index = threads.findIndex(unread);
  return index === -1 ? 0 : index;
}

/** Topics a room shows at first, and adds with each Show more. */
export const TOPIC_PAGE = 40;
/** The most chat_topics_page returns in one call. */
const MAX_TOPIC_PAGE = 200;

/** Where the next page starts: the last row's time, exactly as sent, and id. */
export interface TopicCursor {
  at: string;
  id: string;
}

/**
 * The first `want` topics, newest activity first, a page at a time, plus
 * whether there are more. Asks for one extra row to know.
 */
export async function readTopicPages(
  page: (size: number, before: TopicCursor | null) => PromiseLike<Result<TopicRow[]>>,
  want: number,
): Promise<{ rows: TopicRow[]; more: boolean; error: Failure | null }> {
  const rows: TopicRow[] = [];
  let before: TopicCursor | null = null;
  while (rows.length <= want) {
    const size = Math.min(MAX_TOPIC_PAGE, want + 1 - rows.length);
    const result = await page(size, before);
    if (result.error) return { rows: [], more: false, error: result.error };
    const batch = result.data ?? [];
    rows.push(...batch);
    const last = batch.at(-1);
    if (batch.length < size || !last) break;
    before = { at: last.last_post_at, id: last.id };
  }
  return { rows: rows.slice(0, want), more: rows.length > want, error: null };
}

/**
 * The first `want` topics best first (chat_topics_ranked, 20261118180000), a page at a time by
 * how many are already read, plus whether there are more.
 */
export async function readRankedPages(
  page: (size: number, skip: number) => PromiseLike<Result<TopicRow[]>>,
  want: number,
): Promise<{ rows: TopicRow[]; more: boolean; error: Failure | null }> {
  const rows: TopicRow[] = [];
  while (rows.length <= want) {
    const size = Math.min(MAX_TOPIC_PAGE, want + 1 - rows.length);
    const result = await page(size, rows.length);
    if (result.error) return { rows: [], more: false, error: result.error };
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return { rows: rows.slice(0, want), more: rows.length > want, error: null };
}

export interface RoomTopicsState {
  topics: ChatTopic[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** More topics than are shown. */
  hasMore: boolean;
  /** Reading the next page. */
  loadingMore: boolean;
  showMore: () => void;
}

/** `ranked`: best first (the Top sort), else newest activity first. */
export function useRoomTopics(roomId: string | undefined, ranked = false): RoomTopicsState {
  const [topics, setTopics] = useState<ChatTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  // How many the list holds; a reload reads that many again.
  const want = useRef(TOPIC_PAGE);

  const load = useCallback(async () => {
    if (!roomId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const aborted = () => controller.signal.aborted;
    const supabase = getSupabase();

    try {
      let read = ranked
        ? await readRankedPages(
            (size, skip) =>
              supabase
                .rpc('chat_topics_ranked', { room: roomId, max_rows: size, skip })
                .abortSignal(controller.signal) as PromiseLike<Result<TopicRow[]>>,
            want.current,
          )
        : null;
      // A database before 20261118180000: newest activity first, as before.
      if (!read || missingFunction(read.error))
        read = await readTopicPages(
          (size, before) =>
            supabase
              .rpc('chat_topics_page', {
                room: roomId,
                max_rows: size,
                before_at: before?.at ?? null,
                before_id: before?.id ?? null,
              })
              .abortSignal(controller.signal) as PromiseLike<Result<TopicRow[]>>,
          want.current,
        );
      // A database before 20261104212000: the whole list, as before.
      if (missingFunction(read.error)) {
        const all = (await supabase
          .rpc('chat_topics_for', { room: roomId })
          .abortSignal(controller.signal)) as Result<TopicRow[]>;
        read = { rows: all.data ?? [], more: false, error: all.error };
      }
      if (aborted()) return;
      setLoadingMore(false);
      if (read.error) {
        setTopics([]);
        setHasMore(false);
        setError(describeError(read.error, 'Could not load the posts.'));
        setLoading(false);
        return;
      }
      setTopics(read.rows.map(toTopic));
      setHasMore(read.more);
      setError(null);
      setLoading(false);
    } catch (e) {
      if (aborted()) return;
      setTopics([]);
      setHasMore(false);
      setLoadingMore(false);
      setError(describeThrown(e, 'Could not load the posts.'));
      setLoading(false);
    }
  }, [roomId, ranked]);

  useEffect(() => {
    want.current = TOPIC_PAGE;
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const showMore = useCallback(() => {
    want.current += TOPIC_PAGE;
    setLoadingMore(true);
    void load();
  }, [load]);

  return { topics, loading, error, reload, hasMore, loadingMore, showMore };
}

/** One topic's row (20261104212000), or the room's list on an older database. */
async function readOneTopic(
  topicId: string,
  roomId: string,
  signal: AbortSignal,
): Promise<Result<TopicRow | null>> {
  const supabase = getSupabase();
  const one = (await supabase
    .rpc('chat_topic_for', { topic: topicId })
    .abortSignal(signal)) as Result<TopicRow[]>;
  if (!missingFunction(one.error)) return { data: one.data?.[0] ?? null, error: one.error };
  const all = (await supabase
    .rpc('chat_topics_for', { room: roomId })
    .abortSignal(signal)) as Result<TopicRow[]>;
  return { data: all.data?.find((row) => row.id === topicId) ?? null, error: all.error };
}

export interface TopicPostsState {
  /** The topic itself, or null while loading or when it cannot be read. */
  topic: ChatTopic | null;
  posts: ChatPost[];
  /** The reader's own last_read_at, as it was *before* this visit marked it. */
  lastReadAt: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Reload, and know when it has landed. */
  refresh: () => Promise<void>;
  /**
   * The room the topic is in now, when the address names another: it was
   * moved (chat_move_topic) after the link was made. Null otherwise.
   */
  movedTo: string | null;
}

/**
 * One topic and its posts.
 *
 * Three reads rather than one, and each is a different question:
 *
 *  - `chat_topic_for(topic)`, for the title, the reply count and the view
 *    count. The view count only exists inside that function.
 *  - `chat_posts`, for the posts.
 *  - the reader's own `chat_topic_reads` row, read *before* it is overwritten,
 *    so the screen knows where the reader had got to.
 *
 * Then it marks the topic read. Marking is a function and sets the server's
 * clock, so nothing here sends a timestamp.
 */
export function useTopicPosts(
  roomId: string | undefined,
  topicId: string | undefined,
): TopicPostsState {
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;

  const [topic, setTopic] = useState<ChatTopic | null>(null);
  const [posts, setPosts] = useState<ChatPost[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  // This visit has marked once already.
  const opened = useRef(false);

  const load = useCallback(async () => {
    if (!roomId || !topicId) {
      setLoading(false);
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const aborted = () => controller.signal.aborted;
    const supabase = getSupabase();

    try {
      const [topics, postRows, reads, seen] = (await Promise.all([
        readOneTopic(topicId, roomId, controller.signal),
        readPages<PostRow>((from, to) =>
          supabase
            .from('chat_posts')
            .select(POST_COLUMNS)
            .eq('topic_id', topicId)
            .order('created_at')
            .order('id')
            .range(from, to)
            .abortSignal(controller.signal),
        ),
        memberId
          ? supabase
              .from('chat_topic_reads')
              .select('last_read_at')
              .eq('topic_id', topicId)
              .eq('member_id', memberId)
              // Before maybeSingle(), not after: that one returns a promise
              // rather than the builder, so the signal has nowhere to go.
              .abortSignal(controller.signal)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        memberId
          ? supabase
              .rpc('chat_topic_viewed_by_me', { topic: topicId })
              .abortSignal(controller.signal)
          : Promise.resolve({ data: null, error: null }),
      ])) as [
        Result<TopicRow | null>,
        Result<PostRow[]>,
        Result<{ last_read_at: string }>,
        Result<boolean | null>,
      ];
      if (aborted()) return;

      const failure = topics.error ?? postRows.error;
      if (failure) {
        setError(describeError(failure, 'Could not load the topic.'));
        setLoading(false);
        return;
      }

      // In another room: moved, which the check below tells apart.
      const found = topics.data?.room_id === roomId ? topics.data : null;
      if (!found) {
        // Not in this room: moved since the address was made, or gone.
        const where = (await supabase
          .rpc('chat_topic_room', { topic: topicId })
          .abortSignal(controller.signal)) as Result<string | null>;
        if (aborted()) return;
        if (where.data && where.data !== roomId) {
          setMovedTo(where.data);
          return;
        }
      }
      setMovedTo(null);
      // The counts were read a moment before this visit was recorded, so a
      // first-time reader would be looking at a topic that says "0 views".
      // Marking read below inserts exactly one row when there was none, so
      // adding one here is the count after this visit rather than a guess.
      // Not for the member who started it: their own visit is never a view
      // (20261016020000). Nor for one who liked or reacted from Home, already
      // counted (20261019000000); without that answer, the read row decides.
      const counted =
        (seen.error || seen.data === null ? reads.data === null : !seen.data) &&
        found?.author_id !== memberId;
      setTopic(
        found
          ? { ...toTopic(found), viewCount: Number(found.view_count) + (counted ? 1 : 0) }
          : null,
      );
      setPosts((postRows.data ?? []).map(toPost));
      setLastReadAt(reads.data?.last_read_at ?? null);
      setError(null);
      setLoading(false);

      // After the read, not before: the value above is where the reader had
      // got to, and this is the visit that moves it. A failure is silent.
      // Only the first load of a visit marks through the same post again;
      // reloads mark only when the newest post moved (topic-read-mark.ts).
      const through = postRows.data?.at(-1)?.id;
      if (found && through) {
        markTopicRead(topicId, through, !opened.current);
        opened.current = true;
      }
    } catch (e) {
      if (aborted()) return;
      setError(describeThrown(e, 'Could not load the topic.'));
      setLoading(false);
    }
  }, [roomId, topicId, memberId]);

  useEffect(() => {
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  // Another topic is a new visit; leaving sends the mark still waiting.
  useEffect(() => {
    opened.current = false;
    return () => {
      if (topicId) flushTopicRead(topicId);
    };
  }, [topicId]);

  const refresh = useCallback(() => {
    const run = load();
    // A return's catch-up: what counts after it waits for it and its mark.
    holdReturn(run);
    return run;
  }, [load]);
  const reload = useCallback(() => {
    void refresh();
  }, [refresh]);

  return { topic, posts, lastReadAt, loading, error, reload, refresh, movedTo };
}

/**
 * A topic's posts, live. A change (and a reconnect or return) reads the posts
 * again; the likes go after them, so new posts and missed likes are one read.
 */
export function useTopicRealtime(
  topicId: string | undefined,
  posts: Pick<TopicPostsState, 'refresh'>,
  edits: { reload: () => void },
  likes: { reload: () => void },
): void {
  useRealtimeRows({
    table: 'chat_posts',
    filter: topicId ? `topic_id=eq.${topicId}` : undefined,
    onChange: () => {
      void posts.refresh().then(likes.reload);
      // An edit arrives as an update to the post; its earlier version is a
      // new row here.
      edits.reload();
    },
    enabled: Boolean(topicId),
  });
}

export type ChatWriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Start a topic: the title and the first post, in one transaction.
 *
 * Returns the new topic's id so the caller can go straight to it, which is also
 * what marks it read — see the unread note in 20260918050000.
 */
export async function createTopic(
  roomId: string,
  title: string,
  body: string,
  attachments: string[] = [],
  /** Asked as a question, drawn larger on Home (20261010010000). */
  question = false,
): Promise<ChatWriteResult<string>> {
  const { data, error } = (await getSupabase().rpc('chat_create_topic', {
    room: roomId,
    title,
    body,
    attachments,
    // Only when true, so an ordinary topic is the same call it always was.
    ...(question ? { question: true } : {}),
  })) as Result<string>;
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'The post was not created.',
        constraints: {
          chat_topics_title_check: 'A title is up to 140 characters.',
          chat_posts_check: `A post needs some words or a photograph, and at most ${POST_MAX_WORDS} characters.`,
          chat_posts_attachments_check: `Up to ${MAX_ATTACHMENTS} photographs on one post.`,
        },
      }),
    };
  }
  if (!data) return { ok: false, error: 'The post was not created.' };
  return { ok: true, value: data };
}

/**
 * What the row can be refused for, in the composer's words. The policy is
 * the membership, the room and whether the topic is still open; the two
 * constraints are the row's own shape, which the composer already stops.
 */
const POST_REFUSALS = {
  attempt: 'Your reply was not posted.',
  refused: 'You cannot reply in this room.',
  // The topic was deleted by an administrator while this was being written.
  missing: 'This post has been deleted.',
  constraints: {
    chat_posts_check: `A reply needs some words or a photograph, and at most ${POST_MAX_WORDS} characters.`,
    chat_posts_attachments_check: `Up to ${MAX_ATTACHMENTS} photographs on one reply.`,
  },
};

/** Post a reply. The insert policy is what decides; this only asks. */
export async function sendPost(
  topicId: string,
  authorId: string,
  body: string,
  attachments: string[] = [],
  /** The post this one answers, or null for a post at the top level. */
  replyTo: string | null = null,
): Promise<ChatWriteResult<ChatPost>> {
  const { data, error } = (await getSupabase()
    .from('chat_posts')
    // reply_to is named only when there is one, so a plain post still lands
    // on a database that predates the column. The trigger behind it refuses
    // a parent in another topic, a removed one, or a reply, in a sentence.
    .insert({
      topic_id: topicId,
      author_id: authorId,
      body,
      attachments,
      ...(replyTo ? { reply_to: replyTo } : {}),
    })
    .select(POST_COLUMNS)
    .single()) as Result<PostRow>;
  if (error) return { ok: false, error: describeError(error, POST_REFUSALS) };
  if (!data) return { ok: false, error: 'Your reply was not posted.' };
  return { ok: true, value: toPost(data) };
}

/**
 * Change the words of the reader's own post.
 *
 * `chat_edit_post` decides and refuses in a sentence: the author only, an
 * administrator included — an administrator removes, and does not rewrite a
 * member's words — and only while the post is standing and the room is open.
 * The earlier version goes to chat_edits, where an administrator can read
 * it; a blank body is refused unless the post has photographs, and an edit
 * that changes nothing is refused so that "Edited" is never a lie. The
 * composer stops the first two before sending; reaching them here means a
 * second tab got there first.
 */
export async function editPost(
  postId: string,
  body: string,
  added: string[] = [],
  /**
   * The photographs it keeps, when some are taken out (20261119150000);
   * null keeps them all.
   */
  kept: string[] | null = null,
): Promise<ChatWriteResult<null>> {
  // Photographs taken out, else added (20261029000000), else words alone, as before.
  const { error } =
    kept !== null
      ? await getSupabase().rpc('chat_edit_post_photographs_kept', {
          post: postId,
          new_body: body,
          kept,
          added,
        })
      : added.length > 0
        ? await getSupabase().rpc('chat_edit_post_photographs', {
            post: postId,
            new_body: body,
            added,
          })
        : await getSupabase().rpc('chat_edit_post', { post: postId, new_body: body });
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'Your edit was not saved.',
        refused: 'You can only edit what you wrote.',
        missing: 'That post or reply is not there any more.',
      }),
    };
  }
  return { ok: true, value: null };
}

/**
 * Remove a post. The author's own, or anybody's if the caller is an
 * administrator — `chat_remove_post` decides and refuses in a sentence.
 * Returns the photographs to delete through the storage API: only those the
 * post's author uploaded, never simply what the row named, since a row could
 * name anybody's file (20261018020000).
 */
export async function removePost(postId: string): Promise<ChatWriteResult<string[]>> {
  const { data, error } = (await getSupabase().rpc('chat_remove_post', {
    post: postId,
  })) as Result<string[]>;
  if (error)
    return { ok: false, error: describeError(error, 'The post or reply was not removed.') };
  return { ok: true, value: data ?? [] };
}

/**
 * Delete a whole topic — administrators only; `admin_delete_topic` refuses
 * anybody else in a sentence. Returns the photograph paths its posts carried,
 * for the caller to remove through the storage API (files cannot be deleted
 * from SQL). Reports on its posts keep their own copy; see 20260927040000.
 */
export async function deleteTopic(topicId: string): Promise<ChatWriteResult<string[]>> {
  const { data, error } = (await getSupabase().rpc('admin_delete_topic', {
    topic: topicId,
  })) as Result<string[]>;
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'The post was not deleted.',
        missing: 'That post is not there any more.',
      }),
    };
  }
  return { ok: true, value: data ?? [] };
}

/**
 * The starter edits a topic posted with only its title: the title and the
 * post repeating it, together (chat_edit_topic_title, 20261029260000).
 */
export async function editTopicTitle(
  topicId: string,
  title: string,
): Promise<ChatWriteResult<null>> {
  const { error } = (await getSupabase().rpc('chat_edit_topic_title', {
    topic: topicId,
    new_title: title,
  })) as Result<null>;
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'Your edit was not saved.',
        refused: 'You can only edit your own topic.',
        missing: 'This post is not there any more.',
      }),
    };
  }
  return { ok: true, value: null };
}

/**
 * Whoever started a topic deletes it, while no other member's post stands in
 * it (chat_delete_my_topic, 20261029250000). Returns photographs as above.
 */
export async function deleteMyTopic(topicId: string): Promise<ChatWriteResult<string[]>> {
  const { data, error } = (await getSupabase().rpc('chat_delete_my_topic', {
    topic: topicId,
  })) as Result<string[]>;
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'The post was not deleted.',
        missing: 'That post is not there any more.',
      }),
    };
  }
  return { ok: true, value: data ?? [] };
}

/**
 * Moves a topic to another room: an administrator, or whoever started it
 * (chat_move_topic, 20261010010000). The database decides; the page only
 * offers it to those two.
 */
export async function moveTopic(topicId: string, roomId: string): Promise<ChatWriteResult<null>> {
  try {
    const { error } = await getSupabase().rpc('chat_move_topic', {
      topic: topicId,
      to_room: roomId,
    });
    if (error) return { ok: false, error: describeError(error, 'The post was not moved.') };
    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'The post was not moved.') };
  }
}

/**
 * Whether a topic was asked as a question (chat_topics.is_question), for the
 * words on its page: "Answer question" and "Reply to this question" (the
 * owner, 2026-11-19). False until it is read, or when it cannot be: the
 * page then says "post", as it always did.
 */
export function useTopicIsQuestion(topicId: string | undefined): boolean {
  const [question, setQuestion] = useState<{ id: string; is: boolean } | null>(null);
  useEffect(() => {
    if (!topicId) return;
    // Left behind once the page moves on to another topic.
    const run = { live: true };
    void (async () => {
      try {
        const { data } = (await getSupabase()
          .from('chat_topics')
          .select('is_question')
          .eq('id', topicId)
          .maybeSingle()) as { data: { is_question?: boolean } | null };
        if (run.live) setQuestion({ id: topicId, is: data?.is_question === true });
      } catch {
        // Offline: the page says "post".
      }
    })();
    return () => {
      run.live = false;
    };
  }, [topicId]);
  return question !== null && question.id === topicId && question.is;
}
