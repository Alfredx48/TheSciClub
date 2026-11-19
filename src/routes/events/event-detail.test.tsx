import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChatGroups from '@/lib/chat/groups';
import type * as Threads from '@/lib/chat/threads';
import type * as EventAudience from '@/lib/event-audience';
import type * as EventPhone from '@/lib/event-phone';
import type * as Events from '@/lib/events';
import { makeEvent, makeOrganization, makeTag } from '@/test/factory';
import type { ClubEvent, EventAttendee, Organization, RsvpStatus } from '@/types/domain';

const state = vi.hoisted(() => ({
  events: [] as ClubEvent[],
  rsvps: new Map<string, RsvpStatus>(),
  attendees: new Map<string, EventAttendee[]>(),
  organizations: [] as Organization[],
  loading: false,
  error: null as string | null,
  setRsvp: vi.fn(),
  reload: vi.fn(),
  reloadEvents: vi.fn(),
  reloadAttendees: vi.fn(),
  threads: [] as { id: string; eventId: string | null }[],
  joinEventGroup: vi.fn(),
  /** The number on file for the member: null for none. */
  phone: null as string | null,
}));

// What the RSVP sheet reads; the sheet itself is tested in
// src/components/rsvp-sheet.test.tsx. Here it is whether the page opens it.
vi.mock('@/lib/event-phone', async (importOriginal) => ({
  ...(await importOriginal<typeof EventPhone>()),
  loadOwnPhone: () => Promise.resolve({ ok: true, phone: state.phone }),
}));

vi.mock('@/lib/events', async (importOriginal) => ({
  rsvpSaved: (await importOriginal<typeof Events>()).rsvpSaved,
  useEvents: () => ({
    events: state.events,
    loading: state.loading,
    error: state.error,
    reload: state.reloadEvents,
  }),
  useAttendeesByEvent: () => ({
    byEvent: state.attendees,
    loading: false,
    error: null,
    reload: state.reloadAttendees,
  }),
  useViewerEvents: () => ({
    rsvps: state.rsvps,
    loading: false,
    error: null,
    reload: state.reload,
  }),
  setRsvp: (...args: unknown[]): Promise<{ ok: boolean; error?: string }> =>
    state.setRsvp(...args) as Promise<{ ok: boolean; error?: string }>,
}));

// Who an event is for, for a member outside its audience (20261022180000).
const audience = vi.hoisted(() => ({
  hint: null as null | {
    audience: 'followers' | 'groups' | 'people' | 'organizations';
    organization: { id: string; name: string; shortCode: string; logoPath: null } | null;
  },
  // What event_visibility gives this reader (20261107130000).
  invitees: null as null | { id: string; displayName: string; username: string; photoPath: null }[],
  addedBy: null as null | { id: string; displayName: string; photoPath: null },
  changedBy: [] as { id: string; displayName: string; photoPath: null }[],
}));
vi.mock('@/lib/event-audience', async (importOriginal) => ({
  ...(await importOriginal<typeof EventAudience>()),
  fetchAudienceHint: () => Promise.resolve(audience.hint),
  fetchEventVisibility: () =>
    Promise.resolve({
      ok: true,
      value: {
        audience: 'people',
        mayChange: false,
        organizations: [],
        groups: null,
        invitees: audience.invitees,
        inviteeCount: 3,
        addedBy: audience.addedBy,
        changedBy: audience.changedBy,
      },
    }),
}));
vi.mock('@/routes/reviews/reviews-section', () => ({ ReviewsSection: () => null }));
vi.mock('@/lib/organization-follows', () => ({
  useOrganizationFollows: () => ({
    following: new Set<string>(),
    requested: new Set<string>(),
    toggle: () => undefined,
  }),
}));

vi.mock('@/lib/organizations', () => ({
  useOrganizations: () => ({
    organizations: state.organizations,
    byId: new Map(state.organizations.map((o) => [o.id, o])),
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'signed-in', userId: 'me' }),
}));

