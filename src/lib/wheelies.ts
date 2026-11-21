import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Wheelie points (20261121030000; the owner's 2-pager, 2026-11-20): what a
 * member has earned for taking part, shown as a wheel on their journey in
 * the club (the Me tab and their profile; the owner, 2026-11-20, took it off
 * names everywhere else as too loud). Its colour is their level; its thirteen spokes fill one at a time on the way to the
 * next (seven until the owner, 2026-11-21), and when all thirteen would be full the wheel takes the next colour and
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

export const SPOKES = 13;

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

/** An event that earned them points, with what for. */
export interface WheelieEvent {
  eventId: string;
  title: string;
  startTime: string;
  /** The event's own time zone, for its date. */
  timezone: string;
  allDay: boolean;
  rsvp: number;
  checkIn: number;
  review: number;
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
  /** Their longest run of days. */
  bestStreak: number;
  /** Events the reader may see. */
  events: WheelieEvent[];
  /** The parts of their profile that earned ('photo', 'q:bio' …), to the member
   * themselves; null to anybody else. */
  parts: string[] | null;
}

interface EventRow {
  event_id: string;
  title: string;
  start_time: string;
  timezone: string | null;
  all_day: boolean | null;
  rsvp: number;
  check_in: number;
  review: number;
  points: number;
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
      best_streak?: number;
      events?: EventRow[];
      parts?: string[] | null;
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
    // Absent from a database before 20261121070000.
    bestStreak: data.best_streak ?? data.streak,
    events: (data.events ?? []).map((e) => ({
      eventId: e.event_id,
      title: e.title,
      startTime: e.start_time,
      timezone: e.timezone ?? 'America/Los_Angeles',
      allDay: e.all_day === true,
      rsvp: e.rsvp,
      checkIn: e.check_in,
      review: e.review,
      points: e.points,
    })),
    parts: data.parts ?? null,
  };
}

/** A member's Wheelie points taken apart: undefined while it is read, null when there is
 * nothing to show. */
export function useWheelieBreakdown(
  memberId: string | null | undefined,
): WheelieBreakdown | null | undefined {
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
  if (!memberId) return null;
  return found?.id === memberId ? found.breakdown : undefined;
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
