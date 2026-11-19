import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Events from '@/lib/events';
import { capWords, EventCard, type EventCardProps } from '@/routes/events/event-card';
import { makeEvent, makeOrganization, makeTag } from '@/test/factory';

const attendees = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/events', async (importOriginal) => ({
  ...(await importOriginal<typeof Events>()),
  useAttendeesByEvent: (ids: string[]) => {
    attendees.read(ids);
    const row = (memberId: string, displayName: string, status: string) => ({
      memberId,
      displayName,
      status,
      photoPath: null,
      photoAlt: null,
      avatarColor: null,
      city: null,
      levelRange: null,
      exactLevel: null,
      injuryType: null,
      conditionName: null,
      type: 'peer',
    });
    return {
      byEvent: new Map([
        [ids[0], [row('m1', 'Nicole', 'going'), row('m2', 'Kerry', 'interested')]],
      ]),
      loading: false,
      error: null,
      reload: vi.fn(),
    };
  },
}));

beforeEach(() => {
  attendees.read.mockClear();
});

function renderCard(overrides: Partial<EventCardProps> = {}) {
  const props: EventCardProps = {
    event: makeEvent(),
    status: null,
    organization: null,
    onOpen: vi.fn(),
    onRsvp: vi.fn(),
    ...overrides,
  };
  render(<EventCard {...props} />);
  return props;
}

