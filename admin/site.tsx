import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { StatsSection } from '@/routes/admin/stats-section';
import { getSupabase } from './supabase';

/**
 * admin.thesciclub.com (the owner, 2026-11-22): the club's stats, speed and server logs on their
 * own site, which an administrator can add to the Home Screen and which still opens when the app
 * does not. Its own build and its own Cloudflare Worker (cloudflare/admin/), so a broken app
 * release or service worker does not reach it; it shares only the Stats screens' code.
 *
 * Signing in is by a 6-digit code emailed to the address (Supabase's magic-link email, which
 * carries the code: supabase/templates/magic_link.html). A link would open in Safari, not in the
 * Home Screen app. The site is for administrators: anybody else is signed out again, and every
 * read it makes is refused by the database for anybody but an administrator anyway.
 */

/** Where the members' app is, for its status and for a member's profile. */
const APP_ORIGIN = (import.meta.env.VITE_APP_ORIGIN as string | undefined) ?? '';

type Door =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'not-admin' }
  | { state: 'error'; message: string }
  | { state: 'admin'; session: Session; name: string | null };

export function AdminSite() {
  return (
    <Routes>
      {/* Stats links a member's name to their profile: that is in the app. */}
      <Route path="/peers/:id" element={<ToTheApp />} />
      <Route path="*" element={<Door />} />
    </Routes>
  );
}

function ToTheApp() {
  const { id = '' } = useParams();
  useEffect(() => {
    window.location.replace(`${APP_ORIGIN}/peers/${encodeURIComponent(id)}`);
  }, [id]);
  return <Shell>Opening the profile in the app…</Shell>;
}

/** Each try is a fresh DoorRound: Try again starts one. */
function Door() {
  const [round, setRound] = useState(0);
  return (
    <DoorRound
      key={round}
      onRetry={() => {
        setRound((n) => n + 1);
      }}
    />
  );
}

