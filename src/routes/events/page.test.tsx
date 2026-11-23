import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountContext } from '@/lib/account-context';
import type * as Events from '@/lib/events';
import type * as Grants from '@/lib/grants';
import type { MapData } from '@/lib/map-data';
import type { NearHome } from '@/lib/near-home';
import type { ClubMapProps } from '@/routes/map/club-map';
import { makeEvent, makeOrganization, makeTag } from '@/test/factory';
import type { ClubEvent, Organization, RsvpStatus } from '@/types/domain';

const state = vi.hoisted(() => ({
  events: [] as ClubEvent[],
  rsvps: new Map<string, RsvpStatus>(),
  organizations: [] as Organization[],
  loading: false,
  error: null as string | null,
  setRsvp: vi.fn(),
  reload: vi.fn(),
  reloadEvents: vi.fn(),
  near: { status: 'any', ids: null as ReadonlySet<string> | null },
  whens: new Map<string, { startTime: string; endTime: string | null; allDay: boolean }>(),
  queries: [] as unknown[],
}));

vi.mock('@/lib/near-home', () => ({
  useNearHome: (miles: number | null): NearHome =>
    miles === null ? { status: 'any', ids: null } : (state.near as NearHome),
}));
vi.mock('@/lib/home-state', () => ({
  useHome: () => ({ city: 'San Jose', state: 'CA' }),
  useHomeState: () => 'CA',
}));

vi.mock('@/lib/events', async (importOriginal) => ({
  rsvpSaved: (await importOriginal<typeof Events>()).rsvpSaved,
  useEvents: (query: unknown) => {
    state.queries.push(query);
    return {
      events: state.events,
      loading: state.loading,
      error: state.error,
      reload: state.reloadEvents,
    };
  },
  useViewerEvents: () => ({
    rsvps: state.rsvps,
    whens: state.whens,
    loading: false,
    error: null,
    reload: state.reload,
  }),
  setRsvp: (...args: unknown[]): Promise<{ ok: boolean; error?: string }> =>
    state.setRsvp(...args) as Promise<{ ok: boolean; error?: string }>,
}));

// The directory's grant chips read every grant; none here.
vi.mock('@/lib/grants', async (importOriginal) => ({
  ...(await importOriginal<typeof Grants>()),
  useGrantsByOrganization: () => new Map(),
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

// The map: its data, and a stand-in for the MapLibre screen.
const map = vi.hoisted(
  (): {
    reads: number;
    retry: () => void;
    status: MapData['status'];
    props: ClubMapProps | null;
  } => ({ reads: 0, retry: () => undefined, status: 'ready', props: null }),
);
vi.mock('@/lib/map', () => ({ loadMapCanvas: () => Promise.resolve({ default: () => null }) }));
vi.mock('@/lib/map-data', () => ({
  useMapData: (active = true): MapData => {
    if (active) map.reads++;
    return {
      status: map.status,
      retry: map.retry,
      events: [],
      peerCities: [],
      organizations: [],
      home: null,
      contents: { events: [], peerCities: [], organizations: [], home: null },
    };
  },
}));
vi.mock('@/routes/map/club-map', () => ({
  default: (props: ClubMapProps) => {
    map.props = props;
    return (
      <div data-testid="club-map">
        <p>On the map: {(props.events ?? []).map((event) => event.id).join(', ')}</p>
        <p>Organizations on the map: {(props.organizations ?? []).map((o) => o.name).join(', ')}</p>
        <button type="button" onClick={props.onUnsupported}>
          No WebGL2
        </button>
        <p>Showing: {props.show ? `${props.show.id} ${props.show.event?.title ?? '?'}` : 'none'}</p>
        <button type="button" onClick={props.onShown}>
          Shown
        </button>
      </div>
    );
  },
}));

const { default: EventsPage } = await import('@/routes/events/page');

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

function renderPage(entry = '/events') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <EventsPage />
      <Address />
    </MemoryRouter>,
  );
}

/** "Your RSVP" lives in Filters since 2026-10-10: choose one, then close. */
async function chooseRsvp(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^Filters/ }));
  await user.click(screen.getByRole('button', { name: label }));
  await user.click(screen.getByRole('button', { name: /^Show \d+/ }));
}