describe('EventCard', () => {
  it('shows the date in the event’s zone, not the machine’s', () => {
    // 03:00 UTC on the 6th is still the evening of the 5th in California.
    renderCard({ event: makeEvent({ startTime: '2026-09-06T03:00:00Z' }) });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('SEP')).toBeInTheDocument();
  });

  // The owner, 2026-11-01.
  it('says RSVP on an event made in the club', () => {
    renderCard({ event: makeEvent({ handAdded: true }), status: null });
    expect(screen.getByRole('button', { name: 'RSVP' })).toBeInTheDocument();
  });

  it('has no RSVP button on an event read from another calendar', () => {
    renderCard({ event: makeEvent({ handAdded: false }), status: null });
    expect(screen.queryByRole('button', { name: 'RSVP' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Interested' })).toBeInTheDocument();
  });

  it('has one on such an event if its organization collects them', () => {
    renderCard({
      event: makeEvent({ handAdded: false }),
      status: null,
      organization: makeOrganization({ collectsRsvps: true }),
    });
    expect(screen.getByRole('button', { name: 'RSVP' })).toBeInTheDocument();
  });

  it('keeps Going ✓ for a member already going, to take it back', () => {
    renderCard({ event: makeEvent({ handAdded: false }), status: 'going' });
    expect(screen.getByRole('button', { name: 'Going ✓' })).toBeInTheDocument();
  });

  // The owner, 2026-10-27: as on the event's page.
  describe('with a sign-up of the host’s own', () => {
    const event = makeEvent({ registrationUrl: 'https://norcalsci.org/register/swim' });

    it('opens registration without recording a club RSVP', async () => {
      const props = renderCard({ event, status: null });
      expect(screen.queryByRole('button', { name: 'RSVP' })).not.toBeInTheDocument();
      const register = screen.getByRole('link', { name: /^Register/ });
      expect(register).toHaveAttribute('href', 'https://norcalsci.org/register/swim');
      expect(register).toHaveAttribute('target', '_blank');
      await userEvent.click(register);
      expect(props.onRsvp).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Going in club' }));
      expect(props.onRsvp).toHaveBeenCalledWith('going');
    });

    it('keeps host registration available after marking Going in the club', async () => {
      const props = renderCard({ event, status: 'going' });
      expect(screen.getByRole('link', { name: /^Register/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Going in club ✓' }));
      expect(props.onRsvp).toHaveBeenCalledWith(null);
    });

    it('ignores a sign-up that is not a web address', () => {
      renderCard({ event: makeEvent({ registrationUrl: 'javascript:alert(1)' }) });
      expect(screen.getByRole('button', { name: 'RSVP' })).toBeInTheDocument();
    });
  });

  describe('the two-button row', () => {
    // The owner, 2026-10-27: what Going shares is said in the sheet that
    // opens once it is pressed (rsvp-sheet.tsx), not under every card.
    it('carries no line about what Going shares', () => {
      renderCard({ status: null });
      expect(screen.queryByText(/share your email/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'RSVP' })).not.toHaveAttribute('aria-describedby');
    });

    it('reports Interested when it was not set', async () => {
      const props = renderCard({ status: null });
      await userEvent.click(screen.getByRole('button', { name: 'Interested' }));
      expect(props.onRsvp).toHaveBeenCalledWith('interested');
    });

    it('takes the RSVP back when the same button is pressed again', async () => {
      // The only way to undo an RSVP from the list, so it has to work.
      const props = renderCard({ status: 'going' });
      await userEvent.click(screen.getByRole('button', { name: 'Going ✓' }));
      expect(props.onRsvp).toHaveBeenCalledWith(null);
    });

    it('switches from interested to going in one tap, not two', async () => {
      const props = renderCard({ status: 'interested' });
      await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
      expect(props.onRsvp).toHaveBeenCalledWith('going');
    });

    it('tells assistive technology which one is set', () => {
      renderCard({ status: 'going' });
      expect(screen.getByRole('button', { name: 'Going ✓' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Interested' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  describe('what it says', () => {
    it('says how many are going, and reads nobody until asked', () => {
      renderCard({ event: makeEvent({ goingCount: 3 }), onOpenMember: vi.fn() });
      expect(screen.getByRole('button', { name: '3 going' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(attendees.read).not.toHaveBeenCalled();
    });

    it('opens who is going from the count, not the event', async () => {
      const onOpenMember = vi.fn();
      const props = renderCard({
        event: makeEvent({ id: 'e1', goingCount: 3 }),
        onOpenMember,
      });
      await userEvent.click(screen.getByRole('button', { name: '3 going' }));
      expect(props.onOpen).not.toHaveBeenCalled();
      expect(attendees.read).toHaveBeenCalledWith(['e1']);
      await userEvent.click(screen.getByRole('button', { name: /Nicole/ }));
      expect(onOpenMember).toHaveBeenCalledWith('m1');
      // Interested is not going; the rest chose not to be shown.
      expect(screen.queryByText('Kerry')).toBeNull();
      expect(screen.getByText(/and 2 more who are not shown by choice/)).toBeInTheDocument();
    });

    it('closes again', async () => {
      renderCard({ event: makeEvent({ goingCount: 1 }), onOpenMember: vi.fn() });
      const count = screen.getByRole('button', { name: '1 going' });
      await userEvent.click(count);
      await userEvent.click(count);
      expect(count).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Nicole')).toBeNull();
    });

    it('opens the host from its name, not the event', async () => {
      const onOpenOrganization = vi.fn();
      const organization = makeOrganization({ id: 'o1', name: 'Bay Area Adaptive' });
      const props = renderCard({ organization, onOpenOrganization });
      await userEvent.click(screen.getByText('Bay Area Adaptive'));
      expect(onOpenOrganization).toHaveBeenCalledWith('o1');
      expect(props.onOpen).not.toHaveBeenCalled();
    });
  });

  describe('who is hosting', () => {
    it('prefers a club organization', () => {
      const organization = makeOrganization();
      renderCard({ organization, event: makeEvent({ hostName: 'Somebody else' }) });
      expect(screen.getByText(/NorCal SCI/)).toBeInTheDocument();
      expect(screen.queryByText(/Somebody else/)).not.toBeInTheDocument();
    });

    it('falls back to the name the feed gave', () => {
      renderCard({ event: makeEvent({ hostName: 'BORP' }) });
      expect(screen.getByText(/BORP/)).toBeInTheDocument();
    });

    it('does not render a lonely separator when there is neither', () => {
      renderCard({ event: makeEvent({ hostName: null, city: null }) });
      expect(screen.queryByText(/^ · /)).not.toBeInTheDocument();
    });
  });

  it('marks a hybrid event as attendable online', () => {
    renderCard({ event: makeEvent({ format: 'hybrid' }) });
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
  });

  it('shows an event’s tags as chips', () => {
    renderCard({ event: makeEvent({ tags: [makeTag('wheelchair-rugby')] }) });
    expect(screen.getByText('wheelchair-rugby')).toBeInTheDocument();
  });

  it('omits the tally entirely when nobody has said anything', () => {
    renderCard({ event: makeEvent({ goingCount: 0, interestedCount: 0 }) });
    expect(screen.queryByText(/interested$/)).not.toBeInTheDocument();
  });

  it('draws no zero in the tally', () => {
    renderCard({ event: makeEvent({ goingCount: 1, interestedCount: 0 }) });
    expect(screen.getByText('1 going')).toBeInTheDocument();
    expect(screen.queryByText(/0 interested/)).not.toBeInTheDocument();
  });

  it('draws both counts when both are there', () => {
    renderCard({ event: makeEvent({ goingCount: 2, interestedCount: 3 }) });
    expect(screen.getByText('2 going · 3 interested')).toBeInTheDocument();
  });

  it('keeps the interested count beside a count that opens', () => {
    renderCard({ event: makeEvent({ goingCount: 2, interestedCount: 3 }), onOpenMember: vi.fn() });
    expect(screen.getByRole('button', { name: '2 going' })).toBeInTheDocument();
    expect(screen.getByText('· 3 interested')).toBeInTheDocument();
  });

  it('opens the event when the body is tapped', async () => {
    const props = renderCard({ event: makeEvent({ title: 'Rugby practice' }) });
    await userEvent.click(screen.getByText('Rugby practice'));
    expect(props.onOpen).toHaveBeenCalled();
  });
});

describe('an event that is over', () => {
  it('offers no Interested or Going, because there is nothing left to decide', () => {
    renderCard({ past: true });
    expect(screen.queryByRole('button', { name: /interested/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^going/i })).not.toBeInTheDocument();
  });

  it('still opens the event, which is where the description is', () => {
    const props = renderCard({ past: true });
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('keeps what a member reads it for: when, what, and whose', () => {
    renderCard({
      past: true,
      event: makeEvent({ title: 'Friday Happy Hour', hostName: 'NorCal SCI' }),
    });
    expect(screen.getByText('Friday Happy Hour')).toBeInTheDocument();
    expect(screen.getByText(/NorCal SCI/)).toBeInTheDocument();
  });

  it('drops what only helps somebody decide whether to go', () => {
    renderCard({
      past: true,
      event: makeEvent({ tags: [makeTag('wheelchair-rugby')] }),
    });
    // Tags and the going counter are all there to answer "should I
    // go"; none of them is a live question afterwards.
    expect(screen.queryByText('wheelchair-rugby')).not.toBeInTheDocument();
    expect(screen.queryByText(/going ·/i)).not.toBeInTheDocument();
  });

  it('still offers both buttons while the event is ahead', () => {
    renderCard({ past: false });
    expect(screen.getByRole('button', { name: /interested/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RSVP' })).toBeInTheDocument();
  });
});

describe('one more date of a series', () => {
  it('carries only what differs between occurrences', () => {
    // The title, host and mark are on the card above, identical every time.
    // Four rows repeating a truncated title spend the line on what the reader
    // already knows.
    renderCard({
      occurrence: true,
      event: makeEvent({
        title: 'The Lionheart Community’s Weekly Wednesdays',
        hostName: 'NorCal SCI',
        startTime: '2026-09-23T22:00:00Z',
      }),
    });
    expect(screen.queryByText(/Weekly Wednesdays/)).not.toBeInTheDocument();
    expect(screen.queryByText('NorCal SCI')).not.toBeInTheDocument();
    expect(screen.getByText(/Wed/)).toBeInTheDocument();
  });

  it('offers no RSVP of its own, and still opens its own page', () => {
    const props = renderCard({ occurrence: true });
    expect(screen.queryByRole('button', { name: /interested/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('writes the weekday as prose, not as the tile’s small caps', () => {
    renderCard({ occurrence: true, event: makeEvent({ startTime: '2026-09-23T22:00:00Z' }) });
    expect(screen.queryByText(/WED ·/)).not.toBeInTheDocument();
  });
});

// The owner, 2026-10-20: a click on a host's logo opens the host.
describe('the host logo', () => {
  it('opens the organization, not the event', async () => {
    const onOpenOrganization = vi.fn();
    const props = renderCard({ organization: makeOrganization(), onOpenOrganization });
    await userEvent.click(screen.getByText('NCS'));
    expect(onOpenOrganization).toHaveBeenCalledWith('org-1');
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('opens the event when there is no organization page to go to', async () => {
    const props = renderCard({ event: makeEvent({ hostName: 'Bay Rollers' }) });
    await userEvent.click(screen.getByText('BR'));
    expect(props.onOpen).toHaveBeenCalled();
  });
});

describe('the words on a card', () => {
  const words = 'Click here!!! https://x.org First lines.';

  it('are the summary when there is one', () => {
    renderCard({ event: makeEvent({ description: words, detailSummary: 'A coffee meetup.' }) });
    expect(screen.getByText('A coffee meetup.')).toBeInTheDocument();
    expect(screen.queryByText(/Click here/)).toBeNull();
  });

  it('are nothing without one, whatever the description says', () => {
    renderCard({ event: makeEvent({ description: words, detailSummary: null }) });
    expect(screen.queryByText(/Click here/)).toBeNull();
  });
});

describe('View on the map on a card', () => {
  it("is a link of its own beside the card's button, never inside it", () => {
    render(
      <MemoryRouter>
        <EventCard
          event={makeEvent({ title: 'Rugby' })}
          status={null}
          organization={null}
          onOpen={vi.fn()}
          onRsvp={vi.fn()}
          mapHref="/events?view=map&show=x"
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'View Rugby on the map' });
    expect(link).toHaveAttribute('href', '/events?view=map&show=x');
    expect(link.closest('button')).toBeNull();
    // Not on a phone, where the map's sheet leaves too little of it.
    expect(link).toHaveClass('hidden', 'lg:inline-flex');
  });

  it('is not drawn without a place to go', () => {
    renderCard();
    expect(screen.queryByRole('link', { name: /on the map/ })).toBeNull();
  });
});

describe('capWords, for an event shared in a message', () => {
  it('keeps short words whole and cuts long ones at a word, with an ellipsis', () => {
    expect(capWords('  Pain   management\nwith Stephen. ', 140)).toBe(
      'Pain management with Stephen.',
    );
    expect(capWords('Join us for an evening of stretching, talk and tea.', 30)).toBe(
      'Join us for an evening of…',
    );
    expect(capWords(null, 30)).toBe('');
  });
});
