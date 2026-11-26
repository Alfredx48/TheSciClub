import { Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { MentorField } from '@/components/invite-list';
import { OrganizationCombobox } from '@/components/organization-combobox';
import { useAccount } from '@/lib/account';
import { looksLikeEmail } from '@/lib/auth-email';
import { describeThrown } from '@/lib/describe-error';
import { useInvitePermissions } from '@/lib/invite-permissions';
import {
  answerInviteRequest,
  fetchMyInviteRequests,
  type ReceivedInviteRequest,
} from '@/lib/invite-requests';
import { useMemberOrganizations } from '@/lib/organization-members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { InviteSheet } from '@/routes/admin/invite-sheet';
import {
  canWithdraw,
  createMyInvite,
  fetchMyInvites,
  inviteState,
  MENTOR_ALLOWANCE,
  type MentorInvite,
  resendMyInvite,
  slotsLeft,
  withdrawMyInvite,
} from '@/routes/invites/mentor-invites';

/**
 * A mentor's invites.
 *
 * A mentor invites by email address. The club emails them a link; whoever
 * opens it while signed in takes the invite, whatever address they signed up
 * with.
 *
 * Nothing here decides who may invite. `create_my_invite` and the mentor
 * policies do, and supabase/tests/mentor-invites.sql runs them as a real
 * mentor session. What this screen owes a member is that the database's
 * answer arrives as a sentence rather than as a constraint name.
 *
 * An org admin also sees the requests people sent from /request-invite
 * (20261029030000) above the form: Send invite is the same invite as the form
 * makes, then the request is marked answered; Dismiss only marks it.
 */

/** Formatted the way the club writes numbers back to people: +1 (408) 555-0112. */
function displayPhone(e164: string): string {
  const d = e164.length === 11 && e164.startsWith('1') ? e164.slice(1) : e164;
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** The choice of no organization, as against none chosen yet (''). */
const NO_ORGANIZATION = 'none';

export default function InvitesPage() {
  const account = useAccount();
  const userId = account.status === 'member' ? account.userId : null;
  const permissions = useInvitePermissions(userId);
  const [invites, setInvites] = useState<MentorInvite[]>([]);
  const [requests, setRequests] = useState<ReceivedInviteRequest[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  // Optional (the owner, 2026-11-15): "Hi Ana," and joining's name.
  const [name, setName] = useState('');
  // Quoted in the email (the owner, 2026-11-17).
  const [message, setMessage] = useState('');
  // Asked only of an org admin of several (the owner, 2026-10-30); of one, the
  // database knows which.
  const [organizationId, setOrganizationId] = useState('');
  const mine = useMyOrganizations(userId);
  const { byId, organizations } = useOrganizations();
  const isAdmin = account.status === 'member' && account.isAdmin;
  const memberOf = useMemberOrganizations(userId ?? undefined);
  // Every organization they belong to, not only those they run (the owner,
  // 2026-11-05; 20261105010000). Whoever joins on it joins it too, so one that
  // approves its members first is only for its org admins and administrators.
  const myOrganizations = [...new Set([...mine.ids, ...memberOf])]
    .map((id) => byId.get(id))
    .filter((organization) => organization !== undefined)
    .filter(
      (organization) => isAdmin || mine.ids.has(organization.id) || !organization.joinsNeedApproval,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  // Optional for everybody (the owner, 2026-11-15: "make choosing an
  // organization optional ... If it is not selected, then the user is not
  // auto-associated with an organization"). It was required of an org admin
  // of several (2026-10-30). An administrator or org admin with only one is
  // given it ("If an admin has only one org then just assign it to that org").
  // The club's administrators choose from every organization (the owner,
  // 2026-11-25), so theirs is never assumed.
  const assigned =
    !isAdmin && mine.ids.size > 0 && myOrganizations.length === 1 ? myOrganizations[0] : undefined;
  const choosesOrganization = isAdmin || (!assigned && myOrganizations.length > 0);
  const everyOrganization = isAdmin
    ? [...organizations].sort((a, b) => a.name.localeCompare(b.name))
    : [];
  // The organization the invite is for, once known, and whether they may make
  // its mentors (the owner, 2026-11-19; 20261119200000).
  const inviteOrganization =
    assigned ??
    (organizationId !== '' && organizationId !== NO_ORGANIZATION
      ? byId.get(organizationId)
      : undefined);
  const mentorOrganization =
    inviteOrganization && (isAdmin || mine.ids.has(inviteOrganization.id))
      ? inviteOrganization
      : undefined;
  const [asMentor, setAsMentor] = useState(false);
  // A club administrator answering a request picks who the invite is for, from
  // the organizations they belong to (the owner, 2026-11-01).
  const [invitingFor, setInvitingFor] = useState<Record<string, string>>({});
  const organizationsFor = (request: ReceivedInviteRequest) =>
    [...new Set([request.organizationId, ...mine.ids, ...memberOf])]
      .map((id) => byId.get(id))
      .filter((organization) => organization !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [result, asked] = await Promise.all([fetchMyInvites(), fetchMyInviteRequests()]);
    if (result.ok) setInvites(result.invites);
    else setError(result.error);
    // A failure here leaves the list empty: the invites are what this page is for.
    if (asked.ok) setRequests(asked.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (account.status === 'member') void load();
  }, [account.status, load]);

  if (account.status === 'loading' || permissions.loading)
    return <div className="min-h-dvh bg-canvas" />;
  if (account.status !== 'member') return <Navigate to="/join" replace />;
  // Not the permission check — the insert policy refuses a peer either way.
  // This is so somebody who follows a stale link sees the club rather than a
  // form that would fail on submit.
  if (permissions.error)
    return (
      <div className="p-4">
        <BackLink to="/me" label="Me" />
        <p role="alert" className="mt-3 text-destructive">
          {permissions.error}
        </p>
        <button
          type="button"
          onClick={permissions.reload}
          className="min-h-[44px] text-emphasis underline"
        >
          Retry invite permissions
        </button>
      </div>
    );
  if (!permissions.canInvite) return <Navigate to="/me" replace />;

  const left = permissions.unlimited ? Infinity : slotsLeft(invites);
  // Chosen, never left blank (the owner, 2026-11-15: "better to have an
  // explicit no org selection. To prevent people from being lazy").
  const ready =
    looksLikeEmail(email) &&
    left > 0 &&
    userId !== null &&
    (!choosesOrganization || organizationId !== '');

  /**
   * Deliberately not async: these are handed to onClick, which expects void,
   * and an async handler's rejection there goes unhandled — so a dropped
   * connection would leave a row spinning with no error shown.
   */
  function act(id: string, run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setNotice(null);
    run()
      .then(async (result) => {
        if (!result.ok) {
          setError(result.error ?? 'That did not work.');
          return;
        }
        setError(null);
        await load();
      })
      .catch((e: unknown) => {
        setError(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setBusyId(null);
      });
  }

  function add() {
    if (!userId) return;
    const address = email.trim();
    const mentorFor = asMentor && mentorOrganization ? mentorOrganization.name : null;
    act('new', async () => {
      const result = await createMyInvite({
        email: address,
        note: note.trim() || null,
        ...(name.trim() ? { name } : {}),
        ...(message.trim() ? { message } : {}),
        ...(permissions.unlimited ? { unlimited: true } : {}),
        ...(mentorFor ? { asMentor: true } : {}),
        ...(assigned
          ? { organizationId: assigned.id }
          : organizationId === NO_ORGANIZATION
            ? // Chosen: none, just the club (20261115160000).
              { noOrganization: true }
            : organizationId !== ''
              ? { organizationId }
              : {}),
      });
      if (result.ok) {
        setEmail('');
        setName('');
        setAsMentor(false);
        setNote('');
        setMessage('');
        setOrganizationId('');
        // On the list, but the email did not go: say so, and the row has Resend.
        setNotice(
          result.sendError ??
            `The link is on its way to ${address}${mentorFor ? `, as a mentor for ${mentorFor}` : ''}.`,
        );
      }
      return result;
    });
  }

  function sendRequested(request: ReceivedInviteRequest) {
    act(request.id, async () => {
      const result = await createMyInvite({
        email: request.email,
        note: `${request.name} (asked for an invite)`,
        name: request.name,
        ...(permissions.unlimited ? { unlimited: true } : {}),
        organizationId: invitingFor[request.id] ?? request.organizationId,
      });
      if (!result.ok) return result;
      const answered = await answerInviteRequest(request.id, 'invited');
      setNotice(result.sendError ?? `The link is on its way to ${request.email}.`);
      return answered;
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        {/* The same measure as the content below. Left at the page edge, the
            title sat 460px to the left of the card it names on a desktop, and
            read as a heading for the empty space beside it. */}
        <div className="mx-auto w-full max-w-[560px]">
          <BackLink to="/me" label="Me" />
          <h1 className="mt-1 font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
            Invite new members
          </h1>
          <p className="mt-1 text-[0.78125rem] text-grey">
            {permissions.unlimited
              ? 'You can invite people without a limit.'
              : left === 0
                ? `All ${MENTOR_ALLOWANCE} of your invites are in use.`
                : `${left} of your ${MENTOR_ALLOWANCE} invites ${left === 1 ? 'is' : 'are'} free.`}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3.5">
        <div className="mx-auto w-full max-w-[560px]">
          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
            >
              {error}
            </p>
          ) : null}

          {notice ? (
            <p
              role="status"
              className="mb-3 rounded-[11px] border border-line bg-paper px-3 py-2.5 text-[0.8125rem] text-ink leading-[1.45]"
            >
              {notice}
            </p>
          ) : null}

          {requests.length > 0 ? (
            <section id="requests" className="mb-5">
              <h2 className="mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
                Asking for an invite
              </h2>
              <ul className="overflow-hidden rounded-[14px] border border-line bg-paper">
                {requests.map((request) => (
                  <li key={request.id} className="border-line border-b p-3.5 last:border-b-0">
                    <span className="block font-extrabold font-head text-[0.9375rem] text-ink">
                      {request.name}
                    </span>
                    <span className="mt-0.5 block break-all text-[0.8125rem] text-ink2">
                      {request.email}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] text-grey">
                      {request.organizationName}
                      {request.asked ? ` · asked ${request.asked}` : ''}
                    </span>
                    {request.note ? (
                      <p className="mt-1.5 whitespace-pre-line text-[0.8125rem] text-ink leading-[1.45]">
                        {request.note}
                      </p>
                    ) : null}
                    {isAdmin ? (
                      <div className="mt-2.5">
                        <OrganizationCombobox
                          id={`request-organization-${request.id}`}
                          label="Inviting for"
                          labelClassName="block font-bold text-[0.75rem] text-ink"
                          yours={organizationsFor(request)}
                          others={everyOrganization}
                          value={invitingFor[request.id] ?? request.organizationId}
                          onChange={(id) => {
                            setInvitingFor((now) => ({ ...now, [request.id]: id }));
                          }}
                          className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line bg-paper px-3 py-2 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
                        />
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null || left === 0}
                        onClick={() => {
                          sendRequested(request);
                        }}
                        className="min-h-[40px] flex-1 rounded-full bg-action px-3.5 font-bold font-head text-[0.8125rem] text-white disabled:opacity-40"
                      >
                        {busyId === request.id ? 'Sending…' : 'Send invite'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => {
                          act(request.id, () => answerInviteRequest(request.id, 'dismissed'));
                        }}
                        className="min-h-[40px] flex-none rounded-full bg-tint px-3.5 font-bold font-head text-[0.8125rem] text-ink2 disabled:opacity-40"
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Stated before the form, not after a refusal. */}
          <div className="rounded-[14px] border border-line bg-paper p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[11px] bg-tint text-emphasis">
                <Mail className="h-4 w-4" />
              </span>
              <p className="min-w-0 flex-1 text-[0.78125rem] text-ink2 leading-[1.45]">
                The club emails them a link to join. You may want to tell them to look for it, and
                in their spam folder. Anyone who opens the link while signed in takes the invite.
              </p>
            </div>

            {/* Above the fields, not under the button. Below it, a mentor
                with nothing left met a dead form first and the reason for it
                last. */}
            {left === 0 ? (
              <p className="mt-3 rounded-r-[9px] border-gold border-l-[3px] bg-gold-lt px-3 py-2 text-[0.78125rem] text-gold-ink leading-[1.45]">
                Withdraw one below to free a slot. An invite somebody has already used stays spent
                until they leave the club.
              </p>
            ) : null}

            {assigned ? (
              <p className="mt-3 text-[0.78125rem] text-ink2 leading-[1.45]">
                They join <b className="font-bold text-ink">{assigned.name}</b> with this invite.
              </p>
            ) : null}

            {choosesOrganization ? (
              <div className="mt-3">
                <OrganizationCombobox
                  id="mentor-invite-organization"
                  label="Inviting for"
                  labelClassName="block font-bold text-[0.75rem] text-ink"
                  yours={myOrganizations}
                  others={everyOrganization}
                  value={organizationId}
                  onChange={setOrganizationId}
                  none="No organization, just the club"
                  noneValue={NO_ORGANIZATION}
                  placeholder="Choose an organization"
                  disabled={left === 0}
                  className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line bg-paper px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis disabled:opacity-40"
                />
              </div>
            ) : null}

            {mentorOrganization ? (
              <MentorField
                id="mentor-invite"
                organization={mentorOrganization.name}
                checked={asMentor}
                onChange={setAsMentor}
              />
            ) : null}

            <div className="mt-3">
              <label
                htmlFor="mentor-invite-email"
                className="block font-bold text-[0.75rem] text-ink"
              >
                Email address
              </label>
              <input
                id="mentor-invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                placeholder="name@example.com"
                value={email}
                disabled={left === 0}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis disabled:opacity-40"
              />
            </div>

            <div className="mt-2.5">
              <label
                htmlFor="mentor-invite-name"
                className="block font-bold text-[0.75rem] text-ink"
              >
                Their name (optional)
              </label>
              <input
                id="mentor-invite-name"
                autoComplete="off"
                autoCapitalize="words"
                maxLength={80}
                placeholder="Ana Lopez"
                value={name}
                disabled={left === 0}
                aria-describedby="mentor-invite-name-hint"
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis disabled:opacity-40"
              />
              <p
                id="mentor-invite-name-hint"
                className="mt-1 text-[0.75rem] text-grey leading-[1.4]"
              >
                Optional. The email says hello to them by it, and it is filled in when they join.
              </p>
            </div>

            <div className="mt-2.5">
              <label
                htmlFor="mentor-invite-note"
                className="block font-bold text-[0.75rem] text-ink"
              >
                Who are they? (only you see this)
              </label>
              <input
                id="mentor-invite-note"
                placeholder="Met at rugby practice"
                value={note}
                disabled={left === 0}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] outline-none focus:border-emphasis disabled:opacity-40"
              />
            </div>

            <div className="mt-2.5">
              <label
                htmlFor="mentor-invite-message"
                className="block font-bold text-[0.75rem] text-ink"
              >
                Note in the email (optional)
              </label>
              <textarea
                id="mentor-invite-message"
                rows={3}
                maxLength={1000}
                value={message}
                disabled={left === 0}
                aria-describedby="mentor-invite-message-hint"
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
                className="mt-1.5 w-full rounded-[11px] border-[1.6px] border-line px-3 py-2 text-[0.9375rem] leading-[1.45] outline-none focus:border-emphasis disabled:opacity-40"
              />
              <p
                id="mentor-invite-message-hint"
                className="mt-1 text-[0.75rem] text-grey leading-[1.4]"
              >
                Shown in the email as a note from you. Others may see their inbox, so leave out
                anything private.
              </p>
            </div>

            <button
              type="button"
              disabled={!ready || busyId !== null}
              onClick={add}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[11px] bg-action font-bold font-head text-[0.875rem] text-white disabled:opacity-40"
            >
              {busyId === 'new' ? 'Adding…' : 'Add and send the link'}
            </button>
          </div>

          {/* Here rather than in Admin (the owner, 2026-11-18: "a little section
              with a button above the People you have invited section"). For
              administrators: inviteList is theirs (members-admin.ts). */}
          {isAdmin ? (
            <section aria-labelledby="invite-sheet-title" className="mt-5">
              <h2
                id="invite-sheet-title"
                className="mb-1 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
              >
                From a spreadsheet
              </h2>
              <p className="mb-2.5 text-[0.78125rem] text-grey leading-[1.4]">
                A Google Sheet link or rows pasted from any spreadsheet. Each person gets an email
                from you, with your message.
              </p>
              {sheetOpen ? (
                <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
                  <InviteSheet
                    onCreated={() => {
                      void load();
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(true);
                  }}
                  className="flex min-h-[44px] items-center justify-center rounded-[11px] border border-line bg-paper px-4 font-bold font-head text-[0.875rem] text-emphasis"
                >
                  Invite from a spreadsheet
                </button>
              )}
            </section>
          ) : null}

          <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
            People you have invited
          </h2>

          {loading ? (
            <p className="py-8 text-center text-[0.875rem] text-grey">Loading your invites…</p>
          ) : invites.length === 0 ? (
            <p className="rounded-[14px] border border-line bg-paper px-3.5 py-6 text-center text-[0.875rem] text-grey leading-[1.5]">
              You have not invited anybody yet.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-[14px] border border-line bg-paper">
              {invites.map((invite) => (
                <li key={invite.id} className="border-line border-b p-3.5 last:border-b-0">
                  {/* The buttons sit below, so a long address has the row's whole width. */}
                  <span className="block font-extrabold font-head text-[0.9375rem] text-ink [overflow-wrap:anywhere]">
                    {invite.email ?? (invite.phone ? displayPhone(invite.phone) : 'Unknown')}
                  </span>
                  <span className="mt-0.5 block text-[0.78125rem] text-grey leading-[1.45]">
                    {inviteState(invite)}
                    {invite.status === 'pending' && invite.email
                      ? invite.sentAt
                        ? ' · link sent'
                        : ' · link not sent yet'
                      : ''}
                    {invite.asMentor ? ' · as a mentor' : ''}
                    {invite.email === null ? ' · phone invite (old)' : ''}
                    {invite.note ? ` · ${invite.note}` : ''}
                  </span>
                  {canWithdraw(invite) ? (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {invite.email ? (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => {
                            act(invite.id, () => resendMyInvite(invite.id));
                          }}
                          className="min-h-[40px] flex-none rounded-full bg-tint px-3.5 font-bold font-head text-[0.8125rem] text-emphasis disabled:opacity-40"
                        >
                          Resend link
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => {
                          act(invite.id, () => withdrawMyInvite(invite.id));
                        }}
                        className="min-h-[40px] flex-none rounded-full bg-destructive/10 px-3.5 font-bold font-head text-[0.8125rem] text-destructive disabled:opacity-40"
                      >
                        {busyId === invite.id ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
