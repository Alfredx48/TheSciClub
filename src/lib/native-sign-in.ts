import { Capacitor } from '@capacitor/core';
import type { SocialLoginPlugin } from '@capgo/capacitor-social-login';
import { describeError } from '@/lib/describe-error';
import { makeNonce } from '@/lib/google-identity';
import { GOOGLE_NOT_SIGNED_IN, linkGoogleToken, signInWithGoogleToken } from '@/lib/google-sign-in';
import { hintSignIn } from '@/lib/sign-in-record';
import { isAndroidApp, isNative } from '@/lib/standalone';
import { getSupabase } from '@/lib/supabase';

/**
 * Google and iOS Apple sign-in give Supabase an ID token with a nonce: the
 * SHA-256 of a fresh random value goes to Apple or Google, which put it in
 * the token, and Supabase is given the value itself to compare.
 * Android Apple sign-in returns from the browser with a PKCE code.
 */

export interface NativeWaysIn {
  apple: boolean;
  google: boolean;
}

/** Google's iOS OAuth client, set at build time (VITE_GOOGLE_IOS_CLIENT_ID). Public. */
export function googleIosClientId(): string | null {
  const id = (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined)?.trim();
  return id && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
}

function googleAndroidWebClientId(): string | null {
  const id = (import.meta.env.VITE_GOOGLE_ANDROID_WEB_CLIENT_ID as string | undefined)?.trim();
  return id && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
}

export function nativeWaysIn(): NativeWaysIn {
  if (isAndroidApp()) {
    return {
      apple: import.meta.env.VITE_ANDROID_APPLE_SIGN_IN === 'true',
      google: googleAndroidWebClientId() !== null,
    };
  }
  if (!isNative() || Capacitor.getPlatform() !== 'ios') return { apple: false, google: false };
  return { apple: true, google: googleIosClientId() !== null };
}

let loading: Promise<SocialLoginPlugin> | null = null;

