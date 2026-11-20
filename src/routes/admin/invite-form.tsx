import { useEffect, useState } from 'react';
import { MentorField } from '@/components/invite-list';
import { useAccount } from '@/lib/account';
import { looksLikeEmail } from '@/lib/auth-email';
import { describeThrown } from '@/lib/describe-error';
import { useMemberOrganizations } from '@/lib/organization-members';
import {
  createInvite,
  fetchInvitingOrganizations,
  type InvitingOrganization,
} from '@/routes/admin/members-admin';

/**
 * Putting an address on the list, and emailing it the link.
 *
 * The list entry and the email are two steps. If the email fails the invite is
 * still on the list, so the form says so and the row has Resend; it does not
 * report a failure the administrator would answer by adding it a second time.
 */
/** The choice of no organization, as against none chosen yet (''). */
const NO_ORGANIZATION = 'none';

export function InviteForm({ onCreated }: { onCreated: () => void }) {
  const account = useAccount();
  const [inviting, setInviting] = useState<InvitingOrganization[]>([]);
  // Only the organizations they belong to (the owner, 2026-11-05).
  const memberOf = useMemberOrganizations(
    account.status === 'member' ? (account.userId ?? undefined) : undefined,
  );
  const organizations = inviting.filter((o) => memberOf.includes(o.id));
  // Only one: it is theirs (the owner, 2026-11-15: "If an admin has only one
  // org then just assign it to that org").
  const assigned = organizations.length === 1 ? organizations[0] : undefined;
  const [email, setEmail] = useState('');
  // '' is the club itself — the administrator vouching in their own name —
  // rather than "nothing chosen"; picking an organization is the deliberate act.
  const [organizationId, setOrganizationId] = useState('');
  const [note, setNote] = useState('');
  // Optional (the owner, 2026-11-15): "Hi Ana," and joining's name.
  const [name, setName] = useState('');
  // Quoted in the email (the owner, 2026-11-17: "if I want to add a note to
  // the invite e-mail"); the Note stays on the list only.
  const [message, setMessage] = useState('');
  // A mentor of the organization chosen, when they join (the owner, 2026-11-19).
  const [asMentor, setAsMentor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void fetchInvitingOrganizations().then(setInviting);
  }, []);

  // Chosen, never left at a default (the owner, 2026-11-15: "better to have an
  // explicit no org selection. To prevent people from being lazy").
  const ready = looksLikeEmail(email) && (assigned !== undefined || organizationId !== '');
  const inviteOrganization =
    assigned ?? organizations.find((o) => o.id === organizationId && o.id !== NO_ORGANIZATION);

  function submit() {
    const address = email.trim();
    const mentorFor = asMentor && inviteOrganization ? inviteOrganization.name : null;
    setBusy(true);
    setError(null);
    setDone(null);
    createInvite({
      email: address,
      organizationId: assigned
        ? assigned.id
        : organizationId === NO_ORGANIZATION
          ? null
          : organizationId,
      note: note.trim() || null,
      ...(name.trim() ? { name } : {}),
      ...(message.trim() ? { message } : {}),
      ...(asMentor && inviteOrganization ? { asMentor: true } : {}),
    })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Could not add that address.');
          return;
        }
        setEmail('');
        setName('');
        setNote('');
        setMessage('');
        setAsMentor(false);
        if (result.sendError) setError(result.sendError);
        else
          setDone(
            `The link is on its way to ${address}${mentorFor ? `, as a mentor for ${mentorFor}` : ''}.`,
          );
        onCreated();
      })
      .catch((e: unknown) => {
        setError(describeThrown(e, 'Could not add that address.'));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <div className="rounded-[14px] border border-line bg-paper p-3.5">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="invite-email" className="block font-bold text-[0.75rem] text-ink">
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis"
          />
        </div>

        {assigned ? (
          <p className="min-w-[160px] flex-1 pb-2 text-[0.8125rem] text-ink2 leading-[1.45]">
            For <b className="font-bold text-ink">{assigned.name}</b>
          </p>
        ) : (
          <div className="min-w-[160px] flex-1">
            <label htmlFor="invite-org" className="block font-bold text-[0.75rem] text-ink">
              Vouched for by
            </label>
            <select
              id="invite-org"
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
              }}
              className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis"
            >
              <option value="" disabled>
                Choose an organization
              </option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value={NO_ORGANIZATION}>No organization — you are vouching</option>
            </select>
          </div>
        )}
      </div>

      {inviteOrganization ? (
        <MentorField
          id="invite"
          organization={inviteOrganization.name}
          checked={asMentor}
          onChange={setAsMentor}
        />
      ) : null}

      <div className="mt-2.5">
        <label htmlFor="invite-name" className="block font-bold text-[0.75rem] text-ink">
          Their name (optional)
        </label>
        <input
          id="invite-name"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={80}
          placeholder="Ana Lopez"
          value={name}
          aria-describedby="invite-name-hint"
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis"
        />
        <p id="invite-name-hint" className="mt-1 text-[0.75rem] text-grey leading-[1.4]">
          Optional. The email says hello to them by it, and it is filled in when they join.
        </p>
      </div>

      <div className="mt-2.5">
        <label htmlFor="invite-note" className="block font-bold text-[0.75rem] text-ink">
          Note (optional)
        </label>
        <input
          id="invite-note"
          placeholder="Met at rugby practice"
          value={note}
          aria-describedby="invite-note-hint"
          onChange={(e) => {
            setNote(e.target.value);
          }}
          className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis"
        />
        <p id="invite-note-hint" className="mt-1 text-[0.75rem] text-grey leading-[1.4]">
          On the list here only, not in the email.
        </p>
      </div>

      <div className="mt-2.5">
        <label htmlFor="invite-message" className="block font-bold text-[0.75rem] text-ink">
          Note in the email (optional)
        </label>
        <textarea
          id="invite-message"
          rows={3}
          maxLength={1000}
          value={message}
          aria-describedby="invite-message-hint"
          onChange={(e) => {
            setMessage(e.target.value);
          }}
          className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] leading-[1.45] outline-none focus:border-emphasis disabled:opacity-40"
        />
        <p id="invite-message-hint" className="mt-1 text-[0.75rem] text-grey leading-[1.4]">
          Shown in the email as a note from you. Others may see their inbox, so leave out anything
          private.
        </p>
      </div>

      <p className="mt-2.5 text-[0.75rem] text-grey leading-[1.45]">
        The club emails them a link to join. Anyone who opens it while signed in takes the invite,
        whatever address they signed up with.
      </p>

      {error ? (
        <p role="alert" className="mt-2.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-2.5 text-[0.78125rem] text-ink leading-[1.45]">
          {done}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!ready || busy}
        onClick={submit}
        className="mt-3 flex min-h-[42px] w-full items-center justify-center rounded-[11px] bg-action font-bold font-head text-[0.875rem] text-white disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add and send the link'}
      </button>
    </div>
  );
}