// The group-chat card reads the viewer's own conversations to know whether they
// are already in the group — three of the five things it can say depend on it.
// Narrowly mocked: `threads.ts` also exports the pure `threadTitle`, and a
// whole-module stub of it is exactly the shape that lets a test assert its own
// wording.
vi.mock('@/lib/chat/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof Threads>()),
  useMyThreads: () => ({ threads: state.threads, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('@/lib/chat/groups', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatGroups>()),
  joinEventGroup: (...args: unknown[]) => state.joinEventGroup(...args) as unknown,
}));

const { default: EventDetailPage } = await import('@/routes/events/event-detail');

function renderDetail(id = 'rugby') {
  return render(
    <MemoryRouter initialEntries={[`/events/${id}`]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function attendee(name: string, status: RsvpStatus = 'going'): EventAttendee {
  return {
    memberId: name,
    status,
    displayName: name,
    photoPath: null,
    photoAlt: null,
    avatarColor: null,
    city: 'San Jose',
    levelRange: 'T1–T6',
    exactLevel: 'T4',
    injuryType: null,
    conditionName: null,
    type: 'peer',
  };
}

/** An ISO start time `days` ahead of now, for cases that must not read as past. */
function aheadByDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

beforeEach(() => {
  state.events = [
    makeEvent({
      id: 'rugby',
      title: 'Wheelchair rugby',
      description: 'Bring nothing.',
      descriptionHtml: '<p>Bring <strong>nothing</strong>.</p>',
      startTime: '2026-09-06T03:00:00Z',
      location: 'Independence Sports Complex',
      city: 'San Jose',
      tags: [makeTag('wheelchair-rugby', 'sport')],
      goingCount: 2,
      interestedCount: 0,
    }),
  ];
  state.rsvps = new Map();
  state.attendees = new Map();
  state.organizations = [];
  state.loading = false;
  state.error = null;
  state.setRsvp = vi.fn().mockResolvedValue({ ok: true });
  state.reload = vi.fn();
  state.reloadEvents = vi.fn();
  state.reloadAttendees = vi.fn();
  state.threads = [];
  state.joinEventGroup = vi.fn().mockResolvedValue({ ok: true, value: 'th-ev' });
  state.phone = null;
  window.sessionStorage.clear();
});

describe('EventDetailPage', () => {
  it('shows the event in its own timezone', () => {
    renderDetail();
    // 03:00 UTC on the 6th is the evening of the 5th in California.
    expect(screen.getByText('Sat, Sep 5 · 8:00pm')).toBeInTheDocument();
  });

  it('links the place to Google Maps, with the city it lacks', () => {
    renderDetail();
    const link = screen.getByRole('link', { name: /in Google Maps/ });
    expect(link).toHaveTextContent('Independence Sports Complex, San Jose');
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('query')).toBe(
      'Independence Sports Complex, San Jose',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links a place that is only a city, as most imported events are', () => {
    state.events = [makeEvent({ id: 'rugby', location: '', city: 'Oakland', state: 'CA' })];
    renderDetail();
    const link = screen.getByRole('link', { name: /in Google Maps/ });
    expect(link).toHaveTextContent('Oakland');
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('query')).toBe('Oakland, CA');
  });

  it('renders the organization’s own formatting', () => {
    renderDetail();
    expect(screen.getByText('nothing')).toBeInTheDocument();
  });

  it('says plainly that an unknown event is not there, rather than erroring', async () => {
    audience.hint = null;
    renderDetail('does-not-exist');
    expect(await screen.findByText(/not on the calendar/)).toBeInTheDocument();
  });

  // The owner, 2026-10-22: a member outside an event's audience who has its
  // link is told who it is for, and nothing more.
  it('tells a member outside a followers event whose followers it is for', async () => {
    audience.hint = {
      audience: 'followers',
      organization: { id: 'ncs', name: 'NorCal SCI', shortCode: 'NCS', logoPath: null },
    };
    renderDetail('for-followers');
    expect(await screen.findByText("For NorCal SCI's members")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    audience.hint = null;
  });

  it('never names the group of a groups event', async () => {
    audience.hint = { audience: 'groups', organization: null };
    renderDetail('for-a-group');
    expect(await screen.findByText("For a group you're not in")).toBeInTheDocument();
    audience.hint = null;
  });

  // The owner, 2026-11-06: private events say so, and are not for the link.
  // The owner, 2026-11-14: no link to share, only invites.
  it('marks an invite-only event, says nobody else can see it, and offers no link', async () => {
    state.events = [makeEvent({ id: 'dinner', audience: 'people' })];
    renderDetail('dinner');
    // The chip at the top, and who it is for below.
    expect(await screen.findByText('Invite only · 3 people invited')).toBeInTheDocument();
    expect(screen.getByText('Invite only')).toBeInTheDocument();
    expect(screen.getByText(/Private\. Only the people invited can see it/)).toBeInTheDocument();
    expect(screen.queryByText(/Share the link to invite anyone/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  // The owner, 2026-11-07: the count opens who is invited, and who organized it.
  it('opens who is invited from the count, with who organized it', async () => {
    const user = userEvent.setup();
    audience.invitees = [
      { id: 'u1', displayName: 'Bo Diaz', username: 'bo', photoPath: null },
      { id: 'u2', displayName: 'Cy Ng', username: '', photoPath: null },
    ];
    audience.addedBy = { id: 'org1', displayName: 'Ana Ruiz', photoPath: null };
    // The owner changed it after Ana added it.
    audience.changedBy = [{ id: 'me', displayName: 'Alex', photoPath: null }];
    state.events = [makeEvent({ id: 'dinner', audience: 'people' })];
    renderDetail('dinner');
    await user.click(await screen.findByRole('button', { name: '3 people invited' }));
    const sheet = screen.getByRole('dialog', { name: 'Who’s invited' });
    expect(within(sheet).getByRole('link', { name: /Ana Ruiz/ })).toHaveAttribute(
      'href',
      '/peers/org1',
    );
    expect(within(sheet).getByRole('link', { name: /Ana Ruiz.*Added it/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Alex.*Changed it/ })).toHaveAttribute(
      'href',
      '/peers/me',
    );
    expect(within(sheet).getByRole('link', { name: /Bo Diaz/ })).toHaveAttribute(
      'href',
      '/peers/u1',
    );
    expect(within(sheet).getByText('Invited (3)')).toBeInTheDocument();
    expect(sheet).toHaveTextContent('administrators can see it too.');
    expect(within(sheet).getByText('1 more is not shown to you.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Who’s invited' })).toBeNull();
    audience.invitees = null;
    audience.addedBy = null;
    audience.changedBy = [];
  });

  it('tells a member outside an invite-only event only that it is invite only', async () => {
    audience.hint = { audience: 'people', organization: null };
    renderDetail('private-dinner');
    expect(await screen.findByRole('heading', { name: 'Invite only' })).toBeInTheDocument();
    expect(screen.getByText(/Ask whoever shared it to invite you/)).toBeInTheDocument();
    // No way into its chat either.
    expect(screen.queryByRole('button', { name: /group chat/i })).toBeNull();
    audience.hint = null;
  });

  // Every event, whoever in the club it is for (the owner, 2026-10-29).
  it('says who can see it, and gives every event a link to share', () => {
    state.events = [makeEvent({ id: 'picnic', audience: 'groups' })];
    renderDetail('picnic');
    expect(screen.getByText('Members of chosen groups')).toBeInTheDocument();
    expect(screen.getByText(/Share the link to invite anyone/)).toBeInTheDocument();
    expect(screen.getByText('https://thesciclub.com/e/picnic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('says the link is copied, briefly, where it can be seen', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    state.events = [makeEvent({ id: 'picnic' })];
    renderDetail('picnic');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('https://thesciclub.com/e/picnic');
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryByText('Link copied')).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  describe('RSVP', () => {
    // Dated ahead for this block. The fixture's own start time is in the past
    // now, and an event that is over offers no buttons to press — which is the
    // subject of the block below this one.
    beforeEach(() => {
      state.events = [makeEvent({ id: 'rugby', startTime: aheadByDays(21) })];
    });

    // The owner, 2026-10-27: below the details, under a heading of their own.
    it('puts the details under a heading, and the answers after them', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          descriptionHtml: '<p>Bring <strong>nothing</strong>.</p>',
        }),
      ];
      renderDetail();
      const heading = screen.getByRole('heading', { name: 'Details' });
      const going = screen.getByRole('button', { name: 'RSVP' });
      expect(heading.compareDocumentPosition(screen.getByText('nothing'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(screen.getByText('nothing').compareDocumentPosition(going)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(screen.queryByText(/share your email/)).not.toBeInTheDocument();
    });

    // The owner, 2026-10-27: Register stands for Going when the host has a
    // sign-up of its own, and the host's page is the details' last line.
    it('keeps host registration separate from Going in the club', async () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          url: 'https://norcalsci.org/events/rugby',
          registrationUrl: 'https://norcalsci.org/register/rugby',
        }),
      ];
      renderDetail();
      expect(screen.getByRole('link', { name: /More details at norcalsci\.org/ })).toHaveAttribute(
        'href',
        'https://norcalsci.org/events/rugby',
      );
      expect(screen.queryByRole('button', { name: 'RSVP' })).not.toBeInTheDocument();
      const register = screen.getByRole('link', { name: /^Register with / });
      expect(register).toHaveAttribute('href', 'https://norcalsci.org/register/rugby');
      expect(register).toHaveAttribute('target', '_blank');
      await userEvent.click(register);
      expect(state.setRsvp).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Going in club' }));
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', 'going');
    });

    // The owner, 2026-11-04: read from a calendar whose organization does not
    // collect RSVPs, and with no sign-up, it still has Going, for the club.
    it('offers Going on an imported event without a sign-up, and says the host is not told', async () => {
      state.organizations = [makeOrganization({ id: 'pch', name: 'ParaCliffHangers' })];
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          handAdded: false,
          organizationId: 'pch',
        }),
      ];
      renderDetail();
      expect(screen.queryByRole('button', { name: 'RSVP' })).not.toBeInTheDocument();
      const going = screen.getByRole('button', { name: 'Going' });
      expect(going).toHaveAccessibleDescription(/doesn’t send ParaCliffHangers an RSVP/);
      await userEvent.click(going);
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', 'going');
      expect(await screen.findByRole('dialog')).toHaveTextContent(
        /doesn’t send ParaCliffHangers an RSVP, so check with them/,
      );
      expect(screen.queryByText(/share your email/)).not.toBeInTheDocument();
    });

    it('calls it an RSVP where the organization collects them', () => {
      state.organizations = [
        makeOrganization({ id: 'pch', name: 'ParaCliffHangers', collectsRsvps: true }),
      ];
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          handAdded: false,
          organizationId: 'pch',
        }),
      ];
      renderDetail();
      expect(screen.getByRole('button', { name: 'RSVP' })).not.toHaveAccessibleDescription();
      expect(screen.queryByText(/doesn’t send/)).not.toBeInTheDocument();
    });

    it('reads the Going list and tally again when it is taken back', async () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          registrationUrl: 'https://norcalsci.org/register/rugby',
        }),
      ];
      state.rsvps = new Map([['rugby', 'going']]);
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Going in club ✓' }));
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', null);
      await waitFor(() => {
        expect(state.reloadAttendees).toHaveBeenCalled();
      });
      expect(state.reloadEvents).toHaveBeenCalled();
      expect(state.reload).toHaveBeenCalled();
    });

    it('once going, keeps Going ✓ to take it back, and the sign-up as a link', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          registrationUrl: 'https://norcalsci.org/register/rugby',
        }),
      ];
      state.rsvps = new Map([['rugby', 'going']]);
      renderDetail();
      expect(screen.getByRole('button', { name: 'Going in club ✓' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Register with / })).toHaveAttribute(
        'href',
        'https://norcalsci.org/register/rugby',
      );
    });

    it('reminds about the host’s sign-up in the sheet', async () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          registrationUrl: 'https://norcalsci.org/register/rugby',
        }),
      ];
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Interested' }));
      const sheet = await screen.findByRole('dialog');
      expect(sheet).toHaveTextContent('The host has its own sign-up.');
    });

    it('offers Join online beside Going for an online event', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(21),
          format: 'online',
          url: 'https://us02web.zoom.us/j/123',
        }),
      ];
      renderDetail();
      expect(screen.getByRole('link', { name: /Join online/ })).toHaveAttribute(
        'href',
        'https://us02web.zoom.us/j/123',
      );
    });

    it('records going, then says what it shares and offers the calendar', async () => {
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', 'going');
      const sheet = await screen.findByRole('dialog', { name: 'You’re going' });
      expect(sheet).toHaveTextContent('We share your email with the host');
      expect(screen.getByRole('link', { name: /Google Calendar/ })).toBeInTheDocument();
    });

    it('opens the sheet for Interested too, with a nudge to RSVP', async () => {
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Interested' }));
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', 'interested');
      expect(await screen.findByRole('dialog', { name: 'You’re interested' })).toHaveTextContent(
        /Make sure to RSVP/,
      );
      expect(screen.queryByLabelText(/Phone number/)).not.toBeInTheDocument();
    });

    it('changes Going to Interested from the sheet', async () => {
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      await userEvent.click(await screen.findByRole('button', { name: /Change to Interested/ }));
      expect(state.setRsvp).toHaveBeenLastCalledWith('rugby', 'me', 'interested');
      expect(await screen.findByRole('dialog', { name: 'You’re interested' })).toBeInTheDocument();
    });

    it('asks for a number with Going when there is none on file', async () => {
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      expect(await screen.findByLabelText('Phone number (optional)')).toBeInTheDocument();
    });

    it('does not ask when there is a number on file', async () => {
      state.phone = '14085550112';
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      await screen.findByRole('dialog');
      // The read is async: give the page its chance to add the field.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByLabelText(/Phone number/)).not.toBeInTheDocument();
    });

    it('takes it back when pressed again', async () => {
      state.rsvps = new Map([['rugby', 'going']]);
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Going ✓' }));
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', null);
    });

    it('surfaces a failed write', async () => {
      state.setRsvp = vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' });
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      expect(await screen.findByText('permission denied')).toBeInTheDocument();
    });
  });

  describe('the group chat', () => {
    // Upcoming, so the RSVP is still a live question. The fixture's own start
    // time is in the past.
    beforeEach(() => {
      state.events = [makeEvent({ id: 'rugby', startTime: aheadByDays(21) })];
      state.threads = [];
      state.joinEventGroup = vi.fn().mockResolvedValue({ ok: true, value: 'th-ev' });
    });

    it('lets somebody going join it', async () => {
      state.rsvps = new Map([['rugby', 'going']]);
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Open group chat' }));
      expect(state.joinEventGroup).toHaveBeenCalledWith('rugby');
    });

    it('says who is in it, once they are', () => {
      state.rsvps = new Map([['rugby', 'going']]);
      state.threads = [{ id: 'th-ev', eventId: 'rugby' }];
      renderDetail();
      expect(screen.getByRole('button', { name: 'Open group chat' })).toBeInTheDocument();
      expect(screen.getByText(/Everyone going or interested is in this chat/)).toBeInTheDocument();
    });

    // The owner, 2026-10-22: going is not needed to join (20261022210000).
    it('lets somebody who is not going join the chat too', () => {
      renderDetail();
      expect(screen.getByRole('button', { name: 'Open group chat' })).toBeInTheDocument();
      expect(screen.getByText(/Any member can join/)).toBeInTheDocument();
    });

    it('surfaces a refusal instead of navigating', async () => {
      state.rsvps = new Map([['rugby', 'going']]);
      state.joinEventGroup = vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'The group chat is for everybody going.' });
      renderDetail();
      await userEvent.click(screen.getByRole('button', { name: 'Open group chat' }));
      expect(await screen.findByText('The group chat is for everybody going.')).toBeInTheDocument();
    });

    describe('once the event is over', () => {
      beforeEach(() => {
        state.events = [makeEvent({ id: 'rugby', startTime: '2020-03-04T18:00:00Z' })];
      });

      // The owner, 2026-10-22: somebody who missed it may want to ask about it.
      it('still takes new joins', () => {
        renderDetail();
        expect(screen.getByRole('button', { name: 'Open group chat' })).toBeInTheDocument();
      });

      it('still opens for somebody who was in it', () => {
        state.threads = [{ id: 'th-ev', eventId: 'rugby' }];
        renderDetail();
        expect(screen.getByRole('button', { name: 'Open group chat' })).toBeInTheDocument();
      });
    });
  });

  describe('who is going', () => {
    it('lists the members it is allowed to name', () => {
      state.attendees = new Map([['rugby', [attendee('Nicole'), attendee('Jake')]]]);
      renderDetail();
      expect(screen.getByText('Nicole')).toBeInTheDocument();
      expect(screen.getByText('Jake')).toBeInTheDocument();
    });

    it('explains the gap when the tally is higher than the names', () => {
      // The difference is members who opted out of being browsed. Leaving it
      // unexplained makes the count look broken.
      state.attendees = new Map([['rugby', [attendee('Nicole')]]]);
      renderDetail();
      expect(screen.getByText('Going · 2')).toBeInTheDocument();
      expect(screen.getByText(/1 more who is not shown by choice/)).toBeInTheDocument();
    });

    it('handles a roster where nobody can be named', () => {
      state.attendees = new Map();
      renderDetail();
      expect(screen.getByText(/2 members, not shown by choice/)).toBeInTheDocument();
    });

    it('renders no heading at all when nobody has said yes', () => {
      state.events = [makeEvent({ id: 'rugby', goingCount: 0, interestedCount: 0 })];
      renderDetail();
      // An empty "Going" heading reads as a failure to load, not as a zero.
      expect(screen.queryByText(/^Going · /)).not.toBeInTheDocument();
    });
  });

  describe('who is hosting', () => {
    const organization = makeOrganization({ id: 'o1' });

    it('links to a club organization', () => {
      state.organizations = [organization];
      state.events = [makeEvent({ id: 'rugby', organizationId: 'o1' })];
      renderDetail();
      expect(screen.getByRole('button', { name: /NorCal SCI/ })).toBeInTheDocument();
    });

    it('does not link a host the club has no page for', () => {
      state.events = [makeEvent({ id: 'rugby', hostName: 'BORP', organizationId: null })];
      renderDetail();
      expect(screen.getByText('BORP')).toBeInTheDocument();
      // A chevron on a dead end is worse than no chevron.
      expect(screen.queryByRole('button', { name: /BORP/ })).not.toBeInTheDocument();
    });
  });

  describe('links out', () => {
    it('says Register when there is a registration link', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(3),
          registrationUrl: 'https://example.org/signup',
        }),
      ];
      renderDetail();
      expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute(
        'href',
        'https://example.org/signup',
      );
    });

    it('falls back to the event page when there is no registration link', () => {
      state.events = [makeEvent({ id: 'rugby', url: 'https://example.org/event' })];
      renderDetail();
      expect(
        screen.getByRole('link', { name: /More details at example\.org/ }),
      ).toBeInTheDocument();
    });

    it('drops a registration link that is not a web address, and uses the event page', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          registrationUrl: 'javascript:alert(1)',
          url: 'https://example.org/event',
        }),
      ];
      renderDetail();
      expect(screen.queryByRole('link', { name: /Register/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /More details at example\.org/ })).toHaveAttribute(
        'href',
        'https://example.org/event',
      );
    });

    it('offers no link when neither address is a web address', () => {
      state.events = [
        makeEvent({ id: 'rugby', registrationUrl: 'data:text/html,hi', url: 'javascript:void 0' }),
      ];
      renderDetail();
      expect(screen.queryByRole('link', { name: /Register|More details/ })).not.toBeInTheDocument();
    });

    it('opens an outbound link safely', () => {
      state.events = [
        makeEvent({
          id: 'rugby',
          startTime: aheadByDays(3),
          registrationUrl: 'https://example.org/signup',
        }),
      ];
      renderDetail();
      expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute(
        'rel',
        'noopener noreferrer',
      );
    });
  });
});

