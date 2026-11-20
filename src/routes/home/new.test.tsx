import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Router from 'react-router-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChatRooms from '@/lib/chat/rooms';
import type { ChatRoom } from '@/lib/chat/types';
import { makeRoom } from '@/test/factory';

/**
 * Asking or sharing from Home: write first, the room optional.
 *
 * `roomsByCategory` is left real, since the order of the rooms is what the
 * select promises. The room read and the topic write are the network and are
 * stubbed; the write records what it was sent.
 */

const db = vi.hoisted(() => ({
  rooms: [] as ChatRoom[],
  roomsError: null as string | null,
  navigated: [] as [string, unknown][],
  created: [] as unknown[][],
  createFails: null as string | null,
}));

// Looking up similar questions is the network; stubbed, with what it finds.
const similar = vi.hoisted(() => ({
  found: [] as { id: string; roomId: string; title: string; replyCount: number }[],
}));
vi.mock('@/lib/chat/similar', () => ({ useSimilarTopics: () => similar.found }));
vi.mock('@/lib/chat/topics', () => ({
  createTopic: (...args: unknown[]) => {
    db.created.push(args);
    return Promise.resolve(
      db.createFails ? { ok: false, error: db.createFails } : { ok: true, value: 'new-topic' },
    );
  },
}));

vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRooms>()),
  useChatRooms: () => ({
    rooms: db.rooms,
    loading: false,
    error: db.roomsError,
    reload: () => undefined,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => (to: string, options?: { state?: unknown }) => {
    db.navigated.push([to, options?.state]);
  },
}));

const { default: HomeNewPage } = await import('@/routes/home/new');

const rooms = () => [
  makeRoom({ id: 'general', name: 'General', category: 'General', sortOrder: 0 }),
  makeRoom({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit', sortOrder: 11 }),
  makeRoom({ id: 'bowel', name: 'Bowel management', category: 'Body', sortOrder: 1 }),
  makeRoom({ id: 'newsci', name: 'Newly injured', category: 'Life', sortOrder: 6 }),
  // Closed: an administrator reads it, and nobody can ask in it.
  makeRoom({ id: 'skin', name: 'Skin & pressure sores', category: 'Body', openedAt: null }),
];

beforeEach(() => {
  db.rooms = rooms();
  db.roomsError = null;
  db.navigated = [];
  db.created = [];
  db.createFails = null;
});

function renderPage(search = '', state: unknown = { from: 'home', segment: 'topics' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/home/new', search, state }]}>
      <Routes>
        <Route path="/home/new" element={<HomeNewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const roomSelect = () => screen.getByRole('combobox', { name: /Room/ });

describe('the kind', () => {
  it('asks by default, opening on the question box', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Ask the club' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveFocus();
  });

  it('opens on sharing from the URL', () => {
    renderPage('?kind=share');
    expect(screen.getByRole('heading', { name: 'Share a photograph' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your question' })).toBeNull();
  });

  it('goes back to the pill on Home it came from', () => {
    renderPage('', { from: 'home', segment: 'photos' });
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home?segment=photos',
    );
  });
});

describe('the room', () => {
  it('is General unless another is chosen', () => {
    renderPage();
    expect(roomSelect()).toHaveValue('general');
  });

  it('offers the open rooms only, under their headings in order', () => {
    renderPage();
    const groups = within(roomSelect()).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['General', 'Body', 'Life', 'Kit']);
    expect(
      within(roomSelect()).queryByRole('option', { name: 'Skin & pressure sores' }),
    ).toBeNull();
  });

  it('falls back to the first open room where there is no General', () => {
    db.rooms = rooms().filter((room) => room.id !== 'general');
    renderPage();
    expect(roomSelect()).toHaveValue('bowel');
  });

  it('always offers to start a room', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Start a room' })).toHaveAttribute(
      'href',
      '/chat/rooms/new',
    );
  });
});

describe('asking', () => {
  it('waits for a question and says so', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Post your question' })).toBeDisabled();
    expect(screen.getByText('Write your question.')).toBeInTheDocument();
  });

  it('posts to General as a question, with the question as the first post when there is no detail', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Best cushion?');
    expect(screen.getByRole('checkbox', { name: 'Question' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Post your question' }));
    await waitFor(() => {
      expect(db.created).toEqual([['general', 'Best cushion?', 'Best cushion?', [], true, false]]);
    });
    expect(db.navigated).toEqual([
      ['/chat/rooms/general/topics/new-topic', { from: 'home', segment: 'topics' }],
    ]);
  });

  it('sends the detail, the chosen room, and "not a question" when unticked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'My new chair');
    await user.click(screen.getByRole('checkbox', { name: 'Question' }));
    await user.type(screen.getByRole('textbox', { name: /More detail/ }), 'It arrived today.');
    await user.selectOptions(roomSelect(), 'equip');
    await user.click(screen.getByRole('button', { name: 'Post your question' }));
    await waitFor(() => {
      expect(db.created).toEqual([
        ['equip', 'My new chair', 'It arrived today.', [], false, false],
      ]);
    });
  });

  it('keeps what was written when the post is refused', async () => {
    const user = userEvent.setup();
    db.createFails = 'You cannot post in this room.';
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Anyone?');
    await user.click(screen.getByRole('button', { name: 'Post your question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot post in this room.');
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Anyone?');
    expect(db.navigated).toEqual([]);
  });
});

describe('sharing', () => {
  it('goes on to the photo picker in the chosen room, with the kind and the way back', async () => {
    const user = userEvent.setup();
    renderPage('?kind=share', { from: 'home', segment: 'photos' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(db.navigated).toEqual([
      ['/chat/rooms/general/new', { from: 'home', segment: 'photos', kind: 'share' }],
    ]);
  });
});

describe('when no room is open', () => {
  it('says so and links to starting one, with no form', () => {
    db.rooms = [makeRoom({ id: 'skin', openedAt: null })];
    renderPage();
    expect(screen.getByText(/No rooms are open yet/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your question' })).toBeNull();
  });
});

describe('when the rooms cannot be read', () => {
  it('says why, and still offers to start a room', () => {
    db.roomsError = 'Could not load the rooms.';
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the rooms.');
    expect(screen.getByRole('link', { name: 'Start a room' })).toBeInTheDocument();
  });
});
