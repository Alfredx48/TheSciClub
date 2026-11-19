import type { UserIdentity } from '@supabase/supabase-js';
import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMAIL_RETURN_PARAM,
  type SignInDetails,
  type SignInState,
  waysIn,
} from '@/lib/account-email';
import { useAnnounce } from '@/lib/announce';
import {
  APPLE_RETURN_PARAM,
  appleSignInEnabled,
  linkApple,
  unlinkApple,
} from '@/lib/apple-sign-in';
import { sendPasswordReset } from '@/lib/auth-email';
import { describeThrown } from '@/lib/describe-error';
import { displayPhone, useOwnPhone } from '@/lib/event-phone';
import { linkAppleNatively, nativeWaysIn } from '@/lib/native-sign-in';
import {
  deletePasskey,
  listPasskeys,
  type PasskeyEntry,
  passkeysAvailable,
  registerPasskey,
} from '@/lib/passkeys';
import { formatPhoneInput, isCompletePhone } from '@/lib/phone';
import { useRedirectTap } from '@/lib/redirect-tap';
import { isNative } from '@/lib/standalone';
import {
  isValidUsername,
  normalizeUsername,
  setMyUsername,
  USERNAME_MAX,
  USERNAME_MIN,
  usernameAvailable,
} from '@/lib/usernames';
import { GoogleSignIn } from '@/routes/me/google-sign-in';
import {
  CARD_BUTTON,
  CardError,
  FIELD,
  FIELD_LABEL,
  PRIMARY_BUTTON,
  SignInCard,
} from '@/routes/me/sign-in-card';

/**
 * Me → Account → Signing in: every way into this account, and the two
 * numbers and names that go with it.
 *
 * The account is the email address. Each card says what it is, changes only
 * that, and never leaves the member with no way in: Google and Apple come off
 * only while another way in remains (`waysIn`). A phone number is no longer a
 * way in at all, so it is not counted, and appears here only as the number
 * event hosts may use.
 */
