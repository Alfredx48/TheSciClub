import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterChip } from '@/components/filter-sheet-shell';
import {
  type CodeEntry,
  type EmailEntry,
  fetchInviteLog,
  type LogEntry,
  type Person,
} from '@/lib/invite-log';
import { madeWhen } from '@/routes/admin/sign-in-methods';

/**
 * Admin › Invite log (the owner, 2026-11-25): "a chronological list of all
 * e-mail invites sent and by whom, if the invites were opened and if they
 * were used to create an account (if so what account with a link to the
 * users profile page), and QR codes generated. For all QR codes and links
 * have the author, show a list of users that created profiles from them."
 * Newest first, from admin_invite_log (20261125130000).
 */

const PAGE = 30;

type Show = 'all' | 'email' | 'code';

const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'email', label: 'Invite emails' },
  { value: 'code', label: 'QR codes & links' },
];

const linkClass = 'underline underline-offset-2';

function Who({ person, gone }: { person: Person | null; gone: string }) {
  if (!person) return <>{gone}</>;
  return (
    <Link to={`/peers/${person.id}`} className={linkClass}>
      {person.name ?? 'A member'}
    </Link>
  );
}

function Step({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={
        on ? 'rounded-full bg-tint px-2 py-0.5 font-bold text-emphasis' : 'px-1 py-0.5 text-grey/75'
      }
    >
      {on ? null : <span className="sr-only">Not yet: </span>}
      {children}
    </span>
  );
}

/** "Nov 20, 2026 at 3:05 PM", or the bare string if it does not read. */
const when = (iso: string) => madeWhen(iso) ?? iso;

function EmailRow({ entry }: { entry: EmailEntry }) {
  const sender = entry.organization ?? (
    <Who person={entry.sentBy} gone="a member no longer in the club" />
  );
  return (
    <li className="border-line border-b px-3 py-2.5 text-[0.8125rem] leading-[1.45] last:border-b-0">
      <span className="block [overflow-wrap:anywhere]">
        {entry.name ? <b className="font-bold text-ink">{entry.name} · </b> : null}
        <span className="text-ink2">{entry.email}</span>
      </span>
      <span className="block text-[0.75rem] text-grey">
        Invite email sent by {sender} on {when(entry.at)}
        {entry.event ? (
          <>
            {' '}
            for{' '}
            <Link to={`/events/${entry.event.id}`} className={linkClass}>
              {entry.event.title}
            </Link>
          </>
        ) : null}
        {entry.status === 'revoked' ? ' · taken off the list' : ''}
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1 text-[0.75rem]">
        <Step on={entry.openedAt !== null}>Opened</Step>
        <Step on={entry.linkOpenedAt !== null}>Clicked the link</Step>
        <Step on={entry.accountAt !== null}>Made an account</Step>
        <Step on={entry.member !== null}>Joined</Step>
      </span>
      {entry.member ? (
        <span className="mt-1 block text-[0.75rem] text-ink2">
          Joined as{' '}
          <Link to={`/peers/${entry.member.id}`} className={`${linkClass} font-bold text-ink`}>
            {entry.member.name ?? 'a member'}
          </Link>{' '}
          on {when(entry.member.joinedAt)}
        </span>
      ) : null}
    </li>
  );
}

const CODE_KIND: Record<NonNullable<CodeEntry['madeAs']> | 'none', string> = {
  qr: 'QR code',
  link: 'Invite link',
  qr_and_link: 'QR code and invite link',
  share: 'Shared post link',
  none: 'QR code or invite link',
};

const CODE_HOW: Record<NonNullable<CodeEntry['madeAs']> | 'none', string> = {
  qr: ', with Make QR code on the Me tab',
  link: ', with Make invite link on the Me tab',
  qr_and_link: ', with both Make QR code and Make invite link on the Me tab',
  // "Shared post link … Shared by" already says how.
  share: '',
  none: '',
};

/** Live, turned off or expired, and until when. */
function codeState(entry: CodeEntry, now: Date): string {
  if (entry.turnedOffAt) return `Turned off ${when(entry.turnedOffAt)}`;
  if (entry.expiresAt === null) return 'Live, no end date';
  return Date.parse(entry.expiresAt) > now.getTime()
    ? `Live until ${when(entry.expiresAt)}`
    : `Expired ${when(entry.expiresAt)}`;
}

