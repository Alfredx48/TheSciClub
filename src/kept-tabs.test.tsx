import { act, render, screen } from '@testing-library/react';
import { Suspense, useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ mounts: [] as string[], reads: [] as string[] }));

/** A tab that counts its mounts (its state's first use) and its reads. */
function fakeTab(name: string) {
  return {
    default: function Tab() {
      useState(() => {
        seen.mounts.push(name);
      });
      useEffect(() => {
        seen.reads.push(name);
      }, []);
      return <h1>{name}</h1>;
    },
  };
}

vi.mock('@/routes/home/page', () => fakeTab('Home'));
vi.mock('@/routes/peers/page', () => fakeTab('Peers'));
vi.mock('@/routes/chat/page', () => fakeTab('Chat'));
vi.mock('@/routes/events/page', () => fakeTab('Events'));
vi.mock('@/routes/me/page', () => fakeTab('Me'));

const { KeptTabs } = await import('@/App');

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <Suspense fallback={null}>
            <KeptTabs />
          </Suspense>
        ),
      },
    ],
    {
      initialEntries: [path],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  seen.mounts = [];
  seen.reads = [];
});

describe('the five tabs', () => {
  it('opens only the tab being visited', async () => {
    renderAt('/home');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeVisible();
    expect(seen.mounts).toEqual(['Home']);
  });

  it('keeps a tab mounted and hidden while another shows, and reads again on return', async () => {
    const router = renderAt('/home');
    await screen.findByRole('heading', { name: 'Home' });

    await act(() => router.navigate('/peers'));
    expect(await screen.findByRole('heading', { name: 'Peers' })).toBeVisible();
    expect(screen.getByText('Home')).not.toBeVisible();

    await act(() => router.navigate('/home'));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible();
    expect(screen.getByText('Peers')).not.toBeVisible();
    // Mounted once each; Home's effect ran again when it showed.
    expect(seen.mounts).toEqual(['Home', 'Peers']);
    expect(seen.reads.filter((name) => name === 'Home')).toHaveLength(2);
  });

  it('hides every tab on another screen', async () => {
    const router = renderAt('/me');
    await screen.findByRole('heading', { name: 'Me' });
    await act(() => router.navigate('/me/qr'));
    expect(screen.getByText('Me')).not.toBeVisible();
    await act(() => router.navigate('/me'));
    expect(screen.getByRole('heading', { name: 'Me' })).toBeVisible();
    expect(seen.mounts).toEqual(['Me']);
  });
});
