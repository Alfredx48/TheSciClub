import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapData } from '@/lib/map-data';
import type { MembersState } from '@/lib/members';
import type { ClubMapProps } from '@/routes/map/club-map';
import { makeMember } from '@/test/factory';

const state = vi.hoisted(() => ({ current: null as MembersState | null }));
vi.mock('@/lib/members', () => ({
  useBrowseMembers: () => state.current,
}));

const map = vi.hoisted(() => ({ props: null as ClubMapProps | null }));
vi.mock('@/lib/map', () => ({ loadMapCanvas: () => Promise.resolve({ default: () => null }) }));
const mapContents = vi.hoisted(() => {
  const current: MapData['contents'] = {
    events: [],
    peerCities: [],
    organizations: [],
    home: null,
  };
  return { current };
});
vi.mock('@/lib/map-data', () => ({
  useMapData: (): MapData => ({
    status: 'ready',
    retry: () => undefined,
    ...mapContents.current,
    contents: mapContents.current,
  }),
}));
vi.mock('@/routes/map/club-map', () => ({
  default: (props: ClubMapProps) => {
    map.props = props;
    return (
      <div data-testid="club-map">
        <p>Counted: {(props.members ?? []).map((member) => member.displayName).join(', ')}</p>
        <button type="button" onClick={props.filters?.onOpen}>
          {props.filters?.label}
        </button>
        <button type="button" onClick={props.onUnsupported}>
          No WebGL2
        </button>
      </div>
    );
  },
}));

const { default: PeersPage } = await import('@/routes/peers/page');

function Address() {
  return <output data-testid="address">{useLocation().search}</output>;
}

/** Cards navigate to a profile, so the page needs a router around it. */
function renderPage(entry = '/peers') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PeersPage />
      <Address />
    </MemoryRouter>,
  );
}

const deck = [
  makeMember({
    id: '1',
    displayName: 'Nicole',
    type: 'peer',
    city: 'Santa Clara',
    region: 'Cervical',
  }),
  makeMember({
    id: '2',
    displayName: 'Todd',
    type: 'mentor',
    city: 'Roseville',
    region: 'Thoracic',
  }),
  makeMember({
    id: '3',
    displayName: 'Kerry',
    type: 'mentor',
    city: 'San Jose',
    region: 'Thoracic',
  }),
];

beforeEach(() => {
  state.current = { members: deck, loading: false, error: null, signedOut: false };
  map.props = null;
  mapContents.current = { events: [], peerCities: [], organizations: [], home: null };
});

