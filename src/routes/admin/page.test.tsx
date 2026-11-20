import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { Account } from '@/lib/account';
import type * as MembersAdmin from '@/routes/admin/members-admin';
import {
  type AdminInvite,
  type AdminMember,
  canRevoke,
  inviteState,
  type MemberReach,
  type Strike,
  type TallyRow,
  vouchedBy,
} from '@/routes/admin/members-admin';
import type { Renewal } from '@/routes/admin/renewals';

const account = vi.hoisted(() => ({ current: null as Account | null }));
let confirmSpy: MockInstance<typeof window.confirm>;
const api = vi.hoisted(() => ({
  members: [] as AdminMember[],
  reach: null as Map<string, MemberReach> | null,
  invites: [] as AdminInvite[],
  tally: [] as TallyRow[],
  deleted: [] as string[],
  revoked: [] as string[],
  statusCalls: [] as [string, string][],
  strikes: [] as [string, string][],
  withdrawn: [] as [string, string][],
  strikeRows: [] as Strike[],
  typeCalls: [] as [string, string][],
  created: [] as unknown[],
  blocked: [] as {
    email: string;
    reason: string | null;
    blockedAt: string;
    blockedBy: string | null;
  }[],
  /** [address or number, reason] for every block, whether from an invite row or a member. */
  blockCalls: [] as [string, string | null][],
  unblocked: [] as string[],
  resent: [] as string[],
  reinvited: [] as [string, string][],
  failWith: null as string | null,
  /**
   * Whether admin_strike_member says what the strike did (20261120110000).
   * False stands in for a database that does not, where nothing is said.
   */
  reportsStrikeCount: true,
  /** Paused for strikes before: the third closes the account (20261120110000). */
  pausedBefore: false,
  /** Open reports, for the count in the Reports tab's label. */
  openReports: 0,
  /** member id → professional title (20261029100000). */
  partners: new Map<string, string | null>(),
  partnerCalls: [] as [string, string | null][],
  /** [member, organization] for Make staff and Make mentor (20261117000000). */
  staffCalls: [] as [string, string][],
  mentorCalls: [] as [string, string][],
}));

vi.mock('@/lib/account', () => ({ useAccount: () => account.current }));
// Stubbed because the page reads it for the tab's label on every render, and
// an unmocked hook in a test talks to the hosted project — the Phase 6 lesson,
// which is about reads and not only about sockets. What the panel itself does
// is tested in reports-section.test.tsx.
vi.mock('@/lib/chat/reports', () => ({
  useAdminReports: () => ({
    reports: [],
    openCount: api.openReports,
    loading: false,
    error: null,
    reload: () => undefined,
  }),
}));
// Partial: the network calls are stubbed, but `inviteState` is a pure
// formatter and the page should be rendering the real one — a stub of it would
// let this file assert whatever wording it liked.
const { rosterFilter } = vi.hoisted(() => ({
  rosterFilter: (
    m: { isSeed: boolean; status: string; strikes: number },
    filter: string,
  ): boolean =>
    filter === 'joined'
      ? !m.isSeed
      : filter === 'directory'
        ? m.isSeed
        : filter === 'attention'
          ? !m.isSeed && (m.status !== 'active' || m.strikes > 0)
          : filter === 'active'
            ? !m.isSeed && m.status === 'active'
            : true,
}));
// As admin_invite_page, admin_invite_counts and admin_join_tally answer
// (20261104201000), over api.invites; their own probe is admin-invite-page.sql.
const inviteKey = (i: AdminInvite) => (i.email ?? i.phone ?? i.id).toLowerCase();
const newestFirst = (a: AdminInvite, b: AdminInvite) => b.createdAt.localeCompare(a.createdAt);
function invitePart(part: 'listed' | 'withdrawn') {
  if (part === 'listed')
    return api.invites
      .filter((i) => i.status !== 'revoked')
      .sort(newestFirst)
      .map((invite) => ({ invite, times: 1 }));
  const live = new Set(api.invites.filter((i) => i.status !== 'revoked').map(inviteKey));
  const blocked = new Set(api.blocked.map((b) => b.email.toLowerCase()));
  const groups = new Map<string, AdminInvite[]>();
  for (const i of api.invites) {
    if (i.status !== 'revoked' || live.has(inviteKey(i)) || blocked.has(inviteKey(i))) continue;
    groups.set(inviteKey(i), [...(groups.get(inviteKey(i)) ?? []), i]);
  }
  return [...groups.values()]
    .map((g) => ({
      invite: g.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)),
      times: g.length,
    }))
    .sort((a, b) => newestFirst(a.invite, b.invite));
}

vi.mock('@/routes/admin/members-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof MembersAdmin>()),
  // As admin_member_search and admin_member_counts (20261029230000) answer.
  fetchMemberPage: ({
    query = '',
    filter = 'all',
    memberId = null,
    offset = 0,
    limit = 50,
  }: {
    query?: string;
    filter?: string;
    memberId?: string | null;
    offset?: number;
    limit?: number;
  }) => {
    const q = query.trim().toLocaleLowerCase();
    const found = api.members.filter(
      (m) =>
        ((memberId === null || m.id === memberId) &&
          rosterFilter(m, filter) &&
          [
            m.displayName,
            m.email,
            m.username,
            m.phone,
            m.city,
            m.state,
            m.type,
            m.status,
            m.isAdmin ? 'admin' : '',
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(q)) ||
        (/^[+\d\s()-]+$/.test(q) &&
          (m.phone ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))),
    );
    return Promise.resolve({
      ok: true as const,
      members: found.slice(offset, offset + limit),
      total: found.length,
    });
  },
  fetchMemberCounts: () =>
    Promise.resolve({
      ok: true as const,
      counts: {
        everyone: api.members.length,
        joined: api.members.filter((m) => !m.isSeed).length,
        directory: api.members.filter((m) => m.isSeed).length,
        attention: api.members.filter((m) => rosterFilter(m, 'attention')).length,
      },
    }),
  fetchMemberReach: () => Promise.resolve(api.reach),
  fetchInvitePage: ({
    part,
    offset = 0,
    limit = 50,
  }: {
    part: 'listed' | 'withdrawn';
    offset?: number;
    limit?: number;
  }) => {
    const rows = invitePart(part);
    return Promise.resolve({
      ok: true as const,
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
    });
  },
  fetchPendingInvites: () =>
    Promise.resolve({
      ok: true as const,
      pending: api.invites.filter((i) => i.status === 'pending').length,
    }),
  fetchJoinTally: () => Promise.resolve({ ok: true as const, rows: api.tally }),
  fetchBlockedEmails: () => Promise.resolve(api.blocked),
  blockEmail: (email: string, reason: string | null) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.blockCalls.push([email, reason]);
    return Promise.resolve({ ok: true });
  },
  // The real one calls blockEmail and deleteMember inside the module, which a
  // mock of those two cannot intercept; its own two-step order is tested in
  // members-admin.test.ts. Here: one call that blocks and removes.
  removeAndBlock: (
    m: { id: string; email: string | null; phone: string | null },
    reason: string | null,
  ) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.blockCalls.push([m.email ?? m.phone ?? '', reason]);
    api.members = api.members.filter((x) => x.id !== m.id);
    return Promise.resolve({ ok: true });
  },
  unblockEmail: (email: string) => {
    api.unblocked.push(email);
    api.blocked = api.blocked.filter((b) => b.email !== email);
    return Promise.resolve({ ok: true });
  },
  fetchInvitingOrganizations: () =>
    Promise.resolve([
      { id: 'org1', name: 'NorCal SCI', shortCode: 'NCS' },
      { id: 'org2', name: 'Elsewhere Rugby', shortCode: 'ER' },
    ]),
  createInvite: (input: unknown) => {
    api.created.push(input);
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    return Promise.resolve({ ok: true });
  },
  resendInvite: (id: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.resent.push(id);
    return Promise.resolve({ ok: true });
  },
  reinviteByEmail: (old: { id: string }, email: string) => {
    api.reinvited.push([old.id, email]);
    return Promise.resolve({ ok: true });
  },
  revokeInvite: (id: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.revoked.push(id);
    return Promise.resolve({ ok: true });
  },
  setMemberType: (id: string, type: string) => {
    api.typeCalls.push([id, type]);
    return Promise.resolve({ ok: true });
  },
  setPartner: (id: string, title: string | null) => {
    api.partnerCalls.push([id, title]);
    api.partners.set(id, title ?? api.partners.get(id) ?? null);
    return Promise.resolve({ ok: true });
  },
  setStaff: (id: string, organizationId: string) => {
    api.staffCalls.push([id, organizationId]);
    api.partners.set(id, api.partners.get(id) ?? null);
    return Promise.resolve({ ok: true });
  },
  makeMentorOf: (id: string, organizationId: string) => {
    api.mentorCalls.push([id, organizationId]);
    return Promise.resolve({ ok: true });
  },
  removePartner: (id: string) => {
    api.partnerCalls.push([id, 'removed']);
    api.partners.delete(id);
    return Promise.resolve({ ok: true });
  },
  deleteMember: (id: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.deleted.push(id);
    api.members = api.members.filter((m) => m.id !== id);
    return Promise.resolve({ ok: true });
  },
  setMemberStatus: (id: string, status: string) => {
    api.statusCalls.push([id, status]);
    return Promise.resolve({ ok: true });
  },
  addStrike: (id: string, reason: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.strikes.push([id, reason]);
    // The roster moves too, the way it does when load() re-reads
    // admin_members — otherwise a test could strike somebody onto three and
    // find the row still offering a fourth.
    let counting = 0;
    api.members = api.members.map((m) => {
      if (m.id !== id) return m;
      counting = m.strikes + 1;
      return { ...m, strikes: counting };
    });
    // As admin_strike_member: the third pauses, or after a pause closes.
    const outcome = counting >= 3 ? (api.pausedBefore ? 'closed' : 'paused') : 'none';
    if (outcome === 'paused') {
      api.members = api.members.map((m) => (m.id === id ? { ...m, status: 'suspended' } : m));
    }
    if (outcome === 'closed') api.members = api.members.filter((m) => m.id !== id);
    return Promise.resolve(
      api.reportsStrikeCount
        ? { ok: true, strikes: counting, outcome, pausedUntil: '2026-12-20T18:00:00Z' }
        : { ok: true },
    );
  },
  fetchStrikes: () => Promise.resolve({ ok: true as const, strikes: api.strikeRows }),
  withdrawStrike: (id: string, reason: string) => {
    if (api.failWith) return Promise.resolve({ ok: false, error: api.failWith });
    api.withdrawn.push([id, reason]);
    return Promise.resolve({ ok: true });
  },
}));

