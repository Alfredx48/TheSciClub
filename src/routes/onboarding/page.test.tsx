import { Capacitor } from '@capacitor/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NativeSignInModule from '@/lib/native-sign-in';
import type * as ProgressModule from '@/routes/onboarding/progress';

/**
 * Joining and signing in by email.
 *
 * What is worth proving here is the order: nobody is told whether an address
 * is on the list until they are signed in, the invite link is claimed before
 * the list is consulted, and every way in ends at the same check.
 */

const calls = vi.hoisted(() => {
  const account = (): { email: string; user_metadata: Record<string, unknown> } => ({
    email: 'dana@example.com',
    user_metadata: {},
  });
  return {
    account,
    order: [] as string[],
    listeners: new Set<() => void>(),
    status: 'signed-out',
    /** What a successful password sign-in makes the account: a stranger to the club, or a member. */
    afterPassword: 'signed-up',
    passwordError: null as { message: string; code?: string; status?: number } | null,
    signUpError: null as { message: string; code?: string; status?: number } | null,
    signUpExisting: false,
    resendError: null as { message: string; code?: string } | null,
    resendHold: null as Promise<void> | null,
    resetError: null as { message: string; code?: string } | null,
    signUpOptions: null as { emailRedirectTo?: string } | null,
    resetRedirect: null as string | null,
    /** The signed-in account, as the session shows it. */
    user: account(),
    invited: true,
    /** Whether anybody can join (20261014000000): only what the doors say. */
    joiningOpen: false,
    /** The terms version this account agreed to (20261029080000); null is none yet. */
    termsAgreed: null as string | null,
    /** The versions agree_to_terms was sent, in turn. */
    agreedTo: [] as string[],
    agreeError: false,
    /** What qr_code_details answers for a held administrator's code; null says nothing. */
    qrDetails: null as Record<string, unknown> | null,
    claimResult: true,
    claimError: false,
    claimedWith: null as string | null,
    /** What the club says the held link was sent to; null is any token that is not a live one. */
    inviteAddress: null as string | null,
    // From the registration a guest-list invite was sent from (20261104000000).
    inviteGuest: null as { name: string; phone: string; event_id: string } | null,
    addressError: false,
    addressAskedWith: null as string | null,
    /** Holds the answer back until a test lets it go, to type first. */
    addressGate: null as Promise<void> | null,
    /** Usernames the club says are taken. */
    taken: [] as string[],
    suggestions: ['dana', 'dana.s', 'dana_s'] as string[],
    checked: [] as string[],
    submitted: null as Record<string, unknown> | null,
    /** What each submit answers, in turn; ok when the list runs out. */
    submitResults: [] as {
      ok: boolean;
      error?: string;
      photoRefused?: boolean;
      usernameRefused?: boolean;
    }[],
    /** Null is the club unable to send, which is the default for these tests. */
    vapidKey: null as string | null,
    notificationState: 'off',
    /** Whether Google's script loaded; 'unavailable' shows the club's button. */
    widget: 'unavailable',
    onToken: null as ((token: string, nonce: string) => void) | null,
    promptAsked: false,
    idTokenError: null as string | null,
    passkeyError: null as { name?: string; message: string } | null,
    /** The signed-in account's passkeys, as passkey.list() reads them. */
    passkeys: [] as { id: string; created_at: string }[],
    setStatus(next: string) {
      calls.status = next;
      for (const listener of calls.listeners) listener();
    },
  };
});

vi.mock('@/lib/google-identity', () => ({
  useGoogleButton: ({
    onToken,
    prompt,
  }: {
    onToken: (token: string, nonce: string) => void;
    prompt?: boolean;
  }) => {
    calls.onToken = onToken;
    calls.promptAsked = Boolean(prompt);
    return { ref: { current: null }, state: calls.widget };
  },
}));

vi.mock('@/lib/organizations', () => ({
  useOrganizations: () => ({
    organizations: [
      {
        id: 'ncs',
        shortCode: 'NCS',
        name: 'NorCal SCI',
        city: 'Northern California',
        description: 'Peer mentoring, support groups and a regional events calendar.',
        tags: [],
        canInvite: true,
        logoPath: null,
      },
      {
        id: 'wwm',
        shortCode: 'WWM',
        name: 'Wheel with Me Foundation',
        city: 'East Bay',
        description: 'Grants and adaptive sport programming.',
        tags: [],
        canInvite: false,
        logoPath: null,
      },
    ],
    byId: new Map(),
    loading: false,
    error: null,
  }),
}));

// The insert itself is covered by submit-onboarding's own tests; what this
// file cares about is which answers reach it.
vi.mock('@/routes/onboarding/submit-onboarding', () => ({
  submitOnboarding: (data: Record<string, unknown>) => {
    calls.submitted = data;
    return Promise.resolve(calls.submitResults.shift() ?? { ok: true });
  },
}));

// A real subscription, so an account that changes while the page is open
// (a sign-in that succeeds) reaches the screen as it does in the app.
vi.mock('@/lib/account', async () => {
  const { useEffect, useReducer } = await import('react');
  return {
    useAccount: () => {
      const [, bump] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        calls.listeners.add(bump);
        return () => {
          calls.listeners.delete(bump);
        };
      }, []);
      return {
        status: calls.status,
        userId: calls.status === 'signed-out' ? null : 'user-1',
        isAdmin: false,
        displayName: null,
      };
    },
    signOut: () => {
      calls.order.push('signOut');
      calls.setStatus('signed-out');
      return Promise.resolve({ ok: true });
    },
  };
});

// Where an account left off (progress.ts has its own tests): what this file
// cares about is that the wizard opens there, and keeps each step as it goes.
const progress = vi.hoisted(() => ({
  saved: null as null | { step: string; answers: Record<string, unknown>; savedAt: string },
  device: [] as string[],
  account: [] as { step: string; answers: Record<string, unknown> }[],
  forgotten: [] as string[],
}));
vi.mock('@/routes/onboarding/progress', async (original) => {
  const real = await original<typeof ProgressModule>();
  return {
    ...real,
    savedProgress: () => Promise.resolve(progress.saved),
    saveOnDevice: (_user: string, step: string) => {
      progress.device.push(step);
    },
    saveToAccount: (step: string, data: Record<string, unknown>) => {
      progress.account.push({ step, answers: real.keptAnswers(data) });
      return Promise.resolve();
    },
    forgetOnDevice: (user: string) => {
      progress.forgotten.push(user);
    },
  };
});

// The device and the push service are the network; the screen's own choices
// are what is tested here. See notifications-step.tsx.
vi.mock('@/lib/push/notifications', () => ({
  vapidPublicKey: () => calls.vapidKey,
  markNotificationsAsked: () => {
    calls.order.push('asked');
  },
  useDeviceNotifications: () => ({
    state: calls.notificationState,
    busy: false,
    error: null,
    turnOn: () => {
      calls.order.push('turnOn');
    },
    turnOff: () => undefined,
  }),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      signInWithOAuth: (options: { provider: string; options?: { redirectTo?: string } }) => {
        calls.order.push(`signInWithOAuth:${options.provider}`);
        return Promise.resolve({ error: null });
      },
      signInWithIdToken: (options: { provider: string; token: string; nonce: string }) => {
        calls.order.push(`signInWithIdToken:${options.provider}:${options.token}:${options.nonce}`);
        return Promise.resolve({
          error: calls.idTokenError ? { message: calls.idTokenError } : null,
        });
      },
      getSession: () =>
        Promise.resolve({
          data: { session: { user: calls.user } },
        }),
      signInWithPassword: (credentials: { email: string; password: string }) => {
        calls.order.push(`signInWithPassword:${credentials.email}`);
        if (calls.passwordError) return Promise.resolve({ error: calls.passwordError });
        calls.setStatus(calls.afterPassword);
        return Promise.resolve({ error: null });
      },
      signUp: (credentials: {
        email: string;
        password: string;
        options?: { emailRedirectTo?: string };
      }) => {
        calls.order.push(`signUp:${credentials.email}`);
        calls.signUpOptions = credentials.options ?? null;
        return Promise.resolve({
          data: { user: calls.signUpExisting ? { identities: [] } : { identities: [{}] } },
          error: calls.signUpError,
        });
      },
      verifyOtp: (params: { email: string; token: string; type: string }) => {
        calls.order.push(`verifyOtp:${params.type}:${params.email}:${params.token}`);
        return Promise.resolve({ error: null });
      },
      resend: (options: { type: string; email: string }) => {
        calls.order.push(`resend:${options.type}:${options.email}`);
        return (calls.resendHold ?? Promise.resolve()).then(() => ({ error: calls.resendError }));
      },
      resetPasswordForEmail: (email: string, options?: { redirectTo?: string }) => {
        calls.order.push(`resetPasswordForEmail:${email}`);
        calls.resetRedirect = options?.redirectTo ?? null;
        return Promise.resolve({ error: calls.resetError });
      },
      signInWithPasskey: () => {
        calls.order.push('signInWithPasskey');
        return Promise.resolve({ error: calls.passkeyError });
      },
      registerPasskey: () => {
        calls.order.push('registerPasskey');
        return Promise.resolve({ error: calls.passkeyError });
      },
      passkey: {
        list: () => {
          calls.order.push('passkey.list');
          return Promise.resolve({ data: calls.passkeys, error: null });
        },
        startRegistration: () => {
          calls.order.push('passkey.startRegistration');
          return Promise.resolve({
            data: {
              challenge_id: 'reg',
              options: { challenge: 'aGk', user: { id: 'dXNlcg', name: 'sam' } },
              expires_at: 0,
            },
            error: null,
          });
        },
        verifyRegistration: () => {
          calls.order.push('passkey.verifyRegistration');
          return Promise.resolve({ data: {}, error: null });
        },
        startAuthentication: () => {
          calls.order.push('startAuthentication');
          return Promise.resolve({
            data: { challenge_id: 'ch', options: { challenge: 'aGk' }, expires_at: 0 },
            error: calls.passkeyError,
          });
        },
      },
    },
    // rpc() is awaited as it is, and `.single()` is chained on the one that
    // returns a row; both are the same answer here.
    rpc: (name: string, args?: Record<string, unknown>) => {
      // Asked once as the page opens, whatever happens next, so kept out of
      // the order the other tests read.
      if (name === 'joining_is_open')
        return Promise.resolve({ data: calls.joiningOpen, error: null });
      // The blocked screen's list (20261029030000), kept out of the order too.
      if (name === 'invite_request_choices')
        return Promise.resolve({
          data: [
            {
              organization_id: 'o1',
              name: 'NorCal SCI',
              short_code: 'NCS',
              logo_path: null,
              admins: [{ id: 'a1', first_name: 'Sam' }],
            },
          ],
          error: null,
        });
      // Agreeing to the terms (20261029080000), kept out of the order too.
      if (name === 'my_terms_agreement')
        return Promise.resolve({ data: calls.termsAgreed, error: null });
      if (name === 'agree_to_terms') {
        if (calls.agreeError) return Promise.resolve({ data: null, error: { message: 'offline' } });
        calls.agreedTo.push(String(args?.p_version));
        calls.termsAgreed = String(args?.p_version);
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'qr_code_details') {
        const answer = Promise.resolve({ data: calls.qrDetails, error: null });
        return Object.assign(answer, { maybeSingle: () => answer });
      }
      calls.order.push(name);
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (name === 'my_invite_status') result = { data: { invited: calls.invited }, error: null };
      if (name === 'claim_invite') {
        calls.claimedWith = String(args?.token);
        result = calls.claimError
          ? { data: null, error: { message: 'offline' } }
          : { data: calls.claimResult, error: null };
      }
      if (name === 'invite_address_for_token' || name === 'invite_details_for_token') {
        calls.addressAskedWith = String(args?.token);
        const found =
          name === 'invite_address_for_token'
            ? calls.inviteAddress
            : calls.inviteAddress === null
              ? []
              : [{ email: calls.inviteAddress, status: 'going', ...calls.inviteGuest }];
        result = calls.addressError
          ? { data: null, error: { message: 'offline' } }
          : { data: found, error: null };
        const answered = (calls.addressGate ?? Promise.resolve()).then(() => result);
        return Object.assign(answered, { single: () => answered });
      }
      if (name === 'suggest_usernames') result = { data: calls.suggestions, error: null };
      if (name === 'username_available') {
        const asked = String(args?.name);
        calls.checked.push(asked);
        result = { data: !calls.taken.includes(asked), error: null };
      }
      return Object.assign(Promise.resolve(result), { single: () => Promise.resolve(result) });
    },
  }),
}));

