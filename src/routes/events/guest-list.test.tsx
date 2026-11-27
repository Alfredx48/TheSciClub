import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EventAudience from '@/lib/event-audience';
import type { Guest } from '@/lib/event-audience';
import type * as SendInvite from '@/lib/send-invite';

type InviteAnswer =
  | { ok: true; inviteId: string; sendError?: string }
  | { ok: false; error: string };

type TickAnswer = { ok: true; value: null } | { ok: false; error: string };

const state = vi.hoisted(() => ({
  guests: [] as Guest[],
  invited: [] as string[],
  inviteAnswer: null as InviteAnswer | null,
  sentAgain: [] as string[],
  startTime: null as string | null,
  ticks: [] as { guest: string | null; checked: boolean }[],
  tickAnswer: null as TickAnswer | null,
}));

vi.mock('@/lib/event-audience', async (importOriginal) => ({
  ...(await importOriginal<typeof EventAudience>()),
  fetchGuestList: () => Promise.resolve({ ok: true, value: state.guests }),
  inviteGuest: (id: string) => {
    state.invited.push(id);
    return Promise.resolve(state.inviteAnswer ?? { ok: true, inviteId: 'inv-1' });
  },
  setGuestCheckedIn: (
    _event: string,
    g: { memberId: string | null; registrationId: string | null },
    checked: boolean,
  ) => {
    state.ticks.push({ guest: g.memberId ?? g.registrationId, checked });
    return Promise.resolve(state.tickAnswer ?? { ok: true, value: null });
  },
}));
vi.mock('@/lib/send-invite', async (importOriginal) => ({
  ...(await importOriginal<typeof SendInvite>()),
  sendInvite: (id: string) => {
    state.sentAgain.push(id);
    return Promise.resolve({ ok: true });
  },
}));
vi.mock('@/lib/chat/realtime', () => ({ useRealtimeRows: () => undefined }));
vi.mock('@/routes/events/event-invite-tracking', () => ({ EventInviteTracking: () => null }));
vi.mock('@/routes/events/event-declines-list', () => ({ EventDeclinesList: () => null }));
vi.mock('@/routes/events/event-join-requests', () => ({ EventJoinRequests: () => null }));
vi.mock('@/lib/events', () => ({
  useEvents: () => ({
    events: state.startTime ? [{ id: 'e1', title: 'Picnic', startTime: state.startTime }] : [],
    loading: false,
    error: null,
  }),
}));

const { default: GuestListPage } = await import('@/routes/events/guest-list');

const guest = (o: Partial<Guest> = {}): Guest => ({
  name: 'Maria Lopez',
  email: 'maria@example.com',
  phone: '(408) 555-0112',
  status: 'going',
  state: 'unconfirmed',
  respondedAt: '2026-10-22T18:00:00Z',
  registrationId: 'reg-1',
  invite: null,
  inviteId: null,
  memberId: null,
  checkedIn: false,
  ...o,
});

function renderList() {
  render(
    <MemoryRouter initialEntries={['/events/e1/guests']}>
      <Routes>
        <Route path="/events/:id/guests" element={<GuestListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.startTime = null;
  state.ticks = [];
  state.tickAnswer = null;
  state.invited = [];
  state.sentAgain = [];
  state.inviteAnswer = { ok: true, inviteId: 'inv-1' };
});

// The owner, 2026-11-04.
describe('inviting a guest from the public page', () => {
  it('invites them, and then says they are invited', async () => {
    state.guests = [guest()];
    renderList();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Invite Maria Lopez to the club' }),
    );
    expect(state.invited).toEqual(['reg-1']);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invite sent to maria@example.com.',
    );
    expect(screen.getByText('Invited')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(state.sentAgain).toEqual(['inv-1']);
  });

  it('is not offered for members, or for a member’s RSVP', async () => {
    state.guests = [
      guest({ name: 'Sam', state: 'member' }),
      guest({ name: 'Ana', state: 'member', registrationId: null }),
    ];
    renderList();
    await screen.findByText('Sam');
    expect(screen.queryByRole('button', { name: /to the club/ })).toBeNull();
  });

  it('says Invited, with no Send again, for an invite somebody else sent', async () => {
    state.guests = [guest({ invite: 'pending', inviteId: null })];
    renderList();
    expect(await screen.findByText('Invited')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(screen.queryByRole('button', { name: /to the club/ })).toBeNull();
  });

  it('says why when the club refuses', async () => {
    state.guests = [guest()];
    state.inviteAnswer = { ok: false, error: 'That email address is already on the list' };
    renderList();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Invite Maria Lopez to the club' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('already on the list');
  });
});

// The owner, 2026-11-13 (20261113110000).
describe('ticking who was there', () => {
  it('offers boxes only once the event has started, and puts a refused tick back', async () => {
    state.guests = [guest({ name: 'Sam', state: 'member', registrationId: null, memberId: 'm-1' })];
    state.startTime = new Date(Date.now() + 3_600_000).toISOString();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/events/e1/guests']}>
        <Routes>
          <Route path="/events/:id/guests" element={<GuestListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Sam');
    expect(screen.queryByRole('checkbox')).toBeNull();
    unmount();

    state.startTime = new Date(Date.now() - 30 * 86_400_000).toISOString();
    renderList();
    const box = await screen.findByRole('checkbox', { name: 'Sam was there' });
    await userEvent.click(box);
    expect(state.ticks).toEqual([{ guest: 'm-1', checked: true }]);
    expect(box).toBeChecked();

    state.tickAnswer = { ok: false, error: 'Could not undo their check-in.' };
    await userEvent.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not undo');
    expect(box).toBeChecked();
  });

  // The Fable review, 2026-11-13: an untick took a walk-in off for good.
  it('keeps a walk-in ticked, since unticking would lose them', async () => {
    state.guests = [
      guest({
        name: 'Lee',
        status: 'walk_in',
        state: 'member',
        registrationId: null,
        memberId: 'm-2',
        checkedIn: true,
      }),
    ];
    state.startTime = new Date(Date.now() - 86_400_000).toISOString();
    renderList();
    const box = await screen.findByRole('checkbox', { name: 'Lee was there' });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });
});