// The invite form offers only the organizations the administrator belongs to.
vi.mock('@/lib/organization-members', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMemberOrganizations: () => ['org1'],
}));
// Who is a professional, read with the roster; never the network.
vi.mock('@/lib/club-partners', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPartnerTitles: () => Promise.resolve(new Map(api.partners)),
  fetchStaffOrganizations: () => Promise.resolve(new Map()),
  forgetPartnerTitles: () => undefined,
}));

// The directory the Make staff and Make mentor panels choose from.
vi.mock('@/lib/organizations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganizations: () => ({
    organizations: [
      { id: 'o1', name: 'The SCI Club', shortCode: 'TSC', city: '' },
      { id: 'o2', name: 'Craig Hospital', shortCode: 'CH', city: 'Englewood' },
    ],
    byId: new Map(),
    loading: false,
    error: null,
    reload: () => undefined,
  }),
}));

// Read on every render for the Invites tab; what the switch itself does is
// tested in joining-section.test.tsx and lib/joining.test.ts.
const joining = vi.hoisted(() => ({ open: false }));
vi.mock('@/lib/joining', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useJoiningSetting: () => ({
    setting: { open: joining.open, changedAt: null },
    error: null,
    reload: () => undefined,
  }),
}));

// Read on every render for the tab's count; renewals-section.test.tsx tests the list.
const renewals = vi.hoisted(() => ({ list: [] as Renewal[] }));
vi.mock('@/routes/admin/renewals', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRenewals: () => ({ renewals: renewals.list, error: null, reload: () => undefined }),
}));

// The Going tab reads events and who is going; neither is what this file tests
// (event-contacts-section.test.tsx does), but the page imports the section.
vi.mock('@/routes/admin/event-contacts-section', () => ({
  EventContactsSection: () => <p>Going section</p>,
}));
vi.mock('@/routes/admin/invite-tracking-section', () => ({
  InviteTrackingSection: () => <p>How the invites did</p>,
}));

const { default: AdminPage } = await import('@/routes/admin/page');

const member = (o: Partial<AdminMember> = {}): AdminMember => ({
  id: 'm1',
  displayName: 'Alfred S',
  phone: '12222222222',
  email: 'alfred.s@example.com',
  username: null,
  type: 'peer',
  status: 'active',
  isAdmin: false,
  isSeed: false,
  city: 'Foster City',
  state: 'CA',
  createdAt: '2026-09-11T08:43:18Z',
  invitesUsed: 0,
  strikes: 0,
  ...o,
});

