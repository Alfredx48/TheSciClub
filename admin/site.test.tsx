import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSite } from './site';

const state = vi.hoisted(() => ({
  row: null as { is_admin: boolean; display_name: string } | null,
  signOut: vi.fn(),
}));

vi.mock('./supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'someone' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: () => {
        state.signOut();
        return Promise.resolve({ error: null });
      },
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => Promise.resolve({ data: state.row, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('@/routes/admin/stats-section', () => ({
  StatsSection: () => <p>The club’s stats</p>,
}));

beforeEach(() => {
  state.signOut.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
  );
});

// The owner, 2026-11-22: admin.thesciclub.com is for the club's administrators.
// The database refuses their reads to anybody else; the site signs them out too.
describe('the admin site', () => {
  it.each([
    [{ is_admin: false, display_name: 'Member' }, false],
    [null, false],
    [{ is_admin: true, display_name: 'Admin' }, true],
  ])('lets in only an administrator (%o)', async (row, admitted) => {
    state.row = row;
    render(
      <MemoryRouter>
        <AdminSite />
      </MemoryRouter>,
    );
    if (admitted) {
      await screen.findByText('The club’s stats');
      expect(state.signOut).not.toHaveBeenCalled();
    } else {
      await screen.findByText('This site is for the club’s administrators only.');
      await waitFor(() => {
        expect(state.signOut).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByText('The club’s stats')).toBeNull();
    }
  });
});