export function SignInSection({
  userId,
  state,
  reload,
  username,
  onUsernameChanged,
}: {
  userId: string | null;
  state: SignInState;
  reload: () => void;
  username: string | null;
  onUsernameChanged: (name: string) => void;
}) {
  const details = state.status === 'ready' ? state.details : null;
  return (
    <section aria-labelledby="signing-in-heading" className="mt-6">
      <h2
        id="signing-in-heading"
        className="mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
      >
        Signing in
      </h2>
      {state.status === 'error' ? <CardError>{state.error}</CardError> : null}
      {/* Two to a row on a desktop, so Account is not one long column. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <EmailCard details={details} />
        <PasswordCard email={details?.email ?? null} />
        <GoogleSignIn
          canUnlink={details ? waysIn(details, 'google') > 0 : false}
          onChanged={reload}
        />
        {appleSignInEnabled() || nativeWaysIn().apple || details?.providers.apple ? (
          <AppleCard details={details} reload={reload} />
        ) : null}
        {passkeysAvailable() ? <PasskeysCard /> : null}
        <PhoneCard userId={userId} />
        <UsernameCard username={username} onChanged={onUsernameChanged} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ email */

/**
 * Read only (the owner, 2026-10-11): the address is how the member was invited
 * and how the club knows them, so Me does not change it. Somebody who loses
 * the inbox asks an administrator, who sets it with scripts/set-member-email.mjs.
 * Adding a first address to an account with none is the banner's job.
 */
function EmailCard({ details }: { details: SignInDetails | null }) {
  const [params, setParams] = useSearchParams();
  const [returned] = useState(() => params.get(EMAIL_RETURN_PARAM) === 'changed');

  // The banner's confirmation link comes back to /me?email=changed; once, not on every visit.
  useEffect(() => {
    if (!returned) return;
    setParams(
      (p) => {
        p.delete(EMAIL_RETURN_PARAM);
        return p;
      },
      { replace: true },
    );
  }, [returned, setParams]);

  if (!details) return null;
  const { email } = details;

  if (!email) {
    return (
      <SignInCard title="Email">
        <p className="text-[0.875rem] text-ink2 leading-[1.45]">
          This account has no email yet. Add one with the form at the top of this page.
        </p>
      </SignInCard>
    );
  }

  return (
    <SignInCard title="Email">
      <p className="text-[0.875rem] text-ink2 leading-[1.45]">
        You sign in with <strong className="text-ink">{email}</strong>.
      </p>
      <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
        Your account belongs to this address, so it can&apos;t be changed here. If you lose access
        to it, ask an administrator.
      </p>
    </SignInCard>
  );
}

/* --------------------------------------------------------------- password */

function PasswordCard({ email }: { email: string | null }) {
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!email) return null;

  async function send(address: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await sendPasswordReset(address);
      if (result.ok) {
        setSent(true);
        announce(`We sent a link to ${address}.`);
      } else setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'The email was not sent. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInCard title="Password">
      <p className="text-[0.875rem] text-ink2 leading-[1.45]">
        Set a new password, or add one if you sign in with Google. We email a link to {email}.
      </p>
      {sent ? (
        <p role="status" className="mt-2 text-[0.875rem] text-ink leading-[1.45]">
          Check your email for the link.
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void send(email);
        }}
        className={CARD_BUTTON}
      >
        {busy ? 'One moment…' : sent ? 'Send the link again' : 'Email me a link'}
      </button>
      {error ? <CardError>{error}</CardError> : null}
    </SignInCard>
  );
}

/* ------------------------------------------------------------------ apple */

function AppleCard({ details, reload }: { details: SignInDetails | null; reload: () => void }) {
  const announce = useAnnounce();
  const [params, setParams] = useSearchParams();
  const [returned] = useState(() => params.get(APPLE_RETURN_PARAM) === 'linked');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked: UserIdentity | null = details?.providers.apple ?? null;
  // Not `busy`: the button must still work if Apple's page is closed.
  const goesOut = useRedirectTap();

  useEffect(() => {
    if (!returned || !details) return;
    // As with Google: coming back says nothing about whether it worked.
    if (linked) announce('Apple is linked.');
    else setError('Apple was not linked. Try again.');
    setParams(
      (p) => {
        p.delete(APPLE_RETURN_PARAM);
        return p;
      },
      { replace: true },
    );
  }, [returned, details, linked, announce, setParams]);

  if (!details) return null;

  async function link() {
    if (isNative()) return linkNatively();
    if (!goesOut()) return;
    setError(null);
    try {
      const result = await linkApple();
      if (!result.ok) setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'Could not reach Apple.'));
    }
  }

  /** The store app: Apple's sheet, without leaving Me. */
  async function linkNatively() {
    setBusy(true);
    setError(null);
    try {
      const result = await linkAppleNatively();
      if (result.ok) {
        if (!result.redirected) {
          announce('Apple is linked.');
          reload();
        }
      } else if (result.error) setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'Apple was not linked.'));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(identity: UserIdentity) {
    setBusy(true);
    setError(null);
    try {
      const result = await unlinkApple(identity);
      if (result.ok) {
        announce('Apple is no longer linked.');
        reload();
      } else setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'Apple is still linked.'));
    } finally {
      setBusy(false);
    }
  }

  // Only where the app can link it natively (lib/native-sign-in.ts).
  if (!linked && isNative() && !nativeWaysIn().apple) return null;
  const canUnlink = waysIn(details, 'apple') > 0;
  return (
    <SignInCard title="Apple">
      <p aria-live="polite" className="text-[0.875rem] text-ink2 leading-[1.45]">
        {linked
          ? canUnlink
            ? 'You can sign in with Apple.'
            : 'You can sign in with Apple. It is your only way in, so add an email and password before you unlink it.'
          : 'Link Apple to sign in with it in one tap.'}
      </p>
      {linked ? (
        canUnlink ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void unlink(linked);
            }}
            className={CARD_BUTTON}
          >
            {busy ? 'One moment…' : 'Unlink Apple'}
          </button>
        ) : null
      ) : (
        <button type="button" disabled={busy} onClick={() => void link()} className={CARD_BUTTON}>
          {busy ? 'One moment…' : 'Link Apple'}
        </button>
      )}
      {error ? <CardError>{error}</CardError> : null}
    </SignInCard>
  );
}

/* --------------------------------------------------------------- passkeys */

