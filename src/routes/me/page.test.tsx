import { Capacitor } from '@capacitor/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/account';
import type * as DetailsApi from '@/routes/profile/details-api';
import type { MemberDetails } from '@/routes/profile/details-api';
import { applicableQuestions } from '@/routes/profile/questions';

const account = vi.hoisted(() => ({ current: null as Account | null }));
const auth = vi.hoisted(() => ({ signedOut: 0, failWith: null as string | null }));
const own = vi.hoisted(() => ({
  member: null as Record<string, unknown> | null,
  invitedBy: null as string | null,
}));
const rsvps = vi.hoisted(() => ({ current: new Map<string, string>() }));
const startTimes = vi.hoisted(() => ({ current: new Map<string, string>() }));
const endTimes = vi.hoisted(() => ({ current: new Map<string, string>() }));
const wroteVisibility = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const wroteMap = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));

/** An ISO start time `days` from now. Negative is in the past. */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const completeDetails: MemberDetails = {
  displayName: 'Dana',
  birthDate: '1990-04-02',
  exactLevel: 'C7',
  injuryType: 'quad',
  conditionName: '',
  completeness: 'Incomplete',
  injuryDate: '2013-01-01',
  injuryDatePrecision: 'year',
  city: 'San Jose',
  state: 'CA',
  zip: '',
  photoPath: 'u1/profile.jpg',
  photoAlt: null,
  showInjuryDate: false,
  showInBrowse: true,
  showOnMap: true,
  declined: [],
};
const details = vi.hoisted(() => ({ current: null as unknown as MemberDetails }));
const survey = vi.hoisted(() => ({
  answers: {},
  declined: new Set<string>(),
}));

const privileges = vi.hoisted(() => ({ representative: false, partner: false, connects: false }));
vi.mock('@/lib/club-partners', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIAmPartner: () => privileges.partner,
  useICanConnect: () => privileges.connects,
  useMyStaffLive: () => undefined,
}));
vi.mock('@/lib/invite-permissions', () => ({
  useInvitePermissions: () => ({
    canInvite:
      own.member?.type === 'mentor' ||
      own.member?.type === 'organization' ||
      Boolean(account.current?.isAdmin) ||
      privileges.representative,
    unlimited:
      own.member?.type === 'organization' ||
      Boolean(account.current?.isAdmin) ||
      privileges.representative,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/lib/members', () => ({
  useOwnMember: () => ({
    member: own.member,
    invitedBy: own.invitedBy,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/events', () => ({
  useViewerEvents: () => ({
    rsvps: rsvps.current,
    whens: new Map(
      [...startTimes.current].map(([id, startTime]) => [
        id,
        { startTime, endTime: endTimes.current.get(id) ?? null, allDay: false },
      ]),
    ),
    loading: false,
    error: null,
    reload: () => undefined,
  }),
}));

// Driven per-test, and `progressOf` is deliberately not stubbed: the page
// should be running the real arithmetic, or this file would be asserting its
// own. A complete profile is produced by declining every question, which is a
// real way to reach 100 and needs no fixture of seventeen answers.
vi.mock('@/routes/profile/profile-api', () => ({
  loadAnswers: () =>
    Promise.resolve({
      ok: true as const,
      answers: survey.answers,
      declined: survey.declined,
    }),
}));

// Partial: `missingDetails` and `listInWords` are pure and the page should be
// running the real ones, or this file would be asserting its own arithmetic.
vi.mock('@/routes/profile/details-api', async (importOriginal) => ({
  ...(await importOriginal<typeof DetailsApi>()),
  loadDetails: () => Promise.resolve({ ok: true as const, details: details.current }),
  setShowInBrowse: (...args: unknown[]) =>
    wroteVisibility.calls.push(args) && Promise.resolve({ ok: true as const }),
  setShowOnMap: (...args: unknown[]) =>
    wroteMap.calls.push(args) &&
    Promise.resolve(wroteMap.fail ? { ok: false, error: 'That was not changed.' } : { ok: true }),
}));

// The Notifications row reads the browser and the club; neither belongs in a
// test of this page. It has its own test, and draws nothing while null.
vi.mock('@/lib/push/notifications', () => ({
  useDeviceNotifications: () => ({
    state: null,
    error: null,
    busy: false,
    turnOn: () => undefined,
    turnOff: () => undefined,
  }),
}));

// Blocked members, on Settings: a read of member_blocks.
vi.mock('@/lib/blocks', () => ({
  useMyBlocks: () => ({
    blocked: [],
    ids: new Set(),
    loading: false,
    error: null,
    reload: () => undefined,
  }),
  unblockMember: vi.fn(),
}));

const chatRooms = vi.hoisted(() => ({
  rooms: [] as { id: string; name: string; openedAt: string | null }[],
}));
vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useChatRooms: () => ({ rooms: chatRooms.rooms, loading: false, error: null }),
}));

vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnseenNotifications: () => ({ count: 0, loaded: true, refresh: () => undefined }),
}));
vi.mock('@/lib/account', () => ({
  useAccount: () => account.current,
  signOut: () => {
    if (auth.failWith) return Promise.resolve({ ok: false, error: auth.failWith });
    auth.signedOut += 1;
    return Promise.resolve({ ok: true });
  },
}));

