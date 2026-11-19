import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { QrCodeDetails } from '@/lib/qr-codes';
import { InvitedElsewhere } from '@/routes/onboarding/invited-elsewhere';
import { AskForInvite } from '@/routes/onboarding/sign-in-steps';
import { InviteRequestPanel } from '@/routes/request-invite/request-panel';

/**
 * The address is not on the list: refused at sign-up before any email (20261012040000), or
 * signed in and found not invited (Google and Apple, after their round trip). A closed door,
 * not an error, with a way forward.
 *
 * The owner, 2026-11-02: the other-address box is open from the start, and the main button
 * opens the request form here (20261102050000). Sign out stays as a small link: with no invite
 * it is the only way back. "Ask somebody you know" was removed (the owner, 2026-10-10).
 * Until 2026-11-02 this screen listed inviting organizations from invite_request_choices()
 * (20261029030000); never hardcode such a list, it goes stale and names the wrong body.
 */

export function BlockedScreen({
  onTryAnother,
  email,
  name = '',
  signedIn = true,
  fromCode = null,
  onProved,
}: {
  /** Signs them out (when signed in) and goes back to the doors. */
  onTryAnother: () => void;
  /** The address they signed in with, so they can see which one was refused. */
  email: string | null;
  /** To start the request form with. */
  name?: string;
  /** False when the join form was refused: there is no account to sign out of. */
  signedIn?: boolean;
  /** An administrator's QR code they came by (20261014020000): who to ask. */
  fromCode?: QrCodeDetails | null;
  /** The invite at another address is now this account's. Needs a session. */
  onProved?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <main className="mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-[18px] pt-12">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] bg-gold-lt text-gold-dp">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-extrabold font-display text-[1.5625rem] text-ink leading-tight tracking-[-0.01em]">
          This email isn't on the list
        </h1>
        <p className="mt-2.5 text-[0.8875rem] text-ink2 leading-[1.52]">
          {email ? <b className="text-ink">{email}</b> : 'This account'} has not been invited.
        </p>
        {/* One form at a time, so the request opens where they are looking. */}
        {signedIn && onProved && !asking ? <InvitedElsewhere onProved={onProved} /> : null}
        {/* Only while joining is closed: open, the code would have let them
            in, so whatever refused them is not something to ask about. */}
        {fromCode && !fromCode.joiningOpen && !fromCode.admits ? (
          <p className="mt-3 rounded-[14px] border border-line bg-paper p-3.5 text-[0.9375rem] text-ink leading-[1.52]">
            <AskForInvite who={fromCode} />
          </p>
        ) : null}
        {/* Up here under "If not" (the owner, 2026-11-03), not in the footer. */}
        {asking ? null : (
          <>
            {signedIn ? null : (
              <p className="mt-4 text-[0.8125rem] text-ink2 leading-[1.5]">
                If you were invited, use the address your invitation was sent to, or open the link
                in your invitation and join from there.
              </p>
            )}
            <p className="mt-4 font-bold text-[0.9375rem] text-ink">If not</p>
            <button
              type="button"
              onClick={() => {
                setAsking(true);
              }}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-on-gold text-[0.9375rem]"
            >
              Request an invite
            </button>
          </>
        )}
        {asking ? <InviteRequestPanel initialName={name} initialEmail={email ?? ''} /> : null}

        {/* No consultation call here for now (the owner, 2026-10-25); it may
            come back, with CONSULTATION_URL as on the welcome screen. */}

        {fromCode && !fromCode.joiningOpen && !fromCode.admits ? null : (
          <p className="mt-4 text-[0.78125rem] text-grey leading-[1.5]">
            A QR code or its link lets you in only until it expires or is turned off. Otherwise
            someone has to invite your email address.
          </p>
        )}
      </div>

      <footer className="flex-none px-[18px] pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onTryAnother}
          className="flex min-h-[44px] w-full items-center justify-center font-bold text-[0.875rem] text-emphasis"
        >
          {signedIn ? 'Sign out' : 'Try another email'}
        </button>
      </footer>
    </main>
  );
}
