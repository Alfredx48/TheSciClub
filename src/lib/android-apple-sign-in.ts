import { Browser } from '@capacitor/browser';
import { keepAppleRefreshToken } from '@/lib/apple-web-token';
import type { NativeResult } from '@/lib/native-sign-in';
import { hintSignIn } from '@/lib/sign-in-record';
import { getSupabase } from '@/lib/supabase';

const CALLBACK = 'com.thesciclub.app://auth/apple';
const PENDING_KEY = 'club:android-apple';
const CALLBACK_WINDOW_MS = 30 * 60_000;

type Intent = 'signin' | 'linked';
interface Pending {
  intent: Intent;
  attempt: string;
  flowId: string;
  userId: string | null;
  joinQuery: string;
  startedAt: number;
}

export function androidAppleCallback(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.href.split(/[?#]/, 1)[0] === CALLBACK ? url : null;
  } catch {
    return null;
  }
}

function pendingKey(): string {
  const project = import.meta.env.VITE_SUPABASE_URL as string;
  return `${PENDING_KEY}:${project}`;
}

export async function startAndroidApple(intent: Intent): Promise<NativeResult> {
  const error = intent === 'signin' ? 'Could not reach Apple.' : 'Apple was not linked.';
  try {
    const { auth } = getSupabase();
    const session = await auth.getSession();
    const userId = session.data.session?.user.id ?? null;
    if (session.error || (intent === 'linked' && !userId)) return { ok: false, error };

    const attempt = crypto.randomUUID();
    const options = { redirectTo: `${CALLBACK}?attempt=${attempt}`, skipBrowserRedirect: true };
    const result =
      intent === 'signin'
        ? await auth.signInWithOAuth({ provider: 'apple', options })
        : await auth.linkIdentity({ provider: 'apple', options });
    if (result.error || !result.data.url || !result.data.flowId) return { ok: false, error };

    const pending: Pending = {
      intent,
      attempt,
      userId,
      flowId: result.data.flowId,
      joinQuery: window.location.search,
      startedAt: Date.now(),
    };
    localStorage.setItem(pendingKey(), JSON.stringify(pending));
    try {
      await Browser.open({ url: result.data.url });
    } catch {
      localStorage.removeItem(pendingKey());
      return { ok: false, error };
    }
    return { ok: true, name: null, redirected: true };
  } catch {
    return { ok: false, error };
  }
}

/** Take only the code for a redirect this app started. */
export async function finishAndroidApple(url: URL): Promise<string | null> {
  const code = url.searchParams.get('code');
  const failed =
    url.searchParams.has('error') || new URLSearchParams(url.hash.slice(1)).has('error');
  if (!code && !failed) return null;

  const key = pendingKey();
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const pending = JSON.parse(raw) as Pending;
  if (url.searchParams.get('attempt') !== pending.attempt) return null;
  localStorage.removeItem(key);
  if (Date.now() - pending.startedAt >= CALLBACK_WINDOW_MS) return null;

  const client = getSupabase();
  const { data, error } = await client.auth.getSession();
  if (error || (data.session?.user.id ?? null) !== pending.userId) return null;

  let completed = false;
  if (code && !failed) {
    if (pending.intent === 'signin') hintSignIn({ provider: 'apple' });
    const exchange = await client.auth.exchangeCodeForSession(code, { flowId: pending.flowId });
    completed = !exchange.error;
    const token = exchange.data.session?.provider_refresh_token;
    if (token) await keepAppleRefreshToken(client, token);
  }

  if (pending.intent === 'linked') return '/me?tab=account&apple=linked';
  const query = new URLSearchParams(pending.joinQuery);
  if (!completed) query.set('apple', 'signin');
  return `/join?${query}`;
}