describe('an event\u2019s link', () => {
  it('is "Join online" for a meeting, with the service in its name', () => {
    state.events = [
      makeEvent({
        id: 'call',
        url: 'https://meet.google.com/abc-defg-hij',
        startTime: aheadByDays(3),
        format: 'online',
      }),
    ];
    renderDetail('call');
    const join = screen.getByRole('link', { name: 'Join online, opens Google Meet' });
    expect(join).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    expect(join).toHaveAttribute('target', '_blank');
    expect(screen.queryByText(/More details at/)).toBeNull();
  });

  it('says "More details at" the site for any other address', () => {
    state.events = [
      makeEvent({ id: 'page', url: 'https://norcalsci.org/happy-hour', startTime: aheadByDays(3) }),
    ];
    renderDetail('page');
    expect(screen.getByRole('link', { name: /More details at norcalsci\.org/ })).toHaveAttribute(
      'href',
      'https://norcalsci.org/happy-hour',
    );
    expect(screen.queryByText('Join online')).toBeNull();
  });

  it('offers Join online from the description, and More details at the site, for an ordinary link', () => {
    state.events = [
      makeEvent({
        id: 'norcal',
        url: 'https://norcalsci.org/happy-hour',
        descriptionHtml:
          '<p>To join this Zoom meeting, <a href="https://us02web.zoom.us/j/86004299187">CLICK HERE</a></p>',
        startTime: aheadByDays(3),
        format: 'online',
      }),
    ];
    renderDetail('norcal');
    expect(screen.getByRole('link', { name: 'Join online, opens Zoom' })).toHaveAttribute(
      'href',
      'https://us02web.zoom.us/j/86004299187',
    );
    expect(screen.getByRole('link', { name: /More details at norcalsci\.org/ })).toHaveAttribute(
      'href',
      'https://norcalsci.org/happy-hour',
    );
  });

  it('offers the registration beside a meeting, and Join online only once', () => {
    state.events = [
      makeEvent({
        id: 'both',
        url: 'https://zoom.us/j/1',
        registrationUrl: 'https://norcalsci.org/register',
        startTime: aheadByDays(3),
      }),
    ];
    renderDetail('both');
    expect(screen.getAllByRole('link', { name: /Join online/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute(
      'href',
      'https://norcalsci.org/register',
    );
  });

  it('does not offer a meeting once the event is over', () => {
    state.events = [makeEvent({ id: 'old', url: 'https://zoom.us/j/1' })];
    renderDetail('old');
    expect(screen.queryByText('Join online')).toBeNull();
  });
});

describe('an event that is over', () => {
  it('offers no RSVP, the way the list stopped offering one', () => {
    // The same finished evening used to answer two different ways depending on
    // whether you met it in the list or on its own page.
    state.events = [makeEvent({ id: 'rugby', startTime: '2026-09-06T03:00:00Z' })];
    renderDetail();
    expect(screen.queryByRole('button', { name: 'RSVP' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Interested/ })).not.toBeInTheDocument();
    expect(screen.getByText(/already happened/i)).toBeInTheDocument();
  });

  // As its public page says "This event is over" (the owner, 2026-11-03).
  it('offers no RSVP once it ended, even earlier today', () => {
    const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
    state.events = [makeEvent({ id: 'rugby', startTime: hours(-2), endTime: hours(-1) })];
    renderDetail();
    expect(screen.queryByRole('button', { name: /^Interested/ })).not.toBeInTheDocument();
    expect(screen.getByText(/already happened/i)).toBeInTheDocument();
  });

  it('still offers RSVP while it is running', () => {
    const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
    state.events = [makeEvent({ id: 'rugby', startTime: hours(-30), endTime: hours(2) })];
    renderDetail();
    expect(screen.queryByText(/already happened/i)).not.toBeInTheDocument();
  });

  it('still says what you had said about it', () => {
    state.events = [makeEvent({ id: 'rugby', startTime: '2026-09-06T03:00:00Z' })];
    state.rsvps = new Map([['rugby', 'going']]);
    renderDetail();
    expect(screen.getByText(/you said you were going/i)).toBeInTheDocument();
  });
});

describe('the place on the event page', () => {
  it('has no button to the club map: the place itself opens a map', async () => {
    state.events = [makeEvent({ id: 'rugby', title: 'Rugby', startTime: aheadByDays(3) })];
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Rugby' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /on the map/ })).toBeNull();
  });
});