/** Far enough out to sit outside "this week" but inside "this month" is fragile
 *  near a month boundary, so tests that care about windows set `when` instead. */
function soon(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

beforeEach(() => {
  state.events = [
    makeEvent({
      id: 'rugby',
      title: 'Wheelchair rugby',
      startTime: soon(1),
      tags: [makeTag('wheelchair-rugby', 'sport')],
    }),
    makeEvent({
      id: 'coffee',
      title: 'Newly injured coffee',
      startTime: soon(2),
      tags: [makeTag('peer-support', 'support')],
    }),
    makeEvent({ id: 'zoom', title: 'Driving Q&A', startTime: soon(3), format: 'online', tags: [] }),
  ];
  state.rsvps = new Map();
  state.organizations = [];
  state.loading = false;
  state.error = null;
  state.setRsvp = vi.fn().mockResolvedValue({ ok: true });
  state.reload = vi.fn();
  state.reloadEvents = vi.fn();
  state.near = { status: 'any', ids: null };
  state.whens = new Map();
  state.queries = [];
  map.reads = 0;
  map.retry = vi.fn();
  map.status = 'ready';
  map.props = null;
});

describe('EventsPage', () => {
  // Over by its end time (the owner, 2026-11-03), so not bounded by today.
  it('reads Been to by its ids alone, so an event over earlier today is in it', () => {
    const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
    state.rsvps = new Map([
      ['ended', 'going'],
      ['running', 'going'],
    ]);
    state.whens = new Map([
      ['ended', { startTime: hours(-3), endTime: hours(-1), allDay: false }],
      ['running', { startTime: hours(-30), endTime: hours(5), allDay: false }],
    ]);
    renderPage('/events?segment=been-to');
    expect(state.queries).toContainEqual({ ids: ['ended'] });
  });

  it('lists what is on the calendar', () => {
    renderPage();
    expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
    expect(screen.getByText('Driving Q&A')).toBeInTheDocument();
  });

  // Display is on Me only (the owner, 2026-10-22).
  it('has no Display button in its header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Display settings' })).toBeNull();
  });

  // The owner, 2026-10-31: within 50 miles unless widened in Filters.
  describe('distance from home', () => {
    // events_within_miles answers an online event by its host's city.
    it('lists what is within 50 miles, online events included, until widened to any distance', async () => {
      state.near = { status: 'ready', ids: new Set(['rugby', 'zoom']) };
      const user = userEvent.setup();
      renderPage();
      expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
      expect(screen.getByText('Driving Q&A')).toBeInTheDocument();
      expect(screen.queryByText('Newly injured coffee')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Filters' }));
      const slider = screen.getByLabelText('Within 50 miles of San Jose');
      fireEvent.change(slider, { target: { value: '205' } });
      expect(screen.getByLabelText('Any distance')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Show 3/ }));
      expect(screen.getByText('Newly injured coffee')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument();
    });

    it('leaves distance out of the map and its Filters', async () => {
      state.near = { status: 'ready', ids: new Set(['rugby', 'zoom']) };
      const user = userEvent.setup();
      renderPage('/events?view=map');
      await screen.findByTestId('club-map');
      const near = screen.getByText(/^On the map:/).textContent;
      expect(near.split(', ')).toHaveLength(3);
      await user.click(screen.getByRole('button', { name: /^Filters/ }));
      expect(screen.queryByLabelText(/^Within 50 miles/)).toBeNull();
    });

    it('shows every distance while home is not on the map', () => {
      state.near = { status: 'unplaced', ids: null };
      renderPage();
      expect(screen.getByText('Newly injured coffee')).toBeInTheDocument();
    });
  });

  describe('segments', () => {
    it('has two pills, Events and Organizations', () => {
      renderPage();
      expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Organizations' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      for (const gone of ['Upcoming', 'Adaptive sport', 'Online', "I'm going", 'Been to']) {
        expect(screen.queryByRole('button', { name: gone })).toBeNull();
      }
    });

    it('opens the whole calendar from an old Adaptive sport or Online link', () => {
      renderPage('/events?segment=sport');
      expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
      expect(screen.getByText('Newly injured coffee')).toBeInTheDocument();
    });

    it('"I\'m going" shows only what the member said yes to', async () => {
      state.rsvps = new Map([['coffee', 'going']]);
      renderPage();
      await chooseRsvp("I'm going");
      expect(screen.getByText('Newly injured coffee')).toBeInTheDocument();
      expect(screen.queryByText('Wheelchair rugby')).not.toBeInTheDocument();
      // Said, with the way back to everything.
      expect(screen.getByText(/Showing:/)).toHaveTextContent("Showing: I'm going");
      await userEvent.click(screen.getByRole('button', { name: 'Show all events' }));
      expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
    });

    it('swaps the body for the directory under Organizations', async () => {
      state.organizations = [makeOrganization({ id: 'o1' })];
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Organizations' }));
      expect(screen.getByText('NorCal SCI')).toBeInTheDocument();
      // Not a narrowed list — no events at all.
      expect(screen.queryByText('Wheelchair rugby')).not.toBeInTheDocument();
    });

    it('keeps the filter button under Organizations, for the directory’s own filters', async () => {
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Organizations' }));
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      expect(screen.getByRole('dialog', { name: 'Filter organizations' })).toBeInTheDocument();
    });

    it('filters the events as each letter is typed, and says the search is for them', async () => {
      renderPage();
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search events' }), 'rugby');
      expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
      expect(screen.queryByText('Newly injured coffee')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
      expect(screen.getByText('Newly injured coffee')).toBeInTheDocument();
    });

    it('searches organizations under Organizations, and does not count it as a filter', async () => {
      renderPage('/events?segment=orgs');
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search organizations' }), 'x');
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    });

    // The owner, 2026-11-22: + on Events opened the organization form.
    it('offers + for what is showing: events to who can add them, organizations to every member', () => {
      const asMember = (path: string, isAdmin: boolean) =>
        render(
          <AccountContext.Provider
            value={{ status: 'member', userId: 'me', isAdmin, displayName: 'Bo' }}
          >
            <MemoryRouter initialEntries={[path]}>
              <EventsPage />
            </MemoryRouter>
          </AccountContext.Provider>,
        );
      const { unmount } = asMember('/events', false);
      expect(screen.queryByRole('link', { name: /^Add an/ })).toBeNull();
      unmount();
      const orgs = asMember('/events?segment=orgs', false);
      expect(screen.getByRole('link', { name: 'Add an organization' })).toHaveAttribute(
        'href',
        '/events/new?add=organization',
      );
      orgs.unmount();
      asMember('/events', true);
      expect(screen.getByRole('link', { name: 'Add an event' })).toHaveAttribute(
        'href',
        '/events/new',
      );
    });

    it('leaves + off the map', async () => {
      render(
        <AccountContext.Provider
          value={{ status: 'member', userId: 'me', isAdmin: false, displayName: 'Bo' }}
        >
          <MemoryRouter initialEntries={['/events?view=map']}>
            <EventsPage />
          </MemoryRouter>
        </AccountContext.Provider>,
      );
      await screen.findByTestId('club-map');
      expect(screen.queryByRole('link', { name: /^Add an/ })).toBeNull();
    });
  });

  describe('empty states say which emptiness it is', () => {
    it('tells somebody with no RSVPs that they have not said yes yet', () => {
      renderPage('/events?segment=going');
      expect(screen.getByText(/have not said you are going/)).toBeInTheDocument();
      // Telling them to widen filters they never set is how an app teaches
      // people to distrust it.
      expect(screen.queryByText(/fewer filters/)).not.toBeInTheDocument();
    });

    it('tells somebody with a narrow filter to widen it', () => {
      state.events = [];
      renderPage();
      expect(screen.getByText(/fewer filters/)).toBeInTheDocument();
    });
  });

  describe('RSVP', () => {
    /** The first card's Going button. Throws rather than asserting non-null, so
     *  a missing button fails as itself instead of as a null dereference. */
    function firstGoingButton(): HTMLElement {
      const [button] = screen.getAllByRole('button', { name: 'RSVP' });
      if (!button) throw new Error('no Going button rendered');
      return button;
    }

    it('writes the member’s own id, never the event’s', async () => {
      renderPage();
      await userEvent.click(firstGoingButton());
      expect(state.setRsvp).toHaveBeenCalledWith('rugby', 'me', 'going');
    });

    it('re-reads after a write rather than patching the tally locally', async () => {
      renderPage();
      await userEvent.click(firstGoingButton());
      await waitFor(() => {
        expect(state.reload).toHaveBeenCalled();
        expect(state.reloadEvents).toHaveBeenCalled();
      });
    });

    it('surfaces a failed write instead of silently doing nothing', async () => {
      state.setRsvp = vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' });
      renderPage();
      await userEvent.click(firstGoingButton());
      expect(await screen.findByText('permission denied')).toBeInTheDocument();
    });
  });

  describe('the filter sheet', () => {
    it('only offers tags that are on the events in view', async () => {
      state.rsvps = new Map([['rugby', 'going']]);
      renderPage('/events?segment=going');
      await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
      // peer-support is on an event the segment already removed, so offering it
      // would be offering a way to empty the screen.
      expect(screen.queryByRole('button', { name: 'peer-support' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'wheelchair-rugby' })).toBeInTheDocument();
    });

    it('has no City group: Distance does that', async () => {
      state.events = [
        makeEvent({ id: 'a', startTime: soon(1), city: 'San Jose' }),
        makeEvent({ id: 'b', startTime: soon(2), city: 'Santa Cruz' }),
      ];
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      expect(screen.queryByRole('button', { name: 'San Jose' })).toBeNull();
      expect(screen.queryByText('City')).toBeNull();
    });

    it('narrows to a kind of host with Host org type', async () => {
      state.organizations = [
        makeOrganization({ id: 'gym', name: 'Gym One', category: 'gym' }),
        makeOrganization({ id: 'peers', name: 'Peer Circle', category: 'peer' }),
      ];
      state.events = [
        makeEvent({ id: 'a', title: 'Lift day', startTime: soon(1), organizationId: 'gym' }),
        makeEvent({ id: 'b', title: 'Coffee chat', startTime: soon(2), organizationId: 'peers' }),
      ];
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await userEvent.click(screen.getByRole('button', { name: 'Recovery gyms' }));
      await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
      expect(screen.getByText('Lift day')).toBeInTheDocument();
      expect(screen.queryByText('Coffee chat')).toBeNull();
    });

    it('lists Hosted by to pick from past five hosts', async () => {
      const ids = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      state.organizations = ids.map((id) => makeOrganization({ id, name: `Host ${id}` }));
      state.events = ids.map((id, i) =>
        makeEvent({
          id: `e${id}`,
          title: `Event ${id}`,
          startTime: soon(i + 1),
          organizationId: id,
        }),
      );
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      expect(screen.queryByRole('button', { name: 'Host h1' })).toBeNull();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Hosted by' }), 'h3');
      await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
      expect(screen.getByText('Event h3')).toBeInTheDocument();
      expect(screen.queryByText('Event h1')).toBeNull();
    });

    it('narrows the list when a tag is picked', async () => {
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await userEvent.click(screen.getByRole('button', { name: 'wheelchair-rugby' }));
      await userEvent.click(screen.getByRole('button', { name: /^Show \d/ }));
      expect(screen.getByText('Wheelchair rugby')).toBeInTheDocument();
      expect(screen.queryByText('Newly injured coffee')).not.toBeInTheDocument();
    });

    it('marks the filter button when something is on', async () => {
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await userEvent.click(screen.getByRole('button', { name: 'wheelchair-rugby' }));
      await userEvent.click(screen.getByRole('button', { name: /^Show \d/ }));
      expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument();
    });
  });

  it('shows the database’s own sentence when the load fails', () => {
    state.error = 'relation "events" does not exist';
    renderPage();
    expect(screen.getByText('relation "events" does not exist')).toBeInTheDocument();
  });
});

