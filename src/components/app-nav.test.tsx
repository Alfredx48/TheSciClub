import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppNav, litTab } from '@/components/app-nav';
import type * as BadgesModule from '@/lib/badges';
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

describe('the bar on a scroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function scrollOn({
    coarse,
    wide,
    height = 2000,
    bar = 60,
    path = '/home',
  }: {
    coarse: boolean;
    wide: boolean;
    height?: number;
    bar?: number;
    path?: string;
  }) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer') ? coarse : wide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppNav />
        <div data-testid="box" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    Object.defineProperty(nav, 'offsetHeight', { value: bar });
    const box = screen.getByTestId('box');
    Object.defineProperty(box, 'scrollHeight', { value: height });
    Object.defineProperty(box, 'clientHeight', { value: 600 });
    Object.defineProperty(box, 'scrollTop', { value: 300 });
    // The reader's own scroll: only that moves the bar (hide-on-scroll.ts).
    fireEvent.touchStart(box);
    fireEvent.scroll(box);
    return nav;
  }

  it('goes on a phone', () => {
    expect(scrollOn({ coarse: true, wide: false }).style.marginBottom).toBe('-60px');
  });

  // Home's feed only (the owner, 2026-11-09).
  it('stays on every other screen', () => {
    expect(scrollOn({ coarse: true, wide: false, path: '/events' }).style.marginBottom).toBe('');
  });

  // 200 to scroll, 110 once a 90 bar has gone: it would only bounce.
  it('stays on a page that would keep too little room without it', () => {
    const nav = scrollOn({ coarse: true, wide: false, height: 800, bar: 90 });
    expect(nav.style.marginBottom).toBe('');
  });

  // In the column, not over it: what is above always ends at the bar's top.
  it('sits under the screen rather than over it, clear of the home indicator', () => {
    const nav = scrollOn({ coarse: true, wide: false, height: 600 });
    expect(nav.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(nav.className).toContain('order-last');
    expect(nav.className).toContain('pb-[max(0.5rem,env(safe-area-inset-bottom))]');
    expect(nav.style.marginBottom).toBe('');
  });

  it('stays in a narrow window on a computer', () => {
    expect(scrollOn({ coarse: false, wide: false }).style.marginBottom).toBe('');
  });

  it('stays at the top of a wide screen, touch or not', () => {
    expect(scrollOn({ coarse: true, wide: true }).style.marginBottom).toBe('');
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
