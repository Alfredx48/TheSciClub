import type { HomeView } from '@/lib/home/types';
import { getSupabase } from '@/lib/supabase';

export const HOME_TOPIC_LIMIT = 40;

/** Reads Home's cards under the current session and its row policies. */
export async function readHomeFeed(view: HomeView, signal: AbortSignal): Promise<unknown[] | null> {
  try {
    const { data, error } = (await getSupabase()
      .rpc('home_feed', { p_show: view.show, p_sort: view.sort, max_rows: HOME_TOPIC_LIMIT })
      .abortSignal(signal)) as { data: unknown; error: unknown };
    return error || !Array.isArray(data) ? null : data;
  } catch {
    return null;
  }
}
