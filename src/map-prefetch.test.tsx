import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PageSpeed from '@/lib/page-speed';

const tabs = vi.hoisted(() => ({ loaded: [] as string[] }));
const prefetchMap = vi.fn();
vi.mock('@/lib/map', () => ({ prefetchMap }));

const account = vi.hoisted((): { status: string; userId: string | null } => ({
  status: 'member',
  userId: 'u1',
}));
vi.mock('@/lib/account', () => {
  const read = () => ({ ...account, isAdmin: false, displayName: 'Test' });
  return {
    useAccount: read,
    useOwnAccount: read,
    AccountProvider: ({ children }: { children: React.ReactNode }) => children,
    signOut: () => Promise.resolve({ ok: true }),
  };
});
vi.mock('@/lib/members', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOwnMember: () => ({ member: null, invitedBy: null, loading: false, error: null }),
}));
vi.mock('@/components/app-nav', () => ({ AppNav: () => null }));
vi.mock('@/routes/home/page', () => ({
  default: () => (
    <>
      <h1>Home</h1>
      <Link to="/peers">Peers</Link>
      <Link to="/events">Events</Link>
    </>
  ),
}));
vi.mock('@/routes/onboarding/page', () => ({ default: () => <h1>Join</h1> }));
vi.mock('@/routes/peers/page', () => {
  tabs.loaded.push('peers');
  return { default: () => null };
});
vi.mock('@/routes/chat/page', () => {
  tabs.loaded.push('chat');
  return { default: () => null };
});
vi.mock('@/routes/events/page', () => {
  tabs.loaded.push('events');
  return { default: () => null };
});
vi.mock('@/routes/me/page', () => {
  tabs.loaded.push('me');
  return { default: () => null };
});

const { default: App } = await import('@/App');

// Run idle work on the next tick.
// The stand-in Home draws no content, so the tabs' scripts need not wait for it.
vi.mock('@/lib/page-speed', async (original) => ({
  ...(await original<typeof PageSpeed>()),
  afterFirstContent: () => Promise.resolve(),
}));
vi.stubGlobal('requestIdleCallback', (task: () => void) => window.setTimeout(task, 0));
vi.stubGlobal('cancelIdleCallback', (id: number) => {
  window.clearTimeout(id);
});

beforeEach(() => {
  prefetchMap.mockClear();
});

describe('warming the map', () => {
  it.each(['Peers', 'Events'])('warms on %s after staying off Home', async (tab) => {
    account.status = 'member';
    account.userId = 'u1';
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect([...tabs.loaded].sort()).toEqual(['chat', 'events', 'me', 'peers']);
    });
    await new Promise((done) => setTimeout(done, 50));
    expect(prefetchMap).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: tab }));
    await vi.waitFor(() => {
      expect(prefetchMap).toHaveBeenCalledTimes(1);
    });
  });

  it('never starts for somebody signed out', async () => {
    account.status = 'signed-out';
    account.userId = null;
    render(
      <MemoryRouter initialEntries={['/peers']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Join' })).toBeInTheDocument();
    await new Promise((done) => setTimeout(done, 50));
    expect(prefetchMap).not.toHaveBeenCalled();
  });
});