function plugin(): Promise<SocialLoginPlugin> {
  loading ??= (async () => {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    if (isAndroidApp()) {
      const webClientId = googleAndroidWebClientId();
      if (!webClientId) throw new Error('Android Google sign-in is not configured.');
      await SocialLogin.initialize({ google: { webClientId, mode: 'online' } });
      return SocialLogin;
    }
    const google = googleIosClientId();
    await SocialLogin.initialize({
      // The authorization code back, unspent, for apple-token to exchange.
      apple: { useProperTokenExchange: true },
      ...(google ? { google: { iOSClientId: google, mode: 'online' as const } } : {}),
    });
    return SocialLogin;
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

interface Credential {
  token: string;
  /** The value whose SHA-256 is in the token. */
  nonce: string;
  accessToken: string | null;
  /** Apple's one-time code, for keeping a token to revoke. */
  code: string | null;
  /** Apple gives a name only the first time. */
  name: string | null;
}

/** The plugin's code for a sheet the member closed. */
function cancelled(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'USER_CANCELLED';
}

async function askApple(): Promise<Credential> {
  const social = await plugin();
  const nonce = await makeNonce();
  // Default scopes: name and email.
  const { result } = await social.login({ provider: 'apple', options: { nonce: nonce.hashed } });
  if (!result.idToken) throw new Error('Apple gave no token.');
  const name = [result.profile.givenName, result.profile.familyName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return {
    token: result.idToken,
    nonce: nonce.raw,
    accessToken: null,
    code: result.authorizationCode ?? null,
    name: name || null,
  };
}

async function askGoogle(): Promise<Credential> {
  const social = await plugin();
  const nonce = await makeNonce();
  // forcePrompt: never a remembered sign-in, whose token has no nonce of ours.
  const { result } = await social.login({
    provider: 'google',
    options: { nonce: nonce.hashed, forcePrompt: true },
  });
  if (result.responseType !== 'online' || !result.idToken) throw new Error('Google gave no token.');
  // Google's own memory of the account is not needed: Supabase holds the session.
  void social.logout({ provider: 'google' }).catch(() => undefined);
  return {
    token: result.idToken,
    nonce: nonce.raw,
    accessToken: result.accessToken?.token ?? null,
    code: null,
    name: null,
  };
}

/** Keeps a token to revoke Apple with later (apple-token). Never fails a sign-in. */
export async function keepAppleCode(code: string): Promise<void> {
  try {
    await getSupabase().functions.invoke('apple-token', { body: { code } });
  } catch {
    // The account still works; it only cannot be revoked from here.
  }
}

/** Ok, or a sentence to show; null for a sheet the member closed. */
export type NativeResult =
  | { ok: true; name: string | null; redirected?: true }
  | { ok: false; error: string | null };

export const APPLE_NOT_SIGNED_IN = 'Apple did not sign you in. Try again, or use your email.';
export const APPLE_TAKEN =
  'That Apple ID already signs in to another member. Choose a different one.';

function hasName(metadata: Record<string, unknown> | undefined): boolean {
  return ['full_name', 'name'].some((key) => {
    const value = metadata?.[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

export async function signInWithAppleNatively(): Promise<NativeResult> {
  if (isAndroidApp()) {
    const { startAndroidApple } = await import('@/lib/android-apple-sign-in');
    return startAndroidApple('signin');
  }
  let credential: Credential;
  try {
    credential = await askApple();
  } catch (e: unknown) {
    return { ok: false, error: cancelled(e) ? null : APPLE_NOT_SIGNED_IN };
  }
  hintSignIn({ provider: 'apple' });
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.token,
    nonce: credential.nonce,
  });
  if (error) return { ok: false, error: APPLE_NOT_SIGNED_IN };
  // Kept where the website's Apple sign-in keeps it, for the name box.
  if (credential.name && !hasName(data.user.user_metadata)) {
    await supabase.auth.updateUser({ data: { full_name: credential.name } }).catch(() => null);
  }
  if (credential.code) void keepAppleCode(credential.code);
  return { ok: true, name: credential.name };
}

export async function signInWithGoogleNatively(): Promise<NativeResult> {
  let credential: Credential;
  try {
    credential = await askGoogle();
  } catch (e: unknown) {
    return { ok: false, error: cancelled(e) ? null : GOOGLE_NOT_SIGNED_IN };
  }
  const result = await signInWithGoogleToken(
    credential.token,
    credential.nonce,
    credential.accessToken ?? undefined,
  );
  return result.ok ? { ok: true, name: null } : result;
}

export async function linkAppleNatively(): Promise<NativeResult> {
  if (isAndroidApp()) {
    const { startAndroidApple } = await import('@/lib/android-apple-sign-in');
    return startAndroidApple('linked');
  }
  let credential: Credential;
  try {
    credential = await askApple();
  } catch (e: unknown) {
    return { ok: false, error: cancelled(e) ? null : 'Apple was not linked.' };
  }
  const { error } = await getSupabase().auth.linkIdentity({
    provider: 'apple',
    token: credential.token,
    nonce: credential.nonce,
  });
  if (error) {
    if (error.code === 'identity_already_exists') return { ok: false, error: APPLE_TAKEN };
    return { ok: false, error: describeError(error, 'Apple was not linked.') };
  }
  if (credential.code) await keepAppleCode(credential.code);
  return { ok: true, name: null };
}

export async function linkGoogleNatively(): Promise<NativeResult> {
  let credential: Credential;
  try {
    credential = await askGoogle();
  } catch (e: unknown) {
    return { ok: false, error: cancelled(e) ? null : 'Google was not linked.' };
  }
  const result = await linkGoogleToken(
    credential.token,
    credential.nonce,
    credential.accessToken ?? undefined,
  );
  return result.ok ? { ok: true, name: null } : result;
}
