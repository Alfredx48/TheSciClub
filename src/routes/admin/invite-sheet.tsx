import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EmailPreview,
  inviteListField,
  inviteListLabel,
  linesFor,
  MentorField,
  MessageField,
  PeopleListField,
  type SendLine,
  SendResults,
  sendEach,
} from '@/components/invite-list';
import { useAccount } from '@/lib/account';
import { describeThrown } from '@/lib/describe-error';
import { type ReadSheet, SHEET_LIMIT } from '@/lib/invite-sheet';
import { useMemberOrganizations } from '@/lib/organization-members';
import { setInvitesMentor } from '@/lib/organization-mentors';
import {
  fetchInvitingOrganizations,
  type InvitingOrganization,
  inviteList,
} from '@/routes/admin/members-admin';
import { inviteEmail } from '../../../supabase/functions/send-invite/compose';

/**
 * Inviting a list at once, from a Google Sheet or addresses pasted from
 * anywhere (the owner, 2026-11-14). Every email comes from this administrator
 * by name, with the organization they pick and their own words.
 *
 * The list goes on the club's list in one call; the emails then go one at a
 * time, a little apart. One that fails stays on the list with Resend, like any
 * invite.
 */

const SAYS = {
  member: { state: 'skipped' as const, why: 'already in the club' },
  on_list: { state: 'skipped' as const, why: 'already invited' },
  blocked: { state: 'skipped' as const, why: 'blocked from the club' },
  not_an_email: { state: 'skipped' as const, why: 'not an email address' },
  repeat: { state: 'skipped' as const, why: 'twice in the list' },
};

/**
 * What the message box starts with (the owner, 2026-11-14: "a default message
 * and let the admin customize"). Short and warm, since the email already says
 * what the club is, and nothing about anybody's health.
 */
export function suggestedMessage(organization: string | null, mentors = false): string {
  if (organization && mentors)
    return `I'd love for you to join ${organization} in The SCI Club as a mentor. Signing up only takes a couple of minutes. See you inside!`;
  return organization
    ? `I'd love for you to join ${organization} in The SCI Club. Signing up only takes a couple of minutes. See you inside!`
    : "I'd love for you to join me in The SCI Club. Signing up only takes a couple of minutes. See you inside!";
}