function CodeRow({ entry, now }: { entry: CodeEntry; now: Date }) {
  const kind = entry.madeAs ?? 'none';
  return (
    <li className="border-line border-b px-3 py-2.5 text-[0.8125rem] leading-[1.45] last:border-b-0">
      <span className="block font-bold text-ink [overflow-wrap:anywhere]">
        {CODE_KIND[kind]}
        {entry.post ? (
          <>
            {': '}
            <Link
              to={`/chat/rooms/${entry.post.roomId}/topics/${entry.post.id}`}
              className={linkClass}
            >
              {entry.post.title}
            </Link>
          </>
        ) : null}
        {entry.organization ? ` from ${entry.organization}` : ''}
        {entry.event ? ` for ${entry.event}` : ''}
      </span>
      <span className="block text-[0.75rem] text-grey">
        {kind === 'share' ? 'Shared' : 'Made'} by{' '}
        <Who person={entry.madeBy} gone="somebody no longer in the club" /> on {when(entry.at)}
        {CODE_HOW[kind]} · {codeState(entry, now)}
      </span>
      {entry.joined.length ? (
        <>
          <span className="mt-1.5 block font-bold text-[0.75rem] text-ink2">
            {entry.joined.length === 1
              ? '1 member joined from it'
              : `${String(entry.joined.length)} members joined from it`}
          </span>
          <ul className="mt-0.5 space-y-0.5 text-[0.75rem] text-ink2">
            {entry.joined.map((member) => (
              <li key={member.id}>
                <Link to={`/peers/${member.id}`} className={`${linkClass} text-ink`}>
                  {member.name ?? 'A member'}
                </Link>{' '}
                <span className="text-grey">· {when(member.joinedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <span className="mt-1 block text-[0.75rem] text-grey">Nobody has joined from it yet</span>
      )}
    </li>
  );
}

export function InviteLogSection() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('all');
  const [count, setCount] = useState(PAGE);

  useEffect(() => {
    void fetchInviteLog().then((result) => {
      if (result.ok) setEntries(result.entries);
      else setError(result.error);
    });
  }, []);

  const now = new Date();
  const kept = (entries ?? []).filter((e) => show === 'all' || e.kind === show);
  const shown = kept.slice(0, count);

  return (
    <>
      <div className="mt-4">
        <h2 className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          Invite log
        </h2>
        <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
          Every invite email sent and every QR code and invite link made, newest first. Tap a name
          to open their profile. “Opened” is approximate: some mail apps open every email
          automatically, and others never report it.
        </p>
      </div>
      <fieldset className="mb-2 flex flex-wrap gap-1.5">
        <legend className="sr-only">Show</legend>
        {SHOW.map((choice) => (
          <FilterChip
            key={choice.value}
            label={choice.label}
            on={show === choice.value}
            onClick={() => {
              setShow(choice.value);
              setCount(PAGE);
            }}
          />
        ))}
      </fieldset>
      <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
        {error ? (
          <p role="alert" className="p-3 text-[0.8125rem] text-destructive">
            {error}
          </p>
        ) : entries === null ? (
          <p role="status" className="p-3 text-[0.8125rem] text-grey">
            Loading…
          </p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-[0.8125rem] text-grey">Nothing here yet.</p>
        ) : (
          <>
            <ul>
              {shown.map((entry) =>
                entry.kind === 'email' ? (
                  <EmailRow key={`e:${entry.id}`} entry={entry} />
                ) : (
                  <CodeRow key={`c:${entry.id}`} entry={entry} now={now} />
                ),
              )}
            </ul>
            {kept.length > shown.length ? (
              <button
                type="button"
                onClick={() => {
                  setCount((c) => c + PAGE);
                }}
                className="block w-full border-line border-t px-3 py-2.5 font-bold font-head text-[0.8125rem] text-emphasis"
              >
                Show {String(Math.min(PAGE, kept.length - shown.length))} more
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
