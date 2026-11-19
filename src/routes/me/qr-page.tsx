import { Link as LinkIcon, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { OrganizationPicker } from '@/components/organization-picker';
import { QrCode } from '@/components/qr-code';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { PARTNER_ROLE_NAME, useIAmPartner } from '@/lib/club-partners';
import { useDialogFocus } from '@/lib/dialog-focus';
import { useMemberOrganizations } from '@/lib/organization-members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import {
  createQrCode,
  fetchMyQrCodes,
  isLive,
  type MyQrCode,
  qrJoinUrl,
  turnOffQrCode,
} from '@/lib/qr-codes';
import { copyWhenReady, shareLink } from '@/lib/share-link';
import { cn } from '@/lib/utils';

/**
 * Your QR code: an administrator's for conventions (20261014020000), and an
 * org admin's for their people (20261028960000, the owner, 2026-10-28).
 *
 * An org admin's code is for their organization: whoever scans it, or opens
 * its link, before it expires can join, as invited by them, even while the
 * club is invite only. An administrator chooses one of their organizations
 * too, or none. Since 20261119130000 a code with none lets people in too (the
 * owner, 2026-11-19: their invitees were sent to ask them for an invite); it
 * only gave credit before. Only administrators name an event.
 *
 * Every code expires after a day unless its maker chooses otherwise, and
 * may carry a note only its maker sees. Every code made is listed below with
 * when it was made, when it expires, and a way to turn it off.
 *
 * A professional's own code, with no organization, lets people in as an
 * org admin's does (20261029100000). An org admin may leave their
 * organization out too (the owner, 2026-11-19: "any active admin of any
 * organization", 20261119140000): whoever joins is credited to them and joins
 * no organization.
 */

const WHEN: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-US', WHEN);

/** How long a code lasts, in hours; a day unless chosen otherwise (the owner, 2026-10-28). */
export const EXPIRY_CHOICES = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 24 * 7, label: '7 days' },
  { hours: 24 * 30, label: '30 days' },
] as const;
export const DEFAULT_EXPIRY_HOURS = 24;
const NO_ORGANIZATION = '';

const FIELD =
  'mt-1.5 w-full rounded-[11px] border-[1.6px] border-line bg-paper px-3 py-2 text-[0.9375rem] text-ink outline-none focus:border-emphasis';

