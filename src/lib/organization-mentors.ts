import { useEffect, useState } from 'react';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { useKeptRead } from '@/lib/kept-reads';
import { toOrganizationMark } from '@/lib/members';
import { directoryChanged } from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';
import type { RepresentedOrganization } from '@/types/domain';

/**
 * Mentors are an organization's (20261028000000, the owner, 2026-10-28): an
 * organization's admins make them, and club administrators may for any. The
 * database checks who may; these only ask.
 */

export async function grantMentor(
  organizationId: string,
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getSupabase().rpc('grant_mentor', {
      organization: organizationId,
      member: memberId,
    });
    if (!error) directoryChanged();
    return error
      ? { ok: false, error: describeError(error, 'They were not made a mentor.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'They were not made a mentor.') };
  }
}

export async function revokeMentor(
  organizationId: string,
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getSupabase().rpc('revoke_mentor', {
      organization: organizationId,
      member: memberId,
    });
    if (!error) directoryChanged();
    return error
      ? { ok: false, error: describeError(error, 'They are still a mentor.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'They are still a mentor.') };
  }
}

/** Out of the organization, as if they left; a mentor stops (20261103090000). */
export async function removeOrganizationPerson(
  organizationId: string,
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getSupabase().rpc('remove_organization_person', {
      p_organization: organizationId,
      p_member: memberId,
    });
    if (!error) directoryChanged();
    return error
      ? { ok: false, error: describeError(error, 'They were not removed.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'They were not removed.') };
  }
}

/** The organizations whose mentor the signed-in member is, for Me. Empty on failure. */
export function useMyMentorOrganizations(memberId: string | null): RepresentedOrganization[] {
  const [organizations, setOrganizations] = useState<RepresentedOrganization[]>([]);
  const kept = useKeptRead();

  useEffect(() => {
    if (!memberId) {
      setOrganizations([]);
      return;
    }
    // A kept tab shown again within the minute (lib/kept-reads.ts).
    if (kept.fresh(memberId)) return;
    const landed = kept.start(memberId);
    const controller = new AbortController();
    const aborted = () => controller.signal.aborted;
    void (async () => {
      try {
        const { data, error } = (await getSupabase()
          .rpc('my_mentor_organizations')
          .abortSignal(controller.signal)) as {
          data: Parameters<typeof toOrganizationMark>[0][] | null;
          error: Failure | null;
        };
        if (aborted()) return;
        setOrganizations(error ? [] : (data ?? []).map(toOrganizationMark));
        if (!error) landed();
      } catch {
        if (aborted()) return;
        setOrganizations([]);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [memberId, kept]);

  return organizations;
}

/**
 * Marks the inviter's own pending invites so whoever joins on them becomes a
 * mentor of the organization each is for (20261119200000, the owner,
 * 2026-11-19). Before the emails go: all of them or none.
 */
export async function setInvitesMentor(
  inviteIds: string[],
  mentor: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (inviteIds.length === 0) return { ok: true };
  try {
    const { error } = await getSupabase().rpc('set_invites_mentor', {
      p_invites: inviteIds,
      p_mentor: mentor,
    });
    return error
      ? { ok: false, error: describeError(error, 'They were not invited as mentors.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'They were not invited as mentors.') };
  }
}
