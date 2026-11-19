import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import type { ChatWriteResult } from '@/lib/chat/topics';
import { announcePostViewsChanged } from '@/lib/chat/views';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { useKeptRead } from '@/lib/kept-reads';
import { readInBatches, readPages } from '@/lib/read-pages';
import { getSupabase } from '@/lib/supabase';

/**
 * Votes on posts in rooms: up, down, the score between, and an administrator's boost.
 *
 * The owner, 2026-11-18 (20261118180000): Reddit's up and down arrows with the score between,
 * instead of Like. An upvote is a like: `chat_post_likes` keeps its rows, names list and
 * notification. A downvote is anonymous (`chat_post_downvotes`, nobody reads another's). A club
 * administrator's long press or right click on the up arrow boosts it (`admin_boost_post`), which
 * moves the post up in Top and on Home as a new reply would, and again moves it up again
 * (20261119120000; before, a flat lift for 14 days, once). Since 20261118195000 it is in no
 * score, so members never see it. `chat_post_scores` says
 * each score and the reader's vote; on a database without it, the score is the likes and nobody
 * has downvoted.
 *
 * Before the votes, likes on posts in rooms: who likes which, liking, and taking it back.
 *
 * The owner, 2026-09-29 (HANDOFF.md "What Home is" decision 4): names shown to every member who
 * can read the room. `chat_post_likes` (20260930010000) is a row per member per post.
 *
 * - The count comes from the names, so the two cannot disagree. No reader filter: this read means
 *   everybody's likes (20260930010000 says why there is one select policy).
 * - Liking is `ignoreDuplicates` (on conflict do nothing): there is no update grant
 *   (HANDOFF.md, "An upsert is on conflict do update").
 * - Optimistic, put back on failure. A second tap while a write is in flight is ignored, so a like
 *   and its undo cannot land out of order.
 * - Not live: not in the realtime publication (not urgent, and names would be on the wire).
 *   Screens call `reload` when they refetch anyway.
 */

/** Who likes each post: member ids, oldest like first. Posts nobody likes are absent. */
export type LikesByPost = ReadonlyMap<string, readonly string[]>;

export interface LikeRow {
  post_id: string;
  member_id: string;
}

/** The rows grouped by post, in the order they were read. */
export function groupLikes(rows: readonly LikeRow[]): Map<string, string[]> {
  const byPost = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPost.get(row.post_id);
    if (list) {
      if (!list.includes(row.member_id)) list.push(row.member_id);
    } else {
      byPost.set(row.post_id, [row.member_id]);
    }
  }
  return byPost;
}

/**
 * The map with one member's like on one post set to `liked`. A new map every time; a like goes
 * at the end, where the read would put it.
 */
export function withLike(
  byPost: LikesByPost,
  postId: string,
  memberId: string,
  liked: boolean,
): Map<string, readonly string[]> {
  const next = new Map(byPost);
  const current = byPost.get(postId) ?? [];
  const without = current.filter((id) => id !== memberId);
  const list = liked ? [...without, memberId] : without;
  if (list.length > 0) next.set(postId, list);
  else next.delete(postId);
  return next;
}

/** An up, a down, or neither. */
export type Vote = -1 | 0 | 1;

/** A post's score, the reader's vote on it, and to an administrator the boost in it. */
export interface PostScore {
  score: number;
  myVote: Vote;
  /** Null for everybody but an administrator. */
  boost: number | null;
}

interface ScoreRow {
  post_id: string;
  score: number;
  my_vote: number;
  boost: number | null;
}

/** The scores with one reader's vote on one post moved from `from` to `to`. A new map. */
export function withVote(
  scores: ReadonlyMap<string, PostScore>,
  postId: string,
  from: Vote,
  to: Vote,
): Map<string, PostScore> {
  const next = new Map(scores);
  const current = scores.get(postId);
  if (current) next.set(postId, { ...current, score: current.score + to - from, myVote: to });
  return next;
}

/** "1 like", "3 likes". Zero is shown on new posts too. */
export function likesLabel(count: number): string {
  return `${count} ${count === 1 ? 'like' : 'likes'}`;
}

// From HANDOFF.md "What Home is" step 3. Unlike has no "refused": the delete policy hides
// others' rows rather than refusing.
const LIKE_FAILED = { attempt: 'Your like was not saved.', refused: 'You cannot like this.' };
const UNLIKE_FAILED = { attempt: 'Your like is still there.' };

