import { describeError } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * Admin › Invite log (the owner, 2026-11-25): every invite email sent and
 * every QR code and invite link made, newest first, from admin_invite_log
 * (20261125130000). An email says who sent it, whether it was opened, whether
 * its link was used, and the member it became; a code says who made it, when
 * and how, and who joined from it.
 */

export interface Person {
  id: string;
  name: string | null;
}

export interface EmailEntry {
  kind: 'email';
  id: string;
  at: string;
  email: string;
  name: string | null;
  /** pending, used, revoked… as invites.status keeps it. */
  status: string;
  /** A member who sent it; null for an organization's, or a sender since gone. */
  sentBy: Person | null;
  organization: string | null;
  event: { id: string; title: string } | null;
  openedAt: string | null;
  linkOpenedAt: string | null;
  /** An account was made from the link. */
  accountAt: string | null;
  /** The member that account became. */
  member: (Person & { joinedAt: string }) | null;
}

export interface CodeEntry {
  kind: 'code';
  id: string;
  at: string;
  /** Null when its maker is no longer in the club. */
  madeBy: Person | null;
  /** The button on Me, both, or a shared post's; null for a code made before 20261125120000. */
  madeAs: 'qr' | 'link' | 'qr_and_link' | 'share' | null;
  organization: string | null;
  event: string | null;
  post: { id: string; roomId: string; title: string } | null;
  expiresAt: string | null;
  turnedOffAt: string | null;
  /** Who joined from it, oldest first. */
  joined: (Person & { joinedAt: string })[];
}

export type LogEntry = EmailEntry | CodeEntry;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function person(v: unknown): Person | null {
  if (!isRecord(v) || typeof v.id !== 'string') return null;
  return { id: v.id, name: text(v.name) };
}

function joiner(v: unknown): (Person & { joinedAt: string }) | null {
  const p = person(v);
  if (!p || !isRecord(v) || typeof v.joinedAt !== 'string') return null;
  return { ...p, joinedAt: v.joinedAt };
}

const MADE_AS = new Set(['qr', 'link', 'qr_and_link', 'share']);

/** One row as the database sends it; null for anything that does not read. */
export function toEntry(row: unknown): LogEntry | null {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.at !== 'string') return null;
  if (row.kind === 'email') {
    const event = isRecord(row.event) && typeof row.event.id === 'string' ? row.event : null;
    return {
      kind: 'email',
      id: row.id,
      at: row.at,
      email: text(row.email) ?? '',
      name: text(row.name),
      status: text(row.status) ?? '',
      sentBy: person(row.sentBy),
      organization: text(row.organization),
      event: event ? { id: String(event.id), title: text(event.title) ?? 'An event' } : null,
      openedAt: text(row.openedAt),
      linkOpenedAt: text(row.linkOpenedAt),
      accountAt: text(row.accountAt),
      member: joiner(row.member),
    };
  }
  if (row.kind === 'code') {
    const post =
      isRecord(row.post) && typeof row.post.id === 'string' && typeof row.post.roomId === 'string'
        ? { id: row.post.id, roomId: row.post.roomId, title: text(row.post.title) ?? 'A post' }
        : null;
    const madeAs = text(row.madeAs);
    return {
      kind: 'code',
      id: row.id,
      at: row.at,
      madeBy: person(row.madeBy),
      madeAs: madeAs && MADE_AS.has(madeAs) ? (madeAs as CodeEntry['madeAs']) : null,
      organization: text(row.organization),
      event: text(row.event),
      post,
      expiresAt: text(row.expiresAt),
      turnedOffAt: text(row.turnedOffAt),
      joined: Array.isArray(row.joined)
        ? row.joined.map(joiner).filter((j): j is NonNullable<typeof j> => j !== null)
        : [],
    };
  }
  return null;
}

export async function fetchInviteLog(): Promise<
  { ok: true; entries: LogEntry[] } | { ok: false; error: string }
> {
  const failed = 'Could not load the invite log.';
  try {
    const { data, error } = (await getSupabase().rpc('admin_invite_log', {})) as {
      data: unknown;
      error: Parameters<typeof describeError>[0] | null;
    };
    if (error) return { ok: false, error: describeError(error, failed) };
    const rows = Array.isArray(data) ? data : [];
    return {
      ok: true,
      entries: rows.map(toEntry).filter((e): e is LogEntry => e !== null),
    };
  } catch {
    return { ok: false, error: failed };
  }
}
