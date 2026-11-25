import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureQrCode,
  claimHeldQrCode,
  createQrCode,
  fetchMyQrCodes,
  fetchQrCodeDetails,
  forgetQrCode,
  heldQrCode,
  QR_CODE_KEY,
  qrJoinUrl,
  turnOffQrCode,
} from '@/lib/qr-codes';

/** Only `@/lib/supabase` is stubbed; the module under test is the real one. */

const db = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown>][],
  data: null as Record<string, unknown> | boolean | null,
  error: null as { message: string; code?: string } | null,
  throws: false,
  rows: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      db.calls.push([name, args]);
      const answer = db.throws
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ data: db.data, error: db.error });
      return Object.assign(answer, { single: () => answer, maybeSingle: () => answer });
    },
    from: (table: string) => ({
      select: () => ({
        order: () =>
          Promise.resolve(
            table === 'qr_codes'
              ? { data: db.rows, error: db.error }
              : { data: null, error: { message: `unexpected ${table}` } },
          ),
      }),
    }),
  }),
}));

const row = {
  id: 'q1',
  code: 'abc123',
  event_name: 'Abilities Expo LA',
  contact_email: 'alfred@example.com',
  created_at: '2026-10-14T17:00:00Z',
  turned_off_at: null,
};

beforeEach(() => {
  window.localStorage.clear();
  db.calls = [];
  db.data = null;
  db.error = null;
  db.throws = false;
  db.rows = [];
});

describe('holding the code through sign-up', () => {
  it('keeps the code the address carries, trimmed, and lets it go', () => {
    expect(captureQrCode('?from=%20abc123%20')).toBe('abc123');
    expect(window.localStorage.getItem(QR_CODE_KEY)).toBe('abc123');
    expect(captureQrCode('')).toBe('abc123');
    forgetQrCode();
    expect(heldQrCode()).toBeNull();
  });

  it("makes the store app's code open thesciclub.com, not the app's own address", () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      expect(qrJoinUrl('abc123')).toBe('https://thesciclub.com/join?from=abc123');
    } finally {
      native.mockRestore();
    }
    expect(qrJoinUrl('abc123')).toBe(`${window.location.origin}/join?from=abc123`);
  });

  it('builds the address the code opens', () => {
    expect(qrJoinUrl('abc123', 'https://thesciclub.com')).toBe(
      'https://thesciclub.com/join?from=abc123',
    );
  });
});

describe('what a code says', () => {
  it('reads who it is from, and the email only the database gave', async () => {
    db.data = {
      inviter_name: 'Alfred',
      event_name: 'Abilities Expo LA',
      joining_open: false,
      contact_email: 'alfred@example.com',
    };
    expect(await fetchQrCodeDetails('abc123')).toEqual({
      inviterName: 'Alfred',
      eventName: 'Abilities Expo LA',
      joiningOpen: false,
      contactEmail: 'alfred@example.com',
      organizationName: null,
      admits: false,
    });
    expect(db.calls).toEqual([['qr_code_details', { p_code: 'abc123' }]]);
  });

  // 20261028960000: an org admin's code lets them in while it is live.
  it("reads an organization's code as letting them in", async () => {
    db.data = {
      inviter_name: 'Sam',
      event_name: null,
      joining_open: false,
      contact_email: null,
      organization_name: 'NorCal SCI',
      admits: true,
    };
    expect(await fetchQrCodeDetails('abc123')).toEqual({
      inviterName: 'Sam',
      eventName: null,
      joiningOpen: false,
      contactEmail: null,
      organizationName: 'NorCal SCI',
      admits: true,
    });
  });

  it('is nothing for a code that says nothing, a refusal, or no connection', async () => {
    expect(await fetchQrCodeDetails('dead')).toBeNull();
    db.error = { message: 'nope' };
    db.data = { inviter_name: 'Alfred' };
    expect(await fetchQrCodeDetails('abc123')).toBeNull();
    db.error = null;
    db.throws = true;
    expect(await fetchQrCodeDetails('abc123')).toBeNull();
  });
});

