import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import DeleteAccountPage from '@/routes/legal/delete-account';
import PrivacyPage from '@/routes/legal/privacy';
import TermsPage from '@/routes/legal/terms';
import { WelcomeScreen } from '@/routes/onboarding/welcome';

/**
 * The legal pages as finished HTML, written into the build by
 * `scripts/prerender-legal.mjs`.
 *
 * Every other path is the same empty shell until the app's JavaScript draws
 * it, and that was true of these: a program that fetched /privacy without
 * running scripts got a page titled "The Sci Club" with nothing in it. Link
 * previews and crawlers are such programs (Twilio's pre-check of the old
 * text-message registration was the first to be caught by it, 2026-10-01). So
 * these paths are served as HTML with their words already in them; the app
 * then starts as usual and draws the same page over it.
 *
 * And /join, kept as a static page because the old registration named it. See
 * `JoinPage`.
 *
 * Not the member pages. Those stay an empty shell on purpose, and keep the
 * noindex this removes from the legal pages and /join (index.html's meta; the
 * site-wide X-Robots-Tag header went on 2026-11-20, as a header cannot be
 * lifted for one path on Netlify).
 */

/** Nothing to do: a press before the app has started is a press on nothing. */
function noop() {
  return undefined;
}

/**
 * /join as a program without JavaScript reads it: the welcome screen, which is
 * what the app paints first anyway, so somebody whose browser does run it sees
 * no jump. It links the Privacy Policy and the Terms. The text-message opt-in
 * form that used to follow it went with the phone sign-in.
 */
function JoinPage() {
  return <WelcomeScreen onJoin={noop} onSignIn={noop} />;
}

export const STATIC_PAGES = [
  { file: 'privacy.html', title: 'Privacy Policy', Page: PrivacyPage, indexed: true },
  { file: 'terms.html', title: 'Terms of Service', Page: TermsPage, indexed: true },
  // Google Play links it from the Data safety form.
  {
    file: 'delete-account.html',
    title: 'Deleting your account',
    Page: DeleteAccountPage,
    indexed: true,
  },
  // Listed since 2026-11-20 (the owner): somebody searching for an SCI
  // community finds the club here and asks for an invite from it.
  {
    file: 'join.html',
    title: 'Join',
    Page: JoinPage,
    indexed: true,
    description:
      'A private community for people living with spinal cord injury: meet peers and mentors, ask what you can’t ask anyone else, and find SCI events. Request an invite to join.',
  },
] as const;

/** For an attribute's value: what would end it or start an entity. */
function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const ROBOTS = /\s*<meta name="robots" content="noindex, nofollow" \/>/;
const TITLE = '<title>The Sci Club</title>';
const ROOT = '<div id="root"></div>';

/**
 * The built index.html with one page written into it. Throws if the shell has
 * changed shape, so a build cannot quietly ship the empty page again.
 */
export function withPage(
  shell: string,
  title: string,
  Page: () => React.ReactElement,
  indexed = true,
  description?: string,
): string {
  if (!ROBOTS.test(shell) || !shell.includes(TITLE) || !shell.includes(ROOT)) {
    throw new Error('index.html no longer has the robots meta, title and root this expects');
  }
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
  return shell
    .replace(ROBOTS, (meta) => (indexed ? '' : meta))
    .replace(
      TITLE,
      `<title>${title} · The Sci Club</title>${
        description ? `<meta name="description" content="${escapeAttribute(description)}" />` : ''
      }`,
    )
    .replace(ROOT, `<div id="root">${markup}</div>`);
}
