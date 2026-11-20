import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { describeThrown } from '@/lib/describe-error';
import { type ReadSheet, readSheet, SHEET_LIMIT, sheetCsvUrl } from '@/lib/invite-sheet';
import { sendInvite } from '@/lib/send-invite';
import type { InviteEmail } from '../../supabase/functions/send-invite/compose';

/**
 * The parts every "invite a list" form shares (the owner, 2026-11-14): the
 * list itself (a Google Sheet link, or addresses pasted from Gmail, a
 * spreadsheet or anywhere), the message with its suggestion, the email as it
 * will read, and the emails going out one at a time with what became of each.
 * Used by the administrator's Invites (routes/admin/invite-sheet.tsx) and an
 * event's organizers (routes/events/event-invite-list.tsx).
 */

const field =
  'mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis disabled:opacity-40';
const label = 'block font-bold text-[0.75rem] text-ink';
const hint = 'mt-1.5 text-[0.75rem] text-grey leading-[1.45]';

/** Between two emails: the email service takes about two a second. */
const GAP_MS = 600;

/** A CSV bigger than this is not a list of people (200 at most). */
const CSV_MAX_BYTES = 2_000_000;

export function PeopleListField({
  id,
  onRead,
  list,
}: {
  id: string;
  /** What was found, or null while there is nothing to read. */
  onRead: (read: ReadSheet | null) => void;
  /** Draws the people found, in place of the plain list (the administrator's table). */
  list?: (read: ReadSheet) => ReactNode;
}) {
  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  // Read from the link or from a CSV file, whichever came last.
  const [fromLink, setFromLink] = useState<ReadSheet | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const read = useMemo(() => (pasted.trim() ? readSheet(pasted) : fromLink), [pasted, fromLink]);
  useEffect(() => {
    onRead(read);
  }, [read, onRead]);

  async function readLink() {
    const url = sheetCsvUrl(link);
    if (!url) {
      setError('That is not a Google Sheets link. Copy it from the sheet’s Share button.');
      return;
    }
    setReading(true);
    setError(null);
    try {
      const response = await fetch(url);
      const text = await response.text();
      // A sheet that is not shared answers with Google's sign-in page.
      if (!response.ok || /^\s*<!doctype html|<html/i.test(text)) {
        setError(
          'Google did not let the club read that sheet. In the sheet, press Share, set General access to “Anyone with the link”, and try again.',
        );
        setFromLink(null);
        return;
      }
      setPasted('');
      setFileName(null);
      setFromLink(readSheet(text));
    } catch (e) {
      setError(describeThrown(e, 'The sheet could not be read. Check the link and try again.'));
    } finally {
      setReading(false);
    }
  }

  // A CSV saved from Excel, Numbers or a sheet (the owner, 2026-11-19: "an
  // option to import csv in addition to a google sheets link"). Read here, in
  // the browser: the file goes nowhere.
  async function readFile(chosen: File) {
    setError(null);
    if (chosen.size > CSV_MAX_BYTES) {
      setError(
        'That file is too big for a list of people. Save just the sheet with them as a CSV.',
      );
      return;
    }
    try {
      const text = await chosen.text();
      setPasted('');
      setLink('');
      setFileName(chosen.name);
      setFromLink(readSheet(text));
    } catch (e) {
      setError(describeThrown(e, 'The file could not be read. Save it as a CSV and try again.'));
    }
  }

  const people = read?.people ?? [];

  return (
    <>
      <label htmlFor={`${id}-link`} className={label}>
        Google Sheet link
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id={`${id}-link`}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
          }}
          className="min-w-0 flex-1 rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis"
        />
        <button
          type="button"
          disabled={!link.trim() || reading}
          onClick={() => {
            void readLink();
          }}
          className="min-h-[42px] flex-none rounded-[11px] bg-tint px-3.5 font-bold font-head text-[0.8125rem] text-emphasis disabled:opacity-40"
        >
          {reading ? 'Reading…' : 'Read it'}
        </button>
      </div>
      <p className={hint}>
        In the sheet, press Share and set General access to “Anyone with the link”. It needs a
        column of email addresses; a First name or Name column is used to greet each person.
      </p>
      <p className={`${label} mt-3`} id={`${id}-file-label`}>
        Or import a CSV file
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          ref={file}
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          aria-labelledby={`${id}-file-label`}
          className="sr-only"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            // The same file again, after a change to it, is read again.
            e.target.value = '';
            if (chosen) void readFile(chosen);
          }}
        />
        <button
          type="button"
          aria-describedby={`${id}-file-hint`}
          onClick={() => {
            file.current?.click();
          }}
          className="min-h-[42px] flex-none rounded-[11px] bg-tint px-3.5 font-bold font-head text-[0.8125rem] text-emphasis"
        >
          Choose a CSV file
        </button>
        {fileName && !pasted.trim() ? (
          <span className="min-w-0 text-[0.8125rem] text-ink2 [overflow-wrap:anywhere]">
            {fileName}
          </span>
        ) : null}
      </div>
      <p id={`${id}-file-hint`} className={hint}>
        Saved from Excel, Numbers or Google Sheets (File, Download, CSV). It stays on this device;
        only the addresses and names are sent.
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}

      <label htmlFor={`${id}-paste`} className={`${label} mt-3`}>
        Or paste email addresses
      </label>
      <textarea
        id={`${id}-paste`}
        rows={3}
        autoCapitalize="none"
        placeholder={'Ana Ruiz <ana@example.com>, bo@example.com, cy@example.com'}
        value={pasted}
        onChange={(e) => {
          setPasted(e.target.value);
        }}
        className={field}
      />
      <p className={hint}>
        Separated by commas, spaces or new lines, copied from Gmail’s To line with the names, or
        rows copied out of a spreadsheet.
      </p>

      {read ? (
        <div className="mt-3">
          <p className="font-bold text-[0.8125rem] text-ink">
            {people.length === 0
              ? 'No email addresses found.'
              : `${people.length} ${people.length === 1 ? 'person' : 'people'} to invite`}
            {read.repeats > 0 ? ` · ${read.repeats} repeated, kept once` : ''}
          </p>
          {people.length > 0 && list ? (
            list(read)
          ) : people.length > 0 ? (
            <ul className="mt-1.5 max-h-[11rem] overflow-y-auto rounded-[11px] border border-line text-[0.8125rem]">
              {people.map((p) => (
                <li
                  key={p.email}
                  className="border-line border-b px-3 py-1.5 last:border-b-0 [overflow-wrap:anywhere]"
                >
                  {p.name ? <span className="font-bold text-ink">{p.name} · </span> : null}
                  <span className="text-ink2">{p.email}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {read.skipped.length > 0 ? (
            <p className={hint}>
              {read.skipped.length} row{read.skipped.length === 1 ? '' : 's'} without an email
              address left out.
            </p>
          ) : null}
          {people.length > SHEET_LIMIT ? (
            <p role="alert" className="mt-1.5 text-[0.78125rem] text-destructive leading-[1.45]">
              Up to {SHEET_LIMIT} at a time. Split the list and send it in parts.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The message box, starting from a suggestion that is theirs to change or empty. */
export function MessageField({
  id,
  suggested,
  edited,
  onEdit,
}: {
  id: string;
  suggested: string;
  /** Null until they change it. */
  edited: string | null;
  onEdit: (value: string | null) => void;
}) {
  return (
    <>
      <label htmlFor={`${id}-message`} className={`${label} mt-3`}>
        Your message
      </label>
      <textarea
        id={`${id}-message`}
        rows={4}
        maxLength={1000}
        placeholder="Leave it empty to send the email without a message."
        value={edited ?? suggested}
        onChange={(e) => {
          onEdit(e.target.value);
        }}
        className={field}
      />
      <p className={hint}>
        A suggestion to change as you like. It is quoted in the email, from you. Others can see an
        inbox, so keep it general.
      </p>
      {edited !== null && edited !== suggested ? (
        <button
          type="button"
          onClick={() => {
            onEdit(null);
          }}
          className="mt-1.5 min-h-[36px] rounded-full bg-tint px-3 font-bold font-head text-[0.75rem] text-emphasis"
        >
          Use the suggested message
        </button>
      ) : null}
    </>
  );
}

export function EmailPreview({ email }: { email: InviteEmail }) {
  return (
    <details className="mt-3 rounded-[11px] border border-line">
      <summary className="cursor-pointer px-3 py-2 font-bold text-[0.8125rem] text-emphasis">
        See the email
      </summary>
      <div className="border-line border-t px-3 py-2.5 text-[0.8125rem] leading-[1.5]">
        <p className="text-grey">From: {email.senderName}</p>
        <p className="text-grey">Subject: {email.subject}</p>
        <p className="mt-2 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{email.text}</p>
      </div>
    </details>
  );
}

export interface SendLine {
  email: string;
  name: string | null;
  state: 'waiting' | 'sent' | 'failed' | 'skipped' | 'done';
  /** Why it was skipped, why it failed, or what was done instead of an email. */
  why?: string;
}

/** A list's entries as lines: those with an invite wait for their email. */
export function linesFor(
  entries: { email: string; name: string | null; outcome: string; inviteId: string | null }[],
  says: Record<string, { state: 'skipped' | 'done'; why: string }>,
): SendLine[] {
  return entries.map((e) =>
    e.outcome === 'added' && e.inviteId
      ? { email: e.email, name: e.name, state: 'waiting' }
      : {
          email: e.email,
          name: e.name,
          ...(says[e.outcome] ?? { state: 'skipped' as const, why: 'not invited' }),
        },
  );
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Sends each waiting invite, a little apart, reporting every line as it settles. */
export async function sendEach(
  entries: { inviteId: string | null; outcome: string }[],
  start: SendLine[],
  onChange: (lines: SendLine[]) => void,
): Promise<void> {
  const lines = [...start];
  let first = true;
  for (const [i, entry] of entries.entries()) {
    const line = lines[i];
    if (entry.outcome !== 'added' || !entry.inviteId || !line) continue;
    if (!first) await wait(GAP_MS);
    first = false;
    const sent = await sendInvite(entry.inviteId);
    lines[i] = sent.ok ? { ...line, state: 'sent' } : { ...line, state: 'failed', why: sent.error };
    onChange([...lines]);
  }
}

export function SendResults({
  lines,
  sending,
  error,
  onStartOver,
}: {
  lines: SendLine[];
  sending: boolean;
  error: string | null;
  onStartOver: () => void;
}) {
  const sent = lines.filter((l) => l.state === 'sent').length;
  const waiting = lines.filter((l) => l.state === 'waiting').length;
  return (
    <div className="p-3.5">
      <p role="status" aria-live="polite" className="font-bold text-[0.875rem] text-ink">
        {waiting > 0
          ? `Sending… ${sent} of ${sent + waiting} sent`
          : `${sent} invite${sent === 1 ? '' : 's'} sent.`}
      </p>
      <ul className="mt-2.5 max-h-[22rem] overflow-y-auto rounded-[11px] border border-line">
        {lines.map((l) => (
          <li
            key={l.email}
            className="border-line border-b px-3 py-2 text-[0.8125rem] leading-[1.4] last:border-b-0"
          >
            <span className="block font-bold text-ink [overflow-wrap:anywhere]">
              {l.name ? `${l.name} · ` : ''}
              {l.email}
            </span>
            <span className={`block ${l.state === 'failed' ? 'text-destructive' : 'text-grey'}`}>
              {l.state === 'sent'
                ? 'Sent'
                : l.state === 'waiting'
                  ? 'Waiting…'
                  : l.state === 'failed'
                    ? `On the list, but the email did not go: ${l.why ?? ''} Use Resend.`
                    : l.state === 'done'
                      ? (l.why ?? '')
                      : `Skipped: ${l.why ?? ''}`}
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={sending}
        onClick={onStartOver}
        className="mt-3 flex min-h-[42px] w-full items-center justify-center rounded-[11px] border border-line font-bold font-head text-[0.875rem] text-emphasis disabled:opacity-40"
      >
        Start a new list
      </button>
    </div>
  );
}

export const inviteListField = field;
export const inviteListLabel = label;

/**
 * "Invite as a mentor" (the owner, 2026-11-19: "let them specify that these
 * users will be mentors. If they join, they should automatically be mentors
 * for the org the admin selected"). Shown only with an organization chosen
 * that the inviter may make mentors for; the database checks again
 * (set_invites_mentor, 20261119200000).
 *
 * A native checkbox inside its label, as QuestionSwitch is: the whole row is
 * the target, and a screen reader hears one control with its explanation.
 */
export function MentorField({
  id,
  organization,
  many = false,
  hint,
  checked,
  onChange,
}: {
  id: string;
  organization: string;
  /** A list of people, not one. */
  many?: boolean;
  /** Said under it in place of what joining does. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={`${id}-mentor`}
      className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[11px] border-[1.6px] border-line bg-paper px-3 py-2.5 has-[:checked]:border-emphasis has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emphasis has-[:focus-visible]:outline-offset-2"
    >
      <input
        id={`${id}-mentor`}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        aria-describedby={`${id}-mentor-hint`}
        className="mt-[0.2em] h-[1.15em] w-[1.15em] flex-none accent-emphasis outline-none"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-[0.875rem] text-ink">
          {many ? 'Invite them as mentors' : 'Invite as a mentor'}
        </span>
        <span
          id={`${id}-mentor-hint`}
          className="mt-0.5 block text-[0.78125rem] text-ink2 leading-[1.45]"
        >
          {hint ??
            (many
              ? `When they join, they become mentors for ${organization}.`
              : `When they join, they become a mentor for ${organization}.`)}
        </span>
      </span>
    </label>
  );
}
