import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { Account } from '@/lib/account';
import { AnnounceProvider } from '@/lib/announce';
import type { MyQrCode, NewQrCode } from '@/lib/qr-codes';

const state = vi.hoisted(() => ({
  account: null as Account | null,
  accountEmail: 'alfred@example.com',
  joiningOpen: true,
  /** Organizations the member is an org admin of. */
  mine: new Set<string>(),
  partner: false,
  codes: [] as MyQrCode[],
  created: [] as NewQrCode[],
  turnedOff: [] as string[],
  shared: [] as { url: string; title: string; text: string }[],
  shareOutcome: 'shared',
  createError: null as string | null,
  copied: [] as string[],
  copyWorks: true,
}));

vi.mock('@/lib/account', () => ({ useAccount: () => state.account }));
vi.mock('@/lib/account-email', () => ({
  loadSignInDetails: () => Promise.resolve({ ok: true, details: { email: state.accountEmail } }),
}));
vi.mock('@/lib/joining', () => ({
  fetchJoiningIsOpen: () => Promise.resolve(state.joiningOpen),
}));
vi.mock('@/lib/organization-representatives', () => ({
  useMyOrganizations: () => ({ ids: state.mine, loading: false }),
}));
vi.mock('@/lib/organization-members', () => ({ useMemberOrganizations: () => [] }));
vi.mock('@/lib/club-partners', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIAmPartner: () => state.partner,
}));
vi.mock('@/lib/organizations', () => {
  const ncs = {
    id: 'ncs',
    name: 'NorCal SCI',
    shortCode: 'NCS',
    logoPath: null,
    city: 'Sacramento',
    places: [],
  };
  return {
    useOrganizations: () => ({
      organizations: [ncs],
      byId: new Map([['ncs', ncs]]),
      loading: false,
      error: null,
      reload: () => undefined,
    }),
  };
});
vi.mock('@/lib/qr-codes', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchMyQrCodes: () => Promise.resolve({ ok: true, codes: state.codes }),
  createQrCode: (made: NewQrCode) => {
    state.created.push(made);
    if (state.createError) return Promise.resolve({ ok: false, error: state.createError });
    const code: MyQrCode = {
      id: `new-${state.created.length}`,
      code: 'fresh0code',
      organizationId: made.organizationId,
      eventName: made.eventName,
      contactEmail: made.contactEmail,
      createdAt: '2026-10-28T17:00:00Z',
      expiresAt: made.expiresAt ? made.expiresAt.toISOString() : null,
      notes: made.notes,
      turnedOffAt: null,
      madeAsPartner: made.organizationId === null && state.partner && !state.account?.isAdmin,
    };
    state.codes = [code, ...state.codes];
    return Promise.resolve({ ok: true, code });
  },
  turnOffQrCode: (id: string) => {
    state.turnedOff.push(id);
    state.codes = state.codes.map((c) =>
      c.id === id ? { ...c, turnedOffAt: '2026-10-29T18:00:00Z' } : c,
    );
    return Promise.resolve({ ok: true });
  },
}));
vi.mock('@/lib/share-link', () => ({
  shareLink: (link: { url: string; title: string; text: string }) => {
    state.shared.push(link);
    return Promise.resolve(state.shareOutcome);
  },
  copyWhenReady: async (link: Promise<string | null>) => {
    const url = await link;
    if (url === null) return null;
    state.copied.push(url);
    return { url, copied: state.copyWorks };
  },
}));

const { default: QrCodePage } = await import('@/routes/me/qr-page');

let confirmSpy: MockInstance<typeof window.confirm>;

const HOUR = 3_600_000;
const FAR = new Date(Date.now() + 48 * HOUR).toISOString();

const code = (o: Partial<MyQrCode> = {}): MyQrCode => ({
  id: 'q1',
  code: 'abc123',
  organizationId: null,
  eventName: 'Abilities Expo LA',
  contactEmail: 'alfred@example.com',
  createdAt: '2026-10-28T17:00:00Z',
  expiresAt: FAR,
  notes: null,
  turnedOffAt: null,
  madeAsPartner: false,
  ...o,
});