function DoorRound({ onRetry }: { onRetry: () => void }) {
  const [door, setDoor] = useState<Door>({ state: 'loading' });

  useEffect(() => {
    const supabase = getSupabase();
    // An object, so a check that awaited still sees the effect end.
    const run = { live: true };
    const check = async (session: Session | null) => {
      if (!session) {
        if (run.live) setDoor({ state: 'signed-out' });
        return;
      }
      const { data, error } = await supabase
        .from('members')
        .select('is_admin, display_name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!run.live) return;
      if (error) {
        setDoor({ state: 'error', message: error.message });
        return;
      }
      const row = data as { is_admin?: boolean; display_name?: string | null } | null;
      if (!row?.is_admin) {
        await supabase.auth.signOut({ scope: 'local' });
        setDoor({ state: 'not-admin' });
        return;
      }
      setDoor({ state: 'admin', session, name: row.display_name ?? null });
    };
    void supabase.auth.getSession().then(({ data }) => check(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void check(session);
    });
    return () => {
      run.live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (door.state === 'loading') return <Shell>Opening…</Shell>;
  if (door.state === 'error') {
    return (
      <Shell>
        <p role="alert" className="text-destructive">
          Could not check your account: {door.message}
        </p>
        <button type="button" onClick={onRetry} className={BUTTON}>
          Try again
        </button>
      </Shell>
    );
  }
  if (door.state === 'admin') return <Dashboard name={door.name} />;
  return <SignIn refused={door.state === 'not-admin'} />;
}

const BUTTON =
  'mt-3 min-h-11 rounded-full bg-action px-5 font-bold text-[0.875rem] text-white disabled:opacity-40';
const INPUT =
  'mt-1.5 min-h-11 w-full rounded-[11px] border-[1.6px] border-line bg-paper px-3 py-2 text-[1rem] text-ink outline-none focus:border-emphasis';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-10 text-[0.9375rem] text-ink">
      <h1 className="mb-4 font-bold font-head text-[1.375rem]">Sci Club Admin</h1>
      {children}
    </main>
  );
}

function SignIn({ refused }: { refused: boolean }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(
    refused ? 'This site is for the club’s administrators only.' : null,
  );

  const send = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) {
      setProblem('Enter your email address.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    // An address with no account says the same as one with: nothing to learn here.
    if (error?.status === 429) {
      setProblem('Too many codes asked for. Wait a minute, then try again.');
      return;
    }
    setSentTo(address);
  };

  const verify = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!sentTo) return;
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) {
      setProblem('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const { error } = await getSupabase().auth.verifyOtp({ email: sentTo, token, type: 'email' });
    setBusy(false);
    // Signed in: the door's listener takes it from here.
    if (error) setProblem('That code did not work. Check it, or ask for a new one.');
  };

  return (
    <Shell>
      {sentTo === null ? (
        <form
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <p className="text-ink2">For the club’s administrators. Sign in with your email.</p>
          <label className="mt-4 block font-bold text-[0.8125rem]">
            Email
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className={INPUT}
            />
          </label>
          {problem ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive">
              {problem}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            void verify(event);
          }}
        >
          <p className="text-ink2">
            If <strong className="text-ink">{sentTo}</strong> has an account, a 6-digit code is on
            its way. If the email has a link instead, open it on this device.
          </p>
          <label className="mt-4 block font-bold text-[0.8125rem]">
            Code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={10}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              className={`${INPUT} tracking-[0.3em]`}
            />
          </label>
          {problem ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                setCode('');
                setProblem(null);
              }}
              className="mt-3 min-h-11 px-2 font-semibold text-[0.8125rem] text-ink2 underline underline-offset-2"
            >
              Use another address
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}

function Dashboard({ name }: { name: string | null }) {
  return (
    <div className="min-h-dvh bg-canvas pb-[max(env(safe-area-inset-bottom),16px)]">
      <header className="sticky top-0 z-10 border-line border-b bg-paper pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-[960px] items-center justify-between gap-3 px-4 py-2">
          <h1 className="font-bold font-head text-[1.0625rem] text-ink">Sci Club Admin</h1>
          <div className="flex items-center gap-3 text-[0.8125rem]">
            {name ? <span className="hidden text-ink2 sm:inline">{name}</span> : null}
            <button
              type="button"
              onClick={() => {
                void getSupabase().auth.signOut({ scope: 'local' });
              }}
              className="min-h-11 font-semibold text-ink2 underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[960px] px-4 pt-3">
        <AppCheck />
        <StatsSection />
      </main>
    </div>
  );
}

interface AppAnswer {
  up: boolean;
  status: number | null;
  ms: number | null;
  built: string | null;
}

/**
 * Is the members' app answering? Asked of this site's Worker (cloudflare/admin/worker.ts), which
 * fetches the app's /version.json: the app does not let other sites read it from a browser.
 */
function AppCheck() {
  const [round, setRound] = useState(0);
  return (
    <AppStatus
      key={round}
      onCheck={() => {
        setRound((n) => n + 1);
      }}
    />
  );
}

function AppStatus({ onCheck }: { onCheck: () => void }) {
  const [answer, setAnswer] = useState<AppAnswer | 'checking' | 'unknown'>('checking');
  useEffect(() => {
    let live = true;
    const read = async (): Promise<AppAnswer | 'unknown'> => {
      try {
        const response = await fetch('/app-status', { cache: 'no-store' });
        return response.ok ? ((await response.json()) as AppAnswer) : 'unknown';
      } catch {
        return 'unknown';
      }
    };
    void read().then((found) => {
      if (live) setAnswer(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const built =
    typeof answer === 'object' && answer.built
      ? new Date(`${answer.built}Z`).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/Los_Angeles',
        })
      : null;

  return (
    <section
      aria-label="The app"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-line bg-paper px-3 py-2 text-[0.8125rem]"
    >
      <p className="text-ink">
        {answer === 'checking' ? (
          'Checking the app…'
        ) : answer === 'unknown' ? (
          'Could not check the app from here.'
        ) : answer.up ? (
          <>
            <strong>The app is answering</strong>
            {answer.ms === null ? '' : ` (${String(answer.ms)} ms)`}
            {built ? `. Release built ${built}.` : '.'}
          </>
        ) : (
          <strong className="text-destructive">
            The app is not answering
            {answer.status ? ` (it said ${String(answer.status)})` : ''}.
          </strong>
        )}
      </p>
      <span className="flex items-center gap-3">
        {APP_ORIGIN ? (
          <a
            href={APP_ORIGIN}
            className="min-h-11 content-center font-semibold text-ink2 underline underline-offset-2"
          >
            Open the app
          </a>
        ) : null}
        <button
          type="button"
          onClick={onCheck}
          className="min-h-11 font-semibold text-ink2 underline underline-offset-2"
        >
          Check again
        </button>
      </span>
    </section>
  );
}
