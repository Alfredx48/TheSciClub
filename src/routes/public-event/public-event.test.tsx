import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EventAudience from '@/lib/event-audience';
import type { NextStep, PublicEvent, Registration } from '@/lib/event-audience';
import type * as EventInviteLib from '@/lib/event-invite';
import type { EventInvite } from '@/lib/event-invite';

/**
 * The public event page and its registration form (20261022180000,
 * 20261022190000). The database is stubbed: what is tested is what the
 * page shows, and what it never shows.
 */

const api = vi.hoisted(() => ({
  event: null as PublicEvent | null,
  registered: [] as Registration[],
  kept: [] as Registration[],
  refuse: null as string | null,
  status: 'signed-out',
  next: null as NextStep | null,
  requests: [] as unknown[],
  invite: null as EventInvite | null,
  accepted: [] as unknown[],
}));
vi.mock('@/lib/event-audience', async (importOriginal) => ({
  ...(await importOriginal<typeof EventAudience>()),
  fetchPublicEvent: () => Promise.resolve({ ok: true, value: api.event }),
  fetchEventIdByShortLink: (link: string) => Promise.resolve({ ok: true, value: link }),
  registerForEvent: (registration: Registration) => {
    api.registered.push(registration);
    return Promise.resolve(
      api.refuse ? { ok: false, error: api.refuse } : { ok: true, value: null },
    );
  },
  keepPendingRegistration: (registration: Registration) => {
    api.kept.push(registration);
  },
  registrationNextStep: () =>
    Promise.resolve(api.next ? { ok: true, value: api.next } : { ok: false, error: 'no' }),
}));
vi.mock('@/lib/event-invite', async (importOriginal) => ({
  ...(await importOriginal<typeof EventInviteLib>()),
  fetchEventInvite: (token: string) =>
    Promise.resolve({ ok: true, value: token === 'tok' ? api.invite : null }),
  fetchInviteAnswer: () => Promise.resolve(null),
  answerEventInvite: (...args: unknown[]) => {
    api.accepted.push(args);
    return Promise.resolve({ ok: true });
  },
}));
vi.mock('@/lib/invite-requests', () => ({
  requestClubInvite: (request: unknown) => {
    api.requests.push(request);
    return Promise.resolve({ ok: true, value: null });
  },
}));
vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: api.status, userId: null, isAdmin: false, displayName: null }),
}));
vi.mock('@/lib/photos', () => ({ PHOTOS_BUCKET: 'photos', usePhotoUrl: () => null }));

const { default: PublicEventPage } = await import('@/routes/public-event/page');
const { default: RegisterForEventPage } = await import('@/routes/public-event/register');

const EVENT: PublicEvent = {
  id: 'picnic',
  takesRsvps: true,
  title: 'Friday Happy Hour',
  description: 'Join us on the patio. **Everyone is welcome.**',
  descriptionHtml: '',
  startTime: '2099-10-30T01:30:00Z',
  endTime: '2099-10-30T03:00:00Z',
  allDay: false,
  timezone: 'America/Los_Angeles',
  location: 'Lakeside Park',
  city: 'Oakland',
  state: 'CA',
  format: 'in_person',
  url: null,
  registrationUrl: null,
  photoPath: null,
  photoAlt: null,
  organization: { id: 'ncs', name: 'NorCal SCI', shortCode: 'NCS', logoPath: null },
};

function JoinStandIn() {
  const door = (useLocation().state as { door?: string } | null)?.door;
  return <h1>{door ? `Door: ${door}` : 'Welcome'}</h1>;
}

function JoinStandInWithSearch() {
  const search = useLocation().search;
  return search.startsWith('?invite=') ? <h1>{`Onboarding ${search}`}</h1> : <JoinStandIn />;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/e/:id" element={<PublicEventPage />} />
        <Route path="/e/:id/register" element={<RegisterForEventPage />} />
        <Route path="/join" element={<JoinStandInWithSearch />} />
        <Route path="/events/:id" element={<h1>The members' page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.event = EVENT;
  api.registered = [];
  api.kept = [];
  api.next = null;
  api.requests = [];
  api.refuse = null;
  api.status = 'signed-out';
  api.invite = null;
  api.accepted = [];
});

