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
