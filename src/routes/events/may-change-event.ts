import { useEffect, useState } from 'react';
import type { Failure } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';
import { mayChangeEvent } from '@/routes/events/event-draft';
import type { ClubEvent } from '@/types/domain';

/**
 * Whether the viewer may change this event. Every member may add one in their
 * own name (20261123130000), and who added it is not read by the app, so for
 * an event no organization hosts the database is asked (may_change_event).
 * Not the permission check, which every write makes again: this only chooses
 * what to draw. `known` is false until the answer is in.
 */
export function useMayChangeEvent(
  event: ClubEvent | null,
  member: boolean,
  isAdmin: boolean,
  myOrganizations: Set<string>,
): { may: boolean; known: boolean } {
  const plain = !!event && member && mayChangeEvent(event, isAdmin, myOrganizations);
  const ask = !!event && member && !plain && event.handAdded && event.organizationId === null;
  const askId = ask ? event.id : null;
  const [answer, setAnswer] = useState<{ id: string; may: boolean } | null>(null);

  useEffect(() => {
    if (!askId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = (await getSupabase()
          .rpc('may_change_event', { event: askId })
          .abortSignal(controller.signal)) as { data: boolean | null; error: Failure | null };
        if (controller.signal.aborted) return;
        setAnswer({ id: askId, may: !error && data === true });
      } catch {
        if (controller.signal.aborted) return;
        setAnswer({ id: askId, may: false });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [askId]);

  if (askId === null) return { may: plain, known: true };
  if (answer?.id !== askId) return { may: false, known: false };
  return { may: answer.may, known: true };
}