const { default: MePage } = await import('@/routes/me/page');

function renderMe(entry = '/me') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MePage />
    </MemoryRouter>,
  );
}

function ownMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    displayName: 'Nicole',
    type: 'peer',
    photoPath: null,
    photoAlt: null,
    city: 'Santa Clara',
    state: 'CA',
    levelRange: 'T1–T6',
    exactLevel: 'T4',
    birthDate: '1984-06-21',
    createdAt: '2026-09-01T00:00:00.000Z',
    isAdmin: false,
    wantsToMentor: null,
    ...overrides,
  };
}

beforeEach(() => {
  privileges.representative = false;
  privileges.partner = false;
  privileges.connects = false;
  account.current = { status: 'member', userId: 'u1', isAdmin: false, displayName: 'Nicole' };
  own.member = ownMember();
  own.invitedBy = 'NorCal SCI';
  rsvps.current = new Map();
  startTimes.current = new Map();
  endTimes.current = new Map();
  wroteVisibility.calls = [];
  wroteMap.calls = [];
  wroteMap.fail = false;
  auth.signedOut = 0;
  auth.failWith = null;
  details.current = completeDetails;
  survey.answers = {};
  survey.declined = new Set();
});

describe('MePage', () => {
  it('says which account you are signed in as, so switching is unambiguous', () => {
    renderMe();
    expect(screen.getByRole('heading', { name: 'Nicole' })).toBeInTheDocument();
  });

  it('falls back to a plain header before the member row arrives', () => {
    own.member = null;
    renderMe();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  // Back on Home (the owner, 2026-11-06), with a member row or without.
  it('has no notifications bell', () => {
    renderMe();
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull();
    cleanup();
    own.member = null;
    renderMe();
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull();
  });

  it('says who vouched for you', () => {
    renderMe();
    expect(screen.getByText('Invited by NorCal SCI')).toBeInTheDocument();
  });

  it('leaves out the inviter rather than guessing when it is not known', () => {
    own.invitedBy = null;
    renderMe();
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
  });

  describe('the counters', () => {
    it('count real RSVPs', () => {
      rsvps.current = new Map([
        ['a', 'going'],
        ['b', 'going'],
        ['c', 'interested'],
      ]);
      startTimes.current = new Map([
        ['a', daysFromNow(3)],
        ['b', daysFromNow(10)],
        ['c', daysFromNow(5)],
      ]);
      renderMe();
      expect(screen.getByRole('link', { name: /2\s*Going/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /1\s*Interested/ })).toBeInTheDocument();
    });

    it('count what is coming up, not what has already happened', () => {
      // The counters answer "what have I got on". One that keeps climbing as
      // events go by stops answering it.
      rsvps.current = new Map([
        ['past', 'going'],
        ['soon', 'going'],
        ['gone', 'interested'],
      ]);
      startTimes.current = new Map([
        ['past', daysFromNow(-9)],
        ['soon', daysFromNow(4)],
        ['gone', daysFromNow(-2)],
      ]);
      renderMe();
      expect(screen.getByRole('link', { name: /1\s*Going/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /0\s*Interested/ })).toBeInTheDocument();
    });

    it('counts what you have been to, separately from what is ahead', () => {
      rsvps.current = new Map([
        ['went', 'going'],
        ['soon', 'going'],
        ['considered', 'interested'],
      ]);
      startTimes.current = new Map([
        ['went', daysFromNow(-9)],
        ['soon', daysFromNow(4)],
        ['considered', daysFromNow(-2)],
      ]);
      renderMe();
      expect(screen.getByRole('link', { name: /1\s*Going/ })).toBeInTheDocument();
      // Past "interested" is not a record of anything, so it counts nowhere.
      expect(screen.getByRole('link', { name: /1\s*Been to/ })).toHaveAttribute(
        'href',
        '/events?segment=been-to',
      );
    });

    it('goes by the end time, not the start of today', () => {
      // As the event's public page (the owner, 2026-11-03).
      const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
      rsvps.current = new Map([
        ['endedAnHourAgo', 'going'],
        ['runningSinceYesterday', 'going'],
        ['runningSinceTwoDaysAgo', 'going'],
      ]);
      startTimes.current = new Map([
        ['endedAnHourAgo', hours(-3)],
        ['runningSinceYesterday', hours(-30)],
        ['runningSinceTwoDaysAgo', hours(-54)],
      ]);
      endTimes.current = new Map([
        ['endedAnHourAgo', hours(-1)],
        ['runningSinceYesterday', hours(5)],
        ['runningSinceTwoDaysAgo', hours(5)],
      ]);
      renderMe();
      expect(screen.getByRole('link', { name: /2\s*Going/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /1\s*Been to/ })).toBeInTheDocument();
    });

    it('shows "Been to" even at zero, so the row never appears to lose a counter', () => {
      // It used to hide until there was one. A counter that comes and goes is
      // indistinguishable from one that has broken — reported as missing twice
      // before that was understood.
      rsvps.current = new Map([['soon', 'going']]);
      startTimes.current = new Map([['soon', daysFromNow(4)]]);
      renderMe();
      expect(screen.getByRole('link', { name: /0\s*Been to/ })).toBeInTheDocument();
    });

    it('does not count an RSVP whose event did not come back', () => {
      // A number that guesses is worse than one that waits.
      rsvps.current = new Map([['orphan', 'going']]);
      startTimes.current = new Map();
      wroteVisibility.calls = [];
      renderMe();
      expect(screen.getByRole('link', { name: /0\s*Going/ })).toBeInTheDocument();
    });

    it('shows nothing about conversations or rooms, although both exist', () => {
      // The owner's call, 2026-09-21: Chat is one tap away and its tab already
      // carries an unread dot, so a count of it on Me is a number about a
      // screen the member can see for themselves. See stats.tsx.
      renderMe();
      expect(screen.queryByText(/Conversations/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Rooms/i)).not.toBeInTheDocument();
    });
  });

  // The whole section, not just the button. A peer used to get a heading, a
  // bordered card and an icon spent on telling them about a thing that was
  // never going to happen to them, on the one screen that is about them.
  it('says nothing about invites to somebody who cannot send one', () => {
    renderMe();
    expect(screen.queryByText('Invites')).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot invite/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Invite new members/ })).not.toBeInTheDocument();
  });

  it('tells a mentor they can, and offers the way in', () => {
    own.member = ownMember({ type: 'mentor' });
    renderMe();
    const invites = screen.getByRole('link', { name: /Invite new members/ });
    expect(invites).toHaveAttribute('href', '/invites');
    expect(invites).toHaveAccessibleDescription(/As a mentor you can invite \d+ people by email/);
  });

  it('keeps what can end a membership reachable, without printing it', () => {
    // The card says where you stand; the Terms say what ends a membership
    // (the owner, 2026-10-28). Reachable is still the requirement — see CONTEXT.md.
    renderMe();
    expect(screen.queryByText(/Selling to members/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /what can end a membership/i })).toHaveAttribute(
      'href',
      '/terms#losing-your-membership',
    );
  });

  it('signs out from the tab Me opens on, without looking for it', async () => {
    renderMe();
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    await waitFor(() => {
      expect(auth.signedOut).toBe(1);
    });
  });

  it('surfaces a failure rather than pretending it worked', async () => {
    auth.failWith = 'network is unreachable';
    renderMe();
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(await screen.findByText('network is unreachable')).toBeInTheDocument();
  });

  // A professional (20261029100000) finds their page, and their own codes.
  it('leads an org admin or a partner to Stats & controls and to making a code', () => {
    privileges.partner = true;
    privileges.connects = true;
    renderMe();
    const hub = screen.getByRole('link', { name: 'Stats & controls' });
    expect(hub).toHaveAttribute('href', '/stats');
    expect(hub).toHaveAccessibleDescription(/connecting members/i);
    expect(screen.getByRole('link', { name: 'Create QR code or invite link' })).toHaveAttribute(
      'href',
      '/me/qr',
    );
  });

  it('offers no Stats & controls to anybody else', () => {
    renderMe();
    expect(screen.queryByRole('link', { name: 'Stats & controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create QR code or invite link' })).toBeNull();
  });

  it('marks an administrator, and links to the tools', () => {
    own.member = ownMember({ isAdmin: true });
    account.current = { status: 'member', userId: 'u1', isAdmin: true, displayName: 'admin' };
    renderMe();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('shows no admin link to an ordinary member', () => {
    renderMe();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  // One card for the details and the survey (the owner, 2026-11-09): their
  // average. Since 2026-11-15 it names the next step and opens it, with Edit
  // profile for the whole list.
  it('combines the details and the survey in one card, at their average', async () => {
    survey.answers = { gender: 'Female' }; // 6%
    details.current = { ...completeDetails, photoPath: null, city: null, state: '' }; // 40%
    renderMe();
    expect(await screen.findByText('23%')).toBeInTheDocument();
    expect(screen.getByText('Next: Add a profile photo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Complete your profile' })).toHaveAttribute(
      'href',
      '/profile/details?part=photo&walk=1',
    );
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/profile/answers',
    );
    expect(screen.queryByRole('link', { name: 'Your details' })).toBeNull();
  });
});

