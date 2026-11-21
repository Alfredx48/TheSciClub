import { describe, expect, it } from 'vitest';
import { STATIC_PAGES, withPage } from '@/routes/legal/static';
import shell from '../../../index.html?raw';

/**
 * What a program that does not run JavaScript gets from /privacy and /terms:
 * the real index.html with the page written into it: a link preview or a
 * crawler reads the title and the words without running the app.
 */

const privacy = STATIC_PAGES.find((p) => p.file === 'privacy.html');
const terms = STATIC_PAGES.find((p) => p.file === 'terms.html');
const join = STATIC_PAGES.find((p) => p.file === 'join.html');
const deletion = STATIC_PAGES.find((p) => p.file === 'delete-account.html');
if (!privacy || !terms || !join || !deletion) throw new Error('a static page is missing');

describe('the static Privacy Policy', () => {
  const html = withPage(shell, privacy.title, privacy.Page);

  it('is titled Privacy Policy', () => {
    expect(html).toContain('<title>Privacy Policy · The Sci Club</title>');
    expect(html).not.toContain('<title>The Sci Club</title>');
  });

  it('carries the no-marketing sentence and the brand in the HTML itself', () => {
    expect(html).toContain(
      'We do not sell or share your email address or phone number with third parties for marketing or promotional purposes.',
    );
    expect(html).toContain('operated by Alfred Shaheen');
    expect(html).not.toContain('run by Able Bodied');
  });

  it('carries what changed, and no text-message sign-in, in the HTML itself', () => {
    expect(html).toContain('What changed on');
    expect(html).not.toContain('Message and data rates may apply.');
  });

  it('is not marked noindex, and still starts the app', () => {
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('<script type="module"');
  });
});

describe('the static Terms of Service', () => {
  const html = withPage(shell, terms.title, terms.Page);

  it('is titled Terms of Service and has no text-message terms', () => {
    expect(html).toContain('<title>Terms of Service · The Sci Club</title>');
    expect(html).not.toContain('Carriers are not liable');
    expect(html).not.toContain('Text STOP');
    expect(html).toContain('What the club emails you.');
  });
});

// Google Play reads it from the Data safety form, without the app.
describe('the static account-deletion page', () => {
  const html = withPage(shell, deletion.title, deletion.Page, deletion.indexed);

  it('is titled, indexed, and carries the steps and the email route in the HTML itself', () => {
    expect(html).toContain('<title>Deleting your account · The Sci Club</title>');
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('Open The SCI Club and sign in.');
    expect(html).toContain('Delete my account');
    expect(html).toContain('mailto:hello@thesciclub.com?subject=Delete%20my%20account');
  });
});

/** The first screen of /join, readable without running the app. */
describe('the static join page', () => {
  const html = withPage(shell, join.title, join.Page, join.indexed, join.description);

  it('links the Privacy Policy and the Terms from the first screen', () => {
    expect(html).toContain('Join the club');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it('no longer carries the text-message sign-in form', () => {
    expect(html).not.toContain('Text me my code');
    expect(html).not.toContain('sms-consent');
  });

  // Found by a search for an SCI community (the owner, 2026-11-20).
  it('is listed for search, with a description, and still starts the app', () => {
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('<meta name="description" content="A private community');
    expect(html).toContain('<script type="module"');
  });
});

describe('a shell that has changed shape', () => {
  it('stops the build rather than writing an empty page', () => {
    const changed = shell.replace('<div id="root"></div>', '<div id="app"></div>');
    expect(() => withPage(changed, privacy.title, privacy.Page)).toThrow();
  });
});

// The old Netlify address sends people to thesciclub.com from inside the page
// (index.html), and the static pages carry the same shell, so they do too.
describe('the old Netlify address', () => {
  it('moves a reader of the static privacy page to thesciclub.com', () => {
    const html = withPage(shell, privacy.title, privacy.Page);
    expect(html).toContain("location.hostname === 'thesciclub.netlify.app'");
    expect(html).toContain("'https://thesciclub.com' + location.pathname");
  });
});
