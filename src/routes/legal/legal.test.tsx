import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Privacy Policy and the Terms of Service, through the real routes and
 * signed out: somebody reading them before joining has no account.
 */

vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: 'signed-out', userId: null, isAdmin: false, displayName: null }),
  signOut: () => Promise.resolve({ ok: true }),
}));
vi.mock('@/routes/onboarding/page', () => ({ default: () => <h1>Join</h1> }));

const { default: App, preloadPublicPage } = await import('@/App');
await Promise.all(
  ['/privacy', '/terms', '/delete-account']
    .map(preloadPublicPage)
    .filter((page) => page !== undefined),
);
const { PRIVACY_UPDATED, TERMS_UPDATED } = await import('@/lib/terms');

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('the Privacy Policy', () => {
  it('opens with no account, rather than sending the reader to join', () => {
    open('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Join' })).toBeNull();
  });

  // The owner, 2026-10-22: the club is no longer run by Able Bodied Inc.
  it('names who runs the club, and no nonprofit', () => {
    open('/privacy');
    expect(screen.getAllByText(/operated by Alfred Shaheen/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/run by Able Bodied|nonprofit/);
  });

  // The owner, 2026-11-03: Privacy has its own date, not the Terms'.
  it('shows its own date, the same as its newest note', () => {
    open('/privacy');
    expect(screen.getByText(`Last updated ${PRIVACY_UPDATED}`)).toBeInTheDocument();
    const newest = screen.getAllByRole('heading', { name: /What changed on/ })[0];
    expect(newest).toHaveTextContent(`What changed on ${PRIVACY_UPDATED}`);
  });

  // The note names no earlier operator (the owner, 2026-10-26).
  it('says up top what changed, and names no earlier operator', () => {
    open('/privacy');
    const notes = screen
      .getAllByRole('heading', { name: /What changed on/ })
      .map((heading) => heading.parentElement?.textContent ?? '');
    // 2026-11-16: verified professionals are now staff, of an organization.
    expect(notes[0]).toMatch(/Changed: verified professionals are now called staff/);
    // 2026-11-14: organization events open by link, invite lists, and invite emails tracked.
    expect(notes[1]).toMatch(/Changed: an event for the members of chosen organizations can again/);
    expect(notes[1]).toMatch(/Added: administrators and event organizers can invite a list/);
    expect(notes[1]).toMatch(/Added: an invite email carries a tiny picture/);
    expect(notes[2]).toMatch(
      /Added: a member who joined as a relative or spouse and another member can link/,
    );
    expect(notes[2]).toMatch(/Changed: Cloudflare now counts visits to every page of the website/);
    expect(notes[2]).toMatch(/Added: everyone invited to an invite-only event sees who else/);
    expect(notes[3]).toMatch(
      /Changed: an org admin or a verified professional can connect two or more/,
    );
    expect(notes[3]).toMatch(/Added: an event can be private/);
    expect(notes[3]).toMatch(/Added: Cloudflare counts visits to the website’s public pages/);
    expect(notes[4]).toMatch(/Changed: a notification of a group message now names the group/);
    expect(notes[4]).toMatch(/Changed: a busy conversation notifies you at most once every two/);
    expect(notes[5]).toMatch(/Added: the app measures how long it takes to load/);
    expect(notes[5]).toMatch(/Added: an event’s organizers can invite somebody who registered/);
    expect(notes[5]).toMatch(/Changed: trusted partners are now called verified professionals/);
    expect(notes[6]).toMatch(/Added: you can measure distances in Filters from another city/);
    expect(notes[7]).toMatch(/Added: once a day, on each way you use the club/);
    expect(notes[8]).toMatch(/Changed: an org admin or a trusted partner can connect two members/);
    expect(notes[9]).toMatch(/Changed: Join replaces Follow/);
    expect(notes[10]).toMatch(/Added: when you agreed/);
    expect(notes[11]).toMatch(/Added: address suggestions/);
    expect(notes[12]).toMatch(/Added: the map/);
    for (const note of notes) expect(note).not.toMatch(/Able Bodied/);
    expect(notes.join(' ')).toMatch(/Removed: signing in by text message/);
  });

  it('says it sells nothing, shows no ads and tracks nobody across apps', () => {
    open('/privacy');
    expect(
      screen.getByText(
        'We do not sell your information. There is no advertising in the club, and we do not track you across other apps or websites.',
      ),
    ).toBeInTheDocument();
  });

  it('says what the camera, photos and location are used for, and that OpenStreetMap gets a ZIP or position', () => {
    open('/privacy');
    const section = screen.getByRole('heading', {
      name: /camera, photos and location/,
    }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/only when you choose to add a photograph/);
    expect(section).toHaveTextContent(/only if you ask for it, while joining/);
    expect(section).toHaveTextContent(
      /send the ZIP code, or your device’s position, to OpenStreetMap/,
    );
    expect(section).toHaveTextContent(/The position is not kept/);
    expect(section).toHaveTextContent(/The ZIP code is kept, and only you can see it/);
  });

  it('says links are fetched by the club, and YouTube hears of a video only on play', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Links and videos' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/the club’s own server visits that page once/);
    expect(section).toHaveTextContent(/your phone contacts nobody when you read it/);
    expect(section).toHaveTextContent(/YouTube receives anything only when you press play/);
  });

  it('names Apple and Google as notification services', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Notifications' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/Apple’s on an iPhone/);
    expect(section).toHaveTextContent(/Google’s on Android/);
  });

  // APNs payloads are not end-to-end encrypted, unlike web push (HANDOFF).
  it('says the iPhone app’s notifications go through Apple, who could read them, and badge the icon', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Notifications' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/through Apple Push Notification service/);
    expect(section).toHaveTextContent(/a token for your iPhone/);
    expect(section).toHaveTextContent(/so Apple\s+could read them on the way/);
    expect(section).toHaveTextContent(/how many kinds of\s+notification you have not opened yet/);
  });

  // 20261105160000.
  it('says a busy conversation notifies at most every two minutes, and not while open', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Notifications' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(
      /at most one notification every two minutes while it stays unread, saying how many messages are new, and none while you have it open/,
    );
  });

  it('says a like or a reaction tells the author who', () => {
    open('/privacy');
    expect(
      screen.getByText(/reacting to a post or a message tells its author who you are/),
    ).toBeInTheDocument();
  });

  // 20261029070000.
  it('says a mention tells the member who, once a post, and never across a block', () => {
    open('/privacy');
    expect(screen.getByText(/and so\s+does mentioning a member in a post/)).toBeInTheDocument();
    const section = screen.getByRole('heading', { name: 'Notifications' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/mentions your username in a post, you are told who/);
    expect(section).toHaveTextContent(/Not by somebody you blocked or who blocked you/);
    expect(section).toHaveTextContent(/Mentions in conversations notify nobody/);
  });

  // public/embed/youtube.html: YouTube refuses to play inside the app.
  it('says the iPhone app plays YouTube through the club’s embed page', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Links and videos' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/thesciclub\.com\/embed\//);
  });

  // lib/google-photo.ts: copied only on a tap.
  it('says the Google photo is copied only if the member chooses it', () => {
    open('/privacy');
    const item = screen.getByText(/Your Google photo, only if you choose it/).closest('li');
    expect(item).toHaveTextContent(/copied to the club only if you press Use my Google photo/);
  });

  // 20261022160000 and 20261022170000.
  it('says why Apple’s token is kept, and that Apple tells the club about the account', () => {
    open('/privacy');
    const item = screen.getByText('If you sign in with Apple:').closest('li');
    expect(item).toHaveTextContent(/kept only so we can ask Apple to\s+end/);
    expect(item).toHaveTextContent(/deleted your\s+Apple Account/);
    const deleting = screen.getByRole('heading', { name: 'Deleting your account' }).parentElement;
    if (!deleting) throw new Error('no section');
    expect(deleting).toHaveTextContent(/we also ask Apple to end the club’s Sign in with Apple/);
  });

  // 20261022190000: event_guest_list, and what stays after deletion.
  it('says who sees a public event’s list, that it is not the host’s sign-up, and that it outlives an account', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Event hosts' }).parentElement;
    const deleting = screen.getByRole('heading', { name: 'Deleting your account' }).parentElement;
    if (!section || !deleting) throw new Error('no section');
    expect(section).toHaveTextContent(
      /administrators and anybody in the club who manages that event/,
    );
    expect(section).toHaveTextContent(/It\s+does not register you with the host/);
    expect(section).toHaveTextContent(/whether the address\s+belongs to a member/);
    expect(deleting).toHaveTextContent(/stays until 90 days after the event/);
  });

  // 20261022220000: the sender and the event are kept; the other guests never.
  it('says what a calendar invitation keeps', () => {
    open('/privacy');
    const item = screen.getByText('If you add an event by calendar invitation').closest('li');
    expect(item).toHaveTextContent(/the address it came from/);
    expect(item).toHaveTextContent(/Its other guests are never kept/);
  });

  // The owner, 2026-10-16 and 2026-10-20: Stats may name members.
  it('says what administrators see, Stats included', () => {
    open('/privacy');
    const section = screen.getByRole('heading', {
      name: 'What administrators can see',
    }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/blocks: who blocked whom/);
    expect(section).toHaveTextContent(/who has read each post and when/);
    expect(section).toHaveTextContent(/on a phone or\s+tablet, or a computer/);
  });

  // Google Play requires a way to ask for deletion without the app.
  it('says how to delete an account in the app and by email, and how long things are kept', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Deleting your account' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/Me → Account → Delete my account/);
    expect(section).toHaveTextContent(/email hello@thesciclub\.com to ask us to delete/);
    const kept = screen.getByRole('heading', { name: 'How long we keep it' }).parentElement;
    if (!kept) throw new Error('no section');
    expect(kept).toHaveTextContent(/after 90 days/);
    expect(kept).toHaveTextContent(/Your notifications list: 30 days/);
  });

  // The owner, 2026-10-22: a deleted member's profile report keeps only the words.
  it('says a profile report keeps the words, and not the name or photograph, after deletion', () => {
    open('/privacy');
    const admins = screen.getByRole('heading', {
      name: 'What administrators can see',
    }).parentElement;
    const kept = screen.getByRole('heading', { name: 'How long we keep it' }).parentElement;
    const deleting = screen.getByRole('heading', { name: 'Deleting your account' }).parentElement;
    if (!admins || !kept || !deleting) throw new Error('no section');
    expect(admins).toHaveTextContent(/a copy of a reported profile as it was then/);
    expect(kept).toHaveTextContent(
      /a report of their profile keeps only what they wrote: their name, @username and photograph go/,
    );
    expect(deleting).toHaveTextContent(
      /A report of your profile keeps what you wrote on it, but your name, @username and photograph go from it/,
    );
  });

  it('says email and phone number are not sold or shared for marketing', () => {
    open('/privacy');
    expect(
      screen.getByText(
        'We do not sell or share your email address or phone number with third parties for marketing or promotional purposes.',
      ),
    ).toBeInTheDocument();
  });

  it('says what it emails, and nothing else', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Emails' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/code and link that confirm your address/);
    expect(section).toHaveTextContent(/the day before an event you are going to/);
    expect(section).toHaveTextContent(/do not send newsletters or promotions/);
  });

  it('says a phone number is optional, for event hosts, and never signs anybody in', () => {
    open('/privacy');
    const item = screen.getByText(/A phone number, only if you add one/).closest('li');
    expect(item).toHaveTextContent(/It is never used to sign you in\./);
  });

  // Kinds of infrastructure provider, not which companies (the owner,
  // 2026-10-03); the ones a member meets in the app are named.
  it('says what kinds of provider receive information, naming only those a member meets', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Service providers' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/hosting, our database, file storage and sign-in/);
    expect(section).toHaveTextContent(/location lookup \(OpenStreetMap\)/);
    const page = document.body.textContent;
    for (const company of ['Supabase', 'Twilio', 'Netlify', 'Resend', 'GitHub']) {
      expect(page).not.toContain(company);
    }
  });

  // 2026-10-28: only administrators and organization accounts type addresses.
  it('says what goes to Photon for address suggestions, and that members’ information never does', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Service providers' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(
      /address suggestions \(Komoot’s Photon service, which searches OpenStreetMap\): when an administrator or an organization account types a location’s street address, what they type is sent to Photon/,
    );
    expect(section).toHaveTextContent(/Members’ information is never sent to it/);
  });

  // The owner, 2026-10-08: an event's host receives the phone numbers of the
  // members going. The policy has to say so, plainly, and never for marketing.
  it('says an event host receives the email, and the phone if given, of a member going, and only for that', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Event hosts' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/receives your email address, and your phone number if you/);
    expect(section).toHaveTextContent(/for that event only/);
    expect(section).toHaveTextContent(/Choosing Interested shares nothing/);
    expect(section).toHaveTextContent(/not to use your details for marketing/);
    expect(screen.queryByText(/It is never shared outside the club/)).toBeNull();
  });

  // The owner, 2026-10-22: joining offers Relative/Spouse.
  it('says the club is for family members too, on both pages', () => {
    for (const path of ['/privacy', '/terms']) {
      open(path);
      expect(document.body.textContent).toMatch(
        /adults living with spinal cord\s+injury and their family members/,
      );
      cleanup();
    }
  });

  // The owner, 2026-10-22: the club lists grants and helps with none.
  it('says the club lists grants, shares nothing with grant-makers, and helps with no application', () => {
    open('/privacy');
    const section = screen.getByRole('heading', { name: 'Grants' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/We do not help with applications/);
    expect(section).toHaveTextContent(/we share nothing about you with grant-makers/);
    expect(document.body.textContent).not.toMatch(/If you ask us to help/);
  });

  // 20261022100000 and supabase/tests/sign-in-log-forgotten.sql.
  it('says deleting erases sign-in records, and invites last until used or withdrawn', () => {
    open('/privacy');
    const deleting = screen.getByRole('heading', { name: 'Deleting your account' }).parentElement;
    const kept = screen.getByRole('heading', { name: 'How long we keep it' }).parentElement;
    if (!deleting || !kept) throw new Error('no section');
    expect(deleting).toHaveTextContent(/your\s+sign-in records with their email and IP addresses/);
    expect(kept).toHaveTextContent(/invites do not expire/);
    expect(kept).toHaveTextContent(/withdrawn by whoever sent it or an administrator/);
  });

  it('links to the Terms of Service', () => {
    open('/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });
});

describe('the Terms of Service', () => {
  // From the owner's read of another club's terms, 2026-10-28.
  it('says the account is yours alone, what else is not allowed, and that the club is as it is', () => {
    open('/terms');
    expect(screen.getByText(/Do not share, sell or hand over your account/)).toBeInTheDocument();
    expect(
      screen.getByText(/by copying them out or with a script, bot or scraper/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/do not join again under another name or email address/),
    ).toBeInTheDocument();
    const section = screen.getByRole('heading', { name: 'The club as it is' }).parentElement;
    expect(section).toHaveTextContent(/cannot promise it will always be available/);
  });

  it('opens with no account', () => {
    open('/terms');
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
  });

  it('shows the Terms’ own date', () => {
    open('/terms');
    expect(screen.getByText(`Last updated ${TERMS_UPDATED}`)).toBeInTheDocument();
  });

  it('names who runs the club, and no nonprofit', () => {
    open('/terms');
    expect(screen.getAllByText(/operated by\s+Alfred Shaheen/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Able Bodied|nonprofit/);
  });

  // The rulebook the owner approved (2026-11-20): what ends a membership at
  // once, and the five strike rules by name.
  it('lists what ends a membership at once, and what is a strike', () => {
    open('/terms');
    const section = screen.getByRole('heading', { name: 'Losing your membership' }).parentElement;
    if (!section) throw new Error('no section');
    for (const rule of [
      'Threatening anyone.',
      'Scams, or asking members for money for yourself.',
    ]) {
      expect(within(section).getByText(rule)).toBeInTheDocument();
    }
    for (const name of [
      'Harassment.',
      'Medical claims as fact.',
      'Selling or advertising outside the Marketplace.',
      'Spam.',
      'Careless sharing.',
    ]) {
      expect(within(section).getByText(name)).toBeInTheDocument();
    }
    expect(section).not.toHaveTextContent(/Repeating outside a room/);
  });

  // Apple 1.2 and Google Play's UGC policy.
  it('defines objectionable content, with zero tolerance and a 24-hour review', () => {
    open('/terms');
    const section = screen.getByRole('heading', { name: 'What is not allowed' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/Objectionable content is anything that/);
    expect(section).toHaveTextContent(/threatens, harasses, bullies/);
    expect(section).toHaveTextContent(
      'The club has zero tolerance for objectionable content and for abusive members.',
    );
    expect(
      screen.getByText('We review every report within 24 hours and act on it.'),
    ).toBeInTheDocument();
  });

  it('says how to report and how to block, and that content and membership can go', () => {
    open('/terms');
    const section = screen.getByRole('heading', { name: 'Reporting and blocking' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/To report a message, a post or a reply, press the •••/);
    expect(section).toHaveTextContent(/To report a member’s profile, press the ••• on it/);
    expect(section).not.toHaveTextContent(/such as a member’s profile, email/);
    expect(section).toHaveTextContent(/To block a member, press the •••/);
    expect(section).toHaveTextContent(/Me → Settings → Blocked members/);
    expect(screen.getByText(/We may remove anything that breaks these terms/)).toHaveTextContent(
      /pause a membership, or end it/,
    );
  });

  // Apple 1.4.1 and Google Play's health apps policy.
  it('says nothing in the club is medical advice, and to call 911 in an emergency', () => {
    open('/terms');
    const section = screen.getByRole('heading', { name: 'Not medical advice' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/nothing here is medical advice/);
    expect(section).toHaveTextContent(/check with your own doctor or care team/);
    expect(section).toHaveTextContent('In an emergency, call 911.');
  });

  it('asks for an email address on the list, not a phone number', () => {
    open('/terms');
    expect(screen.getByText(/puts your email address on the club’s list/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/phone number on the/);
  });

  it('says what it emails', () => {
    open('/terms');
    const section = screen.getByRole('heading', { name: 'Email' }).parentElement;
    if (!section) throw new Error('no section');
    const s = within(section);
    expect(s.getByText('What the club emails you.').tagName).toBe('B');
    expect(s.getByRole('link', { name: 'hello@thesciclub.com' })).toHaveAttribute(
      'href',
      'mailto:hello@thesciclub.com',
    );
    expect(s.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});

// Google Play: a public page, naming the app, that asks for deletion without it.
describe('Deleting your account', () => {
  it('opens with no account and names the app', () => {
    open('/delete-account');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Deleting your account' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Join' })).toBeNull();
    expect(screen.getByText(/in The SCI Club, and what that erases/)).toBeInTheDocument();
  });

  it('gives the steps in the app', () => {
    open('/delete-account');
    const section = screen.getByRole('heading', { name: 'In the app' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/Go to Me, then the Account tab/);
    expect(section).toHaveTextContent(/Press Delete my account/);
  });

  it('gives an email route for somebody who cannot sign in', () => {
    open('/delete-account');
    const section = screen.getByRole('heading', { name: 'By email' }).parentElement;
    if (!section) throw new Error('no section');
    expect(section).toHaveTextContent(/If you cannot sign in, or no longer have the app/);
    expect(within(section).getByRole('link', { name: 'hello@thesciclub.com' })).toHaveAttribute(
      'href',
      'mailto:hello@thesciclub.com?subject=Delete%20my%20account',
    );
  });

  it('says what is erased and what stays', () => {
    open('/delete-account');
    const erased = screen.getByRole('heading', { name: 'What is erased' }).parentElement;
    const stays = screen.getByRole('heading', { name: 'What stays' }).parentElement;
    if (!erased || !stays) throw new Error('no section');
    expect(erased).toHaveTextContent(/email address, phone number, photograph and birthday/);
    expect(erased).toHaveTextContent(/Your sign-in records, with the email and IP addresses/);
    expect(stays).toHaveTextContent(/“Deleted member” instead of your name/);
    expect(stays).toHaveTextContent(
      /A report of your profile keeps what you wrote on it; your name, @username and photograph go from it/,
    );
    expect(stays).toHaveTextContent(/A registration on an event’s public page, until 90 days/);
    expect(erased).toHaveTextContent(/we also ask Apple to end the club’s\s+Sign in with Apple/);
  });

  it('is linked from the Privacy Policy and the Terms', () => {
    for (const path of ['/privacy', '/terms']) {
      open(path);
      // Contents has a link of the same name, to the section on this page.
      const links = screen.getAllByRole('link', { name: 'Deleting your account' });
      expect(links.map((link) => link.getAttribute('href'))).toContain('/delete-account');
      cleanup();
    }
  });
});

// The owner, 2026-10-28.
describe('Contents', () => {
  it('links to every section of both pages, in order', () => {
    for (const path of ['/privacy', '/terms']) {
      open(path);
      const contents = screen.getByRole('navigation', { name: 'Contents' });
      const links = within(contents).getAllByRole('link');
      const sections = [...document.querySelectorAll('main section[id]')];
      expect(links.map((link) => link.getAttribute('href'))).toEqual(
        sections.map((section) => `#${section.id}`),
      );
      expect(links.length).toBeGreaterThan(8);
      cleanup();
    }
  });
});

describe('the Privacy Policy, on HIPAA, safety and rights', () => {
  it('says HIPAA does not cover the club, what happens if information is exposed, and how to ask', () => {
    open('/privacy');
    expect(screen.getByText(/so HIPAA, the US health privacy law,/)).toBeInTheDocument();
    const safe = screen.getByRole('heading', { name: 'Keeping it safe' }).parentElement;
    expect(safe).toHaveTextContent(
      /If we learn that your information has been exposed, we\s+will tell you/,
    );
    const rights = screen.getByRole('heading', { name: 'Your rights' }).parentElement;
    expect(rights).toHaveTextContent(/It costs nothing/);
    expect(rights).toHaveTextContent(/nothing to opt out of/);
  });
});

// 20261029100000.
describe('staff', () => {
  it('says who they are, what they see, and that nobody is asked first', () => {
    open('/privacy');
    const who = screen.getByRole('heading', { name: 'Who can see what' }).parentElement;
    expect(who).toHaveTextContent(
      /Staff work with people with spinal cord injuries at an organization/,
    );
    expect(who).toHaveTextContent(/cannot read conversations they are not in/);
    expect(who).toHaveTextContent(/You\s+are not asked first/);
    expect(who).toHaveTextContent(/You can\s+leave it, block or report anyone in it/);
    expect(who).toHaveTextContent(/Org admins see the same about the people they invited/);
    expect(who).toHaveTextContent(/except an address they\s+sent an invite to themselves/);
    expect(document.body.textContent).toMatch(/that alone makes nobody a partner/);
  });

  it('are in the Terms, with what they can do', () => {
    open('/terms');
    expect(document.body.textContent).toMatch(/We may make a member who works with people/);
    expect(document.body.textContent).toMatch(
      /shown with a verified mark, the organization\s+and the profession they write/,
    );
    expect(document.body.textContent).toMatch(
      /Connecting adds them to a group conversation without\s+asking them first, and anyone can\s+leave it/,
    );
  });
});