export default function QrCodePage() {
  const account = useAccount();
  const announce = useAnnounce();
  const memberId = account.status === 'member' ? account.userId : null;
  const mine = useMyOrganizations(memberId);
  const partner = useIAmPartner(memberId);
  const { organizations: everyOrganization, byId } = useOrganizations();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [atEvent, setAtEvent] = useState(false);
  const [eventName, setEventName] = useState('');
  const [expires, setExpires] = useState(true);
  const [hours, setHours] = useState<number>(DEFAULT_EXPIRY_HOURS);
  const [notes, setNotes] = useState('');
  const [codes, setCodes] = useState<MyQrCode[] | null>(null);
  const [showing, setShowing] = useState<MyQrCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The link just made with Make a link, and whether it reached the clipboard.
  const [linkNote, setLinkNote] = useState<{
    url: string;
    copied: boolean;
    expiresAt: string | null;
  } | null>(null);

  const isAdmin = account.status === 'member' && account.isAdmin;
  // The organizations this member is an org admin of, by name.
  const organizations = [...mine.ids]
    .map((id) => byId.get(id))
    .filter((organization) => organization !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  // An administrator may make a code for any of them (the owner, 2026-11-01); the
  // database has always allowed it (create_qr_code). There are too many to
  // list (the owner, 2026-11-05): theirs are listed, the rest are a search.
  const memberOf = useMemberOrganizations(isAdmin ? (memberId ?? undefined) : undefined);
  const offered = isAdmin
    ? [...new Set([...mine.ids, ...memberOf])]
        .map((id) => byId.get(id))
        .filter((organization) => organization !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name))
    : organizations;
  const mayMake = isAdmin || organizations.length > 0 || partner === true;
  // A partner's code with no organization lets people in and needs no email.
  const ownCode = partner === true && !isAdmin;
  // The first of theirs until they choose; an administrator with none makes
  // a code with no organization.
  const forOrganization =
    organizationId === null ? (organizations[0]?.id ?? null) : organizationId || null;

  const load = useCallback(async () => {
    const result = await fetchMyQrCodes();
    if (result.ok) setCodes(result.codes);
    else setError(result.error);
  }, []);

  useEffect(() => {
    if (!mayMake) return;
    void load();
  }, [mayMake, load]);

  if (
    account.status === 'loading' ||
    (account.status === 'member' && (mine.loading || partner === null))
  ) {
    return <div className="min-h-dvh bg-canvas" />;
  }
  if (account.status !== 'member') return <Navigate to="/join" replace />;
  if (!mayMake) return <Navigate to="/me" replace />;

  const event = isAdmin && atEvent ? eventName.trim() : '';
  const ready = !(isAdmin && atEvent) || event !== '';
  const nameOf = (code: MyQrCode) =>
    code.organizationId
      ? (byId.get(code.organizationId)?.name ?? 'Your organization')
      : code.madeAsPartner
        ? 'Your own code'
        : (code.eventName ?? 'No event');

  function made() {
    return createQrCode({
      organizationId: forOrganization,
      eventName: event || null,
      contactEmail: null,
      expiresAt: expires ? new Date(Date.now() + hours * 3_600_000) : null,
      notes: notes.trim() || null,
    });
  }

  async function make() {
    if (!ready || busy) return;
    setBusy('new');
    setError(null);
    setLinkNote(null);
    const result = await made();
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotes('');
    setShowing(result.code);
    void load();
  }

  // The same code as a link, made and copied in one press (the owner,
  // 2026-10-28). Started inside the tap, so Safari lets it copy.
  function makeLink() {
    if (!ready || busy) return;
    setBusy('link');
    setError(null);
    setLinkNote(null);
    const making = made();
    void copyWhenReady(making.then((result) => (result.ok ? qrJoinUrl(result.code.code) : null)))
      .then(async (copied) => {
        const result = await making;
        setBusy(null);
        if (!result.ok || !copied) {
          setError(result.ok ? 'The link was not made.' : result.error);
          return;
        }
        setNotes('');
        setLinkNote({ ...copied, expiresAt: result.code.expiresAt });
        announce(copied.copied ? 'Link copied.' : 'Link made. Copy it below.');
        void load();
      })
      .catch(() => {
        setBusy(null);
        setError('The link was not made.');
      });
  }

  async function turnOff(code: MyQrCode) {
    const name = nameOf(code);
    if (
      !window.confirm(
        `Turn off the code for ${name}?\n\nScanning it will no longer let anyone in or say who invited them. People who already joined from it stay.`,
      )
    ) {
      return;
    }
    setBusy(code.id);
    setError(null);
    const result = await turnOffQrCode(code.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    announce(`The code for ${name} is turned off.`);
    void load();
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        <div className="mx-auto w-full max-w-[560px]">
          <BackLink to="/me" label="Me" />
          <h1 className="mt-1 font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
            Create QR code or invite link
          </h1>
          <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
            Anyone who scans your code or opens its link before it expires can join the club, as
            invited by you. You are told when they do.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[560px] flex-none px-4 pt-4 pb-8">
        <form
          className="rounded-[14px] border border-line bg-paper p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          {/* An org admin may leave their organization out too (20261119140000). */}
          {offered.length > 0 || (isAdmin && everyOrganization.length > 0) ? (
            <>
              <OrganizationPicker
                id="qr-organization"
                label="Who it's for"
                yours={offered}
                others={isAdmin ? everyOrganization : []}
                value={forOrganization ?? NO_ORGANIZATION}
                onChange={setOrganizationId}
                none={
                  ownCode ? `Just you, as ${PARTNER_ROLE_NAME.toLowerCase()}` : 'No organization'
                }
                className={FIELD}
              />
              {/* The owner, 2026-11-19: "if an invite code is tied to a user, we
                  do not need to associate that new member with an organization". */}
              {forOrganization === null ? (
                <p className="mt-1 text-[0.75rem] text-grey leading-[1.45]">
                  They join the club only, not an organization.
                </p>
              ) : null}
            </>
          ) : forOrganization ? (
            <p className="text-[0.875rem] text-ink">
              For <b>{byId.get(forOrganization)?.name}</b>
            </p>
          ) : ownCode ? (
            <p className="text-[0.875rem] text-ink">
              Your own code, as {PARTNER_ROLE_NAME.toLowerCase()}
            </p>
          ) : null}

          {/* Events are for administrators' codes only (the owner, 2026-10-28). */}
          {isAdmin ? (
            <fieldset className="mt-3">
              <legend className="font-bold text-[0.875rem] text-ink">
                Where will you show it?
              </legend>
              <div className="mt-1.5 flex flex-col gap-1">
                <label className="flex min-h-[44px] items-center gap-2.5 text-[0.9375rem] text-ink">
                  <input
                    type="radio"
                    name="qr-event"
                    checked={!atEvent}
                    onChange={() => {
                      setAtEvent(false);
                    }}
                    className="h-5 w-5 accent-[var(--color-action)]"
                  />
                  No event
                </label>
                <label className="flex min-h-[44px] items-center gap-2.5 text-[0.9375rem] text-ink">
                  <input
                    type="radio"
                    name="qr-event"
                    checked={atEvent}
                    onChange={() => {
                      setAtEvent(true);
                    }}
                    className="h-5 w-5 accent-[var(--color-action)]"
                  />
                  At an event
                </label>
              </div>
              {atEvent ? (
                <div className="mt-2">
                  <label
                    htmlFor="qr-event-name"
                    className="block font-bold text-[0.8125rem] text-ink"
                  >
                    Event name
                  </label>
                  <input
                    id="qr-event-name"
                    value={eventName}
                    maxLength={80}
                    placeholder="Abilities Expo LA"
                    onChange={(e) => {
                      setEventName(e.target.value);
                    }}
                    className={FIELD}
                  />
                  <p className="mt-1 text-[0.75rem] text-grey leading-[1.45]">
                    Admin counts who joined by this name, so type it the same way each time.
                  </p>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          <div className="mt-3.5">
            <label className="flex min-h-[44px] items-center gap-2.5 text-[0.9375rem] text-ink">
              <input
                type="checkbox"
                checked={expires}
                onChange={(e) => {
                  setExpires(e.target.checked);
                }}
                className="h-5 w-5 accent-[var(--color-action)]"
              />
              Expires
            </label>
            {expires ? (
              <>
                <label htmlFor="qr-expiry" className="sr-only">
                  Expires after
                </label>
                <select
                  id="qr-expiry"
                  value={hours}
                  onChange={(e) => {
                    setHours(Number(e.target.value));
                  }}
                  className={FIELD}
                >
                  {EXPIRY_CHOICES.map((choice) => (
                    <option key={choice.hours} value={choice.hours}>
                      After {choice.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-[0.75rem] text-grey leading-[1.45]">
                It works until you turn it off.
              </p>
            )}
          </div>

          <div className="mt-3.5">
            <label htmlFor="qr-notes" className="block font-bold text-[0.8125rem] text-ink">
              Notes (optional)
            </label>
            <textarea
              id="qr-notes"
              value={notes}
              maxLength={300}
              rows={2}
              placeholder="Who you gave it to, or where you shared it"
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              className={cn(FIELD, 'resize-none')}
            />
            <p className="mt-1 text-[0.75rem] text-grey leading-[1.45]">Only you see these.</p>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}

          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button
              type="submit"
              disabled={!ready || busy !== null}
              className="flex min-h-[48px] items-center justify-center rounded-[11px] bg-action px-2 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
            >
              {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Make the QR code'}
            </button>
            <button
              type="button"
              disabled={!ready || busy !== null}
              onClick={makeLink}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-[11px] border-[1.6px] border-emphasis px-2 font-bold font-head text-[0.9375rem] text-emphasis disabled:opacity-40"
            >
              {busy === 'link' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <LinkIcon className="h-4 w-4" aria-hidden="true" />
                  Make a link
                </>
              )}
            </button>
          </div>
          {linkNote ? (
            <div
              role="status"
              className="mt-3 rounded-[11px] bg-tint px-3 py-2.5 text-[0.8125rem] text-ink leading-[1.45]"
            >
              <p className="font-bold">
                {linkNote.copied ? 'Link copied.' : 'Link made. Copy it to share it:'}
                {linkNote.expiresAt ? ` It works until ${when(linkNote.expiresAt)}.` : ''}
              </p>
              <p className="mt-1 select-all break-all text-ink2">{linkNote.url}</p>
            </div>
          ) : null}
        </form>

        <h2 className="mt-6 mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          Your codes
        </h2>
        {codes === null ? (
          <p className="py-6 text-center text-[0.875rem] text-grey">Loading your codes…</p>
        ) : codes.length === 0 ? (
          <p className="rounded-[14px] border border-line bg-paper px-3.5 py-6 text-center text-[0.875rem] text-grey">
            You have not made a code yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-[14px] border border-line bg-paper">
            {codes.map((code) => {
              const live = isLive(code);
              return (
                <li
                  key={code.id}
                  className="flex flex-wrap items-center gap-2 border-line border-b p-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 basis-[13rem]">
                    <span
                      className={cn(
                        'block break-words font-extrabold font-head text-[0.90625rem]',
                        live ? 'text-ink' : 'text-grey',
                      )}
                    >
                      {nameOf(code)}
                      {code.organizationId && code.eventName ? ` · ${code.eventName}` : ''}
                    </span>
                    <span className="mt-0.5 block break-words text-[0.75rem] text-grey leading-[1.45]">
                      Made {when(code.createdAt)} · {statusOf(code)}
                    </span>
                    {code.notes ? (
                      <span className="mt-0.5 block break-words text-[0.8125rem] text-ink2 leading-[1.45]">
                        {code.notes}
                      </span>
                    ) : null}
                  </span>
                  {!live ? null : busy === code.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-grey" />
                  ) : (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setShowing(code);
                        }}
                        className="min-h-[44px] rounded-[10px] bg-tint px-3 font-semibold text-[0.8125rem] text-emphasis disabled:opacity-40"
                      >
                        Show
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          void turnOff(code);
                        }}
                        className="min-h-[44px] rounded-[10px] bg-destructive/10 px-3 font-semibold text-[0.8125rem] text-destructive disabled:opacity-40"
                      >
                        Turn off
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showing ? (
        <ShowingCode
          code={showing}
          title={nameOf(showing)}
          inviterName={account.displayName}
          onClose={() => {
            setShowing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** "expires Oct 31, 2026, 3:15 PM", "expired …", "turned off …", or what a code with no end does. */
function statusOf(code: MyQrCode): string {
  if (code.turnedOffAt) return `turned off ${when(code.turnedOffAt)}`;
  if (code.expiresAt) {
    return `${Date.parse(code.expiresAt) > Date.now() ? 'expires' : 'expired'} ${when(code.expiresAt)}`;
  }
  return 'no expiry';
}

/**
 * The code, as large as the screen allows, over everything including the tab
 * bar: it is held up across a table. White whatever the theme, for the camera.
 */
function ShowingCode({
  code,
  title: heading,
  inviterName,
  onClose,
}: {
  code: MyQrCode;
  /** The organization it is for, or the event. */
  title: string;
  inviterName: string | null;
  onClose: () => void;
}) {
  const announce = useAnnounce();
  const dialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useDialogFocus(dialog, title, onClose);
  const url = qrJoinUrl(code.code);
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function share() {
    const outcome = await shareLink({
      url,
      title: 'The SCI Club',
      text: inviterName
        ? `${inviterName} invited you to The SCI Club.`
        : 'You are invited to The SCI Club.',
    });
    if (outcome === 'copied') {
      setShareNote('Link copied.');
      announce('Link copied.');
    } else if (outcome === 'failed') {
      setShareNote(`Could not share it. The link is ${url}`);
    }
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-showing-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white text-[#111111]"
    >
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the code"
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-full text-[#111111]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <h2
          id="qr-showing-title"
          ref={title}
          tabIndex={-1}
          className="text-center font-extrabold font-display text-[1.5rem] leading-tight outline-none"
        >
          {code.organizationId || code.eventName ? heading : 'The SCI Club'}
        </h2>
        <p className="mt-1 text-center text-[1rem]">
          Scan to join The SCI Club{inviterName ? ` · invited by ${inviterName}` : ''}
        </p>
        <p className="mt-1 text-center text-[0.875rem] text-[#444444]">
          Made {when(code.createdAt)}
          {code.expiresAt ? ` · expires ${when(code.expiresAt)}` : ''}
        </p>
        <div className="mt-4 w-full max-w-[min(100%,62dvh)]">
          <QrCode text={url} label="QR code that opens the club's join page" />
        </div>
        <div className="mt-auto flex w-full flex-col gap-2 pt-5">
          <button
            type="button"
            onClick={() => {
              void share();
            }}
            className="flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-[#111111] font-bold font-head text-[0.9375rem] text-white"
          >
            Share the link
          </button>
          {shareNote ? (
            <p role="status" className="break-all text-center text-[0.875rem]">
              {shareNote}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[48px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-[#111111] font-bold font-head text-[0.9375rem]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
