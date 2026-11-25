// What the change log (admin/changes.mjs) works out without git: the week a release falls in,
// the part of the club a change touched, and what a change's own entry says. Apart from the
// script so that it can be tested (admin/changes-lib.test.ts).

const ZONE = 'America/Los_Angeles';

/** Who a commit's author is, as the club knows them. */
const PEOPLE = { 'anatol-AbleBodied': 'Wojtek', 'Alfred Shaheen': 'Alfred', Alfredx48: 'Alfred' };
export const person = (name) => PEOPLE[name] ?? name;

/** The Pacific calendar day of a moment: '2026-11-24'. A release at 11 PM is that day's. */
export function pacificDay(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The Monday of a day's week. Weeks run Monday to Sunday. */
export function weekOf(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** A commit's first line without the "(the owner, 2026-11-20)" it ends with, and not too long. */
export function plainTitle(subject) {
  const text = subject.replace(/\s*\((the owner|screenshot review|the test site)[^)]*\)\s*$/i, '');
  if (text.length <= 240) return text;
  // Cut between words, and not in the middle of something in brackets.
  const cut = text
    .slice(0, 240)
    .replace(/\s+\S*$/, '')
    .replace(/\s*\([^)]*$/, '');
  return `${cut.replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * The parts of the club, in the order By surface lists them. The first seven are what a member
 * sees; the rest are named when a change touched none of those.
 */
export const SURFACES = [
  'Home',
  'Peers',
  'Chat',
  'Events',
  'Me',
  'Joining',
  'Notifications',
  'Admin',
  'iPhone app',
  'Whole app',
  'Database',
  'Behind the scenes',
];

/** Which part a file belongs to: the first rule its path matches. */
const RULES = [
  [/^src\/(routes|lib)\/home/, 'Home'],
  [/^src\/routes\/(peers|profile|map|introductions)\//, 'Peers'],
  [/^src\/lib\/(peers|blocks|directory)/, 'Peers'],
  [/^src\/routes\/(chat|strikes)\//, 'Chat'],
  [/^src\/lib\/chat\//, 'Chat'],
  [/^src\/routes\/(events|public-event|reviews)\//, 'Events'],
  [/^src\/lib\/(events|calendar|reviews)/, 'Events'],
  [/^supabase\/functions\/(event|calendar)/, 'Events'],
  [/^src\/routes\/(me|wheelies)\//, 'Me'],
  [/^src\/lib\/wheelies/, 'Me'],
  [/^src\/routes\/(notifications)\//, 'Notifications'],
  [/^src\/lib\/(push|notifications)/, 'Notifications'],
  [/^supabase\/functions\/(push|notify|email-digest)/, 'Notifications'],
  [
    /^src\/routes\/(onboarding|invites|request-invite|auth-confirm|app-sign-in|reset-password|about|legal)\//,
    'Joining',
  ],
  [/^src\/lib\/(invites|join|onboarding|passkeys|auth)/, 'Joining'],
  [/^supabase\/functions\/(invite|join)/, 'Joining'],
  [/^(src\/routes\/(admin|stats)\/|admin\/|cloudflare\/admin\/|vite\.admin\.config\.ts$)/, 'Admin'],
  [/^(ios\/|capacitor\.config|src\/lib\/native)/, 'iPhone app'],
  [/^(src\/|public\/|index\.html$)/, 'Whole app'],
  [/^supabase\//, 'Database'],
];
const SEEN_BY_MEMBERS = new Set(SURFACES.slice(0, 9));

/**
 * For a change whose files say no part (a database change, shared code): the part its first line
 * names, the first of these it matches. A guess, which a change's entry overrules.
 */
const WORDS = [
  [/\b(iphone|ios|app store|testflight|capacitor)\b/i, 'iPhone app'],
  [/\b(notif\w*|push(es)?|bell|digest|remind\w*)\b/i, 'Notifications'],
  [
    /\b(invit\w*|join\w*|onboarding|sign(s|ed|ing)?[- ]in|qr|passkeys?|password|welcome|about us)\b/i,
    'Joining',
  ],
  [/\b(events?|rsvp\w*|check(s|ed)?[- ]in\w*|calendar|guests?|going)\b/i, 'Events'],
  [
    /\b(chats?|messages?|conversations?|rooms?|posts?|repl(y|ies)|questions?|votes?|boosts?|anonymous\w*|strikes?|typing)\b/i,
    'Chat',
  ],
  [/\b(peers?|profiles?|mentors?|injur\w*|bands?|levels?|organizations?|staff)\b/i, 'Peers'],
  [/\b(home(?! screen)|feed)\b/i, 'Home'],
  [/\b(me|settings|wheelie\w*|journey)\b/i, 'Me'],
  [/\b(admin\w*|stats|debug)\b/i, 'Admin'],
];

/**
 * The part of the club a change touched, from the files it changed: the part with the most of
 * them among the parts members see; failing that the part its first line names; then the shared
 * code, the database, and anything else (deploys, scripts, notes) behind the scenes. The change log's own files are not counted, so
 * an entry does not make its change an Admin one.
 */
export function surfaceOf(paths, subject = '') {
  const counts = new Map();
  for (const path of paths) {
    if (path.startsWith('admin/changes/')) continue;
    const surface = RULES.find(([pattern]) => pattern.test(path))?.[1];
    if (surface) counts.set(surface, (counts.get(surface) ?? 0) + 1);
  }
  const most = (allowed) =>
    [...counts]
      .filter(([surface]) => allowed(surface))
      .sort((a, b) => b[1] - a[1] || SURFACES.indexOf(a[0]) - SURFACES.indexOf(b[0]))[0]?.[0];
  return (
    most((surface) => SEEN_BY_MEMBERS.has(surface)) ??
    WORDS.find(([pattern]) => pattern.test(subject))?.[1] ??
    most((surface) => surface === 'Whole app') ??
    most((surface) => surface === 'Database') ??
    'Behind the scenes'
  );
}

/**
 * A change's entry (admin/changes/entries/*.md):
 *
 *   ---
 *   title: Chat scrolls to the message you just sent
 *   surface: Chat
 *   type: fix
 *   ---
 *   Two lines in plain words: what changed, and what it was like before.
 *
 *   ![Before](shots/2026-11-25-chat-scroll-before.jpg)
 *   ![After](shots/2026-11-25-chat-scroll-after.jpg)
 *
 * Null when it has no title: the change is then listed by its commit's first line.
 */
export function parseEntry(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) return null;
  const field = (name) =>
    new RegExp(`^${name}:\\s*(.+)$`, 'm')
      .exec(match[1])?.[1]
      .trim()
      .replace(/^["']|["']$/g, '');
  const title = field('title');
  if (!title) return null;
  const shots = [];
  const body = match[2].replace(/!\[([^\]]*)\]\(shots\/([A-Za-z0-9._-]+)\)/g, (_, label, file) => {
    shots.push({ label: label.trim(), file });
    return '';
  });
  const named = field('surface');
  const type = field('type')?.toLowerCase();
  return {
    title,
    // What kind of change: something new, something made better, or something mended.
    type: ['new', 'improved', 'fix'].includes(type) ? type : null,
    surface: SURFACES.find((s) => s.toLowerCase() === named?.toLowerCase()) ?? null,
    summary: body.replace(/\s+/g, ' ').trim(),
    shots,
  };
}

/** A week's summary (admin/changes/weeks/<its Monday>.md): its lines, seven at most. */
export function parseWeek(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 7);
}