export function InviteSheet({ onCreated }: { onCreated: () => void }) {
  const account = useAccount();
  const [inviting, setInviting] = useState<InvitingOrganization[]>([]);
  const memberOf = useMemberOrganizations(
    account.status === 'member' ? (account.userId ?? undefined) : undefined,
  );
  const organizations = inviting.filter((o) => memberOf.includes(o.id));
  const [read, setRead] = useState<ReadSheet | null>(null);
  const [round, setRound] = useState(0);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  // Mentors of the organization chosen, when they join (the owner, 2026-11-19):
  // everyone on the list to start with, then each person's own box in the
  // table ("an option for the admin to select who is a mentor and who is not").
  const [asMentor, setAsMentor] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<SendLine[] | null>(null);
  const [sending, setSending] = useState(false);
  const onRead = useCallback((next: ReadSheet | null) => {
    setRead(next);
  }, []);

  useEffect(() => {
    void fetchInvitingOrganizations().then(setInviting);
  }, []);

  // One organization of theirs is the one they mean; with several, they pick.
  const chosen = organizationId ?? (organizations.length === 1 ? (organizations[0]?.id ?? '') : '');
  const organizationName = organizations.find((o) => o.id === chosen)?.name ?? null;
  const people = read?.people ?? [];
  const tooMany = people.length > SHEET_LIMIT;
  const isMentor = (email: string) =>
    organizationName !== null && (picked.get(email.toLowerCase()) ?? asMentor);
  const mentorCount = people.filter((person) => isMentor(person.email)).length;
  // One message goes to everyone: it says mentor only when everyone is one.
  const allMentors = asMentor && (people.length === 0 || mentorCount === people.length);
  const suggested = suggestedMessage(organizationName, allMentors);
  const message = edited ?? suggested;

  const preview = useMemo(
    () =>
      inviteEmail(
        {
          inviter: account.displayName ?? 'You',
          organization: organizationName,
          name: people[0]?.name ?? null,
          message: message.trim() || null,
        },
        'https://thesciclub.com/join?invite=…',
      ),
    [account.displayName, organizationName, people, message],
  );

  async function send() {
    if (people.length === 0 || tooMany) return;
    const count = people.length;
    const mentors = mentorCount;
    if (
      !window.confirm(
        `Send ${count} invite email${count === 1 ? '' : 's'} from you${organizationName ? `, with ${organizationName}` : ''}${mentors === 0 ? '' : mentors === count ? ', all as mentors' : `, ${mentors} of them as mentors`}?`,
      )
    )
      return;
    setSending(true);
    setError(null);
    try {
      const added = await inviteList({
        people,
        organizationId: chosen || null,
        message: message.trim() || null,
      });
      if (!added.ok) {
        setError(added.error);
        return;
      }
      // Marked before any email goes: an unmarked invite makes a member, not
      // a mentor (20261119200000). All of them or none.
      if (mentors > 0) {
        const ids = added.entries.flatMap((entry) =>
          entry.outcome === 'added' && entry.inviteId && isMentor(entry.email)
            ? [entry.inviteId]
            : [],
        );
        const marked = await setInvitesMentor(ids, true);
        if (!marked.ok) {
          onCreated();
          setError(
            `They are on the list, but not as mentors (${marked.error}), so no email has gone. Withdraw them from the list below and try again.`,
          );
          return;
        }
      }
      const start = linesFor(added.entries, SAYS);
      setLines(start);
      onCreated();
      await sendEach(added.entries, start, setLines);
      onCreated();
    } catch (e) {
      setError(describeThrown(e, 'The invites did not all go. Check the list below.'));
    } finally {
      setSending(false);
    }
  }

  if (lines) {
    return (
      <SendResults
        lines={lines}
        sending={sending}
        error={error}
        onStartOver={() => {
          setLines(null);
          setRead(null);
          setRound((r) => r + 1);
          setEdited(null);
          setAsMentor(false);
          setPicked(new Map());
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="p-3.5">
      {/* Who they join with and whether they mentor come first: the table
          below starts from them (the owner, 2026-11-19). */}
      <label htmlFor="sheet-organization" className={inviteListLabel}>
        They join with
      </label>
      <select
        id="sheet-organization"
        value={chosen}
        onChange={(e) => {
          setOrganizationId(e.target.value);
        }}
        className={inviteListField}
      >
        <option value="">Just the club</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      {organizationName ? (
        <MentorField
          id="sheet"
          many
          organization={organizationName}
          hint={
            asMentor && mentorCount < people.length
              ? `Only those ticked in the table below become mentors for ${organizationName} when they join.`
              : `When they join, they become mentors for ${organizationName}. Each person can be changed in the table below.`
          }
          checked={asMentor}
          onChange={(next) => {
            // For everyone again: a person changed one by one follows it too.
            setAsMentor(next);
            setPicked(new Map());
          }}
        />
      ) : null}

      <div className="mt-4">
        <PeopleListField
          key={round}
          id="sheet"
          onRead={onRead}
          list={(found) => (
            <PeopleTable
              read={found}
              mentorFor={organizationName}
              isMentor={isMentor}
              mentors={mentorCount}
              onMentor={(email, next) => {
                setPicked((was) => new Map(was).set(email.toLowerCase(), next));
              }}
            />
          )}
        />
      </div>

      <MessageField id="sheet" suggested={suggested} edited={edited} onEdit={setEdited} />
      <EmailPreview email={preview} />

      {error ? (
        <p role="alert" className="mt-2.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={people.length === 0 || tooMany || sending}
        onClick={() => {
          void send();
        }}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[11px] bg-action font-bold font-head text-[0.875rem] text-white disabled:opacity-40"
      >
        {people.length === 0
          ? 'Send the invites'
          : `Send ${people.length} invite${people.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

/**
 * The list as read, every column of it (the owner, 2026-11-19: "open a table
 * with all the data and check boxes next to each user"), with a Mentor box on
 * each row once there is an organization to mentor for. It scrolls both ways
 * in its own box, the boxes kept in view at the left.
 */
function PeopleTable({
  read,
  mentorFor,
  isMentor,
  mentors,
  onMentor,
}: {
  read: ReadSheet;
  mentorFor: string | null;
  isMentor: (email: string) => boolean;
  mentors: number;
  onMentor: (email: string, mentor: boolean) => void;
}) {
  // The address first after the box: it is what is checked before sending,
  // and on a phone the columns after it scroll out of view.
  const header = read.columns ?? ['Email', 'Name'];
  const emailAt = read.columns
    ? Math.max(
        0,
        header.findIndex((c) => /e-?mail/i.test(c)),
      )
    : 0;
  const order = [emailAt, ...header.map((_, i) => i).filter((i) => i !== emailAt)];
  const columns = order.map((i) => header[i] ?? '');
  const cell = 'px-2.5 py-2 align-middle';
  // A line at the box's edge, so cells scrolled under it are plainly behind it.
  const edge = 'sticky left-0 z-[1] shadow-[inset_-1px_0_0_var(--color-line)]';
  return (
    <>
      <div className="mt-1.5 max-h-[24rem] overflow-auto rounded-[11px] border border-line">
        <table className="w-full border-collapse text-left text-[0.8125rem]">
          <caption className="sr-only">
            The people to invite{mentorFor ? ', with whether each is a mentor' : ''}
          </caption>
          <thead className="sticky top-0 z-[1] bg-tint">
            <tr>
              {mentorFor ? (
                <th scope="col" className={`${cell} ${edge} bg-tint font-bold text-ink`}>
                  Mentor
                </th>
              ) : null}
              {columns.map((column, index) => (
                <th
                  // Columns never move: the index is their place.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                  key={index}
                  scope="col"
                  className={`${cell} whitespace-nowrap font-bold text-ink`}
                >
                  {column || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {read.people.map((person, row) => {
              const values = read.columns
                ? (read.rows?.[row] ?? [])
                : [person.email, person.name ?? ''];
              const cells = order.map((i) => values[i] ?? '');
              const who = person.name ?? person.email;
              return (
                <tr key={person.email} className="border-line border-t">
                  {mentorFor ? (
                    <td className={`${edge} bg-paper p-0`}>
                      <label className="grid h-11 w-14 cursor-pointer place-items-center">
                        <input
                          type="checkbox"
                          aria-label={`${who} as a mentor`}
                          checked={isMentor(person.email)}
                          onChange={(event) => {
                            onMentor(person.email, event.target.checked);
                          }}
                          className="h-[1.15em] w-[1.15em] accent-emphasis"
                        />
                      </label>
                    </td>
                  ) : null}
                  {cells.map((value, index) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                      key={index}
                      className={`${cell} whitespace-nowrap text-ink2`}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mentorFor ? (
        <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
          {mentors === 0
            ? `None of them will be mentors for ${mentorFor}.`
            : mentors === read.people.length
              ? `All of them will be mentors for ${mentorFor}.`
              : `${mentors} of ${read.people.length} will be mentors for ${mentorFor}.`}
        </p>
      ) : null}
    </>
  );
}