function PasskeysCard() {
  const announce = useAnnounce();
  const [passkeys, setPasskeys] = useState<PasskeyEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    try {
      const result = await listPasskeys();
      if (result.ok) setPasskeys(result.passkeys);
      else {
        setPasskeys([]);
        setError(result.error);
      }
    } catch (e: unknown) {
      setPasskeys([]);
      setError(describeThrown(e, 'Could not load your passkeys.'));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once on opening.
  useEffect(() => {
    void read();
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await registerPasskey();
      // A cancelled browser sheet comes back with no sentence: say nothing.
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      announce('Passkey added.');
      await read();
    } catch (e: unknown) {
      setError(describeThrown(e, 'The passkey was not added.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: PasskeyEntry) {
    setBusy(true);
    setError(null);
    try {
      const result = await deletePasskey(entry.id);
      if (result.ok) {
        announce('Passkey removed.');
        await read();
      } else setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'The passkey was not removed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInCard title="Passkeys">
      <p className="text-[0.875rem] text-ink2 leading-[1.45]">
        Sign in with Face ID, your fingerprint or a security key, with no password to type.
      </p>
      {passkeys && passkeys.length > 0 ? (
        <ul className="mt-2.5 space-y-2">
          {passkeys.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-[11px] bg-canvas px-3 py-2"
            >
              <span className="min-w-0 text-[0.875rem] text-ink">
                <span className="block truncate font-semibold">{entry.name}</span>
                <span className="block text-[0.78125rem] text-grey">
                  Added {new Date(entry.createdAt).toLocaleDateString('en-US')}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove passkey ${entry.name}`}
                onClick={() => {
                  void remove(entry);
                }}
                className="min-h-[44px] flex-none px-2 font-bold font-head text-[0.875rem] text-emphasis underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : passkeys ? (
        <p className="mt-2 text-[0.875rem] text-ink2">No passkeys yet.</p>
      ) : null}
      <button type="button" disabled={busy} onClick={() => void add()} className={CARD_BUTTON}>
        {busy ? 'One moment…' : 'Add a passkey'}
      </button>
      {error ? <CardError>{error}</CardError> : null}
    </SignInCard>
  );
}

/* ------------------------------------------------------------------ phone */

function PhoneCard({ userId }: { userId: string | null }) {
  const announce = useAnnounce();
  const fieldId = useId();
  const { phone, error: loadError, save } = useOwnPhone(userId);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(value: string | null, sentence: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await save(value);
      if (result.ok) {
        announce(sentence);
        setEditing(false);
        setTyped('');
      } else setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'Your number was not saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInCard title="Phone number for events">
      <p className="text-[0.875rem] text-ink2 leading-[1.45]">
        Optional, and not a way to sign in. Event hosts get it, with your email, when you RSVP.
      </p>
      {phone === undefined ? null : (
        <p className="mt-2 text-[0.875rem] text-ink">
          {phone ? displayPhone(phone) : 'No number added.'}
        </p>
      )}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && isCompletePhone(typed)) void run(typed, 'Number saved.');
          }}
        >
          <label htmlFor={fieldId} className={FIELD_LABEL}>
            Phone number
          </label>
          <input
            id={fieldId}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={typed}
            placeholder="(408) 555-0112"
            onChange={(event) => {
              setTyped(formatPhoneInput(event.target.value));
            }}
            className={FIELD}
          />
          <button
            type="submit"
            disabled={busy || !isCompletePhone(typed)}
            className={PRIMARY_BUTTON}
          >
            {busy ? 'Saving…' : 'Save number'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className={CARD_BUTTON}
          >
            Cancel
          </button>
        </form>
      ) : phone === undefined ? null : (
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => {
              setTyped(phone ? formatPhoneInput(phone) : '');
              setEditing(true);
            }}
            className={CARD_BUTTON}
          >
            {phone ? 'Change number' : 'Add a number'}
          </button>
          {phone ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(null, 'Number removed.');
              }}
              className={CARD_BUTTON}
            >
              {busy ? 'One moment…' : 'Remove number'}
            </button>
          ) : null}
        </div>
      )}
      {error || loadError ? <CardError>{error ?? loadError}</CardError> : null}
    </SignInCard>
  );
}

/* ---------------------------------------------------------------- username */

const CHECK_DELAY_MS = 400;

function UsernameCard({
  username,
  onChanged,
}: {
  username: string | null;
  onChanged: (name: string) => void;
}) {
  const announce = useAnnounce();
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [free, setFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidUsername(typed);
  const unchanged = typed === username;

  // Debounced, and stale answers are dropped: the last name typed is the one judged.
  useEffect(() => {
    setFree(null);
    if (!editing || !valid || unchanged) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void usernameAvailable(typed)
        .catch(() => null)
        .then((answer) => {
          if (!cancelled) setFree(answer);
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [typed, editing, valid, unchanged]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await setMyUsername(typed);
      if (result.ok) {
        onChanged(typed);
        announce(`Your username is now @${typed}.`);
        setEditing(false);
      } else setError(result.error);
    } catch (e: unknown) {
      setError(describeThrown(e, 'Your username was not changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  let verdict = '';
  if (editing && typed) {
    if (unchanged) verdict = 'That is your username now.';
    else if (!valid)
      verdict = `Use ${USERNAME_MIN} to ${USERNAME_MAX} lowercase letters, digits, dots or underscores.`;
    else if (free === true) verdict = `@${typed} is available.`;
    else if (free === false) verdict = `@${typed} is taken.`;
    else verdict = 'Checking…';
  }

  return (
    <SignInCard title="Username">
      <p className="text-[0.875rem] text-ink2 leading-[1.45]">
        {username ? (
          <>
            Other members see <strong className="text-ink">@{username}</strong> on your profile.
          </>
        ) : (
          'Pick a username other members will see on your profile.'
        )}
      </p>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && valid && !unchanged && free === true) void save();
          }}
        >
          <label htmlFor={fieldId} className={FIELD_LABEL}>
            New username
          </label>
          <input
            id={fieldId}
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            maxLength={USERNAME_MAX + 1}
            value={typed}
            onChange={(event) => {
              setTyped(normalizeUsername(event.target.value));
            }}
            className={FIELD}
          />
          <p aria-live="polite" className="mt-1 min-h-[1.25em] text-[0.8125rem] text-ink2">
            {verdict}
          </p>
          <button
            type="submit"
            disabled={busy || !valid || unchanged || free !== true}
            className={PRIMARY_BUTTON}
          >
            {busy ? 'Saving…' : 'Save username'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className={CARD_BUTTON}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setTyped(username ?? '');
            setEditing(true);
          }}
          className={CARD_BUTTON}
        >
          {username ? 'Change username' : 'Choose a username'}
        </button>
      )}
      {error ? <CardError>{error}</CardError> : null}
    </SignInCard>
  );
}
