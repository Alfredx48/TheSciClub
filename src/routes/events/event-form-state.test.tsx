import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeOrganization } from '@/test/factory';
import type { ClubEvent } from '@/types/domain';

const organizations = [
  makeOrganization({ id: 'borp', name: 'BORP', city: 'Berkeley', state: 'CA' }),
  makeOrganization({ id: 'hf', name: 'High Fives', city: 'Truckee', state: 'NV' }),
  makeOrganization({ id: 'far', name: 'Faraway Rugby', city: 'Bend', state: 'OR' }),
];
vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: 'member', userId: 'u1', isAdmin: true, displayName: 'A' }),
}));
vi.mock('@/lib/organization-representatives', () => ({
  useMyOrganizations: () => ({ ids: new Set(), loading: false }),
}));
// Theirs are listed; the rest are a search (the owner, 2026-11-05).
vi.mock('@/lib/organization-members', () => ({ useMemberOrganizations: () => ['borp', 'hf'] }));
vi.mock('@/lib/organizations', () => ({
  useOrganizations: () => ({
    organizations,
    byId: new Map(organizations.map((o) => [o.id, o])),
    loading: false,
    error: null,
  }),
}));
const shown = vi.hoisted(() => ({ events: [] as ClubEvent[] }));
vi.mock('@/lib/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEvents: () => ({ events: shown.events, loading: false, error: null }),
}));
vi.mock('@/lib/event-audience', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEventVisibility: () => Promise.resolve({ ok: true, value: null }),
}));
vi.mock('@/lib/photos', () => ({ usePhotoUrl: () => null }));
vi.mock('@/lib/address-suggestions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  suggestAddresses: () =>
    Promise.resolve([
      {
        key: 'w1',
        name: 'Lakeside Park',
        street: '666 Bellevue Avenue',
        city: 'Bend',
        state: 'OR',
        postalCode: '97701',
        line: '666 Bellevue Avenue, Bend, OR 97701',
      },
    ]),
}));

const { default: EventFormPage } = await import('@/routes/events/event-form');

function renderForm(path = '/events/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/new" element={<EventFormPage />} />
        <Route path="/events/:id/edit" element={<EventFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it('restores a new event with its restricted audience until the draft is discarded', async () => {
  const user = userEvent.setup();
  const first = renderForm();
  await user.type(screen.getByLabelText('What is it called?'), 'Quiet meetup');
  await user.type(screen.getByLabelText('Accessibility (optional)'), 'Step-free entrance');
  await user.click(screen.getByRole('radio', { name: /Invite only/ }));
  first.unmount();
  sessionStorage.clear();

  const second = renderForm();
  expect(screen.getByLabelText('What is it called?')).toHaveValue('Quiet meetup');
  expect(screen.getByLabelText('Accessibility (optional)')).toHaveValue('Step-free entrance');
  expect(screen.getByRole('radio', { name: /Invite only/ })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Discard draft' }));
  second.unmount();

  renderForm();
  expect(screen.getByLabelText('What is it called?')).toHaveValue('');
  expect(screen.getByRole('radio', { name: /Everyone in the club/ })).toBeChecked();
});

describe("an event's state on its form", () => {
  it("follows the host's state until somebody chooses one", async () => {
    renderForm();
    const host = await screen.findByLabelText('Who is hosting it?');
    const state = screen.getByLabelText('State');
    await userEvent.selectOptions(host, 'borp');
    expect(state).toHaveValue('CA');
    await userEvent.selectOptions(host, 'hf');
    expect(state).toHaveValue('NV');
    await userEvent.selectOptions(state, 'OR');
    await userEvent.selectOptions(host, 'borp');
    expect(state).toHaveValue('OR');
  });

  it('fills Where, City, ZIP code and State from a picked address, and the host no longer moves the state', async () => {
    renderForm();
    const host = await screen.findByLabelText('Who is hosting it?');
    await userEvent.selectOptions(host, 'borp');
    const where = screen.getByRole('combobox', { name: 'Where' });
    await userEvent.type(where, '666 Bell');
    await userEvent.click(await screen.findByRole('option', { name: /Lakeside Park/ }));
    expect(where).toHaveValue('Lakeside Park, 666 Bellevue Avenue');
    expect(screen.getByLabelText('City (optional)')).toHaveValue('Bend');
    expect(screen.getByLabelText('ZIP code (optional)')).toHaveValue('97701');
    expect(screen.getByLabelText('State')).toHaveValue('OR');
    await userEvent.selectOptions(host, 'hf');
    expect(screen.getByLabelText('State')).toHaveValue('OR');
  });

  it('lists the organizations they belong to, and finds the rest by search', async () => {
    renderForm();
    const host = await screen.findByLabelText('Who is hosting it?');
    expect(screen.queryByRole('option', { name: 'Faraway Rugby' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Or find another organization'), 'bend');
    await userEvent.click(screen.getByRole('button', { name: /^Faraway Rugby/ }));
    expect(host).toHaveValue('far');
    expect(screen.getByLabelText('State')).toHaveValue('OR');
  });

  // The owner, 2026-11-06: a video call link, only where there is a call.
  it('asks for a video call link only for an online or hybrid event', async () => {
    renderForm();
    await screen.findByLabelText('Who is hosting it?');
    expect(screen.queryByLabelText('Video call link (optional)')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Online' }));
    expect(screen.getByLabelText('Video call link (optional)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hybrid' }));
    expect(screen.getByLabelText('Video call link (optional)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'In person' }));
    expect(screen.queryByLabelText('Video call link (optional)')).toBeNull();
  });

  // The owner, 2026-11-06: changing a one-off, it can be made to repeat.
  it('offers Repeats when changing a one-off that has not started, and not a date of a series', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    shown.events = [
      makeEvent({ id: 'once', startTime: soon, seriesId: null, handAdded: true }),
      makeEvent({ id: 'dated', startTime: soon, seriesId: 's1', handAdded: true }),
      makeEvent({
        id: 'gone',
        startTime: '2026-01-05T17:00:00.000Z',
        seriesId: null,
        handAdded: true,
      }),
    ];
    renderForm('/events/once/edit');
    expect(await screen.findByLabelText('Repeats')).toBeInTheDocument();
  });

  it('offers no Repeats for a date of a series', async () => {
    renderForm('/events/dated/edit');
    await screen.findByLabelText('Who is hosting it?');
    expect(screen.queryByLabelText('Repeats')).toBeNull();
  });

  it('offers no Repeats for an event that has started', async () => {
    renderForm('/events/gone/edit');
    await screen.findByLabelText('Who is hosting it?');
    expect(screen.queryByLabelText('Repeats')).toBeNull();
  });
});
