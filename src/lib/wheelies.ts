import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Wheelie points (20261121030000; the owner's 2-pager, 2026-11-20): what a
 * member has earned for taking part, shown as a wheel beside their name. Its
 * colour is their level; its seven spokes fill one at a time on the way to the
 * next, and when all seven would be full the wheel takes the next colour and
 * they start over.
 */

export interface WheelLevel {
  level: number;
  /** "Yellow green": said beside the colour, so it is never the only sign. */
  name: string;
  /** Points from which a member is at this level. */
  from: number;
}

/** The 2-pager's first proposal: green through orange and red to dark purple. */
export const WHEEL_LEVELS: readonly WheelLevel[] = [
  { level: 1, name: 'Green', from: 0 },
  { level: 2, name: 'Yellow green', from: 100 },
  { level: 3, name: 'Amber', from: 250 },
  { level: 4, name: 'Orange', from: 500 },
  { level: 5, name: 'Red orange', from: 1000 },
  { level: 6, name: 'Red', from: 2000 },
  { level: 7, name: 'Magenta', from: 3500 },
  { level: 8, name: 'Purple', from: 5000 },
  { level: 9, name: 'Violet', from: 7500 },
  { level: 10, name: 'Dark purple', from: 10000 },
];

export const SPOKES = 7;

export interface Wheel {
  points: number;
  level: WheelLevel;
  /** The next level, or null at the top. */
  next: WheelLevel | null;
  /** Spokes filled, 0 to 6 on the way to the next level; all 7 at the top. */
  spokes: number;
}

export function wheelOf(points: number): Wheel {
  const earned = Math.max(0, Math.floor(points));
  let level: WheelLevel = { level: 1, name: 'Green', from: 0 };
  let next: WheelLevel | null = null;
  for (const [i, each] of WHEEL_LEVELS.entries()) {
    if (earned < each.from) break;
    level = each;
    next = WHEEL_LEVELS[i + 1] ?? null;
  }
  const spokes = next
    ? Math.min(SPOKES - 1, Math.floor(((earned - level.from) / (next.from - level.from)) * SPOKES))
    : SPOKES;
  return { points: earned, level, next, spokes };
}

/** "1,250" */
export function pointsInWords(points: number): string {
  return points.toLocaleString('en-US');
}

// ------------------------------------------------------------ the totals --

/**
 * Everybody's total, read in one go: the club is hundreds of members, and a
 * wheel is drawn beside nearly every name. The database works them out again
 * every five minutes, so they are kept that long here.
 */
const KEEP_MS = 5 * 60 * 1000;

let kept: { at: number; points: Map<string, number> } | null = null;
let reading: Promise<Map<string, number> | null> | null = null;
const listeners = new Set<(points: Map<string, number>) => void>();

async function readAll(): Promise<Map<string, number> | null> {
  const { data, error } = (await getSupabase()
    .from('member_wheelies')
    .select('member_id, points')) as {
    data: { member_id: string; points: number }[] | null;
    error: unknown;
  };
  // Not there yet (a database before 20261121030000), or signed out: no wheels.
  if (error || !data) return null;
  return new Map(data.map((row) => [row.member_id, row.points]));
}

function load(): Promise<Map<string, number> | null> {
  if (kept && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.points);
  reading ??= readAll()
    .then((points) => {
      if (points) {
        kept = { at: Date.now(), points };
        for (const listener of listeners) listener(points);
      }
      return points;
    })
    .catch(() => null)
    .finally(() => {
      reading = null;
    });
  return reading;
}

/** Signing out, or into another account. */
export function forgetWheelies(): void {
  kept = null;
}

/** A member's points, or null until read (and for anybody without a wheel). */
export function useWheeliePoints(memberId: string | null | undefined): number | null {
  const [points, setPoints] = useState<Map<string, number> | null>(() => kept?.points ?? null);
  useEffect(() => {
    let live = true;
    const listener = (next: Map<string, number>) => {
      if (live) setPoints(next);
    };
    listeners.add(listener);
    void load().then((found) => {
      if (live && found) setPoints(found);
    });
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  if (!memberId || !points) return null;
  return points.get(memberId) ?? null;
}

// ------------------------------------------------- one member's, taken apart --

/** What one post of theirs earned (public.member_wheelie_points). */
export interface WheeliePost {
  postId: string;
  topicId: string;
  roomId: string;
  title: string;
  isQuestion: boolean;
  /** The post that started the topic, rather than a reply in it. */
  opening: boolean;
  /** Their first question, which earned 50 more. */
  first: boolean;
  at: string;
  /** For writing it: 10 for asking or posting (and the 50), 5 for a reply. */
  own: number;
  upvotes: number;
  responses: number;
  points: number;
}

export interface WheelieBreakdown {
  total: number;
  /** Points and how many times, by kind: 'rsvp', 'check_in', 'review', 'question', 'post',
   * 'first_question', 'reply', 'upvote', 'response', 'profile', 'streak'. */
  kinds: Partial<Record<string, { count: number; points: number }>>;
  /** Days in a row up to today or yesterday. */
  streak: number;
  posts: WheeliePost[];
}

interface PostRow {
  post_id: string;
  topic_id: string;
  room_id: string;
  title: string;
  is_question: boolean;
  opening: boolean | null;
  first: boolean | null;
  at: string;
  own: number;
  upvotes: number;
  responses: number;
  points: number;
}

/** Null when there is nothing to show: blocked either way, not a member who earns, or a
 * database from before 20261121050000. */
export async function loadWheelieBreakdown(memberId: string): Promise<WheelieBreakdown | null> {
  const { data, error } = (await getSupabase().rpc('member_wheelie_points', {
    p_member: memberId,
  })) as {
    data: {
      total: number;
      kinds: WheelieBreakdown['kinds'];
      streak: number;
      posts: PostRow[];
    } | null;
    error: unknown;
  };
  if (error || !data) return null;
  return {
    total: data.total,
    kinds: data.kinds,
    streak: data.streak,
    posts: data.posts.map((p) => ({
      postId: p.post_id,
      topicId: p.topic_id,
      roomId: p.room_id,
      title: p.title,
      isQuestion: p.is_question,
      opening: p.opening === true,
      first: p.first === true,
      at: p.at,
      own: p.own,
      upvotes: p.upvotes,
      responses: p.responses,
      points: p.points,
    })),
  };
}

export function useWheelieBreakdown(memberId: string | null | undefined): WheelieBreakdown | null {
  const [found, setFound] = useState<{ id: string; breakdown: WheelieBreakdown | null } | null>(
    null,
  );
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    void loadWheelieBreakdown(memberId)
      .catch(() => null)
      .then((breakdown) => {
        if (live) setFound({ id: memberId, breakdown });
      });
    return () => {
      live = false;
    };
  }, [memberId]);
  return found && found.id === memberId ? found.breakdown : null;
}

/** "one upvote", "3 upvotes". */
function counted(n: number, one: string, many: string): string {
  return n === 1 ? `one ${one}` : `${n} ${many}`;
}

/**
 * What a post earned, in words, as the 2-pager has it: "10 for asking, 30 for
 * three upvotes and 12 for four replies".
 */
export function postPointsInWords(post: WheeliePost): string {
  const parts: string[] = [];
  if (post.opening) {
    parts.push(`10 for ${post.isQuestion ? 'asking' : 'posting'}`);
    if (post.first) parts.push('50 for a first question');
  } else {
    parts.push(`5 for ${post.isQuestion ? 'answering' : 'commenting'}`);
  }
  if (post.upvotes)
    parts.push(`${post.upvotes * 10} for ${counted(post.upvotes, 'upvote', 'upvotes')}`);
  if (post.responses)
    parts.push(
      `${post.responses * 3} for ${counted(post.responses, 'reply or reaction', 'replies and reactions')}`,
    );
  const last = parts.pop() ?? '';
  return parts.length ? `${parts.join(', ')} and ${last}` : last;
}

// ------------------------------------------------------- the leaderboard --

export interface Placing {
  memberId: string;
  rank: number;
  points: number;
}

export interface Leaderboard {
  /** The Pacific month, "2026-11-01". */
  month: string;
  top: Placing[];
  /** The reader's own place, or null before they have earned any this month. */
  me: { rank: number; points: number } | null;
}

export interface HallMonth {
  month: string;
  winners: Placing[];
}

/** This month's leaderboard and the Hall of Top Wheelies (20261121060000). */
export async function loadLeaderboard(): Promise<{ board: Leaderboard; hall: HallMonth[] }> {
  const supabase = getSupabase();
  const [board, hall] = (await Promise.all([
    supabase.rpc('wheelie_leaderboard'),
    supabase.rpc('wheelie_hall'),
  ])) as [
    {
      data: {
        month: string;
        top: { member_id: string; rank: number; points: number }[];
        me: { rank: number; points: number } | null;
      } | null;
      error: { message: string } | null;
    },
    {
      data: { month: string; member_id: string; rank: number; points: number }[] | null;
      error: { message: string } | null;
    },
  ];
  if (board.error || !board.data) throw new Error(board.error?.message ?? 'No leaderboard.');
  if (hall.error) throw new Error(hall.error.message);
  const months = new Map<string, Placing[]>();
  for (const row of hall.data ?? []) {
    const list = months.get(row.month) ?? [];
    list.push({ memberId: row.member_id, rank: row.rank, points: row.points });
    months.set(row.month, list);
  }
  return {
    board: {
      month: board.data.month,
      top: board.data.top.map((row) => ({
        memberId: row.member_id,
        rank: row.rank,
        points: row.points,
      })),
      me: board.data.me,
    },
    hall: [...months].map(([month, winners]) => ({ month, winners })),
  };
}

/** "November 2026", for a month given as "2026-11-01". */
export function monthInWords(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(year ?? 2026, (number ?? 1) - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/** "December 1", the day after a month given as "2026-11-01" ends. */
export function monthAfterStarts(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(year ?? 2026, number ?? 1, 1).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}
