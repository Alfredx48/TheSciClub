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
  // Mentors of the organization chosen, when they join (the owner, 2026-11-19).
  const [asMentor, setAsMentor] = useState(false);
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
  const suggested = suggestedMessage(organizationName, asMentor);
  const message = edited ?? suggested;
  const people = read?.people ?? [];
  const tooMany = people.length > SHEET_LIMIT;

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
    const mentors = asMentor && organizationName !== null;
    if (
      !window.confirm(
        `Send ${count} invite email${count === 1 ? '' : 's'} from you${organizationName ? `, with ${organizationName}` : ''}${mentors ? ', as mentors' : ''}?`,
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
      if (mentors) {
        const ids = added.entries.flatMap((entry) =>
          entry.outcome === 'added' && entry.inviteId ? [entry.inviteId] : [],
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
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="p-3.5">
      <PeopleListField key={round} id="sheet" onRead={onRead} />

      <label htmlFor="sheet-organization" className={`${inviteListLabel} mt-3`}>
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
          checked={asMentor}
          onChange={setAsMentor}
        />
      ) : null}

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
