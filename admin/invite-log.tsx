import { useEffect, useState } from 'react';
import { FilterChip } from '@/components/filter-sheet-shell';
import {
  type CodeEntry,
  type EmailEntry,
  fetchInviteLog,
  type LogEntry,
  type Person,
} from '@/lib/invite-log';

/**
 * admin.thesciclub.com › Invites (the owner, 2026-11-25): "a chronological
 * list of all e-mail invites sent and by whom, if the invites were opened and
 * if they were used to create an account (if so what account with a link to
 * the users profile page), and QR codes generated. For all QR codes and links
 * have the author, show a list of users that created profiles from them."
 * ("By admin I mean on admin.thesciclub.com.") Newest first, from
 * admin_invite_log (20261125130000).
 */

/** Profiles, events and posts are the members' app's: links open it. */
const APP_ORIGIN = (import.meta.env.VITE_APP_ORIGIN as string | undefined) ?? '';

function AppLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={`${APP_ORIGIN}${to}`} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

const PAGE = 30;

type Show = 'all' | 'email' | 'code';

const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'email', label: 'Emails' },
  { value: 'code', label: 'Codes & links' },
];

const linkClass = 'underline underline-offset-2';

function Who({ person, gone }: { person: Person | null; gone: string }) {
  if (!person) return <>{gone}</>;
  return (
    <AppLink to={`/peers/${person.id}`} className={linkClass}>
      {person.name ?? 'A member'}
    </AppLink>
  );
}

/**
 * "Nov 20 at 3:05 PM" this year, "Nov 20, 2025 at 3:05 PM" before it, or the
 * bare string if it does not read.
 */
function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // Kept on one line, so "AM" never wraps onto a line of its own.
  return `${day} at ${time}`.replace(/\s/g, ' ');
}

/** The steps an invite email can reach, in order. */
function emailSteps(entry: EmailEntry): { label: string; reached: boolean }[] {
  return [
    // Clicking the link means they opened it, even when the mail app never said.
    { label: 'Opened', reached: entry.openedAt !== null || entry.linkOpenedAt !== null },
    { label: 'Clicked the link', reached: entry.linkOpenedAt !== null },
    { label: 'Made an account', reached: entry.accountAt !== null },
    { label: 'Joined', reached: entry.member !== null },
  ];
}

function EmailRow({ entry }: { entry: EmailEntry }) {
  const sender = entry.organization ?? (
    <Who person={entry.sentBy} gone="a member no longer in the club" />
  );
  const steps = emailSteps(entry);
  const reached = steps.filter((step) => step.reached);
  const notYet = steps.filter((step) => !step.reached);
  // Says it below, with the date.
  const halfJoinedAt = entry.member === null ? entry.accountAt : null;
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
            <AppLink to={`/events/${entry.event.id}`} className={linkClass}>
              {entry.event.title}
            </AppLink>
          </>
        ) : null}
        {entry.status === 'revoked' ? ' · taken off the list' : ''}
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[0.75rem]">
        {reached.length ? (
          reached.map((step) => (
            <span
              key={step.label}
              className="rounded-full bg-tint px-2 py-0.5 font-bold text-emphasis"
            >
              {step.label}
            </span>
          ))
        ) : (
          <span className="text-grey">No sign it was opened yet</span>
        )}
        {reached.length && notYet.length && halfJoinedAt === null ? (
          <span className="text-grey">
            Not yet: {notYet.map((step) => step.label.toLowerCase()).join(', ')}
          </span>
        ) : null}
      </span>
      {halfJoinedAt ? (
        <span className="mt-1 block text-[0.75rem] text-ink2">
          Made an account on {when(halfJoinedAt)} but has not set up a profile yet, so there is none
          to open
        </span>
      ) : null}
      {entry.member ? (
        <span className="mt-1 block text-[0.75rem] text-ink2">
          Joined as{' '}
          <AppLink to={`/peers/${entry.member.id}`} className={`${linkClass} text-ink`}>
            {entry.member.name ?? 'a member'}
          </AppLink>{' '}
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
  qr: ', with “Make QR code” on the Me tab',
  link: ', with “Make invite link” on the Me tab',
  qr_and_link: ', with both “Make QR code” and “Make invite link” on the Me tab',
  // "Shared post link … Shared by" already says how.
  share: '',
  // Made before 2026-11-25, when the button started being kept.
  none: ' (which button made it was not kept then)',
};

/** Turned off or past its end date: nobody new can join from it. */
function codeOver(entry: CodeEntry, now: Date): boolean {
  return (
    entry.turnedOffAt !== null ||
    (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now.getTime())
  );
}

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
            <AppLink
              to={`/chat/rooms/${entry.post.roomId}/topics/${entry.post.id}`}
              className={linkClass}
            >
              {entry.post.title}
            </AppLink>
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
                <AppLink to={`/peers/${member.id}`} className={`${linkClass} text-ink`}>
                  {member.name ?? 'A member'}
                </AppLink>{' '}
                <span className="text-grey">· {when(member.joinedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <span className="mt-1 block text-[0.75rem] text-grey">
          {codeOver(entry, now) ? 'Nobody joined from it' : 'Nobody has joined from it yet'}
        </span>
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
  // Every shared post makes a link; in All, only the ones somebody joined from.
  const kept = (entries ?? []).filter((e) =>
    show === 'all'
      ? !(e.kind === 'code' && e.madeAs === 'share' && e.joined.length === 0)
      : e.kind === show,
  );
  const shown = kept.slice(0, count);

  return (
    <>
      <div className="mt-4">
        <h2 className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          Invite log
        </h2>
        <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
          Every invite email, QR code and invite link, newest first. Underlined names and events
          open in the app. “Joined” means they set up a profile, not just an account. “Opened” is
          approximate: some mail apps never report it. “All” leaves out shared post links nobody
          joined from.
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