/** Hours from now to when it expires, to the nearest hour. */
const hoursLeft = (made: NewQrCode | undefined) =>
  made?.expiresAt ? Math.round((made.expiresAt.getTime() - Date.now()) / HOUR) : null;

function renderPage() {
  return render(
    <AnnounceProvider>
      <MemoryRouter initialEntries={['/me/qr']}>
        <Routes>
          <Route path="/me/qr" element={<QrCodePage />} />
          <Route path="/me" element={<h1>Me</h1>} />
          <Route path="/admin" element={<h1>Admin</h1>} />
        </Routes>
      </MemoryRouter>
    </AnnounceProvider>,
  );
}

beforeEach(() => {
  state.account = { status: 'member', userId: 'me', isAdmin: true, displayName: 'Alfred' };
  state.accountEmail = 'alfred@example.com';
  state.joiningOpen = true;
  state.mine = new Set();
  state.partner = false;
  state.codes = [];
  state.created = [];
  state.turnedOff = [];
  state.shared = [];
  state.shareOutcome = 'shared';
  state.createError = null;
  state.copied = [];
  state.copyWorks = true;
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  confirmSpy.mockClear();
});

const asOrgAdmin = () => {
  state.account = { status: 'member', userId: 'me', isAdmin: false, displayName: 'Sam' };
  state.mine = new Set(['ncs']);
};

const pageReady = () => screen.findByRole('button', { name: 'Make the QR code' });

describe('who may make a code', () => {
  it('sends a member who is neither an administrator nor an org admin back to Me', async () => {
    state.account = { status: 'member', userId: 'me', isAdmin: false, displayName: 'Sam' };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Me' })).toBeInTheDocument();
  });

  it('lets an org admin in', async () => {
    asOrgAdmin();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Create QR code or invite link' }),
    ).toBeInTheDocument();
  });
});

// The owner, 2026-10-28: an org admin's code lets their people in until it
// expires, a day unless they choose; no event; an optional note.
describe("an administrator's code", () => {
  it('can be for any organization, not only one they run', async () => {
    renderPage();
    // Not one of theirs, so it is a search rather than in the list (the owner, 2026-11-05).
    await screen.findByLabelText("Who it's for");
    expect(screen.queryByRole('option', { name: 'NorCal SCI' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Or find another organization'), 'norcal');
    await userEvent.click(screen.getByRole('button', { name: /^NorCal SCI/ }));
    expect(screen.getByLabelText("Who it's for")).toHaveValue('ncs');
    await userEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    await waitFor(() => {
      expect(state.created[0]?.organizationId).toBe('ncs');
    });
  });
});

describe("an org admin's code", () => {
  it('is for their organization, with no event and no email to show', async () => {
    asOrgAdmin();
    renderPage();
    expect(await screen.findByText('NorCal SCI')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'At an event' })).toBeNull();
    expect(screen.queryByLabelText('Email shown while joining is closed')).toBeNull();
    expect(
      screen.getByText(/before it expires can join the club, as invited by you/),
    ).toBeInTheDocument();
  });

  it('expires after a day unless they choose otherwise, and keeps the note', async () => {
    asOrgAdmin();
    renderPage();
    expect(await screen.findByRole('checkbox', { name: 'Expires' })).toBeChecked();
    await userEvent.type(screen.getByLabelText('Notes (optional)'), '  Monday group  ');
    await userEvent.click(screen.getByRole('button', { name: 'Make the QR code' }));
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      organizationId: 'ncs',
      eventName: null,
      contactEmail: null,
      notes: 'Monday group',
    });
    expect(hoursLeft(state.created[0])).toBe(24);
    const shown = await screen.findByRole('dialog', { name: 'NorCal SCI' });
    expect(within(shown).getByText(/Made .* · expires /)).toBeInTheDocument();
  });

  it('can last 7 days, or until it is turned off', async () => {
    asOrgAdmin();
    renderPage();
    await userEvent.selectOptions(await screen.findByLabelText('Expires after'), 'After 7 days');
    await userEvent.click(screen.getByRole('button', { name: 'Make the QR code' }));
    expect(hoursLeft(state.created[0])).toBe(168);
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Expires' }));
    expect(screen.getByText('It works until you turn it off.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make the QR code' }));
    expect(state.created[1]?.expiresAt).toBeNull();
  });

  // The owner, 2026-10-28: a link, made and copied in one press.
  it('makes a link and copies it, saying until when it works', async () => {
    asOrgAdmin();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));
    expect(state.created[0]?.organizationId).toBe('ncs');
    expect(state.copied).toEqual([`${window.location.origin}/join?from=fresh0code`]);
    const note = await screen.findByText(/^Link copied\. It works until /);
    expect(note).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/join?from=fresh0code`)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the link to copy by hand where the clipboard refuses', async () => {
    asOrgAdmin();
    state.copyWorks = false;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));
    expect(await screen.findByText(/^Link made\. Copy it to share it:/)).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/join?from=fresh0code`)).toBeInTheDocument();
  });

  it('says why no link was made', async () => {
    asOrgAdmin();
    state.createError = 'Only that organization’s admins can make its codes.';
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only that organization');
    expect(state.copied).toEqual([]);
  });

  it('warns of nothing while the club is invite only: it lets them in', async () => {
    asOrgAdmin();
    state.joiningOpen = false;
    renderPage();
    await screen.findByText('You have not made a code yet.');
    expect(screen.queryByText('Joining is invite only right now.')).toBeNull();
  });
});