describe('the profile card', () => {
  // The owner asked for this: at 100 the ring and the number go, and the card
  // is a statement. A declined answer or detail counts as done.
  it('drops the ring once the profile is complete', async () => {
    survey.declined = new Set(applicableQuestions({}).map((q) => q.key));
    details.current = { ...completeDetails, photoPath: null, declined: ['photo'] };
    render(
      <MemoryRouter>
        <MePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Profile complete')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.queryByText(/Still to add/)).not.toBeInTheDocument();
  });
});

describe('being findable', () => {
  it('says plainly when a member is hidden, which nothing else on the app did', () => {
    // Somebody who hid themselves months ago and wonders why nobody has been in
    // touch had no way to find out that they did: it lived four fields down a
    // form behind a Save.
    // One word now, at the owner's request. The loudness moved to the gold
    // border and the struck-through eye rather than to a sentence.
    details.current = { ...completeDetails, showInBrowse: false };
    renderMe();
    return screen.findByText('Hidden').then((el) => {
      expect(el).toBeInTheDocument();
    });
  });

  it('offers the switch on, so being hidden is reversible from here', async () => {
    details.current = { ...completeDetails, showInBrowse: false };
    renderMe();
    const toggle = await screen.findByRole('switch', { name: /change your visibility/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(wroteVisibility.calls.at(-1)?.[1]).toBe(true);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('writes immediately rather than waiting for a Save that is not here', async () => {
    details.current = { ...completeDetails, showInBrowse: true };
    renderMe();
    const toggle = await screen.findByRole('switch', { name: /change your visibility/i });
    await userEvent.click(toggle);
    expect(wroteVisibility.calls).toHaveLength(1);
    expect(wroteVisibility.calls[0]?.[1]).toBe(false);
  });
});

describe('show me on the map', () => {
  it('is on unless the member turned it off, and says what is shown', async () => {
    renderMe();
    const toggle = await screen.findByRole('switch', { name: 'Show me on the map' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText(/counted at your ZIP code or city on the map — never your address/),
    ).toBeVisible();
  });

  it('writes at once, for this member', async () => {
    renderMe();
    await userEvent.click(await screen.findByRole('switch', { name: 'Show me on the map' }));
    expect(wroteMap.calls).toEqual([['u1', false]]);
    expect(screen.getByRole('switch', { name: 'Show me on the map' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText(/You are not counted on the map/)).toBeVisible();
  });

  it('moves back, and says so, when the write fails', async () => {
    wroteMap.fail = true;
    details.current = { ...completeDetails, showOnMap: false };
    renderMe();
    const toggle = await screen.findByRole('switch', { name: 'Show me on the map' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('That was not changed.');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

describe('unlimited invite card', () => {
  it.each(['admin', 'organization', 'representative'])(
    'shows no ten-invite limit for %s',
    async (role) => {
      if (account.current) account.current.isAdmin = role === 'admin';
      own.member = { ...own.member, type: role === 'organization' ? 'organization' : 'peer' };
      privileges.representative = role === 'representative';
      render(
        <MemoryRouter>
          <MePage />
        </MemoryRouter>,
      );
      expect(await screen.findByText('You can invite people without a limit.')).toBeInTheDocument();
      expect(screen.queryByText(/put 10 numbers/)).toBeNull();
      expect(screen.getByRole('link', { name: /Invite new members/ })).toHaveAttribute(
        'href',
        '/invites',
      );
      if (role === 'organization')
        expect(screen.getByRole('link', { name: 'Manage your organizations' })).toHaveAttribute(
          'href',
          '/organizations/manage',
        );
    },
  );
});

describe('the three tabs', () => {
  it('opens on Profile, with Settings and Account a tap away', () => {
    renderMe();
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Profile');
    expect(screen.queryByRole('heading', { name: 'Display' })).not.toBeInTheDocument();
  });

  it('opens the tab the address names, so the installed app reopens where it was', () => {
    renderMe('/me?tab=settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument();
  });

  it('keeps Blocked members out from under the device-only note', () => {
    renderMe('/me?tab=settings');
    expect(
      screen.getByText(
        'Display, notifications and installing apply to this phone or computer only.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocked members' })).toBeInTheDocument();
    expect(screen.getByText(/These follow your account, wherever you sign in/)).toBeInTheDocument();
  });

  it('in the store app, says nothing of installing or of a computer', () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      renderMe('/me?tab=settings');
      expect(screen.getByText('Display applies to this phone only.')).toBeInTheDocument();
      expect(screen.queryByText(/installing|computer|Home Screen/)).toBeNull();
    } finally {
      native.mockRestore();
    }
  });

  it('moves between tabs with the arrow keys, as tabs do', async () => {
    const user = userEvent.setup();
    renderMe();
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
  });

  it('comes back from Google on Account, where the answer is shown', () => {
    renderMe('/me?google=linked');
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
  });

  // Apple 5.1.1(i) and Google Play: the policies stay reachable after joining.
  it('links the Privacy Policy, the Terms and account deletion from Account', () => {
    renderMe('/me?tab=account');
    const links = within(screen.getByRole('region', { name: 'Privacy and terms' }));
    expect(links.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(links.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(links.getByRole('link', { name: 'Deleting your account' })).toHaveAttribute(
      'href',
      '/delete-account',
    );
  });
});

describe('no longer being asked for an invite by number', () => {
  // The switch went with "Ask somebody" (2026-10-10): nobody can look a
  // member up by their number any more, so there is nothing to switch.
  it('offers a mentor no such switch', () => {
    own.member = ownMember({ type: 'mentor' });
    renderMe();
    expect(screen.queryByRole('checkbox', { name: /have my number/ })).toBeNull();
    expect(screen.queryByText(/ask me for an invite/i)).toBeNull();
  });
});

// The owner, 2026-10-28: feedback goes to the App Feedback room.
describe('sending app feedback', () => {
  it('opens a new topic in the App Feedback room, coming back to Me', async () => {
    chatRooms.rooms = [
      { id: 'general', name: 'General', openedAt: '2026-09-01T00:00:00Z' },
      { id: 'app-feedback-7960', name: 'App Feedback', openedAt: '2026-09-01T00:00:00Z' },
    ];
    renderMe();
    const link = await screen.findByRole('link', { name: /Send app feedback/ });
    expect(link).toHaveAttribute('href', '/chat/rooms/app-feedback-7960/new');
  });

  it('is not offered while there is no open App Feedback room', async () => {
    chatRooms.rooms = [{ id: 'app-feedback-7960', name: 'App Feedback', openedAt: null }];
    renderMe();
    await screen.findByText('Standing');
    expect(screen.queryByRole('link', { name: /Send app feedback/ })).toBeNull();
    chatRooms.rooms = [];
  });
});