// The plugin's sheets: what the page does with their answer is tested here,
// the sheets themselves in lib/native-sign-in.test.ts. Which ways are offered
// stays real, from Capacitor and VITE_GOOGLE_IOS_CLIENT_ID.
const nativeSheets: { answer: NativeSignInModule.NativeResult } = vi.hoisted(() => ({
  answer: { ok: true, name: null },
}));
vi.mock('@/lib/native-sign-in', async (original) => {
  const sheet = (provider: string) => () => {
    calls.order.push(`native:${provider}`);
    if (nativeSheets.answer.ok) calls.setStatus('signed-up');
    return Promise.resolve(nativeSheets.answer);
  };
  return {
    ...(await original<typeof NativeSignInModule>()),
    signInWithAppleNatively: sheet('apple'),
    signInWithGoogleNatively: sheet('google'),
  };
});

const { default: OnboardingPage } = await import('@/routes/onboarding/page');

// Real routes, so a test can see where somebody lands: Home, since step 5
// of HANDOFF.md "What Home is". Until then it was Peers.
function renderJoin(path = '/join', state?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path.split('?')[0] ?? path,
          search: path.includes('?') ? `?${path.split('?')[1] ?? ''}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/join" element={<OnboardingPage />} />
        <Route path="/home" element={<h1>Home</h1>} />
        <Route path="/chat/t/shared" element={<h1>Shared conversation</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Signed in as an invited stranger to the club, and agreed: on the name step. */
async function reachName() {
  calls.status = 'signed-up';
  renderJoin();
  await screen.findByPlaceholderText('ex. Ajay Shenoy');
}

/** Through the name and the username, to the birthday. */
async function reachBirthday(name: string) {
  await reachName();
  await userEvent.clear(screen.getByPlaceholderText('ex. Ajay Shenoy'));
  await userEvent.type(screen.getByPlaceholderText('ex. Ajay Shenoy'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.click(await screen.findByRole('button', { name: '@dana' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('When is your birthday?');
}

/** Fills the birthday's three boxes from an ISO date, all at once. */
async function enterBirthday(iso: string) {
  const [year = '', month = '', day = ''] = iso.split('-');
  fireEvent.change(await screen.findByLabelText('Month'), { target: { value: month } });
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: day } });
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: year } });
}

/** Types an ISO date into the birthday's boxes a key at a time, as a person would. */
async function typeBirthday(iso: string) {
  const [year = '', month = '', day = ''] = iso.split('-');
  await userEvent.type(await screen.findByLabelText('Month'), month);
  await userEvent.type(screen.getByLabelText('Day'), day);
  await userEvent.type(screen.getByLabelText('Year'), year);
}

/** Fills the sign-in or join form. The join form also asks for the password twice. */
async function fillDoor(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  const again = screen.queryByLabelText('Type it again');
  if (again) await userEvent.type(again, password);
}

beforeEach(() => {
  window.localStorage.clear();
  // Most of this file is about the email box, which then starts open.
  window.localStorage.setItem('club:way-in', 'email');
  window.sessionStorage.clear();
  progress.saved = null;
  progress.device = [];
  progress.account = [];
  progress.forgotten = [];
  calls.order = [];
  calls.status = 'signed-out';
  calls.afterPassword = 'signed-up';
  calls.passwordError = null;
  calls.signUpError = null;
  calls.resendError = null;
  calls.resendHold = null;
  calls.resetError = null;
  calls.signUpOptions = null;
  calls.resetRedirect = null;
  calls.user = { email: 'dana@example.com', user_metadata: {} };
  calls.invited = true;
  calls.joiningOpen = false;
  // Agreed already, so the other tests open at the first question.
  calls.termsAgreed = '2026-11-06';
  calls.agreedTo = [];
  calls.agreeError = false;
  calls.qrDetails = null;
  calls.claimResult = true;
  calls.claimError = false;
  calls.claimedWith = null;
  calls.inviteAddress = null;
  calls.inviteGuest = null;
  calls.addressError = false;
  calls.addressAskedWith = null;
  calls.addressGate = null;
  calls.taken = [];
  calls.suggestions = ['dana', 'dana.s', 'dana_s'];
  calls.checked = [];
  calls.submitted = null;
  calls.submitResults = [];
  calls.vapidKey = null;
  calls.notificationState = 'off';
  calls.widget = 'unavailable';
  calls.onToken = null;
  calls.promptAsked = false;
  calls.idTokenError = null;
  calls.passkeyError = null;
  calls.passkeys = [];
  nativeSheets.answer = { ok: true, name: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, 'PublicKeyCredential');
});

describe('the welcome screen', () => {
  it('starts on the welcome screen, not on a form', () => {
    renderJoin();
    expect(screen.getByRole('button', { name: 'Join the club' })).toBeInTheDocument();
    // The logo carries "MEMBERS ONLY" too, so match the footer line whole;
    // "Members only." is bold, in an element of its own (the owner, 2026-11-03).
    const bold = screen.getByText('Members only.');
    expect(bold.tagName).toBe('B');
    expect(bold.parentElement).toHaveTextContent(
      'Members only. Nothing inside the club is public.',
    );
  });

  it('shows the club mark and offers both doors', () => {
    renderJoin();
    expect(screen.getByRole('img', { name: 'The SCI Club' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I already have an account' })).toBeInTheDocument();
  });
});

// The owner, 2026-10-14: for events, an administrator can let anybody join.
// The doors stop sending a walk-in to find an invite; the database decides.
describe('while anybody can join', () => {
  it('says joining is by invitation, and offers to request an invite, while it is not', async () => {
    renderJoin();
    expect(screen.getByText(/No invite yet\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request an invite' })).toHaveAttribute(
      'href',
      '/request-invite',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    expect(screen.getByText('Joining is by invitation only.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'request one' })).toHaveAttribute(
      'href',
      '/request-invite',
    );
  });

  it('says anybody can join, and drops the call for an invite', async () => {
    calls.joiningOpen = true;
    renderJoin();
    await waitFor(() => {
      expect(screen.queryByText(/No invite yet\?/)).toBeNull();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    expect(
      screen.getByText('Anybody can join right now. Join with any email or account.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Joining is by invitation/)).toBeNull();
  });

  it('still greets somebody with an invitation as invited', async () => {
    calls.joiningOpen = true;
    renderJoin('/join?invite=tok-123');
    expect(await screen.findByText(/^You have an invitation\./)).toBeInTheDocument();
  });
});

// The owner, 2026-10-14: an administrator's QR code gives credit, never entry.
describe("an administrator's QR code", () => {
  const ALFRED = { inviter_name: 'Alfred', event_name: 'Abilities Expo LA' };

  it('goes straight to joining, and says who invited them while anybody can join', async () => {
    calls.qrDetails = { ...ALFRED, joining_open: true, contact_email: null };
    renderJoin('/join?from=abc123');
    expect(
      await screen.findByText(
        'Alfred invited you to The SCI Club. Join with any email or account.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(window.localStorage.getItem('sciclub.qrCode')).toBe('abc123');
  });

  // 20261028960000: an org admin's code lets them in while it is live.
  it("says an org admin's code invites them, even while joining is closed", async () => {
    calls.qrDetails = {
      inviter_name: 'Sam',
      event_name: null,
      joining_open: false,
      contact_email: null,
      organization_name: 'NorCal SCI',
      admits: true,
    };
    renderJoin('/join?from=abc123');
    expect(
      await screen.findByText(
        'Sam from NorCal SCI invited you to The SCI Club. Join with any email or account.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ask Sam for an invite/)).toBeNull();
  });

  it('says who to ask, with their email, while joining is closed', async () => {
    calls.qrDetails = { ...ALFRED, joining_open: false, contact_email: 'alfred@example.com' };
    renderJoin('/join?from=abc123');
    expect(
      await screen.findByText(/Joining is by invitation right now\. Ask Alfred for an invite\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alfred@example.com' })).toHaveAttribute(
      'href',
      'mailto:alfred@example.com',
    );
  });

  it('says the same on the closed door when the sign-up is refused', async () => {
    calls.qrDetails = { ...ALFRED, joining_open: false, contact_email: 'alfred@example.com' };
    calls.signUpError = { message: 'This email is not on the invite list.', status: 403 };
    renderJoin('/join?from=abc123');
    await screen.findByText(/Ask Alfred for an invite/);
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText("This email isn't on the list")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alfred@example.com' })).toBeInTheDocument();
    expect(screen.queryByText(/it gets you the app/)).toBeNull();
  });

  it('reads like any join page for a code that says nothing', async () => {
    renderJoin('/join?from=turned-off');
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByText('Joining is by invitation only.')).toBeInTheDocument();
    expect(screen.getByText(/Use the email address you were invited at/)).toBeInTheDocument();
    expect(screen.queryByText(/invited you/)).toBeNull();
  });

  it('claims the code for the account after sign-in, before asking about the invite', async () => {
    calls.qrDetails = { ...ALFRED, joining_open: true, contact_email: null };
    calls.status = 'signed-up';
    renderJoin('/join?from=abc123');
    await waitFor(() => {
      expect(calls.order).toContain('my_invite_status');
    });
    expect(calls.order.indexOf('claim_qr_code')).toBeGreaterThan(-1);
    expect(calls.order.indexOf('claim_qr_code')).toBeLessThan(
      calls.order.indexOf('my_invite_status'),
    );
    expect(window.localStorage.getItem('sciclub.qrCode')).toBeNull();
  });

  it('is forgotten by somebody already in the club', () => {
    calls.status = 'member';
    renderJoin('/join?from=abc123');
    expect(window.localStorage.getItem('sciclub.qrCode')).toBeNull();
  });
});

// The owner, 2026-10-30: the Home Screen nudge waits until after joining, when
// the app can open already signed in (src/lib/home-screen-handoff.ts).
describe('the Home Screen nudge', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function afterTheWait() {
    act(() => {
      vi.advanceTimersByTime(3100);
    });
  }

  it('is not under the welcome screen on an iPhone', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderJoin();
    afterTheWait();
    expect(screen.getByRole('button', { name: 'Join the club' })).toBeInTheDocument();
    expect(screen.queryByText('Put the club on your Home Screen')).toBeNull();
  });

  it('is not under the join form either', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderJoin();
    fireEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    afterTheWait();
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByText('Put the club on your Home Screen')).toBeNull();
  });
});

describe('joining by email', () => {
  async function openJoin(path = '/join') {
    renderJoin(path);
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
  }

  it('signs up with a lowercase address and has the link come back to /join', async () => {
    await openJoin();
    await fillDoor('Dana@Example.com ', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(calls.order).toEqual(['signUp:dana@example.com']);
    expect(calls.signUpOptions?.emailRedirectTo).toContain('/join?confirmed=1');
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(screen.getByText('hello@thesciclub.com')).toBeInTheDocument();
  });

  // The owner, 2026-10-28: Supabase answered as though it signed up, sent
  // nothing, and the page waited for an email that never came.
  it('says the address already has an account instead of waiting for an email', async () => {
    calls.signUpExisting = true;
    await openJoin();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/This email already has an account/)).toBeInTheDocument();
    expect(screen.queryByText('Check your email')).toBeNull();
    calls.signUpExisting = false;
  });

  // The owner, 2026-10-28: a code typed here, no link to open.
  it('checks the emailed code as soon as all six digits are typed', async () => {
    await openJoin();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await userEvent.type(await screen.findByLabelText('Code from the email'), '12 34 56');
    expect(calls.order).toContain('verifyOtp:email:dana@example.com:123456');
  });

  it('will not sign up with a password under eight characters', async () => {
    await openJoin();
    await fillDoor('dana@example.com', 'seven77');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), '8');
    // Typed once more: the second field still says the old, shorter one.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type it again'), '8');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  describe('typing the password twice', () => {
    it('asks for it again on joining, with the right autocomplete', async () => {
      await openJoin();
      const again = screen.getByLabelText('Type it again');
      expect(again).toHaveAttribute('type', 'password');
      expect(again).toHaveAttribute('autocomplete', 'new-password');
    });

    it('says they do not match as an alert, and will not create the account', async () => {
      await openJoin();
      await userEvent.type(screen.getByLabelText('Email'), 'dana@example.com');
      await userEvent.type(screen.getByLabelText('Password'), 'a long password');
      await userEvent.type(screen.getByLabelText('Type it again'), 'a long passwor');
      expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords do not match.');
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
      expect(calls.order.filter((c) => c.startsWith('signUp'))).toEqual([]);
    });

    it('goes on once they match', async () => {
      await openJoin();
      await fillDoor('dana@example.com', 'a long password');
      expect(screen.queryByText('The two passwords do not match.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    });

    it('does not submit a mismatch with Enter either', async () => {
      await openJoin();
      await userEvent.type(screen.getByLabelText('Email'), 'dana@example.com');
      await userEvent.type(screen.getByLabelText('Password'), 'a long password');
      await userEvent.type(screen.getByLabelText('Type it again'), 'another long one{Enter}');
      expect(calls.order.filter((c) => c.startsWith('signUp'))).toEqual([]);
    });

    it('keeps sign-in to one password field', async () => {
      renderJoin('/join');
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Type it again')).toBeNull();
    });
  });

  it('never asks whether the address is invited before it is confirmed', async () => {
    await openJoin();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Check your email');
    expect(calls.order.filter((c) => c === 'my_invite_status' || c === 'claim_invite')).toEqual([]);
  });

  it('says what went wrong when the sign-up is refused', async () => {
    calls.signUpError = {
      message: 'Signups not allowed for this instance',
      code: 'signup_disabled',
    };
    await openJoin();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  // signup_needs_an_invite (20261012040000) refuses before any email is sent.
  describe('an address that is not invited', () => {
    function refuse() {
      calls.signUpError = {
        message: 'This email is not on the invite list.',
        code: 'unknown',
        status: 403,
      };
    }

    it('goes straight to the closed door, naming the address, with no Check your email', async () => {
      refuse();
      await openJoin();
      await fillDoor('Stranger@Example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByText(/isn't on the list/i)).toBeInTheDocument();
      expect(screen.getByText('stranger@example.com')).toBeInTheDocument();
      expect(screen.queryByText('Check your email')).toBeNull();
    });

    it('Try another email goes back to the join form, empty, without signing anybody out', async () => {
      refuse();
      await openJoin();
      await fillDoor('stranger@example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Try another email' }));
      expect(await screen.findByRole('button', { name: 'Create account' })).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveValue('');
      expect(calls.order).not.toContain('signOut');
    });
  });

  // The sentences for what Supabase really returns, on the three screens that
  // send an email: sign-up, resend, and Forgot password.
  describe('the email errors, in words', () => {
    const TOO_MANY = 'Too many attempts or emails. Wait a minute and try again.';
    const NOT_SENT = 'The email could not be sent. Try again in a minute.';

    it('sign-up: too many emails', async () => {
      calls.signUpError = {
        code: 'over_email_send_rate_limit',
        message: 'email rate limit exceeded',
      };
      await openJoin();
      await fillDoor('dana@example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY);
    });

    it('sign-up: the confirmation email could not be sent', async () => {
      calls.signUpError = {
        code: 'unexpected_failure',
        message: 'Error sending confirmation email',
      };
      await openJoin();
      await fillDoor('dana@example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT);
      expect(screen.getByRole('alert')).not.toHaveTextContent(/code/i);
    });

    it('resend: asked too soon', async () => {
      calls.passwordError = { message: 'Email not confirmed', code: 'email_not_confirmed' };
      calls.resendError = {
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 59 seconds.',
      };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await fillDoor('dana@example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Send it again' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY);
    });

    it('reset: the email could not be sent', async () => {
      calls.resetError = { code: 'unexpected_failure', message: 'Error sending recovery email' };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await userEvent.type(screen.getByLabelText('Email'), 'dana@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT);
    });

    it('reset: asked too many times', async () => {
      calls.resetError = { code: 'over_request_rate_limit', message: 'Request rate limit reached' };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await userEvent.type(screen.getByLabelText('Email'), 'dana@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY);
    });
  });

  it('keeps the resend button waiting for a minute, and lets the address be changed', async () => {
    await openJoin();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('button', { name: /Send it again in \d+s/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Use a different address' }));
    expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
  });

  it('offers the link again to somebody who signs in before confirming', async () => {
    calls.passwordError = { message: 'Email not confirmed', code: 'email_not_confirmed' };
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    await waitFor(() => {
      expect(calls.order).toContain('resend:signup:dana@example.com');
    });
  });

  it('sends the link once however many times a slow resend is pressed', async () => {
    calls.passwordError = { message: 'Email not confirmed', code: 'email_not_confirmed' };
    let answer: (() => void) | undefined;
    calls.resendHold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const button = await screen.findByRole('button', { name: 'Send it again' });
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    answer?.();
    expect(await screen.findByRole('button', { name: /Send it again in \d+s/ })).toBeDisabled();
    expect(calls.order.filter((c) => c.startsWith('resend:'))).toHaveLength(1);
  });
});

describe('leaving halfway and coming back', () => {
  it('opens at the step it was left on, with the answers given', async () => {
    progress.saved = {
      step: 'birthday',
      answers: {
        termsAgreed: true,
        displayName: 'Dana',
        username: 'dana',
        usernameChecked: 'dana',
      },
      savedAt: '2026-10-15T20:00:00Z',
    };
    calls.user = { ...calls.user, id: 'user-1' } as typeof calls.user;
    calls.status = 'signed-up';
    renderJoin();
    expect(await screen.findByText('When is your birthday?')).toBeInTheDocument();
    expect(screen.getByText(/You are where you left off/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Pick a username')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('Dana');
  });

  it('opens on the name, with no welcome back, when that is where they stopped', async () => {
    progress.saved = {
      step: 'name',
      answers: { displayName: 'Dana' },
      savedAt: '2026-10-15T20:00:00Z',
    };
    calls.user = { ...calls.user, id: 'user-1' } as typeof calls.user;
    calls.status = 'signed-up';
    renderJoin();
    expect(await screen.findByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('Dana');
    expect(screen.queryByText(/You are where you left off/)).toBeNull();
  });

  it('keeps each step on the account as it moves on, never the password', async () => {
    await reachBirthday('Dana');
    const steps = progress.account.map((saved) => saved.step);
    expect(steps).toEqual(['name', 'username', 'birthday']);
    const last = progress.account.at(-1)?.answers ?? {};
    expect(last).toMatchObject({ displayName: 'Dana', username: 'dana' });
    expect(Object.keys(last)).not.toContain('password');
    expect(Object.keys(last)).not.toContain('email');
    expect(progress.device).toContain('birthday');
  });

  it('lets the device copy go once the member is made', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1985-04-12');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
    await waitFor(() => {
      expect(progress.forgotten).toEqual(['user-1']);
    });
  });
});

describe('coming back from the confirmation link', () => {
  it('goes on to the invite check, signed in, and then the questions', async () => {
    calls.status = 'signed-up';
    renderJoin('/join?confirmed=1');
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.order).toEqual(['my_invite_status']);
  });

  it('says the address is confirmed when the link opens in a browser that is not signed in', async () => {
    renderJoin('/join?confirmed=1');
    expect(await screen.findByText(/Your email is confirmed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('the invite link', () => {
  it('is kept when it opens while the page is already up, as the store app gets one', async () => {
    let go: (to: string) => void = () => undefined;
    function Navigator() {
      const navigate = useNavigate();
      go = (to) => void navigate(to);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/join']}>
        <Navigator />
        <Routes>
          <Route path="/join" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Join the club' })).toBeInTheDocument();
    act(() => {
      go('/join?invite=tok-late');
    });
    expect(await screen.findByText(/You have an invitation/)).toBeInTheDocument();
    expect(window.localStorage.getItem('sciclub.inviteToken')).toBe('tok-late');
  });

  it('claims the invite before asking whether the account is invited', async () => {
    calls.status = 'signed-up';
    renderJoin('/join?invite=tok-123');
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.order).toEqual(['claim_invite', 'my_invite_status']);
    expect(calls.claimedWith).toBe('tok-123');
  });

  it('lets go of the token once it has been answered', async () => {
    calls.status = 'signed-up';
    renderJoin('/join?invite=tok-123');
    await screen.findByText('What is your name?');
    expect(window.localStorage.getItem('sciclub.inviteToken')).toBeNull();
  });

  it('keeps it through the sign-up and the email, and claims it after', async () => {
    renderJoin('/join?invite=tok-123');
    expect(window.localStorage.getItem('sciclub.inviteToken')).toBe('tok-123');
    // Straight to joining: the link is why they came, so no Welcome screen first.
    expect(screen.getByText(/You have an invitation/)).toBeInTheDocument();
    await fillDoor('hidden.relay@privaterelay.example', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Check your email');
    // Nothing claimed yet: there is no session to claim it with.
    expect(calls.order).not.toContain('claim_invite');

    // The confirmation link brings the account back, and the token with it.
    act(() => {
      calls.setStatus('signed-up');
    });
    await screen.findByText('What is your name?');
    expect(calls.claimedWith).toBe('tok-123');
  });

  it('claims for an account whatever address it signed up with', async () => {
    calls.user = { email: 'someone.else@example.com', user_metadata: {} };
    calls.status = 'signed-up';
    renderJoin('/join?invite=tok-123');
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.claimedWith).toBe('tok-123');
  });

  it('still asks the list when the token is refused, since the address may match', async () => {
    calls.claimResult = false;
    calls.status = 'signed-up';
    renderJoin('/join?invite=used');
    await screen.findByText('What is your name?');
    expect(calls.order).toEqual(['claim_invite', 'my_invite_status']);
  });

  it('keeps the token and says so when the claim could not be made', async () => {
    calls.claimError = true;
    calls.status = 'signed-up';
    renderJoin('/join?invite=tok-123');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check your invitation');
    expect(window.localStorage.getItem('sciclub.inviteToken')).toBe('tok-123');
    expect(calls.order).not.toContain('my_invite_status');

    calls.claimError = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
  });

  it('opens at the join form, not the Welcome screen', () => {
    renderJoin('/join?invite=tok-123');
    expect(screen.getByRole('heading', { name: 'Join the club' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join the club' })).not.toBeInTheDocument();
    // A way back to the Welcome screen and to signing in is still there.
    expect(screen.getByRole('button', { name: 'Already a member? Sign in' })).toBeInTheDocument();
  });

  it('fills in the address the invitation was sent to, and says so', async () => {
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    });
    expect(calls.addressAskedWith).toBe('tok-123');
    expect(screen.getByText(/the address your invitation was sent to/i)).toBeInTheDocument();
  });

  // The owner, 2026-11-04: sent from an event's guest list, the link starts
  // from what they typed when they registered.
  it('keeps the name and phone the guest registered with, for the steps after', async () => {
    calls.inviteAddress = 'dana@example.com';
    calls.inviteGuest = { name: 'Dana Ruiz', phone: '4085550112', event_id: 'climb' };
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    });
    expect(
      JSON.parse(window.localStorage.getItem('sciclub.eventRegistration') ?? '{}'),
    ).toMatchObject({
      eventId: 'climb',
      status: 'going',
      name: 'Dana Ruiz',
      email: 'dana@example.com',
      phone: '4085550112',
    });
  });

  it('offers the invited address back when what is typed is close to it', async () => {
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    });
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'dana@exmaple.com');
    expect(screen.getByText(/Did you mean/)).toHaveTextContent('dana@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
  });

  it('does not offer it for an address that is simply another one', async () => {
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    });
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'dsmith@work.org');
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
  });

  it('leaves the field theirs: another address is used as typed, and the note goes', async () => {
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    });
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'dana.s@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a long password');
    await userEvent.type(screen.getByLabelText('Type it again'), 'a long password');
    expect(screen.queryByText(/the address your invitation was sent to/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Check your email');
    expect(calls.order).toContain('signUp:dana.s@example.com');
  });

  it('does not write over what they have already typed', async () => {
    let release: () => void = () => undefined;
    calls.addressGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await userEvent.type(screen.getByLabelText('Email'), 'mine@example.com');
    release();
    await waitFor(() => {
      expect(calls.addressAskedWith).toBe('tok-123');
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(screen.getByLabelText('Email')).toHaveValue('mine@example.com');
    expect(screen.queryByText(/the address your invitation was sent to/i)).not.toBeInTheDocument();
  });

  it('leaves the field empty, and says nothing, when the club has no address for it', async () => {
    calls.inviteAddress = null;
    renderJoin('/join?invite=used');
    await waitFor(() => {
      expect(calls.addressAskedWith).toBe('used');
    });
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('carries on without it when the lookup fails', async () => {
    calls.addressError = true;
    renderJoin('/join?invite=tok-123');
    await waitFor(() => {
      expect(calls.addressAskedWith).toBe('tok-123');
    });
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not ask for the address of a link that is not there', async () => {
    renderJoin('/join');
    await screen.findByRole('button', { name: 'Join the club' });
    expect(calls.order).not.toContain('invite_address_for_token');
    expect(calls.order).not.toContain('invite_details_for_token');
  });

  it('does not ask once signed in: the claim comes first, and the form is gone', async () => {
    calls.status = 'signed-up';
    calls.inviteAddress = 'dana@example.com';
    renderJoin('/join?invite=tok-123');
    await screen.findByText('What is your name?');
    expect(calls.order).not.toContain('invite_address_for_token');
    expect(calls.order).not.toContain('invite_details_for_token');
  });

  it('is let go when the person is already a member', async () => {
    window.localStorage.setItem('sciclub.inviteToken', 'old');
    calls.status = 'member';
    renderJoin();
    await screen.findByRole('heading', { name: 'Home' });
    expect(window.localStorage.getItem('sciclub.inviteToken')).toBeNull();
  });
});

// From an event's registration (public-event/next-step.tsx, the owner, 2026-11-02).
describe('sent to one door', () => {
  it('opens on signing in', () => {
    renderJoin('/join', { door: 'signin' });
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('opens on joining', () => {
    renderJoin('/join', { door: 'join' });
    expect(screen.getByRole('heading', { name: 'Join the club' })).toBeInTheDocument();
  });
});

describe('the not-invited screen', () => {
  beforeEach(() => {
    calls.invited = false;
    calls.status = 'signed-up';
  });

  it('closes the door and names the address that was refused', async () => {
    renderJoin();
    expect(await screen.findByText(/isn't on the list/i)).toBeInTheDocument();
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Did you receive an invite under a different email address?'),
    ).toBeInTheDocument();
    expect(screen.queryByText('What is your name?')).toBeNull();
  });

  // The owner, 2026-11-02: one button, the request goes to one person.
  it('offers a request, with nobody to choose', async () => {
    renderJoin();
    expect(await screen.findByRole('button', { name: 'Request an invite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ask / })).toBeNull();
  });

  it('signs the account out', async () => {
    renderJoin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(calls.order).toContain('signOut');
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });
});

describe('signing in with email', () => {
  async function openSignIn() {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
  }

  it('greets a returning member and lets the wrong door be swapped', async () => {
    await openSignIn();
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New here? Join the club' }));
    expect(screen.getByRole('heading', { name: 'Join the club' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Already a member? Sign in' }));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('lets the browser offer a passkey in the email box', async () => {
    await openSignIn();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username webauthn');
  });

  describe('a passkey suggested after a password', () => {
    const offer = 'Sign in faster next time?';
    const bytes = new Uint8Array([1]).buffer;

    beforeEach(() => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      calls.afterPassword = 'member';
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'credentials');
    });

    async function signIn() {
      await openSignIn();
      await fillDoor('sam@example.com', 'a long password');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    }

    it('offers one to an account with none, and Not now holds for 30 days', async () => {
      await signIn();
      expect(await screen.findByRole('heading', { name: offer })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(Number(window.localStorage.getItem('club:passkey-offer-snoozed'))).toBeGreaterThan(0);
    });

    it('lets an account that has one straight in', async () => {
      calls.passkeys = [{ id: 'p1', created_at: '2026-10-27T00:00:00Z' }];
      await signIn();
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: offer })).toBeNull();
    });

    it('does not ask again while Not now holds', async () => {
      window.localStorage.setItem('club:passkey-offer-snoozed', String(Date.now()));
      await signIn();
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(calls.order).not.toContain('passkey.list');
    });

    it('lets the browser save one quietly where it can, with no screen', async () => {
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: Object.assign(() => undefined, {
          getClientCapabilities: () => Promise.resolve({ conditionalCreate: true }),
        }),
        configurable: true,
      });
      const asked: CredentialCreationOptions[] = [];
      Object.defineProperty(navigator, 'credentials', {
        value: {
          create: (options: CredentialCreationOptions) => {
            asked.push(options);
            return Promise.resolve({
              id: 'new',
              rawId: bytes,
              type: 'public-key',
              getClientExtensionResults: () => ({}),
              response: { clientDataJSON: bytes, attestationObject: bytes },
            });
          },
        },
        configurable: true,
      });
      await signIn();
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: offer })).toBeNull();
      expect((asked[0] as { mediation?: string } | undefined)?.mediation).toBe('conditional');
      expect(calls.order).toContain('passkey.verifyRegistration');
    });
  });

  it('lets a member straight to Home', async () => {
    calls.afterPassword = 'member';
    await openSignIn();
    await fillDoor('sam@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.order).not.toContain('my_invite_status');
  });

  it('hands the questions to somebody who signed in but never finished joining', async () => {
    await openSignIn();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.order).toEqual(['signInWithPassword:dana@example.com', 'my_invite_status']);
  });

  it('turns away an account that is not invited, before asking for ticks', async () => {
    calls.invited = false;
    await openSignIn();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/isn't on the list/i)).toBeInTheDocument();
    expect(screen.queryByText('What is your name?')).toBeNull();
  });

  it('says the same thing for a wrong password and an unknown address', async () => {
    calls.passwordError = { message: 'Invalid login credentials', code: 'invalid_credentials' };
    await openSignIn();
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password did not match.',
    );
  });

  it('advances on Enter, and not before both boxes are filled', async () => {
    calls.afterPassword = 'member';
    await openSignIn();
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com{Enter}');
    expect(calls.order).toEqual([]);
    await userEvent.type(screen.getByLabelText('Password'), 'a long password{Enter}');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.order).toEqual(['signInWithPassword:sam@example.com']);
  });

  it('returns a sign-in to the shared link it came from', async () => {
    calls.afterPassword = 'member';
    renderJoin('/join?next=%2Fchat%2Ft%2Fshared');
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    await fillDoor('sam@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Shared conversation' })).toBeInTheDocument();
  });
});

describe('forgot password', () => {
  async function openForgot() {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  }

  it('sends the reset link and has it come back to /reset-password', async () => {
    await openForgot();
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'Dana@Example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(calls.order).toEqual(['resetPasswordForEmail:dana@example.com']);
    expect(calls.resetRedirect).toMatch(/\/reset-password$/);
  });

  it('does not say whether the address has an account', async () => {
    await openForgot();
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText(/If nobody@example.com has an account/)).toBeInTheDocument();
  });

  it('goes back to sign in', async () => {
    await openForgot();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });
});

describe('Google, Apple and passkeys', () => {
  it('offers Google on both doors', async () => {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Already a member? Sign in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(calls.order).toEqual(['signInWithOAuth:google']);
  });

  it('joins with Google: an invited Google account goes to the questions', async () => {
    calls.status = 'signed-up';
    calls.user = {
      email: 'dana@gmail.example',
      user_metadata: { full_name: 'Dana Smith' },
    };
    renderJoin('/join?google=signin');
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.order).toEqual(['my_invite_status']);
  });

  it('says what to do when Google comes back without signing anybody in', async () => {
    renderJoin('/join?google=signin');
    expect(await screen.findByRole('alert')).toHaveTextContent('Google did not sign you in.');
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('leaves somebody part-way through joining alone', async () => {
    calls.status = 'signed-up';
    calls.invited = true;
    renderJoin('/join?google=signin');
    await screen.findByText('What is your name?');
    expect(calls.order).not.toContain('signOut');
  });

  it('asks Google for its “Sign in as” box on the sign-in door only', async () => {
    calls.widget = 'ready';
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    expect(calls.promptAsked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'New here? Join the club' }));
    expect(calls.promptAsked).toBe(false);
  });

  it('hands Supabase the token with the nonce it was made with', async () => {
    calls.widget = 'ready';
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    calls.onToken?.('id-token', 'raw-nonce');
    await waitFor(() => {
      expect(calls.order).toEqual(['signInWithIdToken:google:id-token:raw-nonce']);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('in the iPhone Home Screen app, sends Google to a browser instead of its widget', async () => {
    calls.widget = 'ready';
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      );
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    try {
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(
        screen.getByText('Opens Chrome or Safari, where your Google accounts are.'),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
      // Google's own widget, which finds no accounts there, is not drawn.
      expect(calls.promptAsked).toBe(false);
      expect(screen.queryByRole('button', { name: /Google’s sign-in page/ })).toBeNull();
    } finally {
      agent.mockRestore();
      Reflect.deleteProperty(navigator, 'standalone');
    }
  });

  it('says so when Google’s account is refused', async () => {
    calls.idTokenError = 'bad token';
    calls.widget = 'ready';
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    calls.onToken?.('id-token', 'raw-nonce');
    expect(await screen.findByRole('alert')).toHaveTextContent('Google did not sign you in');
  });

  describe('Apple', () => {
    it('is hidden unless VITE_APPLE_SIGN_IN is set', async () => {
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
      expect(screen.queryByRole('button', { name: /Apple/ })).toBeNull();
    });

    it('goes to Apple and back to /join?apple=signin when the switch is on', async () => {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '1');
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with Apple' }));
      expect(calls.order).toEqual(['signInWithOAuth:apple']);
    });

    it('never turns the button off for the trip, and a double tap goes once', async () => {
      // An iPhone's Home Screen app: Apple opens over the app, and its X
      // closes it without this page hearing anything; the button must still work.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.stubEnv('VITE_APPLE_SIGN_IN', '1');
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      const apple = screen.getByRole('button', { name: 'Sign in with Apple' });
      expect(apple.querySelector('.opening-spinner')).toBeNull();
      await userEvent.click(apple);
      // The circle says it is loading; CSS takes it away again by itself.
      expect(apple.querySelector('.opening-spinner')).not.toBeNull();
      await userEvent.click(apple);
      expect(apple).toBeEnabled();
      expect(calls.order).toEqual(['signInWithOAuth:apple']);

      vi.setSystemTime(Date.now() + 2000);
      await userEvent.click(apple);
      expect(calls.order).toEqual(['signInWithOAuth:apple', 'signInWithOAuth:apple']);
      vi.useRealTimers();
    });

    it('says what to do when Apple comes back without signing anybody in', async () => {
      renderJoin('/join?apple=signin');
      expect(await screen.findByRole('alert')).toHaveTextContent('Apple did not sign you in.');
    });
  });

  describe('which way in leads', () => {
    beforeEach(() => {
      window.localStorage.removeItem('club:way-in');
    });

    const SAFARI_IPHONE =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
    const ANDROID =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

    function onDevice(userAgent: string) {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '1');
      return vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    }

    it('on an iPhone, Apple and then Google, and the email behind a button', async () => {
      const agent = onDevice(SAFARI_IPHONE);
      try {
        renderJoin();
        await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
        const apple = screen.getByRole('button', { name: 'Sign in with Apple' });
        const google = screen.getByRole('button', { name: 'Sign in with Google' });
        expect(
          apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Other ways/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeInTheDocument();
        await userEvent.click(google);
        expect(calls.order).toEqual(['signInWithOAuth:google']);
      } finally {
        agent.mockRestore();
      }
    });

    it('on Android, Google and then Apple, and the email behind a button', async () => {
      const agent = onDevice(ANDROID);
      try {
        renderJoin();
        await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
        const google = screen.getByRole('button', { name: 'Continue with Google' });
        const apple = screen.getByRole('button', { name: 'Continue with Apple' });
        expect(
          google.compareDocumentPosition(apple) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Other ways/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Join with email' })).toBeInTheDocument();
        await userEvent.click(apple);
        expect(calls.order).toEqual(['signInWithOAuth:apple']);
      } finally {
        agent.mockRestore();
      }
    });

    it('on Android, both even for somebody who last used Google here', async () => {
      window.localStorage.setItem('club:way-in', 'google');
      const agent = onDevice(ANDROID);
      try {
        renderJoin();
        await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
        expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
      } finally {
        agent.mockRestore();
      }
    });

    it('on a computer, both, and no Other ways', async () => {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '1');
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Other ways/ })).toBeNull();
    });

    it('with Apple off, Google alone, even on an iPhone', async () => {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '');
      const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI_IPHONE);
      try {
        renderJoin();
        await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
        expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeInTheDocument();
      } finally {
        agent.mockRestore();
      }
    });
  });

  describe('in the store app', () => {
    beforeEach(() => {
      window.localStorage.removeItem('club:way-in');
    });

    let native: { mockRestore: () => void } | null = null;
    let platform: { mockRestore: () => void } | null = null;
    afterEach(() => {
      native?.mockRestore();
      platform?.mockRestore();
    });

    function onAnIphone(google: boolean) {
      native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      platform = vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
      if (google) {
        vi.stubEnv('VITE_GOOGLE_IOS_CLIENT_ID', '123456789012-abc.apps.googleusercontent.com');
      }
    }

    it('on an iPhone, offers Apple and Google together, on both doors', async () => {
      onAnIphone(true);
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
      expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Join with email' }));
      expect(screen.getByText('or join with your email')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Already a member? Sign in' }));
      expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
      expect(screen.getByText('Sign in the way you joined.')).toBeInTheDocument();
      // Never the website's ways: no widget, no redirect.
      expect(calls.onToken).toBeNull();
    });

    it('without Google’s iOS client, offers Apple alone and tells Google members what to do', async () => {
      onAnIphone(false);
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Google|Other ways/ })).toBeNull();
      expect(screen.getByText(/Joined with Google\? Choose Forgot password/)).toBeInTheDocument();
    });

    it('signs in with Apple’s sheet, then asks the club, and fills in the name Apple gave', async () => {
      onAnIphone(true);
      nativeSheets.answer = { ok: true, name: 'Dana Ruiz' };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
      expect(await screen.findByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('Dana Ruiz');
      expect(calls.order).toEqual(['native:apple', 'my_invite_status']);
    });

    it('signs in with Google’s sheet, through the same check', async () => {
      onAnIphone(true);
      calls.invited = false;
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
      await waitFor(() => {
        expect(calls.order).toEqual(['native:google', 'my_invite_status']);
      });
    });

    it('says nothing when a sheet is closed, and what went wrong otherwise', async () => {
      onAnIphone(false);
      nativeSheets.answer = { ok: false, error: null };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with Apple' }));
      await waitFor(() => {
        expect(calls.order).toEqual(['native:apple']);
      });
      expect(screen.queryByRole('alert')).toBeNull();
      nativeSheets.answer = { ok: false, error: 'Apple did not sign you in.' };
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with Apple' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Apple did not sign you in.');
    });

    it('elsewhere (Android, for now), offers only the email and password, on both doors, and says how to make one', async () => {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '1');
      vi.stubEnv('VITE_PASSKEYS', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
      native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
      expect(screen.queryByRole('button', { name: /Google|Apple/ })).toBeNull();
      expect(screen.queryByText('or join with your email')).toBeNull();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Already a member? Sign in' }));
      expect(screen.queryByRole('button', { name: /Google|Apple|passkey/ })).toBeNull();
      expect(
        screen.getByText(/Joined with Google or Apple\? Choose Forgot password/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    });
  });

  describe('passkeys', () => {
    it('are hidden unless VITE_PASSKEYS is set', async () => {
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
      // Used here before, so only the switch keeps the button away.
      window.localStorage.setItem('club:passkey-here', '1');
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
    });

    it('are hidden in a browser without WebAuthn, even when the switch is on', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      window.localStorage.setItem('club:passkey-here', '1');
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
    });

    it('show no button where no passkey was ever used, as a site cannot ask', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
    });

    it('sign in with one tap where one was used before', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      window.localStorage.setItem('club:passkey-here', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
      expect(calls.order).toEqual(['signInWithPasskey']);
    });

    it('are offered in the email box instead of a button, where the browser can', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: Object.assign(() => undefined, {
          isConditionalMediationAvailable: () => Promise.resolve(true),
        }),
        configurable: true,
      });
      const asked: CredentialRequestOptions[] = [];
      Object.defineProperty(navigator, 'credentials', {
        value: {
          get: (options: CredentialRequestOptions) => {
            asked.push(options);
            return new Promise(() => undefined);
          },
        },
        configurable: true,
      });
      const { unmount } = renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await waitFor(() => {
        expect(asked).toHaveLength(1);
      });
      expect(asked[0]?.mediation).toBe('conditional');
      expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
      // Leaving the screen stops the quiet request.
      unmount();
      expect(asked[0]?.signal?.aborted).toBe(true);
      Reflect.deleteProperty(navigator, 'credentials');
    });

    it('say nothing when the quiet request is refused, and the button stands in', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      window.localStorage.setItem('club:passkey-here', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: Object.assign(() => undefined, {
          isConditionalMediationAvailable: () => Promise.resolve(true),
        }),
        configurable: true,
      });
      calls.passkeyError = { message: 'too many requests' };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      expect(await screen.findByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
      expect(calls.order).toEqual(['startAuthentication']);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('say nothing when the browser’s own sheet is cancelled', async () => {
      vi.stubEnv('VITE_PASSKEYS', '1');
      window.localStorage.setItem('club:passkey-here', '1');
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: () => undefined,
        configurable: true,
      });
      calls.passkeyError = { name: 'NotAllowedError', message: 'cancelled' };
      renderJoin();
      await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
      await waitFor(() => {
        expect(calls.order).toEqual(['signInWithPasskey']);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

describe('the email box waiting behind a button', () => {
  beforeEach(() => {
    window.localStorage.removeItem('club:way-in');
  });

  const toSignIn = async () => {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
  };

  it('shows only the other ways at first, with no Sign in button to wonder at', async () => {
    await toSignIn();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('opens on a press, and the box takes the focus', async () => {
    await toSignIn();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('is open already for somebody who last used it here', async () => {
    window.localStorage.setItem('club:way-in', 'email');
    await toSignIn();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('stays shut for somebody who last used Google here', async () => {
    window.localStorage.setItem('club:way-in', 'google');
    await toSignIn();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('waits on the join door too', async () => {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Join with email' }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('does not ask the passkey service anything until the box is open', async () => {
    vi.stubEnv('VITE_PASSKEYS', '1');
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: Object.assign(() => undefined, {
        isConditionalMediationAvailable: () => Promise.resolve(true),
      }),
      configurable: true,
    });
    Object.defineProperty(navigator, 'credentials', {
      value: { get: () => new Promise(() => undefined) },
      configurable: true,
    });
    await toSignIn();
    expect(calls.order).not.toContain('startAuthentication');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with email' }));
    await waitFor(() => {
      expect(calls.order).toContain('startAuthentication');
    });
    Reflect.deleteProperty(navigator, 'credentials');
  });
});

describe('the name', () => {
  it('starts as the name Google gave', async () => {
    calls.user = { email: 'dana@gmail.example', user_metadata: { full_name: 'Dana Smith' } };
    await reachName();
    expect(screen.getByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('Dana Smith');
  });

  it('falls back to `name`, which is what some providers send', async () => {
    calls.user = { email: 'dana@example.com', user_metadata: { name: 'Dana' } };
    await reachName();
    expect(screen.getByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('Dana');
  });

  it('starts empty when the provider gave none, as Apple often does', async () => {
    calls.user = { email: 'relay@privaterelay.example', user_metadata: {} };
    await reachName();
    expect(screen.getByPlaceholderText('ex. Ajay Shenoy')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('the username', () => {
  /** On the username step, the first suggestion chosen; cleared unless `keep`. */
  async function reachUsername(name = 'Dana', keep = false) {
    await reachName();
    await userEvent.clear(screen.getByPlaceholderText('ex. Ajay Shenoy'));
    await userEvent.type(screen.getByPlaceholderText('ex. Ajay Shenoy'), name);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Pick a username');
    await waitFor(() => {
      expect(screen.getByLabelText('Username')).toHaveValue(calls.suggestions[0]);
    });
    if (!keep) await userEvent.clear(screen.getByLabelText('Username'));
  }

  it('suggests names built from the name just given', async () => {
    await reachUsername('Dana', true);
    expect(await screen.findByRole('button', { name: '@dana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@dana.s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@dana_s' })).toBeInTheDocument();
    expect(calls.order).toContain('suggest_usernames');
  });

  // The owner, 2026-10-15: the first suggestion, the whole name with dots,
  // is chosen already, so Continue is all it takes.
  it('chooses the first suggestion, so Continue is all it takes', async () => {
    calls.suggestions = ['dana.smith', 'dana', 'danasmith'];
    await reachUsername('Dana Smith', true);
    expect(screen.getByRole('button', { name: '@dana.smith' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByText('@dana.smith is available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    // Already found free by the club: not asked again.
    expect(calls.checked).toEqual([]);
  });

  it('does not put the suggestion back once they clear the box', async () => {
    await reachUsername();
    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('takes another suggestion in one tap, and goes on', async () => {
    await reachUsername();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await userEvent.click(await screen.findByRole('button', { name: '@dana.s' }));
    expect(screen.getByLabelText('Username')).toHaveValue('dana.s');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('lowercases as they type, and drops a leading @', async () => {
    await reachUsername();
    await userEvent.type(screen.getByLabelText('Username'), '@DanaS');
    expect(screen.getByLabelText('Username')).toHaveValue('danas');
  });

  it('says out loud when a name is available, and only then goes on', async () => {
    await reachUsername();
    await userEvent.type(screen.getByLabelText('Username'), 'dana_free');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(await screen.findByText('@dana_free is available.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('@dana_free is available.');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(calls.checked).toEqual(['dana_free']);
  });

  it('says when a name is taken, and does not go on', async () => {
    calls.taken = ['dana_taken'];
    await reachUsername();
    await userEvent.type(screen.getByLabelText('Username'), 'dana_taken');
    expect(await screen.findByText('@dana_taken is taken. Try another.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('does not ask the database about a name that cannot be one', async () => {
    await reachUsername();
    await userEvent.type(screen.getByLabelText('Username'), 'ab');
    expect(screen.getByRole('status')).toHaveTextContent(/3 to 20 letters/);
    await userEvent.type(screen.getByLabelText('Username'), '..');
    expect(screen.getByRole('status')).toHaveTextContent(/3 to 20 letters/);
    expect(calls.checked).toEqual([]);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('asks again after an edit rather than trusting the last answer', async () => {
    await reachUsername();
    await userEvent.type(screen.getByLabelText('Username'), 'dana_ok');
    await screen.findByText('@dana_ok is available.');
    calls.taken = ['dana_ok2'];
    await userEvent.type(screen.getByLabelText('Username'), '2');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(await screen.findByText('@dana_ok2 is taken. Try another.')).toBeInTheDocument();
  });

  it('sends the username to the insert', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
    await waitFor(() => {
      expect(calls.submitted?.username).toBe('dana');
    });
  });

  it('goes back to the username when it was taken in the meantime', async () => {
    calls.submitResults = [
      { ok: false, usernameRefused: true, error: 'That username was just taken. Choose another.' },
    ];
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
    expect(await screen.findByText('Pick a username')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('just taken');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('the phone for events', () => {
  async function reachPhone() {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    await screen.findByText('What is your phone number?');
  }

  it('is optional: Continue works with nothing typed', async () => {
    await reachPhone();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Add a photo?')).toBeInTheDocument();
  });

  it('can be skipped, and sends no number', async () => {
    await reachPhone();
    await userEvent.type(screen.getByPlaceholderText('(408) 555-0112'), '408');
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await waitFor(() => {
      expect(calls.submitted).not.toBeNull();
    });
    expect(calls.submitted?.phone).toBe('');
  });

  it('says who gets the number', async () => {
    await reachPhone();
    expect(
      screen.getByText(/Event hosts can see your number if you say you are going/),
    ).toBeInTheDocument();
    // The club sends no texts, so the screen must not promise any.
    expect(screen.queryByText(/text you/i)).toBeNull();
  });

  it('will not go on with half a number', async () => {
    await reachPhone();
    await userEvent.type(screen.getByPlaceholderText('(408) 555-0112'), '408555');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('(408) 555-0112'), '0112');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('carries a whole number to the insert, formatted as typed', async () => {
    await reachPhone();
    await userEvent.type(screen.getByPlaceholderText('(408) 555-0112'), '4085550112');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await waitFor(() => {
      expect(calls.submitted?.phone).toBe('(408) 555-0112');
    });
  });
});

// No screen of their own and no box to tick (the owner, 2026-10-15). The join
// form says signing up is agreeing, with both documents linked (2026-10-25).
describe('agreeing to the terms', () => {
  it('says so on the join form, with both documents a tap away, and no box to tick', () => {
    renderJoin('/join?invite=tok-123');
    expect(screen.getByRole('heading', { name: 'Join the club' })).toBeInTheDocument();
    expect(screen.getByText(/By signing up, you agree to our/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Text me/)).toBeNull();
  });

  it('says so on the sign-in form too, where Apple or Google can make a new account', async () => {
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    expect(await screen.findByText(/By continuing, you agree to our/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('is not repeated under the name', async () => {
    calls.status = 'signed-up';
    renderJoin();
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(screen.queryByText(/you agree to our/)).toBeNull();
  });
});

// "Before you join" (the owner, 2026-10-29): first, until the account agrees.
describe('before you join', () => {
  beforeEach(() => {
    calls.termsAgreed = null;
    calls.status = 'signed-up';
  });

  it('comes first, says it is not medical advice, and records the agreement', async () => {
    renderJoin();
    expect(await screen.findByRole('heading', { name: 'Before you join' })).toBeInTheDocument();
    expect(screen.getByText(/It is not medical advice/)).toBeInTheDocument();
    expect(screen.getByText(/Check with your doctor/)).toBeInTheDocument();
    expect(screen.getByText(/at your own risk/)).toBeInTheDocument();
    expect(screen.getByText(/you confirm you are 18 or older/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(calls.agreedTo).toEqual(['2026-11-06']);
  });

  it('is not shown again once agreed', async () => {
    calls.termsAgreed = '2026-11-06';
    renderJoin();
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before you join' })).toBeNull();
  });

  it('goes on to where it was left, after agreeing', async () => {
    progress.saved = {
      step: 'birthday',
      answers: { displayName: 'Dana', username: 'dana', usernameChecked: 'dana' },
      savedAt: '2026-10-15T20:00:00Z',
    };
    calls.user = { ...calls.user, id: 'user-1' } as typeof calls.user;
    renderJoin();
    await screen.findByRole('heading', { name: 'Before you join' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('When is your birthday?')).toBeInTheDocument();
    expect(screen.getByText(/You are where you left off/)).toBeInTheDocument();
  });

  it('stays, and says so, when the agreement cannot be saved', async () => {
    calls.agreeError = true;
    renderJoin();
    await screen.findByRole('heading', { name: 'Before you join' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before you join' })).toBeInTheDocument();
  });

  it('signs out on Back, for another account', async () => {
    renderJoin();
    await screen.findByRole('heading', { name: 'Before you join' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Join the club' })).toBeInTheDocument();
    expect(calls.order).toContain('signOut');
  });
});

// Back from the first question: there is nothing before it but the account.
describe('the wrong account', () => {
  it('signs out from the first question, for another account', async () => {
    calls.status = 'signed-up';
    renderJoin();
    await screen.findByText('What is your name?');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Join the club' })).toBeInTheDocument();
    expect(calls.order).toContain('signOut');
    expect(screen.getByRole('button', { name: 'I already have an account' })).toBeInTheDocument();
  });
});

describe('somebody already in the club', () => {
  it('is sent on to Home', async () => {
    calls.status = 'member';
    renderJoin();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('resumes the destination when Google returns an existing member', async () => {
    calls.status = 'member';
    renderJoin('/join?google=signin&next=%2Fchat%2Ft%2Fshared');
    expect(await screen.findByRole('heading', { name: 'Shared conversation' })).toBeInTheDocument();
  });

  it('keeps suspended members at the shell rather than looping through a profile link', async () => {
    calls.status = 'suspended';
    renderJoin('/join?next=%2Fprofile%2Fdetails');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('the passkey offer after joining', () => {
  async function finishLater() {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
  }

  it('is made when the switch is on and the browser can', async () => {
    vi.stubEnv('VITE_PASSKEYS', '1');
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: () => undefined,
      configurable: true,
    });
    await finishLater();
    expect(await screen.findByText('Sign in faster next time?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up a passkey' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.order).toContain('registerPasskey');
  });

  it('can be put off', async () => {
    vi.stubEnv('VITE_PASSKEYS', '1');
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: () => undefined,
      configurable: true,
    });
    await finishLater();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.order).not.toContain('registerPasskey');
  });

  it.each(['google', 'apple'])('is not made to whoever joined with %s', async (way) => {
    vi.stubEnv('VITE_PASSKEYS', '1');
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: () => undefined,
      configurable: true,
    });
    window.localStorage.setItem('club:way-in', way);
    try {
      await finishLater();
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(screen.queryByText('Sign in faster next time?')).toBeNull();
    } finally {
      window.localStorage.removeItem('club:way-in');
    }
  });

  it('is not made while the switch is off', async () => {
    await finishLater();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('Sign in faster next time?')).toBeNull();
  });
});

describe('the keyboard', () => {
  it('advances a question on Enter, not only on the button', async () => {
    await reachName();
    await userEvent.type(screen.getByPlaceholderText('ex. Ajay Shenoy'), 'Dana{Enter}');
    expect(await screen.findByText('Pick a username')).toBeInTheDocument();
  });

  it('does nothing on Enter when the step is not finished', async () => {
    await reachName();
    await userEvent.type(screen.getByPlaceholderText('ex. Ajay Shenoy'), '{Enter}');
    expect(screen.queryByText('Pick a username')).toBeNull();
  });
});
describe('the club is adults only', () => {
  const yearsAgo = (n: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  it('says up front that the club is 18+', async () => {
    await reachBirthday('Sam');
    expect(screen.getByText(/The club is 18\+/)).toBeInTheDocument();
  });

  it('explains rather than just disabling, when the date is under 18', async () => {
    await reachBirthday('Sam');
    await typeBirthday(yearsAgo(15));
    expect(await screen.findByText(/The SCI Club is for adults/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('lets an adult through, and shows the age it will publish', async () => {
    await reachBirthday('Sam');
    await typeBirthday(yearsAgo(30));
    expect(await screen.findByText(/never your birthday/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

// Typed boxes, not a calendar: many members use voice control, a mouth stick
// or a head pointer, and a calendar's small cells and long paging are hardest
// of all for them. See lib/date-parts.ts.

describe('the birthday boxes', () => {
  // The owner, 2026-10-15: the year is the last box, so typing it is done.
  it('goes on by itself once the year is typed', async () => {
    await reachBirthday('Sam');
    await typeBirthday('1985-04-12');
    expect(await screen.findByText('Your spinal cord')).toBeInTheDocument();
  });

  it('does not bounce forward again on coming Back to it', async () => {
    await reachBirthday('Sam');
    await typeBirthday('1985-04-12');
    await screen.findByText('Your spinal cord');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('When is your birthday?')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(screen.getByText('When is your birthday?')).toBeInTheDocument();
  });

  it('stays put for somebody under 18', async () => {
    await reachBirthday('Sam');
    const year = String(new Date().getFullYear() - 10);
    await typeBirthday(`${year}-04-12`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(screen.getByText('When is your birthday?')).toBeInTheDocument();
  });

  it('reads the date back in words, the month typed as its name', async () => {
    await reachBirthday('Sam');
    await userEvent.type(screen.getByLabelText('Month'), 'may');
    await userEvent.type(screen.getByLabelText('Day'), '27');
    await userEvent.type(screen.getByLabelText('Year'), '1996');
    expect(await screen.findByText('May 27, 1996')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  // Dictation and a paste both arrive as one insertion, not key by key.
  it('spreads a whole date said into one box across all three', async () => {
    await reachBirthday('Sam');
    await userEvent.click(screen.getByLabelText('Month'));
    await userEvent.paste('5/27/1996');
    expect(screen.getByLabelText('Month')).toHaveValue('5');
    expect(screen.getByLabelText('Day')).toHaveValue('27');
    expect(screen.getByLabelText('Year')).toHaveValue('1996');
  });

  it('says why a date that does not exist goes no further', async () => {
    await reachBirthday('Sam');
    await enterBirthday('1996-04-31');
    expect(await screen.findByRole('alert')).toHaveTextContent('April 1996 has 30 days.');
    expect(screen.getByLabelText('Day')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  // At the owner's word: a box filled is a tap saved.
  it('moves on by itself as each box fills, and stops at the last', async () => {
    await reachBirthday('Sam');
    await userEvent.click(screen.getByLabelText('Month'));
    await userEvent.keyboard('05');
    expect(screen.getByLabelText('Day')).toHaveFocus();
    await userEvent.keyboard('27');
    expect(screen.getByLabelText('Year')).toHaveFocus();
    await userEvent.keyboard('1996');
    expect(screen.getByLabelText('Year')).toHaveFocus();
    expect(await screen.findByText('May 27, 1996')).toBeInTheDocument();
  });

  it('waits after a 1, which may be heading for 12', async () => {
    await reachBirthday('Sam');
    await userEvent.type(screen.getByLabelText('Month'), '1');
    expect(screen.getByLabelText('Month')).toHaveFocus();
    await userEvent.keyboard('2');
    expect(screen.getByLabelText('Day')).toHaveFocus();
  });

  it('moves on from a single digit nothing could follow', async () => {
    await reachBirthday('Sam');
    await userEvent.type(screen.getByLabelText('Month'), '5');
    expect(screen.getByLabelText('Day')).toHaveFocus();
  });

  // The problem is said beside the cursor, not one box behind it.
  it('stays on a box that is wrong', async () => {
    await reachBirthday('Sam');
    await userEvent.type(screen.getByLabelText('Month'), '13');
    expect(screen.getByLabelText('Month')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(/1 to 12/);
  });

  it('goes back a box on Backspace in an empty one, so a slip can be fixed', async () => {
    await reachBirthday('Sam');
    await userEvent.type(screen.getByLabelText('Month'), '05');
    expect(screen.getByLabelText('Day')).toHaveFocus();
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByLabelText('Month')).toHaveFocus();
    await userEvent.keyboard('{Backspace}6');
    expect(screen.getByLabelText('Month')).toHaveValue('06');
  });

  it('lets a saved birthday be filled in for them', async () => {
    await reachBirthday('Sam');
    expect(screen.getByLabelText('Month')).toHaveAttribute('autocomplete', 'bday-month');
    expect(screen.getByLabelText('Day')).toHaveAttribute('autocomplete', 'bday-day');
    expect(screen.getByLabelText('Year')).toHaveAttribute('autocomplete', 'bday-year');
  });

  it('names the three boxes together as the birthday', async () => {
    await reachBirthday('Sam');
    expect(screen.getByRole('group', { name: 'Your birthday' })).toBeInTheDocument();
  });
});

describe('finishing later', () => {
  async function reachInjury() {
    calls.invited = true;
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  // The club is 18+ and a row needs a name, so those two stay required. Past
  // them the schema allows every answer to be absent, and Me is where they
  // get filled in.
  it('is not offered before the birthday is answered', async () => {
    calls.invited = true;
    await reachName();
    expect(screen.queryByRole('button', { name: /Finish later/ })).toBeNull();
  });

  async function reachBirthdayStep() {
    calls.invited = true;
    await reachBirthday('Dana');
    await screen.findByText('When is your birthday?');
  }

  // Name and age are the two a row cannot be written without, so the way out
  // appears the moment both are in rather than one Continue later.
  it('appears on the birthday step itself, once the date is a real one', async () => {
    await reachBirthdayStep();
    expect(screen.queryByRole('button', { name: /Finish later/ })).toBeNull();

    await enterBirthday('1990-04-02');

    expect(await screen.findByRole('button', { name: /Finish later/ })).toBeInTheDocument();
  });

  // Skipping with an empty or under-age date would write a row the database
  // refuses, and the refusal would arrive as a sentence about a trigger.
  it('stays hidden for a birthday the club cannot accept', async () => {
    await reachBirthdayStep();
    await enterBirthday('2020-01-01');

    expect(screen.queryByRole('button', { name: /Finish later/ })).toBeNull();
  });

  it('enters the club straight from the birthday', async () => {
    await reachBirthdayStep();
    await enterBirthday('1990-04-02');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));

    await waitFor(() => {
      expect(calls.submitted?.displayName).toBe('Dana');
    });
  });

  it('is offered from the step after the birthday', async () => {
    await reachInjury();
    expect(await screen.findByRole('button', { name: /Finish later/ })).toBeInTheDocument();
  });

  it('enters the club with what was answered so far', async () => {
    await reachInjury();
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
    await waitFor(() => {
      expect(calls.submitted?.displayName).toBe('Dana');
    });
    // Unanswered, and left that way rather than guessed at.
    expect(calls.submitted?.exactLevel).toBeNull();
    expect(calls.submitted?.state).toBe('');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('a photograph the club cannot hold', () => {
  const REFUSED = {
    ok: false,
    photoRefused: true,
    error: "That kind of file can't be used. Try a JPEG or PNG.",
  };

  beforeEach(() => {
    // jsdom has no object URLs; the step makes one for the preview.
    URL.createObjectURL = () => 'blob:preview';
  });

  async function reachPhoto() {
    calls.invited = true;
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.selectOptions(await screen.findByLabelText('State'), 'CA');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The phone for events is optional, and left empty.
    await screen.findByText('What is your phone number?');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Add a photo?');
  }

  async function choose(name = 'photo.heic') {
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no photograph input');
    await userEvent.upload(input, new File(['x'], name, { type: 'image/png' }));
  }

  it('names the photo control, and renames it once there is a photo', async () => {
    await reachPhoto();
    expect(screen.getByLabelText('Choose a photo')).toHaveAttribute('type', 'file');
    await choose();
    expect(screen.getByLabelText('Change the photo')).toHaveAttribute('type', 'file');
  });

  // The owner, 2026-09-30: stay on the photo step with the sentence.
  it('stays on the photo step and says why, without a preview of what was refused', async () => {
    calls.submitResults = [REFUSED];
    await reachPhoto();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enter the club' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED.error);
    expect(screen.getByText('Add a photo?')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull();
    expect(document.querySelector('label img')).toBeNull();
  });

  it('still lets them in with Skip for now, without the photograph', async () => {
    calls.submitResults = [REFUSED];
    await reachPhoto();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enter the club' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.submitted?.photoFile).toBeNull();
  });

  // Skip used to `set` the file away and submit from the same render, which
  // still held it: the photograph it skipped went up anyway.
  it('skips a photograph that is chosen and never sent', async () => {
    await reachPhoto();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => {
      expect(calls.submitted).not.toBeNull();
    });
    expect(calls.submitted?.photoFile).toBeNull();
  });

  it('takes the sentence away when another photograph is chosen', async () => {
    calls.submitResults = [REFUSED];
    await reachPhoto();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enter the club' }));
    await screen.findByRole('alert');
    await choose('another.png');

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// The owner, 2026-10-22: offered, and copied only when chosen.
describe("the member's Google photo", () => {
  const AVATAR = 'https://lh3.googleusercontent.com/a/ACg8ocKdana=s96-c';
  let fetched: string[] = [];

  beforeEach(() => {
    fetched = [];
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => undefined;
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function signedInWith(provider: string) {
    calls.user = {
      email: 'dana@example.com',
      user_metadata: { avatar_url: AVATAR },
      app_metadata: { providers: [provider] },
      identities: [{ provider, identity_data: { avatar_url: AVATAR } }],
    } as typeof calls.user;
  }

  async function reachPhoto() {
    calls.invited = true;
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.selectOptions(await screen.findByLabelText('State'), 'CA');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('What is your phone number?');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Add a photo?');
  }

  it('offers it, large, with a preview, and chooses nothing by itself', async () => {
    signedInWith('google');
    await reachPhoto();
    expect(await screen.findByRole('button', { name: 'Use my Google photo' })).toBeInTheDocument();
    expect(fetched).toEqual(['https://lh3.googleusercontent.com/a/ACg8ocKdana=s800-c']);
    expect(document.querySelector('img[src="blob:preview"]')).not.toBeNull();
    expect(screen.getByLabelText('Choose a photo')).toBeInTheDocument();
  });

  it('sends it as the photograph once chosen, as an upload would be', async () => {
    signedInWith('google');
    await reachPhoto();
    await userEvent.click(await screen.findByRole('button', { name: 'Use my Google photo' }));
    expect(screen.getByLabelText('Change the photo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my Google photo' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Enter the club' }));
    await waitFor(() => {
      expect(calls.submitted).not.toBeNull();
    });
    const file = calls.submitted?.photoFile as File;
    expect(file.name).toBe('google-photo.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('still lets them skip it', async () => {
    signedInWith('google');
    await reachPhoto();
    await screen.findByRole('button', { name: 'Use my Google photo' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => {
      expect(calls.submitted).not.toBeNull();
    });
    expect(calls.submitted?.photoFile).toBeNull();
  });

  it('offers nothing to an Apple account, and asks Google for nothing', async () => {
    signedInWith('apple');
    await reachPhoto();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Use my Google photo' })).toBeNull();
    expect(fetched).toEqual([]);
  });
});

// The owner, 2026-10-01: nothing that has already been answered should need a
// second press to move on.
describe('steps that move on by themselves', () => {
  async function reachInjuryStep() {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('moves on from the injury step when they would rather not say', async () => {
    await reachInjuryStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  it('offers rather not say for where they live, and moves on to the phone', async () => {
    await reachInjuryStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Rather not say' }));
    await screen.findByText('Where do you live?');
    await userEvent.click(screen.getByRole('button', { name: 'Rather not say' }));

    expect(await screen.findByText('What is your phone number?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Add a photo?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => {
      expect(calls.submitted?.declined).toEqual(['exactLevel', 'injuryDate', 'city', 'state']);
    });
    expect(calls.submitted?.state).toBe('');
  });
});

// Month, day, year like the birthday, but the year alone is a whole answer.
describe('the injury date boxes', () => {
  const DATE_LINE = 'When did your injury or condition begin?';

  async function reachInjuryStep() {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your spinal cord');
    await userEvent.click(screen.getByRole('radio', { name: /Quadriplegic/ }));
    fireEvent.change(screen.getByLabelText('Level of injury'), { target: { value: 'C5' } });
    // The cursor is not put in the date: it is reached by hand.
    await userEvent.click(screen.getByLabelText('Month'));
  }

  it('runs month, day, year, starting in Month, as the birthday does', async () => {
    await reachInjuryStep();
    const boxes = ['Month', 'Day', 'Year'].map((name) => screen.getByLabelText(name));
    expect(boxes[0]).toHaveFocus();
    expect(boxes[0]?.compareDocumentPosition(boxes[1] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(boxes[1]?.compareDocumentPosition(boxes[2] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await userEvent.keyboard('06');
    expect(screen.getByLabelText('Day')).toHaveFocus();
    await userEvent.keyboard('14');
    expect(screen.getByLabelText('Year')).toHaveFocus();
    await userEvent.keyboard('2013');
    expect(await screen.findByText('June 14, 2013')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  // The owner, 2026-11-04: which describes you comes first, so a relative
  // answers it and is done; the date follows for whoever has one.
  it('asks which describes you before the date', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const kind = await screen.findByText('Which describes you best?');
    expect(kind.compareDocumentPosition(screen.getByText(DATE_LINE))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  // The owner, 2026-10-15: the date is optional, and a relative is not asked it.
  it('goes on with no date at all', async () => {
    await reachInjuryStep();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  it('asks a relative no date and no level, and goes on', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your spinal cord');
    expect(
      screen.getByText('An injury or a condition: members find each other by this.'),
    ).toBeInTheDocument();
    expect(screen.getByText(DATE_LINE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Relative/ }));
    expect(screen.queryByText(DATE_LINE)).toBeNull();
    expect(screen.queryByLabelText('Level of injury')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  it('asks a professional no date and no level, and goes on', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your spinal cord');
    await userEvent.click(screen.getByRole('radio', { name: /Professional/ }));
    expect(screen.queryByText(DATE_LINE)).toBeNull();
    expect(screen.queryByLabelText('Level of injury')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  it('takes a spinal cord condition typed, and "Since birth" for its date', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your spinal cord');
    await userEvent.click(screen.getByRole('radio', { name: /Spinal cord or nerve disorder/ }));
    expect(screen.getByText(DATE_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Which condition?'), 'Spina bifida');
    await userEvent.click(screen.getByRole('button', { name: 'Since birth' }));
    expect(screen.getByLabelText('Year')).toHaveValue('1990');
    expect(screen.getByText(/since birth\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  // The owner, 2026-10-20: "Since birth" whatever the kind, before one is chosen too.
  it('offers "Since birth" to an injury as well, and before the kind is chosen', async () => {
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your spinal cord');
    expect(screen.getByRole('button', { name: 'Since birth' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Low para/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Since birth' }));
    expect(screen.getByLabelText('Year')).toHaveValue('1990');
    expect(screen.getByText(/since birth\./)).toBeInTheDocument();
  });

  it('goes on with the year alone', async () => {
    await reachInjuryStep();
    await userEvent.type(screen.getByLabelText('Year'), '2013');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Where do you live?')).toBeInTheDocument();
  });

  // The cursor starts in Month, and somebody who only knows the year types it there.
  it('moves a year typed into Month across to Year, with no error on the way', async () => {
    await reachInjuryStep();
    await userEvent.keyboard('20');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.keyboard('13');
    expect(screen.getByLabelText('Month')).toHaveValue('');
    expect(screen.getByLabelText('Year')).toHaveValue('2013');
    expect(screen.getByLabelText('Year')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('moves a year from the 1900s across too', async () => {
    await reachInjuryStep();
    await userEvent.keyboard('1998');
    expect(screen.getByLabelText('Year')).toHaveValue('1998');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('still takes February, once the Day box is reached', async () => {
    await reachInjuryStep();
    await userEvent.keyboard('2');
    expect(screen.getByLabelText('Month')).toHaveFocus();
    await userEvent.click(screen.getByLabelText('Day'));
    await userEvent.keyboard('14');
    await userEvent.keyboard('2013');
    expect(await screen.findByText('February 14, 2013')).toBeInTheDocument();
  });
});

// The owner, 2026-10-14: most people join in a browser before installing, so
// signing up no longer asks; the installed app asks once (AskOnOpening).
describe('notifications, not while signing up', () => {
  it('goes straight to Home, even when the club can send', async () => {
    calls.vapidKey = 'key';
    await reachBirthday('Dana');
    await enterBirthday('1990-04-02');
    await userEvent.click(await screen.findByRole('button', { name: /Finish later/ }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('Turn on notifications?')).toBeNull();
    expect(calls.order).not.toContain('turnOn');
    // Not marked as asked, so the installed app still asks this phone.
    expect(calls.order).not.toContain('asked');
  });
});

// iOS opens the number pad only for a focus inside a tap. The tap on Continue
// focuses a hidden numeric field before the code is asked for, and the code
// field takes focus over from it, which keeps the pad open (the owner,

// Joined on a computer, the link opened on a phone (confirm-elsewhere.ts).
describe('confirming on another device', () => {
  const UNCONFIRMED = { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 };

  async function join() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderJoin();
    await userEvent.click(screen.getByRole('button', { name: 'Join the club' }));
    await fillDoor('dana@example.com', 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Check your email');
  }
  const tries = () => calls.order.filter((c) => c.startsWith('signInWithPassword')).length;
  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes on by itself once the link is opened elsewhere', async () => {
    calls.passwordError = UNCONFIRMED;
    await join();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    await waitFor(() => {
      expect(tries()).toBe(1);
    });
    expect(screen.getByText('Check your email')).toBeInTheDocument();

    calls.passwordError = null;
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(await screen.findByText('What is your name?')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('sciclub.awaitingConfirmation')).toBeNull();
  });

  it('stops trying on a password that does not match', async () => {
    calls.passwordError = {
      message: 'Invalid login credentials',
      code: 'invalid_credentials',
      status: 400,
    };
    await join();
    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      await act(() => Promise.resolve());
    }
    expect(tries()).toBe(1);
  });

  it('keeps the address for a refresh, never the password', async () => {
    calls.passwordError = UNCONFIRMED;
    await join();
    expect(window.sessionStorage.getItem('sciclub.awaitingConfirmation')).toBe('dana@example.com');
    const kept = Object.keys(window.sessionStorage).map((key) =>
      window.sessionStorage.getItem(key),
    );
    expect(kept.join(' ')).not.toContain('a long password');
  });

  it('after a refresh, offers the sign-in with the address filled in', async () => {
    window.sessionStorage.setItem('sciclub.awaitingConfirmation', 'dana@example.com');
    renderJoin();
    expect(
      await screen.findByText('If you opened the link in the email, sign in to go on.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