describe("an administrator's code", () => {
  it('makes one with no event by default, expiring in a day', async () => {
    renderPage();
    await userEvent.click(await pageReady());
    expect(state.created[0]).toMatchObject({
      organizationId: null,
      eventName: null,
      contactEmail: null,
      notes: null,
    });
    expect(hoursLeft(state.created[0])).toBe(24);
    expect(await screen.findByRole('dialog', { name: 'The SCI Club' })).toBeInTheDocument();
  });

  it('wants an event name when At an event is chosen, and shows it', async () => {
    renderPage();
    await pageReady();
    await userEvent.click(screen.getByRole('radio', { name: 'At an event' }));
    const make = screen.getByRole('button', { name: 'Make the QR code' });
    expect(make).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Event name'), '  Abilities Expo LA ');
    await userEvent.click(make);
    expect(state.created[0]?.eventName).toBe('Abilities Expo LA');
    const shown = await screen.findByRole('dialog', { name: 'Abilities Expo LA' });
    expect(
      within(shown).getByRole('img', { name: "QR code that opens the club's join page" }),
    ).toBeInTheDocument();
    expect(within(shown).getByText(/invited by Alfred/)).toBeInTheDocument();
  });

  it('chooses an organization of theirs, or none', async () => {
    state.mine = new Set(['ncs']);
    renderPage();
    const which = await screen.findByLabelText("Who it's for");
    expect(which).toHaveValue('ncs');
    await userEvent.selectOptions(which, 'No organization');
    await userEvent.click(screen.getByRole('button', { name: 'Make the QR code' }));
    expect(state.created[0]?.organizationId).toBeNull();
  });

  it('says why the database refused it', async () => {
    state.createError = 'Keep the note to 300 characters.';
    renderPage();
    await userEvent.click(await pageReady());
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep the note');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// The owner, 2026-11-19: people who scanned their code were sent to ask them
// for an invite. An administrator's code lets them in as any other does, and
// asks for no email to show (20261119130000).
describe('while joining is invite only', () => {
  it("says an administrator's code lets people in, and asks for no email", async () => {
    state.joiningOpen = false;
    renderPage();
    await screen.findByText('You have not made a code yet.');
    expect(screen.queryByText('Joining is invite only right now.')).toBeNull();
    expect(screen.queryByLabelText('Email shown while joining is closed')).toBeNull();
    expect(
      screen.getByText(/before it expires can join the club, as invited by you/),
    ).toBeInTheDocument();
  });
});

describe('sharing it', () => {
  it('shares the same address the code opens', async () => {
    state.codes = [code()];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share the link' }));
    expect(state.shared).toEqual([
      {
        url: `${window.location.origin}/join?from=abc123`,
        title: 'The SCI Club',
        text: 'Alfred invited you to The SCI Club.',
      },
    ]);
  });

  it('says the link was copied where there is no share sheet', async () => {
    state.codes = [code()];
    state.shareOutcome = 'copied';
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share the link' }));
    expect(await screen.findByText('Link copied.', { selector: 'p' })).toBeInTheDocument();
  });

  it('closes with Done', async () => {
    state.codes = [code()];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the list of codes', () => {
  it('lists each with when it was made, when it expires and its note, and turns one off after asking', async () => {
    state.codes = [
      code({ notes: 'Monday group' }),
      code({
        id: 'q2',
        eventName: null,
        code: 'def456',
        organizationId: 'ncs',
        contactEmail: null,
      }),
    ];
    renderPage();
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Abilities Expo LA')).toBeInTheDocument();
    expect(within(list).getByText('NorCal SCI')).toBeInTheDocument();
    expect(within(list).getByText('Monday group')).toBeInTheDocument();
    expect(within(list).getAllByText(/^Made Oct 28, 2026, .* · expires /)).toHaveLength(2);
    const [first] = screen.getAllByRole('button', { name: 'Turn off' });
    if (!first) throw new Error('no Turn off');
    await userEvent.click(first);
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(state.turnedOff).toEqual(['q1']);
    expect(await screen.findByText(/turned off Oct 29/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Turn off' })).toHaveLength(1);
  });

  it('turns nothing off on Cancel', async () => {
    state.codes = [code()];
    confirmSpy.mockReturnValue(false);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(state.turnedOff).toEqual([]);
  });

  it('offers nothing on a code turned off or expired', async () => {
    state.codes = [
      code({ turnedOffAt: '2026-10-29T18:00:00Z' }),
      code({ id: 'q2', expiresAt: '2026-10-20T18:00:00Z' }),
    ];
    renderPage();
    expect(await screen.findByText(/turned off Oct 29/)).toBeInTheDocument();
    expect(screen.getByText(/expired Oct 20/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });
});

// A professional's own code, with no organization, lets people in
// (20261029100000).
describe("a professional's own code", () => {
  const asPartner = () => {
    state.account = { status: 'member', userId: 'me', isAdmin: false, displayName: 'Bobby' };
    state.partner = true;
  };

  it('lets a partner in, with no organization and no email to show', async () => {
    asPartner();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Create QR code or invite link' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Your own code, as staff')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email shown while joining is closed')).toBeNull();
    expect(
      screen.getByText(/before it expires can join the club, as invited by you/),
    ).toBeInTheDocument();
  });

  it('warns of nothing while the club is invite only: it lets them in', async () => {
    asPartner();
    state.joiningOpen = false;
    renderPage();
    await screen.findByRole('heading', { name: 'Create QR code or invite link' });
    await waitFor(() => {
      expect(screen.queryByText('Joining is invite only right now.')).toBeNull();
    });
  });

  it('makes one for no organization, without an email, and lists it as their own', async () => {
    asPartner();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Make the QR code' }));
    expect(state.created[0]).toMatchObject({ organizationId: null, contactEmail: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Your own code')).toBeInTheDocument();
  });

  it('offers their organizations, or just themselves, to a partner who is also an org admin', async () => {
    asPartner();
    state.mine = new Set(['ncs']);
    renderPage();
    const who = await screen.findByLabelText("Who it's for");
    expect(within(who).getByRole('option', { name: 'Just you, as staff' })).toBeInTheDocument();
    expect(within(who).getByRole('option', { name: 'NorCal SCI' })).toBeInTheDocument();
  });
});
