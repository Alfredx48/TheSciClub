import { describeError, describeThrown } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * Ask to join an invite-only event (20261127120000; the owner, 2026-11-27).
 * Asking is never an invite: its organizers approve, which invites, or
 * decline, which nobody is told about.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface JoinRequest {
  memberId: string;
  name: string;
  username: string;
  photoPath: string | null;
  askedAt: string;
}

/** 'asked', or 'invited' when they can see it already. */
export async function askToJoinEvent(eventId: string): Promise<Result<'asked' | 'invited'>> {
  const attempt = 'Your ask was not sent.';
  try {
    const { data, error } = (await getSupabase().rpc('ask_to_join_event', {
      p_event: eventId,
    })) as { data: string | null; error: { message: string; code?: string } | null };
    if (error) return { ok: false, error: describeError(error, attempt) };
    return { ok: true, value: data === 'invited' ? 'invited' : 'asked' };
  } catch (e) {
    return { ok: false, error: describeThrown(e, attempt) };
  }
}

/** Whether the member has asked to join; false if it cannot be read. */
export async function fetchMyJoinRequest(eventId: string): Promise<boolean> {
  try {
    const { data, error } = (await getSupabase().rpc('my_event_join_request', {
      p_event: eventId,
    })) as { data: unknown; error: unknown };
    return !error && data === 'asked';
  } catch {
    return false;
  }
}

/** The asks not yet answered, for the event's organizers; anyone else is refused. */
export async function fetchJoinRequests(eventId: string): Promise<Result<JoinRequest[]>> {
  const attempt = 'Could not read who asked to join.';
  try {
    const { data, error } = (await getSupabase().rpc('event_join_requests_for', {
      p_event: eventId,
    })) as {
      data:
        | {
            member_id: string;
            name: string;
            username: string;
            photo_path: string | null;
            asked_at: string;
          }[]
        | null;
      error: { message: string; code?: string } | null;
    };
    if (error) return { ok: false, error: describeError(error, attempt) };
    return {
      ok: true,
      value: (data ?? []).map((row) => ({
        memberId: row.member_id,
        name: row.name,
        username: row.username,
        photoPath: row.photo_path,
        askedAt: row.asked_at,
      })),
    };
  } catch (e) {
    return { ok: false, error: describeThrown(e, attempt) };
  }
}

/** Approve invites them (this date and, in a series, every later one); decline tells nobody. */
export async function answerJoinRequest(
  eventId: string,
  memberId: string,
  approve: boolean,
): Promise<Result<null>> {
  const attempt = 'Your answer was not saved.';
  try {
    const { error } = await getSupabase().rpc('answer_event_join_request', {
      p_event: eventId,
      p_member: memberId,
      p_approve: approve,
    });
    if (error) return { ok: false, error: describeError(error, attempt) };
    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, error: describeThrown(e, attempt) };
  }
}
