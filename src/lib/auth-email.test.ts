import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown[] }[],
  error: null as { message: string; code?: string; status?: number } | null,
  invoked: [] as { name: string; body: unknown }[],
  created: false,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    functions: {
      invoke: (name: string, options: { body: unknown }) => {
        auth.invoked.push({ name, body: options.body });
        return Promise.resolve({ data: { created: auth.created }, error: null });
      },
    },
    auth: new Proxy(
      {},
      {
        get:
          (_target, fn: string) =>
          (...args: unknown[]) => {
            auth.calls.push({ fn, args });
            return Promise.resolve({ data: { user: null }, error: auth.error });
          },
      },
    ),
  }),
}));

const {
  NOT_INVITED_MESSAGE,
  cleanEmail,
  looksLikeEmail,
  resendConfirmation,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
} = await import('@/lib/auth-email');

beforeEach(() => {
  auth.calls = [];
  auth.error = null;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/join');
});

describe('addresses', () => {
  it('trims and lowercases, so the invite and the account compare equal', () => {
    expect(cleanEmail('  Dana@Example.COM ')).toBe('dana@example.com');
  });

  it('knows an address from a word', () => {
    expect(looksLikeEmail('dana@example.com')).toBe(true);
    expect(looksLikeEmail(' dana@example.com ')).toBe(true);
    expect(looksLikeEmail('dana@example')).toBe(false);
    expect(looksLikeEmail('dana example.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });
});

describe('signUpWithEmail', () => {
  it('has the confirmation link return to /join, remembering where they were headed', async () => {
    window.history.replaceState(null, '', '/join?next=%2Fchat%2Ft%2Fshared');
    const result = await signUpWithEmail(' Dana@Example.com', 'a long password');

    expect(result).toEqual({ ok: true });
    const { fn, args } = auth.calls[0] ?? { fn: '', args: [] as unknown[] };
    expect(fn).toBe('signUp');
    const request = args[0] as { email: string; options: { emailRedirectTo: string } };
    expect(request.email).toBe('dana@example.com');
    const redirect = new URL(request.options.emailRedirectTo);
    expect(redirect.pathname).toBe('/join');
    expect(redirect.searchParams.get('confirmed')).toBe('1');
    expect(redirect.searchParams.get('next')).toBe('/chat/t/shared');
  });

  it('gives a sentence when it is refused', async () => {
    auth.error = { message: 'Signups not allowed', code: 'signup_disabled' };
    const result = await signUpWithEmail('dana@example.com', 'a long password');
    expect(result.ok).toBe(false);
  });

  it('sends the held invite token, so a link opened at another address still joins', async () => {
    window.localStorage.setItem('sciclub.inviteToken', 'the-token');
    await signUpWithEmail('dana@example.com', 'a long password');
    const request = auth.calls[0]?.args[0] as { options: { data?: { invite_token?: string } } };
    expect(request.options.data).toEqual({ invite_token: 'the-token' });
  });

  it('sends no metadata when there is no invite link', async () => {
    await signUpWithEmail('dana@example.com', 'a long password');
    const request = auth.calls[0]?.args[0] as { options: { data?: unknown } };
    expect(request.options.data).toBeUndefined();
  });

  it("names the hook's refusal as not invited", async () => {
    auth.error = { message: NOT_INVITED_MESSAGE, code: 'unknown', status: 403 };
    const result = await signUpWithEmail('dana@example.com', 'a long password');
    expect(result).toEqual({ ok: false, error: NOT_INVITED_MESSAGE, notInvited: true });
  });

  it('does not call any other 403 not invited', async () => {
    auth.error = {
      message: 'Signups not allowed for this instance',
      code: 'signup_disabled',
      status: 403,
    };
    const result = await signUpWithEmail('dana@example.com', 'a long password');
    expect(result).not.toHaveProperty('notInvited');
    expect(result.ok).toBe(false);
  });
});

// The owner, 2026-11-10: an invited address, or anybody while joining is open.
it('asks the server first with no link or code, and signs in when it made the account', async () => {
  auth.invoked = [];
  auth.created = true;
  window.localStorage.removeItem('sciclub.inviteToken');
  window.localStorage.removeItem('sciclub.qrCode');
  expect(await signUpWithEmail('dana@example.com', 'a long password')).toEqual({
    ok: true,
    signedIn: true,
  });
  expect(auth.invoked[0]?.body).toMatchObject({ token: null, code: null });
  expect(auth.calls.map((call) => call.fn)).toEqual(['signInWithPassword']);
  auth.created = false;
});

describe('signing up from an emailed invite', () => {
  beforeEach(() => {
    auth.calls = [];
    auth.invoked = [];
    auth.created = false;
    auth.error = null;
    window.localStorage.setItem('sciclub.inviteToken', 'tok');
  });

  it('signs in straight away when the server made the account', async () => {
    auth.created = true;
    expect(await signUpWithEmail('sam@example.com', 'long enough')).toEqual({
      ok: true,
      signedIn: true,
    });
    expect(auth.invoked[0]).toEqual({
      name: 'invite-signup',
      body: { email: 'sam@example.com', password: 'long enough', token: 'tok', code: null },
    });
    expect(auth.calls.map((call) => call.fn)).toEqual(['signInWithPassword']);
    window.localStorage.removeItem('sciclub.inviteToken');
  });

  it('goes on to the ordinary sign-up otherwise', async () => {
    expect(await signUpWithEmail('other@example.com', 'long enough')).toEqual({ ok: true });
    expect(auth.calls.map((call) => call.fn)).toEqual(['signUp']);
    window.localStorage.removeItem('sciclub.inviteToken');
  });
});

describe('signing up from a code', () => {
  it('goes straight in, and carries the code on the ordinary sign-up too', async () => {
    auth.calls = [];
    auth.invoked = [];
    auth.error = null;
    window.localStorage.removeItem('sciclub.inviteToken');
    window.localStorage.setItem('sciclub.qrCode', 'abc');

    auth.created = true;
    expect(await signUpWithEmail('sam@example.com', 'long enough')).toEqual({
      ok: true,
      signedIn: true,
    });
    expect(auth.invoked[0]?.body).toMatchObject({ token: null, code: 'abc' });

    auth.created = false;
    auth.calls = [];
    await signUpWithEmail('sam@example.com', 'long enough');
    expect(auth.calls[0]?.args[0]).toMatchObject({ options: { data: { qr_code: 'abc' } } });
    window.localStorage.removeItem('sciclub.qrCode');
  });
});

describe('signInWithEmail', () => {
  it('is ok when Supabase is', async () => {
    expect(await signInWithEmail('Dana@example.com', 'pw')).toEqual({ ok: true });
    expect(auth.calls[0]).toEqual({
      fn: 'signInWithPassword',
      args: [{ email: 'dana@example.com', password: 'pw' }],
    });
  });

  it('gives one sentence for a wrong password and an unknown address', async () => {
    auth.error = { message: 'Invalid login credentials', code: 'invalid_credentials' };
    expect(await signInWithEmail('a@example.com', 'pw')).toEqual({
      ok: false,
      error: 'That email and password did not match.',
    });
  });

  it('flags an unconfirmed address, so the page can offer the link again', async () => {
    auth.error = { message: 'Email not confirmed', code: 'email_not_confirmed' };
    const result = await signInWithEmail('a@example.com', 'pw');
    expect(result).toMatchObject({ ok: false, unconfirmed: true });
  });
});

describe('in the store app', () => {
  it('has every emailed link come back to thesciclub.com, keeping its path', async () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      window.history.replaceState(null, '', '/join?next=%2Fchat%2Ft%2Fshared');
      await signUpWithEmail('dana@example.com', 'a long password');
      await resendConfirmation('dana@example.com');
      await sendPasswordReset('dana@example.com');
      const sent = (i: number): unknown[] => auth.calls[i]?.args ?? [];
      const up = sent(0)[0] as { options: { emailRedirectTo: string } };
      const again = sent(1)[0] as { options: { emailRedirectTo: string } };
      const reset = sent(2)[1] as { redirectTo: string };
      expect(up.options.emailRedirectTo).toMatch(
        /^https:\/\/thesciclub\.com\/join\?confirmed=1&next=/,
      );
      expect(again.options.emailRedirectTo).toMatch(/^https:\/\/thesciclub\.com\/join\?/);
      expect(reset.redirectTo).toBe('https://thesciclub.com/reset-password');
    } finally {
      native.mockRestore();
    }
  });
});

describe('sendPasswordReset', () => {
  it('has the link return to /reset-password', async () => {
    expect(await sendPasswordReset(' Dana@Example.com ')).toEqual({ ok: true });
    const { fn, args } = auth.calls[0] ?? { fn: '', args: [] as unknown[] };
    expect(fn).toBe('resetPasswordForEmail');
    expect(args[0]).toBe('dana@example.com');
    expect((args[1] as { redirectTo: string }).redirectTo).toMatch(/\/reset-password$/);
  });
});

describe('resendConfirmation', () => {
  it('asks for another signup link to the same address', async () => {
    expect(await resendConfirmation('Dana@Example.com')).toEqual({ ok: true });
    const { fn, args } = auth.calls[0] ?? { fn: '', args: [] as unknown[] };
    expect(fn).toBe('resend');
    expect(args[0]).toMatchObject({ type: 'signup', email: 'dana@example.com' });
  });
});
