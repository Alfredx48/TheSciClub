import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/account';
import type * as MentorInvites from '@/routes/invites/mentor-invites';
import { MENTOR_ALLOWANCE, type MentorInvite } from '@/routes/invites/mentor-invites';

const account = vi.hoisted(() => ({ current: null as Account | null }));
const own = vi.hoisted(() => ({ type: 'mentor', loading: false }));
const api = vi.hoisted(() => ({
  invites: [] as MentorInvite[],
  created: [] as unknown[],
  withdrawn: [] as string[],
  resent: [] as string[],
  sendError: null as string | null,
  failWith: null as string | null,
}));

const privileges = vi.hoisted(() => ({ representative: false }));
vi.mock('@/lib/invite-permissions', () => ({
  useInvitePermissions: () => ({
    canInvite:
      own.type === 'mentor' ||
      own.type === 'organization' ||
      Boolean(account.current?.isAdmin) ||
      privileges.representative,
    unlimited:
      own.type === 'organization' || Boolean(account.current?.isAdmin) || privileges.representative,
    loading: own.loading,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/lib/account', () => ({ useAccount: () => account.current }));
vi.mock('@/lib/members', () => ({
  useOwnMember: () => ({
    member: { id: 'me', type: own.type },
    invitedBy: null,
    loading: own.loading,
    error: null,
  }),
}));

// Partial, for the same reason the admin page's test is: `inviteState`,
// `slotsLeft` and `canWithdraw` are pure and the page should be rendering the
// real ones. Stubbing them would let this file assert its own arithmetic —
// the screen could offer a third invite and the test would still pass.
vi.mock('@/routes/invites/mentor-invites', async (importOriginal) => ({
  ...(await importOriginal<typeof MentorInvites>()),
  fetchMyInvites: () => Promise.resolve({ ok: true as const, invites: api.invites }),
  createMyInvite: (input: unknown) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.created.push(input);
    return Promise.resolve(api.sendError ? { ok: true, sendError: api.sendError } : { ok: true });
  },
  resendMyInvite: (id: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.resent.push(id);
    return Promise.resolve({ ok: true });
  },
  withdrawMyInvite: (id: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.withdrawn.push(id);
    api.invites = api.invites.map((i) => (i.id === id ? { ...i, status: 'revoked' as const } : i));
    return Promise.resolve({ ok: true });
  },
}));

const requests = vi.hoisted(() => ({
  received: [] as unknown[],
  memberOf: [] as string[],
}));

vi.mock('@/lib/invite-requests', () => ({
  fetchMyInviteRequests: () => Promise.resolve({ ok: true, value: requests.received }),
  answerInviteRequest: () => Promise.resolve({ ok: true }),
}));
vi.mock('@/lib/organization-members', () => ({
  useMemberOrganizations: (id: string | undefined) => (id ? requests.memberOf : []),
}));
vi.mock('@/lib/organization-representatives', () => ({
  useMyOrganizations: () => ({ ids: new Set(['ncs']), loading: false }),
}));
const directory = [
  { id: 'ncs', name: 'NorCal SCI' },
  { id: 'able', name: 'Able Bodied' },
  { id: 'closed', name: 'Closed Club', joinsNeedApproval: true },
  { id: 'far', name: 'Faraway Rugby' },
];
vi.mock('@/lib/organizations', () => ({
  useOrganizations: () => ({
    organizations: directory,
    byId: new Map(directory.map((o) => [o.id, o])),
  }),
}));

/** Opens an organization box's list and picks one by name. */
async function pickOrganization(box: HTMLElement, name: string) {
  await userEvent.click(box);
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}`) }));
}

const { default: InvitesPage } = await import('@/routes/invites/page');

const invite = (o: Partial<MentorInvite> = {}): MentorInvite => ({
  id: 'i1',
  email: 'friend@example.com',
  phone: null,
  status: 'pending',
  note: null,
  createdAt: '2026-09-11T08:43:18Z',
  sentAt: '2026-09-11T08:44:00Z',
  ...o,
});

function renderInvites() {
  return render(
    <MemoryRouter initialEntries={['/invites']}>
      <Routes>
        <Route path="/invites" element={<InvitesPage />} />
        <Route path="/me" element={<p>Me screen</p>} />
        <Route path="/join" element={<p>Welcome screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  account.current = { status: 'member', userId: 'me', isAdmin: false, displayName: 'Todd' };
  privileges.representative = false;
  own.type = 'mentor';
  own.loading = false;
  api.invites = [];
  api.created = [];
  api.withdrawn = [];
  api.resent = [];
  api.sendError = null;
  api.failWith = null;
  requests.received = [];
  requests.memberOf = [];
});

describe('who can open it', () => {
  it('sends a peer to Me rather than showing a form the database would refuse', async () => {
    own.type = 'peer';
    renderInvites();
    expect(await screen.findByText('Me screen')).toBeInTheDocument();
  });

  it('sends somebody who is not a member to the welcome screen', async () => {
    account.current = { status: 'signed-out', userId: null, isAdmin: false, displayName: null };
    renderInvites();
    expect(await screen.findByText('Welcome screen')).toBeInTheDocument();
  });
});

describe('getting back out', () => {
  // Unlisted in the tab bar, so without this the only way back is the Me tab.
  // A Link rather than history: the label names where it goes, and on a
  // refresh or a deep link history would leave the app while still saying Me.
  it('offers a link to Me', async () => {
    renderInvites();
    const back = await screen.findByRole('link', { name: 'Me' });
    expect(back).toHaveAttribute('href', '/me');
  });
});

/** The sentence the header prints when nothing is spent. */
const allFree = new RegExp(`${MENTOR_ALLOWANCE} of your ${MENTOR_ALLOWANCE} invites are free`);

/** Enough consumed invites to fill the allowance exactly. */
const aFullAllowance = () =>
  Array.from({ length: MENTOR_ALLOWANCE }, (_, i) =>
    invite({ id: `i${i}`, status: 'consumed' as const }),
  );

describe('the allowance on screen', () => {
  it('says they are all free before a mentor has added anybody', async () => {
    renderInvites();
    expect(await screen.findByText(allFree)).toBeInTheDocument();
    expect(screen.getByText('You have not invited anybody yet.')).toBeInTheDocument();
  });

  // The counting rule that matters: somebody who joined is still spending the
  // slot. A screen that freed it on arrival would offer one more than the
  // allowance and the insert policy would refuse it with no explanation the
  // member could act on.
  it('counts a member who has joined against the allowance', async () => {
    api.invites = [invite({ id: 'joined', status: 'consumed' }), invite({ id: 'waiting' })];
    renderInvites();
    expect(
      await screen.findByText(
        new RegExp(`${MENTOR_ALLOWANCE - 2} of your ${MENTOR_ALLOWANCE} invites are free`),
      ),
    ).toBeInTheDocument();
  });

  it('closes the form and says so once every slot is spent', async () => {
    api.invites = aFullAllowance();
    renderInvites();
    expect(
      await screen.findByText(new RegExp(`All ${MENTOR_ALLOWANCE} of your invites are in use`)),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
  });

  it('frees the slot again once an invite is withdrawn', async () => {
    api.invites = [invite({ status: 'revoked' })];
    renderInvites();
    expect(await screen.findByText(allFree)).toBeInTheDocument();
  });
});

describe('inviting by email', () => {
  it('sends the address and the note, and clears the form', async () => {
    const user = userEvent.setup();
    renderInvites();
    await screen.findByText(allFree);

    await user.type(screen.getByLabelText('Email address'), 'dana@example.com');
    await user.type(screen.getByPlaceholderText('Met at rugby practice'), 'Rugby');
    await user.click(screen.getByRole('button', { name: 'Add and send the link' }));

    await waitFor(() => {
      // An org admin of NorCal SCI alone: it is theirs, without asking.
      expect(api.created).toEqual([
        { email: 'dana@example.com', note: 'Rugby', organizationId: 'ncs' },
      ]);
    });
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(await screen.findByText(/on its way to dana@example.com/)).toBeInTheDocument();
  });

  it('has no phone field', async () => {
    renderInvites();
    await screen.findByText(allFree);
    expect(screen.queryByLabelText(/Phone number/)).toBeNull();
  });

  it('will not submit something that is not an address', async () => {
    const user = userEvent.setup();
    renderInvites();
    await screen.findByText(allFree);

    await user.type(screen.getByLabelText('Email address'), 'dana@');
    expect(screen.getByRole('button', { name: 'Add and send the link' })).toBeDisabled();
    expect(api.created).toEqual([]);
  });

  // On the list and spending a slot, but the email did not go. Said as it is,
  // so the mentor uses Resend rather than adding the address a second time.
  it('says so when the invite is on the list but the email did not go', async () => {
    const user = userEvent.setup();
    api.sendError = 'The email service did not take it. Try again in a minute.';
    renderInvites();
    await screen.findByText(allFree);

    await user.type(screen.getByLabelText('Email address'), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: 'Add and send the link' }));

    expect(await screen.findByText(/did not take it/)).toBeInTheDocument();
  });

  // Whatever the database said, verbatim. The two refusals a mentor can
  // actually provoke say different things, and a rewritten sentence here
  // would flatten them back together.
  it('shows the refusal it was given', async () => {
    const user = userEvent.setup();
    api.failWith = 'That email address is already on the club’s list.';
    renderInvites();
    await screen.findByText(allFree);

    await user.type(screen.getByLabelText('Email address'), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: 'Add and send the link' }));

    expect(
      await screen.findByText('That email address is already on the club’s list.'),
    ).toBeInTheDocument();
  });
});

describe('a request for an invite', () => {
  beforeEach(() => {
    requests.memberOf = ['able', 'ncs'];
    requests.received = [
      {
        id: 'r1',
        organizationId: 'ncs',
        organizationName: 'NorCal SCI',
        asked: 'Todd',
        name: 'Sam',
        email: 'sam@example.com',
        note: null,
        createdAt: '2026-11-01T08:00:00Z',
      },
    ];
    privileges.representative = true;
  });

  // The owner, 2026-11-25: any organization, not only theirs.
  it('lets a club administrator choose any organization', async () => {
    account.current = { status: 'member', userId: 'me', isAdmin: true, displayName: 'Todd' };
    renderInvites();
    await screen.findByRole('button', { name: 'Send invite' });
    // The request's own, beside the form's.
    const forRequest = document.getElementById('request-organization-r1');
    if (!forRequest) throw new Error('no organization choice on the request');
    await pickOrganization(forRequest, 'Faraway Rugby');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => {
      expect(api.created[0]).toMatchObject({ organizationId: 'far' });
    });
  });

  it('leaves an org admin with the organization that was asked', async () => {
    renderInvites();
    await screen.findByRole('button', { name: 'Send invite' });
    expect(document.getElementById('request-organization-r1')).toBeNull();
  });
});

// The owner, 2026-11-05: every organization they belong to, not only those
// they run; one that approves its members first only for its org admins.
describe('who a new invite is for', () => {
  beforeEach(() => {
    requests.received = [];
  });

  it('offers the organizations they belong to, and sends the one chosen', async () => {
    requests.memberOf = ['ncs', 'able'];
    renderInvites();
    const picker = await screen.findByLabelText('Inviting for');
    await userEvent.click(picker);
    // Not an administrator: theirs only.
    expect(screen.queryByRole('option', { name: /^Faraway Rugby/ })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /^Able Bodied/ }));
    await userEvent.type(screen.getByLabelText('Email address'), 'friend2@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add and send the link' }));
    await waitFor(() => {
      expect(api.created.at(-1)).toMatchObject({ organizationId: 'able' });
    });
  });

  it('leaves out one that approves its members, which they do not run', async () => {
    requests.memberOf = ['ncs', 'closed'];
    renderInvites();
    await screen.findByRole('button', { name: 'Add and send the link' });
    expect(screen.queryByLabelText('Inviting for')).toBeNull();
  });
});

describe('the list', () => {
  it('offers Withdraw while nobody has joined on it, and not after', async () => {
    api.invites = [
      invite({ id: 'waiting', email: 'waiting@example.com' }),
      invite({ id: 'joined', email: 'joined@example.com', status: 'consumed' }),
    ];
    renderInvites();

    const waiting = (await screen.findByText('waiting@example.com')).closest('li');
    const joined = screen.getByText('joined@example.com').closest('li');
    expect(waiting).not.toBeNull();
    expect(joined).not.toBeNull();
    expect(within(waiting as HTMLElement).getByRole('button', { name: 'Withdraw' })).toBeEnabled();
    expect(within(joined as HTMLElement).queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('keeps somebody who joined on the list rather than dropping them', async () => {
    api.invites = [invite({ status: 'consumed', note: 'Met at rugby practice' })];
    renderInvites();
    expect(await screen.findByText(/joined the club/)).toBeInTheDocument();
    expect(screen.getByText(/Met at rugby practice/)).toBeInTheDocument();
  });

  it('withdraws the row the button belongs to', async () => {
    const user = userEvent.setup();
    api.invites = [
      invite({ id: 'i1', email: 'one@example.com' }),
      invite({ id: 'i2', email: 'two@example.com' }),
    ];
    renderInvites();

    const row = (await screen.findByText('two@example.com')).closest('li');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => {
      expect(api.withdrawn).toEqual(['i2']);
    });
    expect(await screen.findByText('withdrawn')).toBeInTheDocument();
  });

  it('sends the link again for the row the button belongs to', async () => {
    const user = userEvent.setup();
    api.invites = [
      invite({ id: 'i1', email: 'one@example.com' }),
      invite({ id: 'i2', email: 'two@example.com' }),
    ];
    renderInvites();

    const row = (await screen.findByText('two@example.com')).closest('li');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Resend link' }));
    await waitFor(() => {
      expect(api.resent).toEqual(['i2']);
    });
  });

  it('offers no resend on a used or withdrawn invite', async () => {
    api.invites = [
      invite({ id: 'u', email: 'used@example.com', status: 'consumed' }),
      invite({ id: 'r', email: 'gone@example.com', status: 'revoked' }),
    ];
    renderInvites();
    await screen.findByText('used@example.com');
    expect(screen.queryByRole('button', { name: 'Resend link' })).toBeNull();
  });

  it('says whether the link has gone out', async () => {
    api.invites = [
      invite({ id: 'a', email: 'unsent@example.com', sentAt: null }),
      invite({ id: 'b', email: 'sent@example.com' }),
    ];
    renderInvites();
    expect(await screen.findByText(/link not sent yet/)).toBeInTheDocument();
    expect(screen.getByText(/link sent/)).toBeInTheDocument();
  });

  it('shows an old phone invite as one, with a formatted number', async () => {
    api.invites = [invite({ email: null, phone: '14085550112' })];
    renderInvites();
    expect(await screen.findByText('(408) 555-0112')).toBeInTheDocument();
    expect(screen.getByText(/phone invite \(old\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend link' })).toBeNull();
  });
});

// The owner, 2026-10-22: invites do not expire, so every kind of inviter
// withdraws their own (supabase/tests/invite-withdrawal.sql for the database).
describe('withdrawing, for every kind of inviter', () => {
  it.each(['mentor', 'admin', 'organization', 'representative'])(
    'lets %s withdraw an invite nobody has used',
    async (role) => {
      const user = userEvent.setup();
      if (account.current) account.current.isAdmin = role === 'admin';
      own.type = role === 'mentor' || role === 'organization' ? role : 'peer';
      privileges.representative = role === 'representative';
      api.invites = [invite({ id: 'mine', email: 'mine@example.com' })];
      renderInvites();
      const row = (await screen.findByText('mine@example.com')).closest('li');
      await user.click(within(row as HTMLElement).getByRole('button', { name: 'Withdraw' }));
      await waitFor(() => {
        expect(api.withdrawn).toEqual(['mine']);
      });
    },
  );
});

describe('unlimited invites', () => {
  it.each(['admin', 'organization', 'representative'])(
    'allows an eleventh invite for %s without showing a cap',
    async (role) => {
      if (account.current) account.current.isAdmin = role === 'admin';
      own.type = role === 'organization' ? 'organization' : 'peer';
      privileges.representative = role === 'representative';
      api.invites = Array.from({ length: 10 }, (_, index) => invite({ id: `invite-${index}` }));
      renderInvites();
      expect(await screen.findByText('You can invite people without a limit.')).toBeInTheDocument();
      expect(screen.queryByText(/of your 10|All 10/)).toBeNull();
      await userEvent.type(screen.getByLabelText(/Email address/), 'dana@example.com');
      // An administrator always chooses (the owner, 2026-11-25).
      if (role === 'admin')
        await pickOrganization(screen.getByLabelText('Inviting for'), 'NorCal SCI');
      const send = screen.getByRole('button', { name: 'Add and send the link' });
      expect(send).toBeEnabled();
      await userEvent.click(send);
      await waitFor(() => {
        expect(api.created).toHaveLength(1);
      });
    },
  );
});