describe('PeersPage', () => {
  it('lists every member on the Everyone segment', async () => {
    renderPage();
    expect(await screen.findByText('Nicole')).toBeInTheDocument();
    expect(screen.getByText('Todd')).toBeInTheDocument();
    expect(screen.getByText('Kerry')).toBeInTheDocument();
  });

  // A friend 30 minutes away was left out by a starting distance (the owner, 2026-11-10).
  it('starts at any distance, so somebody far from home is listed', async () => {
    const sanJose = { latitude: 37.34, longitude: -121.89 };
    const nearby = Array.from({ length: 20 }, (_, i) => `n${i}`);
    mapContents.current = {
      events: [],
      organizations: [],
      home: { ...sanJose, city: 'San Jose', state: 'CA' } as never,
      peerCities: [
        { ...sanJose, city: 'San Jose', state: 'CA', memberIds: ['1', '3', ...nearby] },
        { latitude: 38.75, longitude: -121.29, city: 'Roseville', state: 'CA', memberIds: ['2'] },
      ] as never,
    };
    renderPage();
    expect(await screen.findByText('Todd')).toBeInTheDocument();
  });

  // Display is on Me only (the owner, 2026-10-22).
  it('has no Display button in its header', async () => {
    renderPage();
    expect(await screen.findByText('Nicole')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Display settings' })).toBeNull();
  });

  it('narrows to mentors when that segment is chosen', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Mentors' }));
    expect(screen.queryByText('Nicole')).not.toBeInTheDocument();
    expect(screen.getByText('Todd')).toBeInTheDocument();
  });

  it('says how many of how many are showing', async () => {
    renderPage();
    expect(await screen.findByText('3 of 3 members')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mentors' }));
    expect(screen.getByText('2 of 2 members')).toBeInTheDocument();
  });

  it('narrows the deck as somebody types', async () => {
    renderPage();
    await userEvent.type(screen.getByRole('searchbox'), 'Todd');
    expect(screen.getByText('Todd')).toBeInTheDocument();
    expect(screen.queryByText('Nicole')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 members')).toBeInTheDocument();
  });

  // Names only, from the first letter: the deck has to move on the first
  // keystroke, and place, level and topics are the filter sheet's job.
  it('narrows the deck by name as you type', async () => {
    state.current = {
      members: [
        makeMember({ id: '1', displayName: 'Nicole', topics: ['SmartDrive'] }),
        makeMember({ id: '2', displayName: 'Todd' }),
      ],
      loading: false,
      error: null,
      signedOut: false,
    };
    renderPage();
    await userEvent.type(screen.getByRole('searchbox'), 'n');
    expect(screen.getByText('Nicole')).toBeInTheDocument();
    expect(screen.queryByText('Todd')).not.toBeInTheDocument();
  });

  it('searches within the segment rather than across it', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Mentors' }));
    await userEvent.type(screen.getByRole('searchbox'), 'Nicole');
    expect(screen.queryByText('Nicole')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 2 members')).toBeInTheDocument();
  });

  it('clears the search from the box', async () => {
    renderPage();
    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'Todd');
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(box).toHaveValue('');
    expect(screen.getByText('Nicole')).toBeInTheDocument();
  });

  // Sending somebody into the filter sheet to loosen filters they never set is
  // the wrong advice when it is three words in the search box holding the deck
  // shut.
  it('names the search, not the filters, when the search is what emptied the deck', async () => {
    renderPage();
    await userEvent.type(screen.getByRole('searchbox'), 'nobody at all');
    expect(screen.getByText(/clear the search/i)).toBeInTheDocument();
    expect(screen.queryByText(/widening the filters/i)).not.toBeInTheDocument();
  });

  it('tells a signed-out visitor the club is members only, not "permission denied"', () => {
    state.current = { members: [], loading: false, error: null, signedOut: true };
    renderPage();
    expect(screen.getByText(/members only/i)).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
  });

  it('still surfaces a genuine database error, which is a different thing', () => {
    state.current = {
      members: [],
      loading: false,
      error: 'permission denied for view browse_members',
      signedOut: false,
    };
    renderPage();
    expect(screen.getByText('permission denied for view browse_members')).toBeInTheDocument();
  });

  it('shows a loading state rather than an empty deck', () => {
    state.current = { members: [], loading: true, error: null, signedOut: false };
    renderPage();
    expect(screen.getByText(/Loading members/)).toBeInTheDocument();
  });

  it('surfaces the database’s own error sentence instead of swallowing it', () => {
    state.current = {
      members: [],
      loading: false,
      error: 'permission denied for view',
      signedOut: false,
    };
    renderPage();
    expect(screen.getByText('permission denied for view')).toBeInTheDocument();
  });

  it('tells somebody the deck is empty because of their filters, not because the club is', async () => {
    state.current = { members: [], loading: false, error: null, signedOut: false };
    renderPage();
    await waitFor(() => expect(screen.getByText(/Nobody matches that yet/)).toBeInTheDocument());
  });

  it('marks the active segment for assistive technology', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Peers' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Mentors' }));
    expect(screen.getByRole('button', { name: 'Mentors' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Peers' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the filter sheet', () => {
  const open = async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    return screen.getByRole('dialog', { name: 'Filter peers' });
  };

  it('opens, and closes on Escape', async () => {
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filter peers' })).not.toBeInTheDocument();
  });

  it('gives the backdrop an accessible name instead of being a dead div', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Close filters' })).toBeInTheDocument();
  });

  it('offers only options that exist in the club, so no chip can match nobody', async () => {
    const sheet = await open();
    // The deck has Cervical and Thoracic members but nobody lumbar.
    expect(within(sheet).getByRole('button', { name: 'Cervical' })).toBeInTheDocument();
    expect(
      within(sheet).queryByRole('button', { name: 'Lumbar & sacral' }),
    ).not.toBeInTheDocument();
  });

  it('narrows the deck when a chip is chosen', async () => {
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cervical' }));
    await userEvent.click(within(sheet).getByRole('button', { name: /^Show/ }));
    expect(screen.getByText('Nicole')).toBeInTheDocument();
    expect(screen.queryByText('Todd')).not.toBeInTheDocument();
  });

  it('counts matches live, before the sheet is even closed', async () => {
    const sheet = await open();
    expect(within(sheet).getByRole('button', { name: 'Show 3' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cervical' }));
    expect(within(sheet).getByRole('button', { name: 'Show 1' })).toBeInTheDocument();
  });

  it('clears back to everybody', async () => {
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cervical' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear (1)' }));
    expect(within(sheet).getByRole('button', { name: 'Show 3' })).toBeInTheDocument();
  });

  it('disables Clear when there is nothing to clear', async () => {
    const sheet = await open();
    expect(within(sheet).getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('marks chosen chips for assistive technology', async () => {
    const sheet = await open();
    const chip = within(sheet).getByRole('button', { name: 'Cervical' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(within(sheet).getByRole('button', { name: 'Cervical' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('layout', () => {
  it('renders every visible member as its own card, whatever the column count', async () => {
    renderPage();
    // The grid is CSS; what matters behaviourally is that nothing is dropped
    // or duplicated when the deck reflows into columns.
    expect(await screen.findByText('Nicole')).toBeInTheDocument();
    expect(screen.getByText('Todd')).toBeInTheDocument();
    expect(screen.getByText('Kerry')).toBeInTheDocument();
    expect(screen.getAllByText('Nicole')).toHaveLength(1);
  });
});

describe('the map of peers', () => {
  it('opens from the switch, in the address, in place of the deck', async () => {
    renderPage();
    const card = await screen.findByText('Nicole');
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByTestId('address').textContent).toBe('?view=map');
    expect(await screen.findByTestId('club-map')).toBeVisible();
    expect(card).not.toBeVisible();
    expect(map.props?.focus).toBe('peers');
  });

  it("counts the deck's members, so a segment and the filters narrow it too", async () => {
    state.current = {
      members: [
        makeMember({ id: '1', displayName: 'Nicole', type: 'peer', age: 34 }),
        makeMember({ id: '2', displayName: 'Todd', type: 'mentor', age: 52 }),
        makeMember({ id: '3', displayName: 'Kerry', type: 'mentor', age: 38 }),
      ],
      loading: false,
      error: null,
      signedOut: false,
    };
    renderPage('/peers?view=map');
    expect(await screen.findByText('Counted: Nicole, Todd, Kerry')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mentors' }));
    expect(screen.getByText('Counted: Todd, Kerry')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const sheet = screen.getByRole('dialog', { name: 'Filter peers' });
    // Distance is the list's: the map shows everybody on it.
    expect(within(sheet).queryByText('Distance')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: '30 to 39' }));
    expect(screen.getByText('Counted: Kerry')).toBeInTheDocument();
  });

  it('shows the deck with a note where the map cannot be drawn', async () => {
    renderPage('/peers?view=map');
    await userEvent.click(await screen.findByRole('button', { name: 'No WebGL2' }));
    expect(screen.getByText(/can’t draw the map, so here is the list/)).toBeVisible();
    expect(screen.getByText('Nicole')).toBeVisible();
  });
});

describe('the age filter in the deck', () => {
  it('narrows the list too', async () => {
    state.current = {
      members: [
        makeMember({ id: '1', displayName: 'Nicole', age: 24 }),
        makeMember({ id: '2', displayName: 'Todd', age: 61 }),
      ],
      loading: false,
      error: null,
      signedOut: false,
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(screen.getByRole('button', { name: '60 to 69' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
    expect(screen.queryByText('Nicole')).toBeNull();
    expect(screen.getByText('Todd')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument();
  });
});
