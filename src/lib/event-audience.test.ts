import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetPendingRegistration,
  type Guest,
  guestListCsv,
  keepPendingRegistration,
  pendingRegistration,
  publicEventUrl,
  registeredRecently,
  registerForEvent,
} from '@/lib/event-audience';

const rpc = vi.hoisted(() => ({ error: null as { code: string; message: string } | null }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: () => Promise.resolve({ data: null, error: rpc.error }) }),
}));

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
  ...o,
});

describe('the guest list as a spreadsheet', () => {
  it('has a header and a row per guest, saying whether they are in the club', () => {
    const csv = guestListCsv([guest(), guest({ name: 'Sam', state: 'member', phone: null })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,Response,In the club,Responded');
    expect(lines[1]).toBe(
      'Maria Lopez,maria@example.com,(408) 555-0112,going,Not confirmed,2026-10-22T18:00:00Z',
    );
    expect(lines[2]).toContain('Sam,maria@example.com,,going,Member');
  });

  it('quotes commas and quotes', () => {
    expect(guestListCsv([guest({ name: 'Lopez, "Mia"' })])).toContain('"Lopez, ""Mia"""');
  });

  // Anybody types these on a public page: a formula must stay text.
  it('keeps a typed formula from running in the organizer’s spreadsheet', () => {
    const csv = guestListCsv([guest({ name: '=HYPERLINK("http://x")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe('the registration kept on this device', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps it until it is let go', () => {
    keepPendingRegistration({
      eventId: 'e1',
      status: 'interested',
      name: 'Maria',
      email: 'maria@example.com',
      phone: '',
      organizer: 'NorCal SCI',
    });
    expect(pendingRegistration()).toMatchObject({
      eventId: 'e1',
      status: 'interested',
      organizer: 'NorCal SCI',
    });
    forgetPendingRegistration();
    expect(pendingRegistration()).toBeNull();
  });

  // It greeted a browser weeks later (the owner, 2026-11-10): news for a day only.
  it('is news for a day, and an old one with no time never', () => {
    const day = 24 * 60 * 60 * 1000;
    keepPendingRegistration({
      eventId: 'e1',
      status: 'going',
      name: '',
      email: 'a@b.co',
      phone: '',
    });
    expect(registeredRecently()).toBe(true);
    expect(registeredRecently(Date.now() + day + 1)).toBe(false);
    expect(pendingRegistration()).not.toBeNull();
    window.localStorage.setItem(
      'sciclub.eventRegistration',
      '{"eventId":"e1","email":"a@b.co","status":"going"}',
    );
    expect(registeredRecently()).toBe(false);
  });

  it('ignores something that is not one', () => {
    window.localStorage.setItem('sciclub.eventRegistration', '{"eventId":3}');
    expect(pendingRegistration()).toBeNull();
    window.localStorage.setItem('sciclub.eventRegistration', 'nope');
    expect(pendingRegistration()).toBeNull();
  });
});

it('shares a public event at thesciclub.com/e/', () => {
  expect(publicEventUrl('abc')).toBe('https://thesciclub.com/e/abc');
});

describe('a refused registration (20261104202000)', () => {
  const registration = {
    eventId: 'gone',
    status: 'going' as const,
    name: 'Maria',
    email: 'maria@example.com',
    phone: '',
  };

  it.each([
    ['22023', 'This event is not taking registrations.'],
    ['P0001', 'Too many registrations just now. Try again in a minute.'],
  ])('says the database’s own sentence for %s', async (code, message) => {
    rpc.error = { code, message };
    await expect(registerForEvent(registration)).resolves.toEqual({ ok: false, error: message });
  });
});