function renderAdmin(entry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/home" element={<p>Home</p>} />
        <Route path="/join" element={<p>Welcome screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Opens a member's row, as an administrator does before acting on it. Only
 * opens: a second call on an open row must not close it again.
 */
async function manage(name: string | RegExp = /^Manage /) {
  const [button] = await screen.findAllByRole('button', { name });
  if (!button) throw new Error(`No ${String(name)} button`);
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button);
}

beforeEach(() => {
  account.current = { status: 'member', userId: 'me', isAdmin: true, displayName: 'Test' };
  api.members = [member()];
  api.reach = null;
  api.invites = [];
  api.tally = [];
  api.deleted = [];
  api.revoked = [];
  api.statusCalls = [];
  api.strikes = [];
  api.withdrawn = [];
  api.reportsStrikeCount = true;
  api.pausedBefore = false;
  api.strikeRows = [];
  api.typeCalls = [];
  api.created = [];
  api.blocked = [];
  api.blockCalls = [];
  api.unblocked = [];
  api.resent = [];
  api.reinvited = [];
  api.failWith = null;
  api.openReports = 0;
  api.partners = new Map();
  api.partnerCalls = [];
  api.staffCalls = [];
  api.mentorCalls = [];
  joining.open = false;
  renewals.list = [];
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  // vi.spyOn on an already-spied method hands back the *existing* spy, so
  // without this the call history survives from one test to the next and
  // `not.toHaveBeenCalled()` asserts against the previous test's clicks.
  // Setting a return value works either way, which is why the older tests
  // here never noticed.
  confirmSpy.mockClear();
});

// 20261029100000; no title asked for, 20261104160000; staff of an
// organization, which Make staff asks for first (the owner, 2026-11-16).
describe('staff', () => {
  it('makes a member staff only of an organization chosen, without asking for their profession', async () => {
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make staff' }));
    expect(screen.queryByLabelText('Profession shown beside their name')).toBeNull();
    const make = screen.getAllByRole('button', { name: 'Make staff' }).at(-1);
    if (!make) throw new Error('no button');
    expect(make).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'o1');
    await userEvent.click(make);
    await waitFor(() => {
      expect(api.staffCalls).toEqual([['m1', 'o1']]);
    });
    expect(api.partnerCalls).toEqual([]);
  });

  it('can still change the profession they wrote', async () => {
    api.partners = new Map([['m1', 'Physical therapist']]);
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Change profession' }));
    const field = screen.getByLabelText('Profession shown beside their name');
    await userEvent.clear(field);
    await userEvent.type(field, ' Physical therapist, SCI-FIT ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.partnerCalls).toEqual([['m1', 'Physical therapist, SCI-FIT']]);
    });
  });

  it('shows the title, and removes the role after asking', async () => {
    api.partners = new Map([['m1', 'Peer support, SCVMC']]);
    renderAdmin();
    await manage();
    expect(await screen.findByText(/Peer support, SCVMC/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove as staff' }));
    expect(api.partnerCalls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the role' }));
    await waitFor(() => {
      expect(api.partnerCalls).toEqual([['m1', 'removed']]);
    });
  });

  it('offers nothing on a directory row, which nobody signs in as', async () => {
    api.members = [member({ isSeed: true })];
    renderAdmin();
    await manage();
    expect(screen.queryByRole('button', { name: 'Make staff' })).toBeNull();
  });
});

describe('getting back out', () => {
  it('offers a link to Me', async () => {
    renderAdmin();
    const back = await screen.findByRole('link', { name: 'Me' });
    expect(back).toHaveAttribute('href', '/me');
  });
});

describe('AdminPage', () => {
  it('sends an ordinary member back to the club rather than showing an empty tool', async () => {
    account.current = { status: 'member', userId: 'me', isAdmin: false, displayName: 'Test' };
    renderAdmin();
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  // The owner, 2026-10-21: who can be reached by a notification, and who has
  // the app.
  it('says whether each member has notifications on and the Home Screen app', async () => {
    api.members = [member({ id: 'on' }), member({ id: 'off', displayName: 'Bea B' })];
    api.reach = new Map([
      ['on', { pushDevices: 2, homeScreenAt: '2026-10-20T18:00:00Z' }],
      ['off', { pushDevices: 0, homeScreenAt: null }],
    ]);
    renderAdmin();
    expect(
      await screen.findByText(
        'Notifications on, 2 devices · Home Screen app, last signed in Oct 20',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Notifications off · No Home Screen app seen')).toBeInTheDocument();
  });

  it('shows neither when it cannot tell', async () => {
    renderAdmin();
    expect(await screen.findByText('Alfred S')).toBeInTheDocument();
    expect(screen.queryByText(/Notifications (on|off)/)).toBeNull();
  });

  it('sends a signed-out visitor to the welcome screen', async () => {
    account.current = { status: 'signed-out', userId: null, isAdmin: false, displayName: 'Test' };
    renderAdmin();
    expect(await screen.findByText('Welcome screen')).toBeInTheDocument();
  });

  it('lists joined members with the email an admin needs to identify them, and the phone if given', async () => {
    api.members = [member({ username: 'alfred.s' })];
    renderAdmin();
    expect(await screen.findByText('Alfred S')).toBeInTheDocument();
    expect(screen.getByText(/alfred\.s@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/12222222222/)).toBeInTheDocument();
    expect(screen.getByText(/@alfred\.s/)).toBeInTheDocument();
  });

  // A phone member who has not added an email yet: the list says so rather
  // than printing nothing, which would read as a row that failed to load.
  it('says when a member has no email yet', async () => {
    api.members = [member({ email: null })];
    renderAdmin();
    expect(await screen.findByText(/no email yet/)).toBeInTheDocument();
  });

  it('separates people who joined from the seeded directory', async () => {
    api.members = [member(), member({ id: 'm2', displayName: 'Todd', isSeed: true })];
    renderAdmin();
    await screen.findByText('Alfred S');
    // The counts share one line with the invite tally, so read the header whole
    // rather than matching a string that spans several elements.
    const header = screen.getByRole('banner');
    expect(header.textContent).toContain('1 joined');
    expect(header.textContent).toContain('1 from the directory');
  });

  it('pauses a member', async () => {
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(api.statusCalls).toEqual([['m1', 'suspended']]);
    });
  });

  it('offers to resume somebody already paused', async () => {
    api.members = [member({ status: 'suspended' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(api.statusCalls).toEqual([['m1', 'active']]);
    });
  });

  it('asks before removing, because a real person loses their profile', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    // The panel, not a native dialog: nothing has happened yet.
    expect(screen.getByText(/Remove Alfred S from the club\?/)).toBeInTheDocument();
    expect(api.deleted).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Remove them' }));
    await waitFor(() => {
      expect(api.deleted).toEqual(['m1']);
    });
  });

  it('does nothing when the panel is cancelled', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleted).toEqual([]);
    expect(screen.queryByText(/Remove Alfred S from the club\?/)).toBeNull();
  });

  it("shows the database's own refusal rather than a rewritten one", async () => {
    const user = userEvent.setup();
    api.failWith = 'An administrator cannot be deleted from the application';
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove them' }));
    expect(
      await screen.findByText('An administrator cannot be deleted from the application'),
    ).toBeInTheDocument();
  });

  it('offers an administrator no controls at all, not even an explanation', async () => {
    // Their membership cannot be ended from the application and their type is
    // a rule rather than a choice, so every control this row could carry is one
    // the database would refuse. A sentence saying so put an apology where an
    // action goes, on the row an administrator sees every time.
    api.members = [
      member({ id: 'other-admin', displayName: 'Co-admin', isAdmin: true }),
      member({ id: 'ordinary', displayName: 'Ordinary', isAdmin: false }),
    ];
    renderAdmin();
    await screen.findByText('Co-admin');
    // One row to open, and it is not the administrator's.
    expect(screen.getAllByRole('button', { name: /^Manage / })).toHaveLength(1);
    await manage('Manage Ordinary');
    // One of each, all belonging to the member they can actually be done to.
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Make (peer|mentor)/ })).toHaveLength(1);
    expect(screen.queryByText(/service role/i)).not.toBeInTheDocument();
  });

  it('does not hold an administrator to the mentor allowance', async () => {
    // Every administrator is a mentor now, and a mentor's row prints "N of 2
    // invites used" — but an administrator invites through admin_create_invite,
    // which the cap does not govern. The real row read "3 of 2 invites used".
    api.members = [member({ id: 'me', displayName: 'Admin', isAdmin: true, invitesUsed: 3 })];
    renderAdmin();
    await screen.findByText(/Admin/);
    expect(screen.queryByText(/of 2 invites used/)).not.toBeInTheDocument();
  });

  it('marks who you are, so you do not act on your own row by accident', async () => {
    api.members = [member({ id: 'me', displayName: 'Alfred Shaheen', isAdmin: true })];
    renderAdmin();
    expect(await screen.findByText('you')).toBeInTheDocument();
    // The page heading is also "Admin", so match the badge specifically.
    const badges = screen.getAllByText('Admin').filter((el) => el.tagName !== 'H1');
    expect(badges).toHaveLength(1);
  });
});

describe('what an invite can have done to it', () => {
  it('offers revoke on an invite nobody is on', () => {
    // It read "unused", offered no way to act on it, and the number underneath
    // could not be invited again while the dead row counted as live.
    expect(canRevoke(invite({ status: 'consumed', heldBy: null }))).toBe(true);
  });

  it('does not offer revoke when somebody is on the number', () => {
    // That would take a membership away through the wrong door.
    expect(canRevoke(invite({ status: 'consumed', heldBy: 'Bob', heldByStatus: 'active' }))).toBe(
      false,
    );
  });

  it('offers nothing when the database cannot say who holds it', () => {
    const { heldBy: _h, ...unknownHolder } = invite({ status: 'consumed' });
    expect(canRevoke(unknownHolder as AdminInvite)).toBe(false);
  });

  it('always offers revoke on a pending invite', () => {
    expect(canRevoke(invite({ status: 'pending' }))).toBe(true);
  });
});

