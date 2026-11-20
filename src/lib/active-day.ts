import { getSupabase } from '@/lib/supabase';

/**
 * Notes each Pacific day a member uses the club (note_active_day,
 * 20261121030000), on their first press or keystroke of it, for the streaks
 * that earn Wheelie points. The day is the club's day, as everywhere else, so
 * midnight in California starts a new one wherever the member is.
 *
 * Kept as "account|day", so a second account signed in on the same device the
 * same day is noted too. Silent: a failure tries again on the next press.
 */

const KEY = 'club:active-day';

export function pacificDay(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function noted(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(value: string | null) {
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    // Private browsing: the database keeps one row a day whatever is sent.
  }
}

/** Started once from main.tsx, outside React, beside the device check. */
export function startActiveDay(now: () => Date = () => new Date()): () => void {
  let asking = false;
  const supabase = getSupabase();
  // Another account: its day has not been noted, whatever this device says.
  const { data: watch } = supabase.auth.onAuthStateChange((_event, session) => {
    const who = session?.user.id ?? null;
    const was = noted();
    if (was && (!who || !was.startsWith(`${who}|`))) remember(null);
  });

  function onAction() {
    const day = pacificDay(now());
    if (asking || noted()?.endsWith(`|${day}`)) return;
    asking = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const who = data.session?.user.id;
      if (!who) return;
      const result = (await supabase.rpc('note_active_day')) as { data: unknown; error: unknown };
      if (!result.error && result.data === true) remember(`${who}|${day}`);
    })()
      .catch(() => undefined)
      .finally(() => {
        asking = false;
      });
  }
  // Kept listening: the app can stay open past midnight.
  window.addEventListener('pointerdown', onAction, true);
  window.addEventListener('keydown', onAction, true);
  return () => {
    watch.subscription.unsubscribe();
    window.removeEventListener('pointerdown', onAction, true);
    window.removeEventListener('keydown', onAction, true);
  };
}
