import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackLine, BackLineProvider, BackTrail, HeaderBack } from '@/components/back-line';
import { BackLink } from '@/components/back-link';
import { forgetTrail, nameScreen } from '@/lib/back-trail';

/** A screen that names itself, as RouteChange does from each screen's h1. */
function Screen({ name, children }: { name: string; children?: React.ReactNode }) {
  // After the trail has the new screen, as RouteChange's effect is.
  useEffect(() => {
    nameScreen(name);
  }, [name]);
  return (
    <div>
      <h1>{name}</h1>
      {children}
    </div>
  );
}

function renderApp(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <BackTrail />
      <BackLineProvider>
        <BackLine />
        <Routes>
          <Route
            path="/chat"
            element={
              <Screen name="Chat">
                <Link to="/chat/rooms/life">Open the room</Link>
              </Screen>
            }
          />
          <Route
            path="/chat/rooms/life"
            element={
              <Screen name="Life stories">
                <BackLink to="/chat" label="Chat" />
                <Link to="/peers/ana">Open Ana</Link>
              </Screen>
            }
          />
          <Route
            path="/peers/ana"
            element={
              <Screen name="Ana Ruiz">
                {/* In its own header, so the line is not drawn too (2026-11-21). */}
                <HeaderBack to="/peers" label="Peers" />
              </Screen>
            }
          />
          <Route path="/peers" element={<Screen name="Peers" />} />
        </Routes>
      </BackLineProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  forgetTrail();
});

describe('the line back', () => {
  // The owner, 2026-11-18: back to the previous page, step by step, and no
  // line on a tab's first screen.
  it('names the screen the member came from and goes there, a step a press', async () => {
    const user = userEvent.setup();
    renderApp('/chat');
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Open the room' }));
    await user.click(screen.getByRole('link', { name: 'Open Ana' }));
    // Not Peers, where a profile's own link went: the room she was opened from.
    await user.click(screen.getByRole('button', { name: 'Back to Life stories' }));
    expect(screen.getByRole('heading', { name: 'Life stories' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to Chat' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
  });

  it('goes where the screen’s own link went when nothing is remembered, and draws only the line', async () => {
    const user = userEvent.setup();
    // Opened from a notification or a shared link: no screen before it.
    renderApp('/peers/ana');
    expect(screen.queryByRole('link', { name: 'Peers' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to Peers' }));
    expect(screen.getByRole('heading', { name: 'Peers' })).toBeInTheDocument();
  });
});