describe('what an invite says it is', () => {
  it('names the member holding it rather than saying "consumed"', () => {
    expect(inviteState(invite({ status: 'consumed', heldBy: 'Bob', heldByStatus: 'active' }))).toBe(
      'used by Bob',
    );
  });

  it('reads an invite backing nobody exactly like one never used', () => {
    // The row this was found on. "consumed" claimed somebody used this and is
    // in the club, when nobody is — and a word of its own only raised the
    // question of what the difference was, when for an administrator there
    // isn't one: nobody is behind it and it can come off the list.
    expect(inviteState(invite({ status: 'consumed', heldBy: null }))).toBe('not used yet');
    expect(inviteState(invite({ status: 'consumed', heldBy: null }))).toBe(
      inviteState(invite({ status: 'pending' })),
    );
  });

  it('claims nothing about a holder the database does not report', () => {
    // `held_by` arrived in a later migration. An app deployed ahead of its
    // database printed "that account has since been deleted" against every
    // used invite, the club's own administrator included, purely because the
    // column was missing. Absent is not the same as none.
    const { heldBy: _h, heldByStatus: _s, ...withoutTheColumn } = invite({ status: 'consumed' });
    expect(inviteState(withoutTheColumn as AdminInvite)).toBe('used');
  });

  it('does not present a removed member as a member in good standing', () => {
    expect(
      inviteState(invite({ status: 'consumed', heldBy: 'Bob', heldByStatus: 'removed' })),
    ).toBe('used by Bob, who was removed');
  });

  it('names a walk-in without saying they used an invite', () => {
    const walkIn = { status: 'consumed' as const, joinedWhileOpen: true, heldBy: 'Dana' };
    expect(inviteState(invite({ ...walkIn, heldByStatus: 'active' }))).toBe('Dana');
    expect(inviteState(invite({ ...walkIn, heldByStatus: 'removed' }))).toBe(
      'Dana, who was removed',
    );
  });

  it('puts the other two states in English too', () => {
    expect(inviteState(invite({ status: 'pending' }))).toBe('not used yet');
    expect(inviteState(invite({ status: 'revoked' }))).toBe('revoked');
  });
});

describe('who vouched', () => {
  // The distinction the page used to lose: both rendered as a bare name, so
  // an organization's invite and a mentor's were indistinguishable.
  it('names a mentor as one, and an organization plainly', () => {
    expect(vouchedBy(invite({ invitedByOrganization: 'NorCal SCI', invitedByMember: null }))).toBe(
      'NorCal SCI',
    );
    expect(vouchedBy(invite({ invitedByOrganization: null, invitedByMember: 'Todd' }))).toBe(
      'Todd (mentor)',
    );
  });

  it('names the administrator whose QR code it was, and the event', () => {
    const fromCode = { fromQrCode: true, joinedWhileOpen: true, invitedByOrganization: null };
    expect(
      vouchedBy(
        invite({ ...fromCode, invitedByMember: 'Alfred', qrEventName: 'Abilities Expo LA' }),
      ),
    ).toBe('Invited by Alfred · Abilities Expo LA');
    expect(vouchedBy(invite({ ...fromCode, invitedByMember: 'Alfred', qrEventName: null }))).toBe(
      'Invited by Alfred',
    );
  });

  it('says a walk-in joined while invite only was off, not "unknown"', () => {
    expect(
      vouchedBy(
        invite({ invitedByOrganization: null, invitedByMember: null, joinedWhileOpen: true }),
      ),
    ).toBe('Joined when invite only was off');
  });

  it('says so when the inviter’s account is gone', () => {
    expect(vouchedBy(invite({ invitedByOrganization: null, invitedByMember: null }))).toBe(
      'unknown',
    );
  });
});

describe('somebody who started and stopped', () => {
  // The state nothing could show before: the invite is consumed by a trigger
  // on the member insert, so abandoning onboarding leaves it pending and
  // looking exactly like a number nobody has touched.
  it('is not read as an untouched number', () => {
    expect(inviteState(invite({ status: 'pending', hasAccount: true }))).toBe(
      'signed up, never finished joining',
    );
    expect(inviteState(invite({ status: 'pending', hasAccount: false }))).toBe('not used yet');
  });

  // A database that predates the column cannot tell us either way, and
  // guessing "they never signed up" would be asserting something unknown —
  // the same trap heldBy's three-valued handling exists for.
  it('says nothing extra where the view does not report it', () => {
    expect(inviteState(invite({ status: 'pending', hasAccount: undefined }))).toBe('not used yet');
  });
});

