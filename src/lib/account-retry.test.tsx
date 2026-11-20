import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireMember } from '@/components/require-member';
import { useOwnAccount } from '@/lib/account';

const state = vi.hoisted(() => ({
  error: null as { message: string } | null,
  onChange: null as
    | ((event: string, session: { user: { id: string }; access_token?: string } | null) => void)
    | null,
  lookup: vi.fn(),
  feedHeader: vi.fn(),
  feedSignal: null as AbortSignal | null,
  feed: null as Promise<{ data: unknown[]; error: null }> | null,
  memberId: 'me',
  reject: false,
  /** A restored session announcing itself before getSession answers. */
  restoring: false,
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              data: { session: { user: { id: 'me' }, access_token: 'session-one' } },
              error: null,
            });
          }, 0);
        }),
      onAuthStateChange: (
        callback: (
          event: string,
          session: { user: { id: string }; access_token?: string } | null,
        ) => void,
      ) => {
        state.onChange = callback;
        if (state.restoring) {
          queueMicrotask(() => {
            callback('SIGNED_IN', { user: { id: 'me' } });
          });
        }
        return { data: { sub: null, subscription: { unsubscribe: vi.fn() } } };
      },
    },
    rpc: () => ({
      abortSignal: (signal: AbortSignal) => {
        state.feedSignal = signal;
        return Object.assign(state.feed ?? Promise.resolve({ data: [], error: null }), {
          setHeader: state.feedHeader,
        });
      },
    }),
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        abortSignal: () => query,
        maybeSingle: () => {
          state.lookup();
          if (state.reject) return Promise.reject(new Error('Offline'));
          return Promise.resolve({
            data: state.error
              ? null
              : { id: state.memberId, status: 'active', display_name: 'Member' },
            error: state.error,
          });
        },
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  state.error = { message: 'Backend unavailable' };
  state.reject = false;
  state.restoring = false;
  state.lookup.mockClear();
  state.feedHeader.mockClear();
  state.feedSignal = null;
  state.feed = null;
  state.memberId = 'me';
});

describe('membership outages', () => {
  it.each([false, true])(
    'retains the protected destination and lets an existing member retry (rejected=%s)',
    async (reject) => {
      state.reject = reject;
      render(
        <MemoryRouter initialEntries={['/chat/t/saved-link']}>
          <Routes>
            <Route
              path="/chat/t/saved-link"
              element={
                <RequireMember>
                  <p>Original conversation</p>
                </RequireMember>
              }
            />
            <Route path="/join" element={<p>Join screen</p>} />
          </Routes>
        </MemoryRouter>,
      );
      await screen.findByRole('button', { name: 'Try again' });
      expect(screen.queryByText('Join screen')).toBeNull();
      state.error = null;
      state.reject = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByText('Original conversation');
      expect(state.lookup).toHaveBeenCalledTimes(2);
    },
  );
  it('still redirects after a real sign-out', async () => {
    state.error = null;
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route
            path="/home"
            element={
              <RequireMember>
                <p>Home</p>
              </RequireMember>
            }
          />
          <Route path="/join" element={<p>Join screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Home');
    // A later sign-out is authoritative, even after a successful member read.
    await act(async () => {
      state.onChange?.('SIGNED_OUT', null);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Join screen')).toBeInTheDocument());
  });

  it('reads the row once when a restored session announces itself first', async () => {
    state.error = null;
    state.restoring = true;
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route
            path="/home"
            element={
              <RequireMember>
                <p>Home</p>
              </RequireMember>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Home');
    expect(state.lookup).toHaveBeenCalledTimes(1);
  });
});

it.each(['sign-out', 'switch'])('discards a pending feed after %s', async (change) => {
  state.error = null;
  interface FeedResult {
    data: unknown[];
    error: null;
  }
  let finishFeed: (result: FeedResult) => void = () => {
    throw new Error('The feed request has not started');
  };
  state.feed = new Promise<FeedResult>((resolve) => {
    finishFeed = resolve;
  });
  const { result } = renderHook(() => useOwnAccount({ refresh: '/home' }));
  await waitFor(() => {
    expect(result.current.status).toBe('member');
  });
  expect(state.feedHeader).toHaveBeenCalledWith('Authorization', 'Bearer session-one');
  const take = result.current.takeInitialHomeFeed;
  const delivered = take?.();
  expect(delivered).toBeDefined();
  const signal = state.feedSignal;
  expect(signal?.aborted).toBe(false);

  await act(async () => {
    state.memberId = 'other';
    if (change === 'switch') {
      state.onChange?.('SIGNED_IN', { user: { id: 'other' }, access_token: 'session-two' });
    } else {
      state.onChange?.('SIGNED_OUT', null);
    }
    finishFeed({ data: [{ title: 'First member’s post' }], error: null });
    expect(await delivered).toBeNull();
  });
  expect(signal?.aborted).toBe(true);
  expect(take?.()).toBeUndefined();
  expect(result.current.userId).toBe(change === 'switch' ? 'other' : null);
  expect(result.current.takeInitialHomeFeed).toBeUndefined();
});
