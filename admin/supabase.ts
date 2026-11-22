import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The admin site's own Supabase client (the owner, 2026-11-22: admin.thesciclub.com "will load if
 * the app itself goes down"). The admin site's build points '@/lib/supabase' here
 * (vite.admin.config.ts), so the Stats and Speed & logs screens it shares with the app read
 * through a plain client: none of the app's page-speed timing, sign-in records or link handling.
 * Its own origin keeps its own session; signing in here does not sign the app in or out.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  // A sign-in link is read from the address: the test project's email carries one, not a code
  // (its default email provider cannot have the code template).
  client = createClient(url, key, { auth: { detectSessionInUrl: true } });
  return client;
}