describe('blocking an address', () => {
  async function openInvites(user: ReturnType<typeof userEvent.setup>) {
    renderAdmin();
    await screen.findByRole('tab', { name: 'Invites' });
    await user.click(screen.getByRole('tab', { name: 'Invites' }));
  }

  // The checkbox is the whole difference between removing somebody and
  // banning them, so it is worth proving it is off by default: an
  // administrator who ticks nothing must not be blocking a number.
  it('removes without blocking unless the box is ticked', async () => {
    const user = userEvent.setup();
    api.members = [member({ id: 'm9', displayName: 'Nuisance', email: 'nuisance@example.com' })];
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(
      screen.getByRole('checkbox', { name: /Block this email address too/ }),
    ).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Remove them' }));

    await waitFor(() => {
      expect(api.deleted).toEqual(['m9']);
    });
    expect(api.blockCalls).toEqual([]);
  });

  it('blocks instead, with a reason, when the box is ticked', async () => {
    const user = userEvent.setup();
    api.members = [member({ id: 'm9', displayName: 'Nuisance', email: 'nuisance@example.com' })];
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('checkbox', { name: /Block this email address too/ }));

    // The button says what it will do, rather than leaving the tick to be
    // remembered.
    await user.type(screen.getByLabelText(/Reason/), 'Harassing members');
    await user.click(screen.getByRole('button', { name: 'Remove and block' }));

    await waitFor(() => {
      expect(api.blockCalls).toEqual([['nuisance@example.com', 'Harassing members']]);
    });
    // One call, removeAndBlock, rather than a block and a separate delete
    // from the page: the order of the two is that function's to keep.
    expect(api.deleted).toEqual([]);
  });

  it('records no reason rather than an empty one', async () => {
    const user = userEvent.setup();
    api.members = [member({ id: 'm9', email: 'nuisance@example.com' })];
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('checkbox', { name: /Block this email address too/ }));
    await user.type(screen.getByLabelText(/Reason/), '   ');
    await user.click(screen.getByRole('button', { name: 'Remove and block' }));

    await waitFor(() => {
      expect(api.blockCalls).toEqual([['nuisance@example.com', null]]);
    });
  });

  it('says the event history goes too, which is the part nobody expects', async () => {
    // event_rsvps, event_dismissals, organization_follows and member_strikes
    // all cascade on member_id. The panel used to name only the profile and
    // the invite.
    api.members = [member({ id: 'm1', displayName: 'Ordinary' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/Everything they said they were going to/)).toBeInTheDocument();
    expect(screen.getByText(/the organizations they follow/)).toBeInTheDocument();
    expect(screen.getByText(/rejoining later starts them from nothing/)).toBeInTheDocument();
  });

  it('says what they wrote does not go, which is the opposite surprise', async () => {
    // Every author column in Chat is `on delete set null`, so a removed
    // member's posts and messages keep their words and lose their name —
    // chat-member-removed.sql proves it. An administrator who has just read
    // the paragraph above would otherwise expect a room's history to leave
    // with whoever wrote it.
    api.members = [member({ id: 'm1', displayName: 'Ordinary' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(
      screen.getByText(/What they wrote in the discussion rooms and in conversations stays/),
    ).toBeInTheDocument();
    expect(screen.getByText(/without their name on it/)).toBeInTheDocument();
  });

  it('asks for no reason until there is something to give one for', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
  });

  // Nobody has ever signed in as a seeded row, so there is no conduct to
  // answer for and the number came from the organization's directory.
  // It used to be hidden here, on the grounds that nobody signs in as a
  // seeded row. But the number on one is a real person's, twenty-two of the
  // rows on this tab are seeded, and an option missing from most of them
  // reads as broken.
  it('offers the block option on a directory row too', async () => {
    const user = userEvent.setup();
    api.members = [
      member({
        id: 's1',
        displayName: 'Seeded Sam',
        phone: '15555550000',
        email: null,
        isSeed: true,
      }),
    ];
    renderAdmin();
    await manage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await user.click(screen.getByRole('checkbox', { name: /Block this number too/ }));
    await user.click(screen.getByRole('button', { name: 'Remove and block' }));
    await waitFor(() => {
      expect(api.blockCalls).toEqual([['15555550000', null]]);
    });
  });

  it('unblocks from the blocked list, after confirming', async () => {
    const user = userEvent.setup();
    api.blocked = [
      {
        email: 'nuisance@example.com',
        reason: 'Harassing members',
        blockedAt: '2026-09-13T00:00:00Z',
        blockedBy: 'Admin',
      },
    ];
    await openInvites(user);

    expect(await screen.findByText('Harassing members', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => {
      expect(api.unblocked).toEqual(['nuisance@example.com']);
    });
  });
});

describe('with the seeded directory removed (20261010020000)', () => {
  it('draws no directory filter, section or count when nobody is seeded', async () => {
    renderAdmin();
    await screen.findByText('Alfred S');
    expect(screen.queryByRole('button', { name: /^Directory/ })).toBeNull();
    expect(screen.queryByText('From the directory')).toBeNull();
    expect(screen.getByRole('banner').textContent).not.toContain('from the directory');
  });

  it('still draws them while a database has seeded rows', async () => {
    api.members = [member(), member({ id: 'm2', displayName: 'Todd', isSeed: true })];
    renderAdmin();
    await screen.findByText('Todd');
    expect(screen.getByRole('button', { name: 'Directory · 1' })).toBeInTheDocument();
    expect(screen.getByText('From the directory')).toBeInTheDocument();
  });
});

describe('the withdrawn list', () => {
  const revoked = (email: string, id: string, createdAt: string) =>
    invite({ id, email, status: 'revoked', createdAt });

  // The grouping itself is the database's: supabase/tests/admin-invite-page.sql.
  it('says how many times, on screen, only when it is more than once', async () => {
    const user = userEvent.setup();
    api.invites = [
      revoked('a@example.com', 'a', '2026-09-01T00:00:00Z'),
      revoked('a@example.com', 'b', '2026-09-05T00:00:00Z'),
      revoked('b@example.com', 'c', '2026-09-02T00:00:00Z'),
    ];
    renderAdmin();
    await screen.findByRole('tab', { name: 'Invites' });
    await user.click(screen.getByRole('tab', { name: 'Invites' }));

    expect(await screen.findByText(/withdrawn 2 times/)).toBeInTheDocument();
    expect(screen.getAllByText('a@example.com')).toHaveLength(1);
    expect(screen.getByText('b@example.com')).toBeInTheDocument();
  });
});

describe('the side of the invites tab', () => {
  const wideScreen = (matches: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  };
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  // Beside the list it scrolls on its own, so the keyboard must reach it.
  it('is a named keyboard stop when it sits beside the list', async () => {
    wideScreen(true);
    const user = userEvent.setup();
    renderAdmin();
    await user.click(await screen.findByRole('tab', { name: 'Invites' }));
    const side = await screen.findByRole('region', { name: 'Joining and adding to the list' });
    expect(side).toHaveAttribute('tabindex', '0');
    expect(within(side).getByRole('heading', { name: 'Add to the list' })).toBeInTheDocument();
  });

  it('is no extra stop in one column, where it does not scroll', async () => {
    wideScreen(false);
    const user = userEvent.setup();
    renderAdmin();
    await user.click(await screen.findByRole('tab', { name: 'Invites' }));
    const side = await screen.findByRole('region', { name: 'Joining and adding to the list' });
    expect(side).not.toHaveAttribute('tabindex');
  });
});

describe('the three lists', () => {
  // Read a page at a time, so the list reaches past the API's 1,000 rows.
  it('pages The list with Show more until every invite is drawn', async () => {
    const user = userEvent.setup();
    api.invites = Array.from({ length: 120 }, (_, n) =>
      invite({
        id: `i${n}`,
        email: `person${n}@example.com`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 120 - n)).toISOString(),
      }),
    );
    renderAdmin();
    await screen.findByRole('tab', { name: 'Invites' });
    await user.click(screen.getByRole('tab', { name: 'Invites' }));

    expect(await screen.findByText('Showing 50 of 120')).toBeInTheDocument();
    expect(screen.getByText('person0@example.com')).toBeInTheDocument();
    expect(screen.queryByText('person50@example.com')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(await screen.findByText('Showing 100 of 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(await screen.findByText('person119@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/^Showing \d+ of 120$/)).toBeNull();
    expect(screen.getByText(/120 invites waiting/)).toBeInTheDocument();
  });

  // Withdrawn rows used to sit in "The list", which is the heading claiming
  // these numbers are on it, and they accumulate forever.
  it('keeps withdrawn numbers out of the list that says they are on it', async () => {
    const user = userEvent.setup();
    api.invites = [
      invite({ id: 'live', email: 'live@example.com', status: 'pending' }),
      invite({ id: 'gone', email: 'gone@example.com', status: 'revoked' }),
    ];
    renderAdmin();
    await screen.findByRole('tab', { name: 'Invites' });
    await user.click(screen.getByRole('tab', { name: 'Invites' }));

    // Section renders a heading row, a subtitle, then the rows. The heading
    // sits inside a flex wrapper so a section-level action can sit beside it,
    // which is why this starts from the heading's parent.
    const rowsUnder = (title: string) =>
      screen.getByText(title).parentElement?.nextElementSibling?.nextElementSibling as HTMLElement;

    await screen.findByText('The list');
    expect(within(rowsUnder('The list')).getByText('live@example.com')).toBeInTheDocument();
    expect(within(rowsUnder('The list')).queryByText('gone@example.com')).toBeNull();
    expect(within(rowsUnder('Withdrawn')).getByText('gone@example.com')).toBeInTheDocument();
  });

  it('says nothing about withdrawn or blocked when there are none', async () => {
    const user = userEvent.setup();
    api.invites = [invite({ id: 'live', status: 'pending' })];
    renderAdmin();
    await screen.findByRole('tab', { name: 'Invites' });
    await user.click(screen.getByRole('tab', { name: 'Invites' }));

    await screen.findByText('The list');
    expect(screen.queryByText('Withdrawn')).toBeNull();
    expect(screen.queryByText('Blocked')).toBeNull();
  });
});

const invite = (o: Partial<AdminInvite> = {}): AdminInvite => ({
  id: 'i1',
  email: 'invitee@example.com',
  phone: null,
  sentAt: null,
  claimedAt: null,
  status: 'pending',
  note: null,
  createdAt: '2026-09-11T09:00:00Z',
  invitedByOrganization: 'NorCal SCI',
  invitedByMember: null,
  invitedByMemberIsAdmin: undefined,
  heldBy: null,
  heldByStatus: null,
  hasAccount: false,
  joinedWhileOpen: false,
  fromQrCode: false,
  qrEventName: null,
  ...o,
});

describe('the invite list', () => {
  const openInvites = async () => {
    renderAdmin();
    await userEvent.click(await screen.findByRole('tab', { name: 'Invites' }));
  };

  it('counts who is waiting, in the header', async () => {
    api.invites = [invite(), invite({ id: 'i2', status: 'consumed' })];
    renderAdmin();
    expect(await screen.findByText(/1 invite waiting/)).toBeInTheDocument();
  });

  it('shows the list with who vouched for each address', async () => {
    api.invites = [invite()];
    await openInvites();
    expect(screen.getByText('invitee@example.com')).toBeInTheDocument();
    // The form's organization dropdown also says "NorCal SCI"; the row's meta
    // line is the one followed by a separator.
    expect(screen.getByText(/NorCal SCI ·/)).toBeInTheDocument();
  });

  // Counted by admin_join_tally (admin-invite-page.sql); drawn here.
  it('draws who joined while open, by event and administrator', async () => {
    api.tally = [
      {
        label: 'Expo',
        joined: 3,
        byAdmin: [
          { name: 'Alfred', joined: 2 },
          { name: 'Sam', joined: 1 },
        ],
      },
      { label: 'Walk-ins, no code', joined: 1, byAdmin: [] },
    ];
    await openInvites();
    const table = screen.getByRole('table');
    const expo = within(table).getByRole('row', { name: /Expo/ });
    expect(expo).toHaveTextContent('Expo3Alfred 2 · Sam 1');
    expect(within(table).getByRole('row', { name: /Walk-ins, no code/ })).toHaveTextContent('1');
  });

  it('draws no tally when nobody joined while open', async () => {
    api.invites = [invite()];
    await openInvites();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists a walk-in by address, and says under it how they came', async () => {
    api.invites = [
      invite({
        email: 'walkin@example.com',
        status: 'consumed',
        invitedByOrganization: null,
        joinedWhileOpen: true,
        heldBy: 'Dana S',
        heldByStatus: 'active',
      }),
    ];
    await openInvites();
    expect(screen.getByText('walkin@example.com')).toBeInTheDocument();
    expect(screen.getByText(/^Joined when invite only was off ·/)).toBeInTheDocument();
    expect(screen.getByText('Dana S')).toBeInTheDocument();
    expect(screen.queryByText(/link not sent yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('says whether the link has gone out, and when', async () => {
    api.invites = [
      invite({ id: 'i1', email: 'unsent@example.com', sentAt: null }),
      invite({ id: 'i2', email: 'sent@example.com', sentAt: '2026-10-03T12:00:00Z' }),
    ];
    await openInvites();
    expect(screen.getByText(/link not sent yet/)).toBeInTheDocument();
    expect(screen.getByText(/link sent Oct 3/)).toBeInTheDocument();
  });

  it('revokes a pending invite, after confirming', async () => {
    api.invites = [invite()];
    await openInvites();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(api.revoked).toEqual(['i1']);
    });
  });

  it('sends the link again from a pending invite, and not from one already used', async () => {
    api.invites = [invite({ sentAt: '2026-10-03T12:00:00Z' })];
    await openInvites();
    await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => {
      expect(api.resent).toEqual(['i1']);
    });
  });

  it('offers no resend once the invite is used or withdrawn', async () => {
    api.invites = [
      invite({ id: 'u', email: 'used@example.com', status: 'consumed', heldBy: 'Bob' }),
      invite({ id: 'r', email: 'gone@example.com', status: 'revoked' }),
    ];
    await openInvites();
    expect(screen.queryByRole('button', { name: /^(Resend|Send) link$/ })).toBeNull();
  });

  it('blocks an invited address, after asking, with the reason', async () => {
    const user = userEvent.setup();
    api.invites = [invite()];
    await openInvites();
    await user.click(screen.getByRole('button', { name: 'Block…' }));
    await user.type(screen.getByLabelText(/Reason/), 'Not a member of our community');
    await user.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => {
      expect(api.blockCalls).toEqual([['invitee@example.com', 'Not a member of our community']]);
    });
  });

  describe('an invite made by phone before email sign-in', () => {
    const old = () => invite({ id: 'p1', email: null, phone: '14085551234', note: 'Met at rugby' });

    it('is marked as old, and offers no resend and no block', async () => {
      api.invites = [old()];
      await openInvites();
      expect(screen.getByText('14085551234')).toBeInTheDocument();
      expect(screen.getByText('phone invite (old)')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^(Resend|Send) link$/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Block…' })).toBeNull();
    });

    it('is re-invited by email through the one action that withdraws it', async () => {
      const user = userEvent.setup();
      api.invites = [old()];
      await openInvites();
      await user.click(screen.getByRole('button', { name: 'Re-invite by email' }));
      await user.type(screen.getByLabelText(/Email address for 14085551234/), 'dana@example.com');
      await user.click(screen.getByRole('button', { name: 'Send the link' }));
      await waitFor(() => {
        expect(api.reinvited).toEqual([['p1', 'dana@example.com']]);
      });
    });

    it('will not send to something that is not an address', async () => {
      const user = userEvent.setup();
      api.invites = [old()];
      await openInvites();
      await user.click(screen.getByRole('button', { name: 'Re-invite by email' }));
      await user.type(screen.getByLabelText(/Email address for/), 'dana');
      expect(screen.getByRole('button', { name: 'Send the link' })).toBeDisabled();
    });
  });

  it('will not add an address until it looks like one', async () => {
    await openInvites();
    const add = screen.getByRole('button', { name: 'Add and send the link' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email address'), 'dana@example');
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email address'), '.com');
    expect(add).toBeEnabled();
  });

  it('has no phone field on the form', async () => {
    await openInvites();
    expect(screen.queryByLabelText('Phone number')).toBeNull();
  });

  // The owner, 2026-11-15: "If an admin has only one org then just assign it
  // to that org." This administrator belongs to NorCal SCI alone.
  it('invites for their only organization, without asking', async () => {
    await openInvites();
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'For NorCal SCI',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Vouched for by/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Email address'), '  Dana@Example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Add and send the link' }));
    await waitFor(() => {
      // Trimmed here; lowercased by the database (normalize_email).
      expect(api.created).toEqual([
        { email: 'Dana@Example.com', organizationId: 'org1', note: null },
      ]);
    });
    expect(await screen.findByText(/on its way to Dana@Example.com/)).toBeInTheDocument();
  });

  it('sends the note, the name and the email note when they are given', async () => {
    await openInvites();
    await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'For NorCal SCI');
    await userEvent.type(screen.getByLabelText('Email address'), 'dana@example.com');
    await userEvent.type(screen.getByLabelText(/Their name/), 'Dana Lee');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Met at rugby');
    await userEvent.type(screen.getByLabelText(/Note in the email/), 'See you Saturday');
    await userEvent.click(screen.getByRole('button', { name: 'Add and send the link' }));
    await waitFor(() => {
      expect(api.created).toEqual([
        {
          email: 'dana@example.com',
          organizationId: 'org1',
          note: 'Met at rugby',
          name: 'Dana Lee',
          message: 'See you Saturday',
        },
      ]);
    });
  });

  it('offers only the organizations they belong to', async () => {
    await openInvites();
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'For NorCal SCI',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere Rugby')).toBeNull();
  });

  it('shows the database’s refusal and keeps what was typed', async () => {
    api.failWith = 'That email address is blocked from the club and cannot be invited';
    await openInvites();
    await userEvent.type(screen.getByLabelText('Email address'), 'dana@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add and send the link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked from the club/);
    expect(screen.getByLabelText('Email address')).toHaveValue('dana@example.com');
  });
});

describe('who vouched, on the list', () => {
  // A member inviter used to mean a mentor and nothing else.
  it('tells an administrator apart from a mentor', () => {
    expect(
      vouchedBy(
        invite({
          invitedByOrganization: null,
          invitedByMember: 'Alfred Shaheen',
          invitedByMemberIsAdmin: true,
        }),
      ),
    ).toBe('Alfred Shaheen (admin)');
    expect(
      vouchedBy(
        invite({
          invitedByOrganization: null,
          invitedByMember: 'Todd',
          invitedByMemberIsAdmin: false,
        }),
      ),
    ).toBe('Todd (mentor)');
  });

  // A database that predates the column cannot say which, and every member
  // inviter on it is a mentor, because that was the only way in.
  it('says mentor where the view does not report it', () => {
    expect(
      vouchedBy(
        invite({
          invitedByOrganization: null,
          invitedByMember: 'Todd',
          invitedByMemberIsAdmin: undefined,
        }),
      ),
    ).toBe('Todd (mentor)');
  });
});

describe('mentor status', () => {
  it('makes a peer a mentor of the organization chosen', async () => {
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make mentor' }));
    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'o1');
    const make = screen.getAllByRole('button', { name: 'Make mentor' }).at(-1);
    if (!make) throw new Error('no button');
    await userEvent.click(make);
    await waitFor(() => {
      expect(api.mentorCalls).toEqual([['m1', 'o1']]);
    });
    expect(api.typeCalls).toEqual([]);
  });

  it('demotes a mentor', async () => {
    api.members = [member({ type: 'mentor' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make peer' }));
    await waitFor(() => {
      expect(api.typeCalls).toEqual([['m1', 'peer']]);
    });
  });
});

describe('giving somebody a strike', () => {
  it('will not send one without a reason', async () => {
    // The database refuses an empty reason, and a strike nobody can read the
    // cause of is unanswerable — so the button does not offer to try.
    api.members = [member({ id: 'm1', displayName: 'Ordinary' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Strike' }));
    expect(screen.getByRole('button', { name: 'Give the strike' })).toBeDisabled();
    expect(api.strikes).toEqual([]);
  });

  it('sends the reason the administrator typed', async () => {
    api.members = [member({ id: 'm1', displayName: 'Ordinary' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Strike' }));
    await userEvent.type(screen.getByLabelText('What happened?'), '  Sold supplements  ');
    await userEvent.click(screen.getByRole('button', { name: 'Give the strike' }));
    expect(api.strikes).toEqual([['m1', 'Sold supplements']]);
  });

  it('shows the count on the row, so the roster says where somebody stands', async () => {
    api.members = [member({ id: 'm1', displayName: 'Ordinary', strikes: 2 })];
    renderAdmin();
    expect(await screen.findByText('2 strikes')).toBeInTheDocument();
  });

  it('says "1 strike", not "1 strikes"', async () => {
    api.members = [member({ id: 'm1', strikes: 1 })];
    renderAdmin();
    expect(await screen.findByText('1 strike')).toBeInTheDocument();
  });

  it('offers no strike on an administrator, which the database refuses anyway', async () => {
    api.members = [member({ id: 'a1', displayName: 'Co-admin', isAdmin: true })];
    renderAdmin();
    await screen.findByText('Co-admin');
    // Not even a row to open, so no strike behind it.
    expect(screen.queryByRole('button', { name: /^Manage / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Strike' })).not.toBeInTheDocument();
  });
});

// 20261120110000: the third strike pauses the membership for 30 days by
// itself, and the third after a pause closes the account. The page says what
// happened; it no longer asks.
describe('three strikes pause, and three more close', () => {
  const onTwo = () => {
    api.members = [member({ id: 'm1', displayName: 'Ordinary', strikes: 2 })];
  };
  async function strikeOnce(why: string) {
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Strike' }));
    await userEvent.type(screen.getByLabelText('What happened?'), why);
    await userEvent.click(screen.getByRole('button', { name: 'Give the strike' }));
  }

  it('says the third paused them, and asks nothing', async () => {
    onTwo();
    renderAdmin();
    await strikeOnce('Third thing');
    expect(
      await screen.findByText(/third strike, so their membership is paused for 30 days/),
    ).toBeInTheDocument();
    expect(api.statusCalls).toEqual([]);
    expect(api.deleted).toEqual([]);
  });

  it('says the third after a pause closed the account', async () => {
    onTwo();
    api.pausedBefore = true;
    renderAdmin();
    await strikeOnce('Third thing');
    expect(await screen.findByText(/account is closed for good/)).toBeInTheDocument();
  });

  it('says nothing on the first two', async () => {
    api.members = [member({ id: 'm1', displayName: 'Ordinary', strikes: 1 })];
    renderAdmin();
    await strikeOnce('Second thing');
    await screen.findByText('2 strikes');
    expect(screen.queryByText(/third strike/)).not.toBeInTheDocument();
  });

  it('says nothing where the database does not report what happened', async () => {
    api.reportsStrikeCount = false;
    onTwo();
    renderAdmin();
    await strikeOnce('Third thing');
    await screen.findByText('3 strikes');
    expect(screen.queryByText(/third strike/)).not.toBeInTheDocument();
  });
});

/** The nth strike, or a failure rather than an undefined spread. */
function nthStrike(rows: Strike[], index: number): Strike {
  const found = rows[index];
  if (!found) throw new Error(`expected at least ${index + 1} strikes, got ${rows.length}`);
  return found;
}

/** The nth match, or a failure that names what was missing. */
function nth(elements: HTMLElement[], index: number): HTMLElement {
  const found = elements[index];
  if (!found) throw new Error(`expected at least ${index + 1} matches, got ${elements.length}`);
  return found;
}

describe('withdrawing a strike', () => {
  const struck = () => {
    api.members = [member({ id: 'm1', displayName: 'Ordinary', strikes: 2 })];
    api.strikeRows = [
      {
        id: 's1',
        memberId: 'm1',
        reason: 'Sold supplements',
        issuedAt: '2026-09-01T10:00:00Z',
        issuedByName: 'Admin',
        withdrawnAt: null,
        withdrawnReason: null,
        counts: true,
      },
      {
        id: 's2',
        memberId: 'm1',
        reason: 'Repeated a room',
        issuedAt: '2026-09-10T10:00:00Z',
        issuedByName: 'Admin',
        withdrawnAt: null,
        withdrawnReason: null,
        counts: true,
      },
    ];
  };

  it('opens the strikes from the count, which the row already shows', async () => {
    struck();
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: '2 strikes' }));
    expect(screen.getByText('Sold supplements')).toBeInTheDocument();
    expect(screen.getByText('Repeated a room')).toBeInTheDocument();
  });

  it('withdraws the one chosen, not simply the latest', async () => {
    // A member can be on three, and an administrator is usually correcting one
    // particular mistake rather than clearing the slate.
    struck();
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: '2 strikes' }));
    const rows = screen.getAllByRole('button', { name: 'Withdraw' });
    await userEvent.click(nth(rows, 0));
    await userEvent.type(screen.getByLabelText(/Why are you withdrawing/), 'Wrong member');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw it' }));
    expect(api.withdrawn).toEqual([['s1', 'Wrong member']]);
  });

  it('will not withdraw without a reason', async () => {
    // The database refuses one, and a correction with no stated cause is the
    // same problem the strike itself was written to avoid.
    struck();
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: '2 strikes' }));
    await userEvent.click(nth(screen.getAllByRole('button', { name: 'Withdraw' }), 0));
    expect(screen.getByRole('button', { name: 'Withdraw it' })).toBeDisabled();
    expect(api.withdrawn).toEqual([]);
  });

  it('lists only the strikes that still count', async () => {
    // A withdrawn or expired one is on the record and nothing can be done to
    // it, so a button beside it would offer nothing.
    struck();
    api.strikeRows = [
      ...api.strikeRows.slice(0, 1),
      { ...nthStrike(api.strikeRows, 1), counts: false },
    ];
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: '2 strikes' }));
    expect(screen.getByText('Sold supplements')).toBeInTheDocument();
    expect(screen.queryByText('Repeated a room')).not.toBeInTheDocument();
  });
});

describe('the Reports tab', () => {
  it('carries the number waiting, and no number when nothing is', async () => {
    renderAdmin();
    expect(await screen.findByRole('tab', { name: 'Reports' })).toBeInTheDocument();

    cleanup();
    api.openReports = 2;
    renderAdmin();
    // The count is in the tab's own label, because a complaint waiting unseen
    // behind a tab that looks like every other tab is what it is there to
    // prevent.
    expect(await screen.findByRole('tab', { name: /^Reports,\s*2 waiting$/ })).toBeInTheDocument();
  });
});

describe('organization account roles', () => {
  it('lets an administrator designate an organization account', async () => {
    api.members = [member({ id: 'organization-account', displayName: 'Organization account' })];
    renderAdmin();
    await manage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make organization account' }));
    await waitFor(() => {
      expect(api.typeCalls).toContainEqual(['organization-account', 'organization']);
    });
  });
  it('shows a linked mentor’s invite usage without a cap', async () => {
    api.members = [member({ type: 'mentor', invitesUsed: 11, unlimitedInvites: true })];
    renderAdmin();
    expect(await screen.findByText(/11 invites used · no limit/)).toBeInTheDocument();
    expect(screen.queryByText(/11 of 10/)).toBeNull();
  });
});

describe('finding members', () => {
  it('searches joined and directory members by name, location and account type', async () => {
    api.members = [
      member({ id: 'joined', displayName: 'Morgan Example', city: 'Oakland', type: 'mentor' }),
      member({ id: 'directory', displayName: 'Taylor Example', city: 'Sacramento', isSeed: true }),
    ];
    renderAdmin();
    const input = await screen.findByRole('searchbox', { name: 'Find a member' });
    // The database answers, a moment after typing stops (20261029230000).
    await userEvent.type(input, 'MENTOR');
    await waitFor(() => {
      expect(screen.queryByText('Taylor Example')).toBeNull();
    });
    expect(screen.getByText('Morgan Example')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'sacramento');
    await waitFor(() => {
      expect(screen.queryByText('Morgan Example')).toBeNull();
    });
    expect(screen.getByText('Taylor Example')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'morgan');
    await waitFor(() => {
      expect(screen.queryByText('Taylor Example')).toBeNull();
    });
    expect(screen.getByText('Morgan Example')).toBeInTheDocument();
    // Searching never changes membership or account type.
    expect(api.typeCalls).toEqual([]);
    expect(api.statusCalls).toEqual([]);
  });

  it('matches a formatted phone number and offers a way out of no matches', async () => {
    api.members = [member({ displayName: 'Phone Example', phone: '19990001234' })];
    renderAdmin();
    const input = await screen.findByRole('searchbox', { name: 'Find a member' });
    await userEvent.type(input, '(999) 000-1234');
    expect(await screen.findByText('1 matching member')).toBeInTheDocument();
    expect(screen.getByText('Phone Example')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'absent');
    expect(await screen.findByText('No joined members match your search.')).toBeInTheDocument();
    expect(screen.queryByText('Phone Example')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Phone Example')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  // SPEED-PLAN Step 7: the roster comes 50 at a time, so member 1,001 is
  // reachable, by Show more or by searching.
  it('shows 50 at a time, with the total, and Show more reads the next', async () => {
    api.members = Array.from({ length: 120 }, (_, i) =>
      member({ id: `p${String(i)}`, displayName: `Person ${String(i)}` }),
    );
    renderAdmin();
    expect(await screen.findByText('Showing 50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All · 120' })).toBeInTheDocument();
    expect(screen.queryByText('Person 50')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(await screen.findByText('Person 50')).toBeInTheDocument();
    expect(screen.getByText('Showing 100 of 120')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(await screen.findByText('Person 119')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('finds a member past the first page by searching', async () => {
    api.members = Array.from({ length: 120 }, (_, i) =>
      member({ id: `p${String(i)}`, displayName: `Person ${String(i)}` }),
    );
    renderAdmin();
    const input = await screen.findByRole('searchbox', { name: 'Find a member' });
    await userEvent.type(input, 'Person 119');
    expect(await screen.findByText('Person 119')).toBeInTheDocument();
    expect(screen.getByText('1 matching member')).toBeInTheDocument();
  });
});

describe('the Going tab', () => {
  it('shows who is going to an event, for passing to the host', async () => {
    renderAdmin();
    await userEvent.click(await screen.findByRole('tab', { name: 'Going' }));
    expect(await screen.findByText('Going section')).toBeInTheDocument();
  });
});

describe('a roster that fits on a phone', () => {
  it('shows each member closed, with their controls one tap away', async () => {
    renderAdmin();
    const manageButton = await screen.findByRole('button', { name: 'Manage Alfred S' });
    expect(manageButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    await userEvent.click(manageButton);
    expect(manageButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(manageButton);
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('keeps one row open at a time', async () => {
    api.members = [member(), member({ id: 'm2', displayName: 'Todd' })];
    renderAdmin();
    await manage('Manage Alfred S');
    await manage('Manage Todd');
    expect(screen.getByRole('button', { name: 'Manage Alfred S' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
  });

  it('narrows to the directory, or to who is paused or struck', async () => {
    api.members = [
      member({ id: 'fine', displayName: 'Fine Member' }),
      member({ id: 'paused', displayName: 'Paused Member', status: 'suspended' }),
      member({ id: 'struck', displayName: 'Struck Member', strikes: 1 }),
      member({ id: 'seed', displayName: 'Seed Member', isSeed: true, status: 'suspended' }),
    ];
    renderAdmin();
    await screen.findByText('Fine Member');
    await userEvent.click(screen.getByRole('button', { name: 'Directory · 1' }));
    expect(screen.getByText('Seed Member')).toBeInTheDocument();
    expect(screen.queryByText('Fine Member')).toBeNull();
    // A paused directory row is a hidden profile, not a problem with a person.
    await userEvent.click(screen.getByRole('button', { name: 'Paused or struck · 2' }));
    expect(screen.getByText('Paused Member')).toBeInTheDocument();
    expect(screen.getByText('Struck Member')).toBeInTheDocument();
    expect(screen.queryByText('Fine Member')).toBeNull();
    expect(screen.queryByText('Seed Member')).toBeNull();
  });
});

describe('the tabs', () => {
  it('shows org admins without scrolling past the organizations on a narrow screen', async () => {
    renderAdmin('/admin?tab=organizations');
    const heading = await screen.findByRole('heading', { name: 'Org admins', hidden: true });
    const panel = heading.closest('.min-w-0');
    expect(panel).toHaveClass('hidden', 'lg:block', 'lg:overflow-y-auto');
    await userEvent.click(screen.getByRole('button', { name: 'Org admins' }));
    expect(panel).not.toHaveClass('hidden');
    expect(
      screen.getByRole('heading', { name: 'Organizations', hidden: true }).closest('.min-w-0'),
    ).toHaveClass('hidden', 'lg:block');
  });

  it('opens the tab the address names', async () => {
    renderAdmin('/admin?tab=invites');
    expect(await screen.findByRole('tab', { name: 'Invites' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Add to the list' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Find a member' })).toBeNull();
  });

  it('puts who can join on the Invites tab, and the form says what an invite is for', async () => {
    renderAdmin('/admin?tab=invites');
    expect(await screen.findByRole('switch', { name: 'Anybody can join' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText(/^Nobody can join without an invite\./)).toBeInTheDocument();
  });

  it('stops saying an invite is needed while anybody can join', async () => {
    joining.open = true;
    renderAdmin('/admin?tab=invites');
    expect(await screen.findByRole('switch', { name: 'Anybody can join' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/^Anybody can join right now, but an invite/)).toBeInTheDocument();
    expect(screen.queryByText(/^Nobody can join without an invite/)).toBeNull();
  });

  it('puts Reports second, so its count is on screen on a narrow phone', async () => {
    renderAdmin();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Members',
      'Reports',
      'Invites',
      'Going',
      'Organizations',
      'Rooms',
      'Keys & renewals',
      'Stats',
    ]);
  });

  it('still opens Keys & renewals from an old ?tab=sign-in link', async () => {
    renderAdmin('/admin?tab=sign-in');
    expect(await screen.findByRole('tab', { name: 'Keys & renewals' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Renewals' })).toBeInTheDocument();
  });

  it('counts on the tab what wants renewing', async () => {
    const inDays = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const renewal = (id: string, expiresOn: string | null): Renewal => ({
      id,
      name: id,
      purpose: '',
      steps: [],
      expires: true,
      expiresOn,
      signInProvider: null,
    });
    renewals.list = [
      renewal('soon', inDays(10)),
      renewal('gone', inDays(-3)),
      renewal('later', inDays(200)),
      renewal('undated', null),
    ];
    renderAdmin();
    expect(
      await screen.findByRole('tab', { name: 'Keys & renewals, 2 to renew' }),
    ).toBeInTheDocument();
  });
});