describe('claiming the held code', () => {
  it('does nothing with no code held', async () => {
    await claimHeldQrCode();
    expect(db.calls).toEqual([]);
  });

  it('claims it and lets it go once answered', async () => {
    captureQrCode('?from=abc123');
    db.data = true;
    await claimHeldQrCode();
    expect(db.calls).toEqual([['claim_qr_code', { p_code: 'abc123' }]]);
    expect(heldQrCode()).toBeNull();
  });

  it('keeps it for the next try when the call fails', async () => {
    captureQrCode('?from=abc123');
    db.throws = true;
    await claimHeldQrCode();
    expect(heldQrCode()).toBe('abc123');
    db.throws = false;
    db.error = { message: 'offline' };
    await claimHeldQrCode();
    expect(heldQrCode()).toBe('abc123');
  });
});

describe("an administrator's codes", () => {
  it('lists them', async () => {
    db.rows = [
      row,
      {
        ...row,
        id: 'q2',
        event_name: null,
        turned_off_at: '2026-10-15T00:00:00Z',
        // A professional's own (20261029100000).
        made_as_partner: true,
      },
    ];
    expect(await fetchMyQrCodes()).toEqual({
      ok: true,
      codes: [
        {
          id: 'q1',
          code: 'abc123',
          eventName: 'Abilities Expo LA',
          contactEmail: 'alfred@example.com',
          createdAt: '2026-10-14T17:00:00Z',
          turnedOffAt: null,
          madeAsPartner: false,
        },
        {
          id: 'q2',
          code: 'abc123',
          eventName: null,
          contactEmail: 'alfred@example.com',
          createdAt: '2026-10-14T17:00:00Z',
          turnedOffAt: '2026-10-15T00:00:00Z',
          madeAsPartner: true,
        },
      ],
    });
  });

  it('makes one, with what it is for, when it expires and its note', async () => {
    db.data = row;
    const expiresAt = new Date('2026-10-31T17:00:00Z');
    const made = await createQrCode({
      organizationId: 'ncs',
      eventName: null,
      contactEmail: null,
      expiresAt,
      notes: 'Monday group',
      madeAs: 'qr',
    });
    expect(made.ok && made.code.code).toBe('abc123');
    await createQrCode({
      organizationId: null,
      eventName: 'Abilities Expo LA',
      contactEmail: 'alfred@example.com',
      expiresAt: null,
      notes: null,
      madeAs: 'link',
    });
    expect(db.calls).toEqual([
      [
        'create_qr_code',
        {
          p_organization: 'ncs',
          p_event_name: null,
          p_contact_email: null,
          p_expires_at: '2026-10-31T17:00:00.000Z',
          p_notes: 'Monday group',
          p_made_as: 'qr',
        },
      ],
      [
        'create_qr_code',
        {
          p_organization: null,
          p_event_name: 'Abilities Expo LA',
          p_contact_email: 'alfred@example.com',
          p_expires_at: null,
          p_notes: null,
          p_made_as: 'link',
        },
      ],
    ]);
  });

  it("passes on the database's refusal", async () => {
    db.error = { message: 'Enter an email address people can write to.' };
    expect(
      await createQrCode({
        organizationId: null,
        eventName: null,
        contactEmail: 'x',
        expiresAt: null,
        notes: null,
        madeAs: 'qr',
      }),
    ).toEqual({
      ok: false,
      error: 'Enter an email address people can write to.',
    });
  });

  it('turns one off', async () => {
    expect(await turnOffQrCode('q1')).toEqual({ ok: true });
    expect(db.calls).toEqual([['turn_off_qr_code', { p_code_id: 'q1' }]]);
    db.error = { message: 'No such code.' };
    expect(await turnOffQrCode('q1')).toEqual({ ok: false, error: 'No such code.' });
  });
});
