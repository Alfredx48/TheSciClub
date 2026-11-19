import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Notifications from '@/lib/notifications';
import type { AppNotification } from '@/lib/notifications';

/**
 * The list. The four calls to the database are stubbed and record what they
 * were asked; the sentences are the real ones.
 */
const db = vi.hoisted(() => ({
  pages: [] as AppNotification[][],
  asked: [] as (string | null)[],
  seen: 0,
  read: [] as (string | undefined)[],
  failure: null as string | null,
  waiting: [] as Notifications.WaitingNotification[],
}));

vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof Notifications>()),
  loadNotifications: (before: string | null = null) => {
    db.asked.push(before);
    if (db.failure) return Promise.resolve({ ok: false, error: db.failure });
    return Promise.resolve({ ok: true, notifications: db.pages.shift() ?? [] });
  },
  loadWaitingNotifications: () => Promise.resolve({ ok: true, notifications: db.waiting }),
  markNotificationsSeen: () => {
    db.seen += 1;
    return Promise.resolve();
  },
  markNotificationsRead: (id?: string) => {
    db.read.push(id);
    return Promise.resolve({ ok: true });
  },
}));
vi.mock('@/components/member-avatar', () => ({ MemberAvatar: () => null }));

const { default: NotificationsPage } = await import('@/routes/notifications/page');

const item = (o: Partial<AppNotification> & { id: string }): AppNotification => ({
  kind: 'reply',
  count: 1,
  createdAt: '2026-10-09T10:00:00Z',
  seen: false,
  read: false,
  actorId: 'a',
  actorName: 'Jan',
  actorPhoto: null,
  place: 'Best cushion?',
  excerpt: 'Try a ROHO.',
  detail: null,
  url: `/chat/rooms/general/topics/t?post=${o.id}`,
  ...o,
});

function Where() {
  const location = useLocation();
  return <p>at {`${location.pathname}${location.search}`}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.pages = [];
  db.asked = [];
  db.seen = 0;
  db.read = [];
  db.failure = null;
  db.waiting = [];
});

describe('the notifications list', () => {
  it('says what each is about, with the words under it', async () => {
    db.pages = [[item({ id: '1' })]];
    renderPage();
    expect(
      await screen.findByRole('button', { name: /Jan replied to your post “Best cushion\?”/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Try a ROHO.')).toBeInTheDocument();
  });

  it('shows a kind this build does not know, instead of failing', async () => {
    db.pages = [[item({ id: '1', kind: 'a_later_kind' as AppNotification['kind'] })]];
    renderPage();
    expect(
      await screen.findByRole('button', { name: /Something new in the club/ }),
    ).toBeInTheDocument();
  });

  it('clears the bell once they are on screen, and only when something was new', async () => {
    db.pages = [[item({ id: '1' })]];
    renderPage();
    await waitFor(() => {
      expect(db.seen).toBe(1);
    });
  });

  it('does not ask again when everything was already seen', async () => {
    db.pages = [[item({ id: '1', seen: true })]];
    renderPage();
    await screen.findByText('Try a ROHO.');
    expect(db.seen).toBe(0);
  });

  it('opens what it is about, marking that one read', async () => {
    const user = userEvent.setup();
    db.pages = [[item({ id: '1' })]];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New:\s*Jan replied/ }));
    expect(db.read).toEqual(['1']);
    expect(screen.getByText('at /chat/rooms/general/topics/t?post=1')).toBeInTheDocument();
  });

  it('marks everything read at once, and the offer goes', async () => {
    const user = userEvent.setup();
    db.pages = [[item({ id: '1' }), item({ id: '2', read: true })]];
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(db.read).toEqual([undefined]);
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
    expect(screen.queryByRole('button', { name: /New:/ })).toBeNull();
  });

  it('pages back from the oldest shown', async () => {
    const user = userEvent.setup();
    const full = Array.from({ length: 40 }, (_, i) =>
      item({ id: `p${i}`, createdAt: `2026-10-09T10:${String(59 - i).padStart(2, '0')}:00Z` }),
    );
    db.pages = [full, [item({ id: 'older' })]];
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Show earlier' }));
    expect(db.asked).toEqual([null, '2026-10-09T10:20:00Z']);
    expect(await screen.findAllByRole('listitem')).toHaveLength(41);
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
  });

  it('keeps what still needs the member on top, read or not, and lists it once', async () => {
    const asked = item({
      id: 'asked',
      kind: 'join_request',
      read: true,
      actorName: 'Ana',
      place: 'Ride On',
      url: '/events/organizations/o',
    });
    db.pages = [[item({ id: 'r1', createdAt: '2026-10-09T11:00:00Z' }), asked]];
    db.waiting = [{ ...asked, waitingSince: new Date(Date.now() - 30 * 3_600_000).toISOString() }];
    renderPage();
    const needs = await screen.findByRole('region', { name: 'Waiting on you (1)' });
    expect(needs).toHaveTextContent('Ana asked to join Ride On');
    expect(needs).toHaveTextContent('Waiting 1 day');
    expect(await screen.findAllByText('Ana asked to join Ride On')).toHaveLength(1);
    expect(screen.getByText('Jan replied to your post “Best cushion?”')).toBeInTheDocument();
  });

  it('says plainly when there is nothing', async () => {
    renderPage();
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument();
  });

  it('says why when the list cannot be read', async () => {
    db.failure = 'Could not load notifications.';
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notifications.');
  });
});
