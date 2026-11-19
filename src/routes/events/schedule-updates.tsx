import { useEffect, useState } from 'react';
import { isNative } from '@/lib/standalone';
import { getSupabase } from '@/lib/supabase';
import { longWhen, timeRange } from '@/routes/events/format';

interface ScheduleUpdate {
  event_id: string;
  title: string;
  previous_start: string;
  previous_end: string | null;
  previous_timezone: string;
  previous_all_day: boolean;
  new_start: string | null;
}

export function useScheduleUpdates(memberId: string | null, eventId?: string) {
  const key = memberId && !isNative() ? `${memberId}:${eventId ?? ''}` : null;
  const [result, setResult] = useState<{ key: string; updates: ScheduleUpdate[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    let current = true;
    void Promise.resolve()
      .then(() => getSupabase().rpc('my_event_schedule_updates', { for_event: eventId ?? null }))
      .then(({ data, error }) => {
        if (current && !error) setResult({ key, updates: (data as ScheduleUpdate[] | null) ?? [] });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [eventId, key]);
  return result?.key === key ? result.updates : [];
}

export function previousSchedule(update: ScheduleUpdate): string {
  const {
    previous_start: start,
    previous_end: end,
    previous_timezone: zone,
    previous_all_day: allDay,
  } = update;
  return [longWhen(start, zone, allDay), timeRange(start, end, zone, allDay)]
    .filter(Boolean)
    .join(' · ');
}

export function CancelledEvent({ update }: { update: ScheduleUpdate }) {
  return (
    <div className="mb-3">
      <h1 className="font-bold text-ink">This date was canceled</h1>
      <p className="mt-1">
        {update.title} · {previousSchedule(update)}
      </p>
      <p className="mt-1">Remove this date from your personal calendar if you added it.</p>
    </div>
  );
}
