import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The website's half of revoking Sign in with Apple (App Store guideline
 * 5.1.1(v); 20261022160000). Back from Apple's redirect, the session carries
 * Apple's own refresh token, once; it goes to the `apple-token` edge
 * function, which checks it with Apple and keeps it where nobody can read
 * it, so deleting the account or unlinking Apple can revoke it.
 *
 * Called as the client is made, like watchSignIns. Best effort: nothing
 * waits on it. The store app keeps its authorization code instead
 * (native-sign-in.ts).
 */

/** APPLE_RETURN_PARAM's values (apple-sign-in.ts), which imports the client. */
const BACK_FROM_APPLE = /[?&]apple=(signin|linked)(&|$)/;

export async function keepAppleRefreshToken(client: SupabaseClient, token: string): Promise<void> {
  await client.functions
    .invoke('apple-token', { body: { refresh_token: token } })
    .catch(() => undefined);
}

export function watchForAppleRefreshToken(client: SupabaseClient): void {
  let sent: string | null = null;
  client.auth.onAuthStateChange((event, session) => {
    if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
    const token = session?.provider_refresh_token;
    if (!token || token === sent || !BACK_FROM_APPLE.test(window.location.search)) return;
    sent = token;
    // After the callback, which holds the client's lock.
    setTimeout(() => {
      void keepAppleRefreshToken(client, token);
    }, 0);
  });
}