/** Like a post, as the reader. Liking twice is one row. */
export async function likePost(postId: string, memberId: string): Promise<ChatWriteResult<null>> {
  const { error } = await getSupabase()
    .from('chat_post_likes')
    .upsert(
      { post_id: postId, member_id: memberId },
      { onConflict: 'post_id,member_id', ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: describeError(error, LIKE_FAILED) };
  // A like is a view (20261019000000).
  announcePostViewsChanged();
  return { ok: true, value: null };
}

/** Take the reader's like back. Taking back one that is not there is not an error. */
export async function unlikePost(postId: string, memberId: string): Promise<ChatWriteResult<null>> {
  const { error } = await getSupabase()
    .from('chat_post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('member_id', memberId);
  if (error) return { ok: false, error: describeError(error, UNLIKE_FAILED) };
  announcePostViewsChanged();
  return { ok: true, value: null };
}

const DOWN_FAILED = {
  attempt: 'Your downvote was not saved.',
  refused: 'You cannot vote on this.',
};
const UNDOWN_FAILED = { attempt: 'Your downvote is still there.' };

/** Downvote a post, as the reader. Takes back their upvote, if any (20261118180000). */
export async function downvotePost(
  postId: string,
  memberId: string,
): Promise<ChatWriteResult<null>> {
  const { error } = await getSupabase()
    .from('chat_post_downvotes')
    .upsert(
      { post_id: postId, member_id: memberId },
      { onConflict: 'post_id,member_id', ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: describeError(error, DOWN_FAILED) };
  return { ok: true, value: null };
}

/** Take the reader's downvote back. */
export async function undownvotePost(
  postId: string,
  memberId: string,
): Promise<ChatWriteResult<null>> {
  const { error } = await getSupabase()
    .from('chat_post_downvotes')
    .delete()
    .eq('post_id', postId)
    .eq('member_id', memberId);
  if (error) return { ok: false, error: describeError(error, UNDOWN_FAILED) };
  return { ok: true, value: null };
}

const BOOST_FAILED = { attempt: 'The boost was not saved.', refused: 'Only administrators boost.' };

/** An administrator's boost, or taking it back. After it: 10 when boosted, 0 when not. */
export async function boostPost(postId: string, more: boolean): Promise<ChatWriteResult<number>> {
  const { data, error } = (await getSupabase().rpc('admin_boost_post', { post: postId, more })) as {
    data: number | null;
    error: Parameters<typeof describeError>[0] | null;
  };
  if (error) return { ok: false, error: describeError(error, BOOST_FAILED) };
  return { ok: true, value: data ?? 0 };
}

/** What a post's arrows need, built by `voteFor`: the topic page, rooms and Home take the same. */
export interface PostVote {
  /** Who upvoted: member ids, oldest first. */
  likedBy: readonly string[];
  /** The signed-in reader, including the post's author. */
  readerId: string | null;
  score: number;
  myVote: Vote;
  /** Null for everybody but an administrator. */
  boost: number | null;
  /** Up, or take the up back. */
  onToggle: () => void;
  /** Down, or take the down back. */
  onDownvote: () => void;
  /** An administrator's +10, or taking 10 back. Absent for everybody else. */
  onBoost?: ((more: boolean) => void) | undefined;
  /** The sentence for a vote that did not land on this post, or null. */
  failure: string | null;
  loading?: boolean | undefined;
  unavailable?: boolean | undefined;
}

export interface PostLikesState {
  byPost: LikesByPost;
  loading: boolean;
  /** This post's likes are not known yet. Posts the last read drew stay known. */
  loadingFor: (postId: string) => boolean;
  /** The read failed. Screens draw no count rather than a wrong one. */
  error: string | null;
  /** A like or its taking back that did not land, and which post it was on. */
  failure: { postId: string; message: string } | null;
  /** Upvote it, or take the upvote back, whichever the reader has not done. */
  toggle: (postId: string) => void;
  /** Downvote it, or take the downvote back. */
  downvote: (postId: string) => void;
  /** An administrator's +10 (`more`), or taking 10 back. Does nothing for anybody else. */
  boost: (postId: string, more: boolean) => void;
  /** The score and the reader's vote; from the likes alone on a database without scores. */
  scoreOf: (postId: string) => PostScore;
  isAdmin: boolean;
  reload: () => void;
}

/** One post's arrows, from the hook's state. */
export function voteFor(state: PostLikesState, postId: string, readerId: string | null): PostVote {
  const { score, myVote, boost } = state.scoreOf(postId);
  return {
    likedBy: state.byPost.get(postId) ?? [],
    readerId,
    score,
    myVote,
    boost,
    loading: state.loadingFor(postId),
    unavailable: Boolean(state.error),
    onToggle: () => {
      state.toggle(postId);
    },
    onDownvote: () => {
      state.downvote(postId);
    },
    onBoost: state.isAdmin
      ? (more: boolean) => {
          state.boost(postId, more);
        }
      : undefined,
    failure: state.failure?.postId === postId ? state.failure.message : null,
  };
}

const EMPTY: LikesByPost = new Map();
const NO_SCORES: ReadonlyMap<string, PostScore> = new Map();
const NONE: ReadonlySet<string> = new Set();

export function usePostLikes(postIds: readonly string[]): PostLikesState {
  const account = useAccount();
  const announce = useAnnounce();
  const memberId = account.status === 'member' ? account.userId : null;
  const isAdmin = account.status === 'member' && account.isAdmin;
  // As one string, so a new array with the same ids does not re-run the effect.
  const key = [...new Set(postIds)].sort().join(',');

  const [byPost, setByPost] = useState<LikesByPost>(EMPTY);
  const [scores, setScores] = useState<ReadonlyMap<string, PostScore>>(NO_SCORES);
  // Loading is derived from this, so new posts never flash unliked before the effect runs.
  const [settled, setSettled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = memberId !== null && key !== '' && settled !== key;
  // The posts the last good read covered: drawn as they were while more load.
  const [known, setKnown] = useState<ReadonlySet<string>>(NONE);
  const [failure, setFailure] = useState<PostLikesState['failure']>(null);
  // Bumped by reload, so the effect runs again for the same ids.
  const [attempt, setAttempt] = useState(0);
  // Posts with a write in flight. A ref, not state: nothing is drawn from it.
  const pending = useRef(new Set<string>());
  // The scores as last drawn, for a boost's check without re-creating it on every vote.
  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  // The posts whose likes are drawn; read again, they stay up meanwhile.
  const shown = useRef<string | null>(null);
  const kept = useKeptRead();

  useEffect(() => {
    // Read so biome does not flag `attempt` as an unused dependency.
    if (attempt < 0) return;
    if (!memberId || key === '') {
      shown.current = null;
      setByPost(EMPTY);
      setScores(NO_SCORES);
      setKnown(NONE);
      setSettled(null);
      setError(null);
      return;
    }
    // A kept tab shown again within the minute (lib/kept-reads.ts).
    const read = `${memberId}|${key}|${attempt}`;
    if (kept.fresh(read)) return;
    const landed = kept.start(read);
    const controller = new AbortController();
    const ids = key.split(',');
    const again = shown.current === key;

    async function load() {
      try {
        // The scores beside the names. Without them (a database before 20261118180000, or a
        // failed read) the score is the likes: never a reason to draw no likes at all.
        const scoreRead = readInBatches<ScoreRow>(
          ids,
          (batch) =>
            getSupabase()
              .rpc('chat_post_scores', { post_ids: batch })
              .abortSignal(controller.signal) as unknown as PromiseLike<{
              data: ScoreRow[] | null;
              error: Failure | null;
            }>,
        ).catch(() => ({ data: null, error: null }));
        // Batched and paged: one read was capped at 1,000 likes and put every id in the URL.
        const { data, error: failed } = await readInBatches<LikeRow>(ids, (batch) =>
          readPages<LikeRow>((first, last) =>
            getSupabase()
              .from('chat_post_likes')
              .select('post_id, member_id')
              .in('post_id', batch)
              .order('liked_at')
              .order('post_id')
              .order('member_id')
              .range(first, last)
              .abortSignal(controller.signal),
          ),
        );
        const scored = await scoreRead;
        if (controller.signal.aborted) return;
        if (failed) {
          if (again) return;
          setByPost(EMPTY);
          setKnown(NONE);
          setError(describeError(failed, 'Could not load the likes.'));
          setSettled(key);
          return;
        }
        shown.current = key;
        setByPost(groupLikes(data ?? []));
        setScores(
          scored.error || !scored.data
            ? NO_SCORES
            : new Map(
                scored.data.map((row) => [
                  row.post_id,
                  {
                    score: row.score,
                    myVote: Math.sign(row.my_vote) as Vote,
                    boost: row.boost,
                  },
                ]),
              ),
        );
        setKnown(new Set(ids));
        setError(null);
        setSettled(key);
        landed();
      } catch (e) {
        if (controller.signal.aborted || again) return;
        setByPost(EMPTY);
        setKnown(NONE);
        setError(describeThrown(e, 'Could not load the likes.'));
        setSettled(key);
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [memberId, key, attempt, kept]);

  const scoreOf = useCallback(
    (postId: string): PostScore => {
      const known = scores.get(postId);
      if (known) return known;
      const likedBy = byPost.get(postId) ?? [];
      return {
        score: likedBy.length,
        myVote: memberId && likedBy.includes(memberId) ? 1 : 0,
        boost: null,
      };
    },
    [scores, byPost, memberId],
  );

  const vote = useCallback(
    (postId: string, way: 1 | -1) => {
      // Not before the reader's own vote is known: a tap would undo it.
      if (!memberId || loading || error || pending.current.has(postId)) return;
      const was = scoreOf(postId).myVote;
      const now: Vote = was === way ? 0 : way;
      pending.current.add(postId);
      setFailure(null);
      setByPost((current) => withLike(current, postId, memberId, now === 1));
      setScores((current) => withVote(current, postId, was, now));

      const done = (message: string | null) => {
        pending.current.delete(postId);
        if (message === null) {
          // The arrow moved before the write; this says the write held.
          announce(now === 1 ? 'Upvoted.' : now === -1 ? 'Downvoted.' : 'Vote taken back.');
          return;
        }
        setByPost((current) => withLike(current, postId, memberId, was === 1));
        setScores((current) => withVote(current, postId, now, was));
        setFailure({ postId, message });
      };

      // The database takes the other vote back (20261118180000).
      const write =
        now === 1
          ? likePost(postId, memberId)
          : now === -1
            ? downvotePost(postId, memberId)
            : was === 1
              ? unlikePost(postId, memberId)
              : undownvotePost(postId, memberId);
      const failed =
        now === 1
          ? LIKE_FAILED
          : now === -1
            ? DOWN_FAILED
            : was === 1
              ? UNLIKE_FAILED
              : UNDOWN_FAILED;
      void write
        .then((result) => {
          done(result.ok ? null : result.error);
        })
        .catch((e: unknown) => {
          done(describeThrown(e, failed));
        });
    },
    [memberId, loading, error, scoreOf, announce],
  );

  const toggle = useCallback(
    (postId: string) => {
      vote(postId, 1);
    },
    [vote],
  );
  const downvote = useCallback(
    (postId: string) => {
      vote(postId, -1);
    },
    [vote],
  );

  const boost = useCallback(
    (postId: string, more: boolean) => {
      if (!isAdmin || pending.current.has(postId)) return;
      // A second boost moves the post up again, as another reply would (20261119120000).
      const again = more && (scoresRef.current.get(postId)?.boost ?? 0) > 0;
      pending.current.add(postId);
      setFailure(null);
      void boostPost(postId, more)
        .then((result) => {
          pending.current.delete(postId);
          if (!result.ok) {
            setFailure({ postId, message: result.error });
            return;
          }
          setScores((current) => {
            const was = current.get(postId);
            if (!was) return current;
            const next = new Map(current);
            // Not in the score (20261118195000): only the order and the label move.
            next.set(postId, { ...was, boost: result.value });
            return next;
          });
          announce(more ? (again ? 'Boosted again.' : 'Boosted.') : 'Boost removed.');
        })
        .catch((e: unknown) => {
          pending.current.delete(postId);
          setFailure({ postId, message: describeThrown(e, BOOST_FAILED) });
        });
    },
    [isAdmin, announce],
  );

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const loadingFor = useCallback(
    (postId: string) => loading && !known.has(postId),
    [loading, known],
  );

  return {
    byPost,
    loading,
    loadingFor,
    error: loading ? null : error,
    failure,
    toggle,
    downvote,
    boost,
    scoreOf,
    isAdmin,
    reload,
  };
}
