import { getSupabase } from '@/lib/supabase';

/**
 * Explanations shown once per account, not once per device (member_seen_explainers,
 * 20261120110000; the owner, 2026-11-20: "only show the pop-up once per Account").
 *
 * Read once a session per member. Anything that goes wrong reads as seen: a pop-up that cannot
 * be marked would otherwise come back on every tick.
 */
export type Explainer = 'anonymous' | 'not_a_question';

let loaded: { memberId: string; seen: Set<string> } | null = null;
let loading: Promise<Set<string> | null> | null = null;

async function seenNow(): Promise<Set<string> | null> {
  const supabase = getSupabase();
  const { data: session } = await supabase.auth.getSession();
  const memberId = session.session?.user.id;
  if (!memberId) return null;
  if (loaded?.memberId === memberId) return loaded.seen;
  const { data, error } = (await supabase
    .from('member_seen_explainers')
    .select('explainer')
    .eq('member_id', memberId)) as { data: { explainer: string }[] | null; error: unknown };
  if (error || !data) return null;
  loaded = { memberId, seen: new Set(data.map((row) => row.explainer)) };
  return loaded.seen;
}

/** Whether the member has not been shown it yet. False when that cannot be known. */
export async function firstTime(explainer: Explainer): Promise<boolean> {
  try {
    loading ??= seenNow().finally(() => {
      loading = null;
    });
    const seen = await loading;
    return seen !== null && !seen.has(explainer);
  } catch {
    return false;
  }
}

/** Shown: never again on this account. */
export function markSeen(explainer: Explainer): void {
  loaded?.seen.add(explainer);
  void (async () => {
    try {
      await getSupabase().from('member_seen_explainers').insert({ explainer });
    } catch {
      // Seen on this device for the session either way.
    }
  })();
}

/** For tests. */
export function forgetExplainers(): void {
  loaded = null;
  loading = null;
}