describe('the public event page', () => {
  it('shows the event and its host, and nothing about who is going', async () => {
    renderAt('/e/picnic');
    expect(await screen.findByRole('heading', { name: 'Friday Happy Hour' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /in Google Maps/ })).toHaveTextContent(
      'Lakeside Park, Oakland',
    );
    expect(screen.getByText('NorCal SCI')).toBeInTheDocument();
    expect(screen.getByText('Everyone is welcome.')).toBeInTheDocument();
    // No counts and no attendees.
    expect(screen.queryByText(/\d+ (going|interested)/i)).toBeNull();
    expect(screen.queryByText(/going/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'RSVP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interested/i })).toBeNull();
  });

  // The owner, 2026-11-05: only RSVP on the public page, also where the host takes no RSVPs here.
  it('offers only RSVP, also for an event whose host takes no RSVPs here', async () => {
    api.event = { ...EVENT, takesRsvps: false };
    renderAt('/e/picnic');
    expect(await screen.findByRole('button', { name: 'RSVP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interested/i })).toBeNull();
  });

  // The owner, 2026-10-24: a stronger ask to join, set apart.
  it('asks the reader to join the club, to see who is coming and the chat', async () => {
    renderAt('/e/picnic');
    const ask = await screen.findByRole('region', { name: 'Join the club' });
    expect(ask).toHaveTextContent("Join the club to see who's coming and join the group chat.");
    expect(within(ask).getByRole('link', { name: 'Join the club' })).toHaveAttribute(
      'href',
      '/join?next=%2Fevents%2Fpicnic',
    );
    expect(within(ask).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns to an unavailable event after signing in from its main action', async () => {
    api.event = null;
    renderAt('/e/picnic?invite=expired');
    expect(await screen.findByRole('link', { name: 'Sign in to the club' })).toHaveAttribute(
      'href',
      '/join?next=%2Fevents%2Fpicnic',
    );
  });

  // The owner, 2026-11-14: an invite email opens the event, private or not, and
  // its Going, Maybe or Can't go is the answer, saved once as the page opens.
  it('shows a private event only to a live invite, and saves the answer pressed in the email', async () => {
    api.event = null; // Private: public_event shows it to nobody.
    api.invite = {
      event: { ...EVENT, id: 'dinner', title: 'Board dinner' },
      guest: { email: 'ana@example.com', name: 'Ana Ruiz', phone: '' },
      inviterName: 'Maya',
      accepted: false,
    };
    const first = renderAt('/e/dinner?invite=tok&rsvp=going');
    expect(await screen.findByRole('heading', { name: 'Board dinner' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Your invite' });
    expect(await within(card).findByText('You’re going. Saved.')).toBeInTheDocument();
    expect(api.accepted).toEqual([['tok', 'going', undefined]]);
    expect(within(card).getByRole('button', { name: 'Going' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'RSVP' })).toBeNull();
    expect(within(card).getByRole('link', { name: 'Join the club' })).toHaveAttribute(
      'href',
      '/join?invite=tok',
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Can’t go' }));
    expect(await within(card).findByText('You can’t go. Saved.')).toBeInTheDocument();
    expect(api.accepted).toEqual([
      ['tok', 'going', undefined],
      ['tok', 'no', undefined],
    ]);
    expect(within(card).queryByRole('link', { name: 'Join the club' })).toBeNull();
    first.unmount();

    // Any other token shows nothing of it.
    renderAt('/e/dinner?invite=guessed');
    expect(
      await screen.findByRole('heading', { name: 'This event is not on the calendar' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Board dinner' })).toBeNull();
  });

  it('says "Join online" for a meeting link, to anybody with the page', async () => {
    api.event = { ...EVENT, format: 'online', url: 'https://us02web.zoom.us/j/123' };
    renderAt('/e/picnic');
    const join = await screen.findByRole('link', {
      name: 'Join online, opens Zoom',
    });
    expect(join).toHaveAttribute('href', 'https://us02web.zoom.us/j/123');
    expect(screen.queryByText('Details on their site')).toBeNull();
  });

  it('offers Join online from the description beside Details on their site', async () => {
    api.event = {
      ...EVENT,
      format: 'online',
      url: 'https://norcalsci.org/happy-hour',
      descriptionHtml:
        '<p>To join this Zoom meeting, <a href="https://us02web.zoom.us/j/86004299187">CLICK HERE</a></p>',
    };
    renderAt('/e/picnic');
    expect(await screen.findByRole('link', { name: 'Join online, opens Zoom' })).toHaveAttribute(
      'href',
      'https://us02web.zoom.us/j/86004299187',
    );
    expect(screen.getByRole('link', { name: 'Details on their site' })).toHaveAttribute(
      'href',
      'https://norcalsci.org/happy-hour',
    );
  });

  it('keeps "Details on their site" for any other link', async () => {
    api.event = { ...EVENT, url: 'https://norcalsci.org/happy-hour' };
    renderAt('/e/picnic');
    expect(await screen.findByRole('link', { name: 'Details on their site' })).toHaveAttribute(
      'href',
      'https://norcalsci.org/happy-hour',
    );
    expect(screen.queryByText('Join online')).toBeNull();
  });

  it('opens the form from RSVP, with no choice to make', async () => {
    renderAt('/e/picnic');
    await userEvent.click(await screen.findByRole('button', { name: 'RSVP' }));
    expect(
      await screen.findByRole('heading', { name: 'Get added to our list' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  // The owner, 2026-10-24: the form is the club's list, not the host's own
  // sign-up (many hosts are not in the club), and says so, pointing to theirs.
  it('says the form is not the host’s own sign-up, and links theirs', async () => {
    api.event = { ...EVENT, registrationUrl: 'https://norcalsci.org/rsvp' };
    renderAt('/e/picnic/register');
    expect(await screen.findByText(/adds you to The SCI Club's list/)).toHaveTextContent(
      "This adds you to The SCI Club's list for this event. It doesn't register you with NorCal SCI: you may need to do that too, with their sign-up.",
    );
    expect(screen.getByRole('link', { name: 'their sign-up' })).toHaveAttribute(
      'href',
      'https://norcalsci.org/rsvp',
    );
  });

  // The owner, 2026-11-02: where the club is the only RSVP, nothing to send them elsewhere for.
  it('says nothing about the host’s sign-up when the club takes the RSVPs and there is none', async () => {
    api.event = { ...EVENT, takesRsvps: true, registrationUrl: null };
    renderAt('/e/picnic/register');
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.queryByText(/adds you to The SCI Club's list/)).toBeNull();
  });

  it('still says so when the host’s events take no RSVPs here', async () => {
    api.event = { ...EVENT, takesRsvps: false, registrationUrl: null };
    renderAt('/e/picnic/register');
    expect(await screen.findByText(/adds you to The SCI Club's list/)).toHaveTextContent(
      'so check the event details.',
    );
  });

  it('underlines the links in the description', async () => {
    api.event = { ...EVENT, description: 'Details at [our site](https://norcalsci.org).' };
    renderAt('/e/picnic');
    const link = await screen.findByRole('link', { name: 'our site' });
    expect(link.closest('[class*="[&_a]:underline"]')).not.toBeNull();
  });

  it('says so for an event that is not on the calendar', async () => {
    api.event = null;
    renderAt('/e/gone');
    expect(await screen.findByText('This event is not on the calendar')).toBeInTheDocument();
  });

  it('sends a member to the members’ page', async () => {
    api.status = 'member';
    renderAt('/e/picnic');
    expect(await screen.findByRole('heading', { name: "The members' page" })).toBeInTheDocument();
  });
});

describe('registering', () => {
  async function fill() {
    await userEvent.type(await screen.findByLabelText('Your name'), 'Maria Lopez');
    await userEvent.type(screen.getByLabelText('Email'), 'maria@example.com');
    await userEvent.type(screen.getByLabelText('Phone (optional)'), '4085550112');
  }

  it('needs a name and an email before it can be sent', async () => {
    renderAt('/e/picnic/register');
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your name'), 'Maria');
    await userEvent.type(screen.getByLabelText('Email'), 'not an email');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  // The owner, 2026-11-05: Going only, even from an old ?status=interested link or a no-RSVP event.
  it('registers as going, with no Interested choice', async () => {
    api.event = { ...EVENT, takesRsvps: false };
    renderAt('/e/picnic/register?status=interested');
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText('Interested')).toBeNull();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(api.registered[0]).toMatchObject({ eventId: 'picnic', status: 'going' });
  });

  it('keeps the registration, then opens the welcome page', async () => {
    renderAt('/e/picnic/register?status=going');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(api.registered[0]).toMatchObject({
      eventId: 'picnic',
      status: 'going',
      name: 'Maria Lopez',
      email: 'maria@example.com',
      phone: '(408) 555-0112',
    });
    expect(api.kept[0]).toMatchObject({
      eventId: 'picnic',
      email: 'maria@example.com',
      organizer: 'NorCal SCI',
    });
  });

  // The owner, 2026-11-02: what comes next depends on the address.
  it('asks a member to sign in', async () => {
    api.next = 'member';
    renderAt('/e/picnic/register?status=going');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Sign in to join the group chat.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Door: signin' })).toBeInTheDocument();
  });

  it('asks somebody invited to create the account, and says why', async () => {
    api.next = 'invited';
    renderAt('/e/picnic/register?status=going');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('See who else is coming')).toBeInTheDocument();
    expect(screen.getByText('Join the chat for this event')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(await screen.findByRole('heading', { name: 'Door: join' })).toBeInTheDocument();
  });

  it('sends an invite request in one tap with what they typed', async () => {
    api.next = 'request';
    renderAt('/e/picnic/register?status=going');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Request an invite' }));
    expect(api.requests).toEqual([
      { name: 'Maria Lopez', email: 'maria@example.com', note: 'Registered for Friday Happy Hour' },
    ]);
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
  });

  it('stays on the form and says why when it is refused', async () => {
    api.refuse = 'Too many registrations just now. Try again in a minute.';
    renderAt('/e/picnic/register');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many registrations/);
    expect(api.kept).toHaveLength(0);
  });

  it('tells them who sees what they type', async () => {
    renderAt('/e/picnic/register');
    expect(
      await screen.findByText(/organizer and the club's administrators see these/),
    ).toBeInTheDocument();
  });
});
