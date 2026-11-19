import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppNav, litTab, TAB_SPIN_MIN_MS } from '@/components/app-nav';
import type * as BadgesModule from '@/lib/badges';
import { noticeWrites, useKeptRead } from '@/lib/kept-reads';
import type * as NotificationsModule from '@/lib/notifications';

const unseen = vi.hoisted(() => ({ count: 0, unproven: null as string | null }));

// The bell reads its number from the database; stubbed so this test reads nothing.
vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  useUnseenNotifications: () => ({ count: unseen.count, refresh: () => undefined }),
}));
vi.mock('@/lib/chat/unread', () => ({ useUnreadThreads: () => ({ count: 0, reload: vi.fn() }) }));
vi.mock('@/lib/chat/realtime', () => ({ useRealtimeRows: vi.fn() }));
vi.mock('@/lib/icon-badge', () => ({ useIconBadge: vi.fn() }));
vi.mock('@/lib/badges', async (importOriginal) => ({
  ...(await importOriginal<typeof BadgesModule>()),
  useBadgeRealtime: vi.fn(),
}));
vi.mock('@/lib/email-proof', () => ({ useUnprovenEmail: () => unseen.unproven }));

describe('litTab', () => {
  it('lights a tab on its own path and beneath it', () => {
    expect(litTab('/chat', null)).toBe('/chat');
    expect(litTab('/chat/rooms/bowel/topics/t', null)).toBe('/chat');
    expect(litTab('/events/abc', undefined)).toBe('/events');
  });

  it('does not light a tab whose name only starts the path', () => {
    expect(litTab('/meetings', null)).toBeNull();
  });

  // Every card on Home hands what it opens `{ from: 'home', segment }`.
  it('lights Home for a screen opened from Home', () => {
    expect(litTab('/chat/rooms/bowel/topics/t', { from: 'home', segment: 'topics' })).toBe('/home');
    expect(litTab('/chat/rooms/bowel/new', { from: 'home', segment: 'everything' })).toBe('/home');
    expect(litTab('/events/abc', { from: 'home', segment: 'events' })).toBe('/home');
    expect(litTab('/peers/abc', { from: 'home' })).toBe('/home');
  });

  it('ignores state that does not say Home', () => {
    expect(litTab('/chat/rooms/bowel/topics/t', { from: 'events' })).toBe('/chat');
  });
});

describe('AppNav', () => {
  it('marks the lit tab as the current page, and only that one', () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/chat/rooms/bowel/topics/t', state: { from: 'home', segment: 'topics' } },
        ]}
      >
        <AppNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Chat' })).not.toHaveAttribute('aria-current');
  });

  // The owner, 2026-11-10: Chat is where it was left, so a conversation stays
  // open across tab switches; 2026-11-19: every other tab opens on its first
  // screen, not the profile or post last looked at.
  it('takes Chat back to its conversation, and every other tab to its first screen', () => {
    // A profile looked at in Peers, then a conversation in Chat.
    render(
      <MemoryRouter initialEntries={['/peers/ana']}>
        <AppNav />
      </MemoryRouter>,
    ).unmount();
    render(
      <MemoryRouter initialEntries={['/chat/t/abc']}>
        <AppNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Peers' })).toHaveAttribute('href', '/peers');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat');
    // What Peers already shows stays up and is read again behind it.
    const peersRead = renderHook(() => useKeptRead()).result.current;
    peersRead.start('peers')();
    expect(peersRead.fresh('peers')).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Peers' }));
    expect(peersRead.fresh('peers')).toBe(false);
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat/t/abc');
  });
});

describe('the bar’s realtime', () => {
  // A club-wide chat_messages feed ran every member's read rules on every
  // message; each unmuted message writes the reader a notification instead.
  it('holds no message subscription of its own, only the badges’ filtered ones', async () => {
    const { useRealtimeRows } = await import('@/lib/chat/realtime');
    const { useBadgeRealtime } = await import('@/lib/badges');
    vi.mocked(useRealtimeRows).mockClear();
    render(
      <MemoryRouter initialEntries={['/events']}>
        <AppNav />
      </MemoryRouter>,
    );
    expect(useRealtimeRows).not.toHaveBeenCalled();
    expect(useBadgeRealtime).toHaveBeenCalled();
  });
});

// Still on every screen, Home's feed included (the owner, 2026-11-15).
describe('the bar on a scroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays on a phone as Home is read down, under the screen, clear of the home indicator', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <AppNav />
        <div data-testid="box" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const box = screen.getByTestId('box');
    Object.defineProperty(box, 'scrollHeight', { value: 2000 });
    Object.defineProperty(box, 'clientHeight', { value: 600 });
    Object.defineProperty(box, 'scrollTop', { value: 300 });
    fireEvent.touchStart(box);
    fireEvent.scroll(box);
    expect(nav.style.marginBottom).toBe('');
    expect(nav.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(nav.className).toContain('order-last');
    expect(nav.className).toContain('pb-[max(0.5rem,env(safe-area-inset-bottom))]');
  });
});

describe('the Me tab', () => {
  const renderNav = () =>
    render(
      <MemoryRouter>
        <AppNav />
      </MemoryRouter>,
    );

  // On Home, where the bell is (the owner, 2026-11-06).
  it('leaves an unseen notification to the Home tab', () => {
    unseen.count = 2;
    renderNav();
    expect(screen.getByRole('link', { name: 'Home, new notifications' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Me' })).toBeInTheDocument();
    unseen.count = 0;
  });

  // The owner, 2026-11-04.
  it('says so while their email waits to be confirmed', () => {
    unseen.unproven = 'sam@example.com';
    renderNav();
    expect(screen.getByRole('link', { name: 'Me, confirm your email' })).toBeInTheDocument();
    unseen.unproven = null;
  });

  it('is plain otherwise', () => {
    renderNav();
    expect(screen.getByRole('link', { name: 'Me' })).toBeInTheDocument();
  });
});

// The owner, 2026-11-19: a spinner on the tab tapped while it reads again.
describe('the tab tapped', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spins while its read is out, at least a moment, and stops once it lands', async () => {
    vi.useFakeTimers();
    let land: (response: Response) => void = () => undefined;
    const reads = noticeWrites(
      () =>
        new Promise<Response>((resolve) => {
          land = resolve;
        }),
    );
    render(
      <MemoryRouter initialEntries={['/home']}>
        <AppNav />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Peers' }));
    const sent = reads('https://x.supabase.co/rest/v1/rpc/browse_members', { method: 'POST' });
    await act(() => vi.advanceTimersByTimeAsync(TAB_SPIN_MIN_MS + 500));
    // Still out after the least time: still turning, on Peers only.
    expect(screen.getByRole('link', { name: 'Peers' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('tab-spinner')).toHaveLength(1);
    await act(async () => {
      land(new Response('[]'));
      await sent;
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByTestId('tab-spinner')).toBeNull();
    expect(screen.getByRole('link', { name: 'Peers' })).not.toHaveAttribute('aria-busy');
  });
});