describe('what the member is going to', () => {
  it('comes first, then everything else in date order', () => {
    state.rsvps = new Map([['zoom', 'going']]);
    renderPage();
    const order = ["You're going", 'Driving Q&A', 'Everything else', 'Wheelchair rugby'];
    const nodes = order.map((text) => screen.getByText(text));
    nodes.slice(1).forEach((node, i) => {
      expect(
        (nodes[i]?.compareDocumentPosition(node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // The owner, 2026-11-18: "I am not seeing events I am going to by
  // default". The calendar's 30 days and 50 miles hid them; a search found them.
  it('has every coming date the member is going to, however far off or away', () => {
    state.events.push(
      makeEvent({ id: 'pain', title: 'Pain management', startTime: soon(45), tags: [] }),
    );
    state.near = { status: 'ready', ids: new Set(['rugby', 'coffee', 'zoom']) };
    state.rsvps = new Map([['pain', 'going']]);
    renderPage();
    expect(state.queries).toContainEqual({ ids: ['pain'] });
    const going = screen.getByText("You're going");
    const pain = screen.getByText('Pain management');
    expect(going.compareDocumentPosition(pain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds no headings when there is nothing to go to', () => {
    renderPage();
    expect(screen.queryByText("You're going")).toBeNull();
    expect(screen.queryByText('Everything else')).toBeNull();
  });
});

describe('a repeating event is one row until you open it', () => {
  const weekly = () => [
    makeEvent({ id: 'w1', title: 'Weekly Wednesdays', startTime: soon(1), seriesId: 'wed' }),
    makeEvent({ id: 'w2', title: 'Weekly Wednesdays', startTime: soon(8), seriesId: 'wed' }),
    makeEvent({ id: 'w3', title: 'Weekly Wednesdays', startTime: soon(15), seriesId: 'wed' }),
    makeEvent({ id: 'solo', title: 'Handcycle ride', startTime: soon(2) }),
  ];

  it('shows the next occurrence and says how many more there are', () => {
    state.events = weekly();
    renderPage();
    expect(screen.getAllByText('Weekly Wednesdays')).toHaveLength(1);
    expect(screen.getByText(/2 more dates/)).toBeInTheDocument();
  });

  it('counts only what the current filters would show', () => {
    // The whole point of counting from the filtered list: "2 more dates" has to
    // mean two rows that opening it actually produces.
    state.events = weekly();
    renderPage();
    expect(screen.queryByText(/more dates through/)).toBeInTheDocument();
    expect(screen.queryByText(/3 more dates/)).not.toBeInTheDocument();
  });

  it('opens the other dates in place', async () => {
    state.events = weekly();
    renderPage();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('leaves a one-off alone', () => {
    state.events = weekly();
    renderPage();
    expect(screen.getByText('Handcycle ride')).toBeInTheDocument();
  });

  it('does not collapse the dates a member chose for themselves', async () => {
    // "I'm going" is a list of particular dates. Collapsing the three Fridays
    // somebody said yes to would hide the answer they came for.
    state.events = weekly();
    state.rsvps = new Map([
      ['w1', 'going'],
      ['w2', 'going'],
    ]);
    renderPage();
    await chooseRsvp("I'm going");
    expect(screen.getAllByText('Weekly Wednesdays')).toHaveLength(2);
    expect(screen.queryByText(/more dates/)).not.toBeInTheDocument();
  });
});

describe('Your RSVP, in Filters', () => {
  it('counts towards the dot, and Clear goes back to every event', async () => {
    const user = userEvent.setup();
    renderPage('/events?segment=interested');
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    // The window does not apply to an RSVP list, so it is not offered.
    expect(screen.queryByRole('group', { name: 'When' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Clear/ }));
    expect(screen.getByRole('button', { name: 'All events' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('List or Map', () => {
  const address = () => screen.getByTestId('address').textContent;

  it("never opens its map, kept and hidden, for the Peers tab's own ?view=map", () => {
    renderPage('/peers?view=map');
    expect(map.reads).toBe(0);
    expect(screen.queryByTestId('club-map')).toBeNull();
  });

  it('reads nothing of the map until Map is chosen', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(map.reads).toBe(0);
    expect(screen.queryByTestId('club-map')).toBeNull();
  });

  it('opens the map in the address, beside the segment, in place of the list', async () => {
    renderPage('/events?segment=interested');
    const empty = screen.getByText(/Nothing marked interested yet/);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(address()).toBe('?segment=interested&view=map');
    expect(await screen.findByTestId('club-map')).toBeVisible();
    expect(empty).not.toBeVisible();
    expect(map.props?.focus).toBe('events');
  });

  it('gives the map the filtered list, so the two agree', async () => {
    renderPage('/events?view=map');
    expect(await screen.findByText('On the map: rugby, coffee, zoom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'peer-support' }));
    expect(screen.getByText('On the map: coffee')).toBeInTheDocument();
  });

  it('opens the same filter sheet from the map, without Online, which is never on it', async () => {
    state.events = state.events.map((event) =>
      event.id === 'coffee' ? { ...event, format: 'hybrid' } : event,
    );
    renderPage('/events?view=map');
    await screen.findByTestId('club-map');
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.getByRole('dialog', { name: 'Filter events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In-person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hybrid' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Online' })).toBeNull();
  });

  it('puts In-person, Online and Hybrid first in the sheet, always all three', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const sheet = screen.getByRole('dialog', { name: 'Filter events' });
    const chips = within(sheet).getAllByRole('button', { pressed: false });
    expect(chips.slice(0, 3).map((chip) => chip.textContent)).toEqual([
      'In-person',
      'Online',
      'Hybrid',
    ]);
  });

  it('keeps the map mounted, hidden, once it has been opened', async () => {
    renderPage('/events?view=map');
    const opened = await screen.findByTestId('club-map');
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(address()).toBe('');
    expect(screen.getByTestId('club-map')).toBe(opened);
    expect(opened).not.toBeVisible();
    expect(screen.getByText('Wheelchair rugby')).toBeVisible();
  });

  it('keeps the map when a segment pill changes', async () => {
    renderPage('/events?view=map');
    await userEvent.click(screen.getByRole('button', { name: 'Organizations' }));
    expect(address()).toBe('?segment=orgs&view=map');
    expect(map.props?.focus).toBe('organizations');
  });

  it('shows the list with a note where the map cannot be drawn', async () => {
    renderPage('/events?view=map');
    await userEvent.click(await screen.findByRole('button', { name: 'No WebGL2' }));
    expect(screen.getByText(/can’t draw the map, so here is the list/)).toBeVisible();
    expect(screen.getByText('Wheelchair rugby')).toBeVisible();
    expect(screen.getByTestId('club-map')).not.toBeVisible();
  });

  it('shows the list when the map will not load, with a way to try again', async () => {
    map.status = 'error';
    renderPage('/events?view=map');
    expect(await screen.findByText(/The map didn’t load/)).toBeVisible();
    expect(screen.getByText('Wheelchair rugby')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try the map again' }));
    expect(map.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/The map didn’t load/)).toBeNull();
  });

  it('says the map holds upcoming events only when the list is of past ones', async () => {
    renderPage('/events?view=map');
    expect(map.props?.eventsNote).toBeUndefined();
    await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Past events' }));
    expect(map.props?.eventsNote).toMatch(/upcoming events only/);
  });

  it("draws the directory's organizations as its filters leave them, from the right sheet", async () => {
    state.organizations = [
      makeOrganization({ id: 'ncs', name: 'NorCal SCI', city: 'Sacramento' }),
      makeOrganization({ id: 'borp', name: 'BORP', city: 'Berkeley' }),
    ];
    renderPage('/events?segment=orgs&view=map');
    expect(
      await screen.findByText('Organizations on the map: BORP, NorCal SCI'),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search organizations' }),
      'berkeley',
    );
    expect(screen.getByText('Organizations on the map: BORP')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filter organizations' });
    // Distance is the list's: the map shows every place.
    expect(within(sheet).queryByText('Distance')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
    // The list on the same segment agrees.
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('berkeley');
  });

  it('offers View on the map only on an event the map can hold', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'View Wheelchair rugby on the map' })).toHaveAttribute(
      'href',
      '/events?view=map&show=rugby',
    );
    expect(screen.queryByRole('link', { name: 'View Driving Q&A on the map' })).toBeNull();
  });

  it('opens the map on the event, and forgets it once shown so back and refresh stay put', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'View Wheelchair rugby on the map' }));
    expect(address()).toBe('?view=map&show=rugby');
    expect(await screen.findByText('Showing: rugby Wheelchair rugby')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Shown' }));
    expect(address()).toBe('?view=map');
    expect(screen.getByText('Showing: none')).toBeInTheDocument();
  });
});
