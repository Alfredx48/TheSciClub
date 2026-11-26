import { BadgeCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { PARTNER_ROLE_NAME, useStaffOrganizations } from '@/lib/club-partners';
import { fetchMyPartnerCard, setMyProfessionalTitle } from '@/lib/partner-hub';

const MAX = 80;

/**
 * A verified professional writes the profession shown beside their name (the
 * owner, 2026-11-04; 20261104100000, 20261104160000): "Verified professional ·
 * Physical therapist, SCI-FIT". Nobody else does, not even when they are made one.
 *
 * It names the organization they are verified staff of, and the notification
 * that tells them (20261125160000) opens it at /me#profession, the box in view
 * and ready to type in (the owner, 2026-11-25).
 */
export function ProfessionField() {
  const id = useId();
  const announce = useAnnounce();
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;
  const staffOf = useStaffOrganizations();
  const organization = memberId ? staffOf?.get(memberId)?.name : undefined;
  const { hash } = useLocation();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const loaded = saved !== null;

  // From the notification: once, when the box is there.
  useEffect(() => {
    if (hash !== '#profession' || !loaded) return;
    const at = form.current;
    if (at && 'scrollIntoView' in at) at.scrollIntoView({ block: 'center' });
    input.current?.focus({ preventScroll: true });
  }, [hash, loaded]);

  useEffect(() => {
    let live = true;
    void fetchMyPartnerCard().then((result) => {
      if (!live) return;
      if (result.ok && result.value) {
        setSaved(result.value.title ?? '');
        setDraft(result.value.title ?? '');
      } else if (!result.ok) setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const clean = draft.trim();
  const changed = saved !== null && clean !== saved;
  const ready = changed && clean.length >= 2 && clean.length <= MAX;

  function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    void setMyProfessionalTitle(clean)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(result.value);
        setDraft(result.value);
        announce('Your profession is saved.');
      })
      .finally(() => {
        setBusy(false);
      });
  }

  if (saved === null && !error) return null;

  return (
    <form
      ref={form}
      id="profession"
      className="mt-2.5 scroll-mt-24 rounded-[17px] border border-line bg-paper p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className="mb-2 flex items-center gap-1.5 font-bold text-[0.8125rem] text-ink">
        <BadgeCheck aria-hidden="true" className="h-4 w-4 flex-none text-emphasis" />
        {organization
          ? `Verified ${PARTNER_ROLE_NAME.toLowerCase()} of ${organization}`
          : `Verified ${PARTNER_ROLE_NAME.toLowerCase()}`}
      </p>
      <label htmlFor={id} className="block font-extrabold font-head text-[0.96875rem] text-ink">
        Your profession
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.45]">
        {saved === '' ? 'You are staff. Write your profession for members. ' : ''}
        Shown beside your name as “{PARTNER_ROLE_NAME} · {clean || 'your profession'}”.
      </p>
      {saved !== null ? (
        <>
          <input
            ref={input}
            id={id}
            value={draft}
            maxLength={MAX}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder="Physical therapist, SCI-FIT"
            className="mt-2 min-h-[44px] w-full rounded-[11px] border-[1.6px] border-line bg-canvas px-3 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
          />
          {changed ? (
            <button
              type="submit"
              disabled={!ready || busy}
              className="mt-2 min-h-[44px] rounded-xl bg-action px-5 font-bold text-[0.875rem] text-white hover:bg-action-hi disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
