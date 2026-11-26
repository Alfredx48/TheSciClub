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
 * The parts of the club, in the order By surface lists them. The first nine are what a member
 * or an administrator sees. Behind the scenes is what nobody sees (deploys, scripts, notes),
 * and Other, last, is what belongs to no one of them: shared code, a database change that names
 * none (the owner, 2026-11-25: "have an other category as well").
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
  'Behind the scenes',
  'Other',
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
  [/^(src\/|public\/|index\.html$|supabase\/)/, 'Other'],
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
 * them among the parts members see; failing that the part its first line names; then Other for
 * shared code or the database; and anything else (deploys, scripts, notes) is behind the scenes.
 * The change log's own files are not counted, so an entry does not make its change an Admin one.
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
    most((surface) => surface === 'Other') ??
    'Behind the scenes'
  );
}

/** A test: a Vitest file, or one of the database's probes (supabase/tests/*.sql). */
const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|^src\/test\/|^supabase\/tests\/)/;
const PROBE = /^supabase\/tests\/[^/]+\.sql$/;
/** Not code: notes, pictures, the lockfile, the change log's own entries. */
const NOT_CODE =
  /(^admin\/changes\/|\.(md|txt|jpe?g|png|gif|webp|svg|ico|pdf|snap)$|(^|\/)(pnpm-lock\.yaml|package-lock\.json)$)/;

/**
 * How big a change is (the owner, 2026-11-25: "change size (lines of code and number of
 * surfaces/tabs impacted)"): the lines of code it added and took out, tests, notes and pictures
 * left out; and the parts of the club members or administrators see that its files belong to,
 * with the one it is listed under.
 *
 * files: [{ path, plus, minus }] from `git log --numstat`, plus and minus null for a picture.
 */
export function sizeOf(files, surface) {
  let lines = 0;
  const parts = new Set(SEEN_BY_MEMBERS.has(surface) ? [surface] : []);
  for (const { path, plus, minus } of files) {
    if (path.startsWith('admin/changes/')) continue;
    const part = RULES.find(([pattern]) => pattern.test(path))?.[1];
    if (part && SEEN_BY_MEMBERS.has(part)) parts.add(part);
    if (TEST_FILE.test(path) || NOT_CODE.test(path) || plus === null) continue;
    lines += plus + (minus ?? 0);
  }
  return { lines, surfaces: SURFACES.filter((s) => parts.has(s)) };
}

/** A test case's first line: it(, test(, it.each(…)(, Deno.test(. */
const CASE = /^([+-])\s*(?:it|test|Deno\.test)\b(?:\.\w+)*\s*[(`]/;

/**
 * How many tests a change added (the owner, 2026-11-25), less any it took out: from its patch
 * of test files (`git log -p -U0`), the test cases begun on lines it added or removed, and a
 * database probe for each file of them it added or removed. A test renamed counts as neither.
 */
export function testsAdded(patch) {
  let count = 0;
  let from = null;
  let file = null;
  // Between a file's "diff --git" and its first hunk: where its names are.
  let header = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true;
      from = null;
      file = null;
    } else if (header && line.startsWith('--- ')) {
      from = line === '--- /dev/null' ? null : line.slice(6);
    } else if (header && line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(6);
      // A probe is one test, its whole file.
      if (file && PROBE.test(file) && from === null) count += 1;
      if (file === null && from && PROBE.test(from)) count -= 1;
    } else if (line.startsWith('@@')) {
      header = false;
    } else if (!header && !PROBE.test(file ?? from ?? '')) {
      const m = CASE.exec(line);
      if (m) count += m[1] === '+' ? 1 : -1;
    }
  }
  return count;
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
 *   ## Prompts
 *
 *   > When I chat with someone, every time I type a message I have to scroll to the bottom.
 *
 *   > Just auto scroll.
 *
 * Null when it has no title: the change is then listed by its commit's first line.
 */
export function parseEntry(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) return null;
  // What was typed is kept apart: none of it is the summary, and a picture in it is not a shot.
  const heading = /^##\s+Prompts\s*$/im.exec(match[2]);
  const above = heading ? match[2].slice(0, heading.index) : match[2];
  const below = heading ? match[2].slice(heading.index + heading[0].length) : '';
  const field = (name) =>
    new RegExp(`^${name}:\\s*(.+)$`, 'm')
      .exec(match[1])?.[1]
      .trim()
      .replace(/^["']|["']$/g, '');
  const title = field('title');
  if (!title) return null;
  const shots = [];
  const body = above.replace(/!\[([^\]]*)\]\(shots\/([A-Za-z0-9._-]+)\)/g, (_, label, file) => {
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
    prompts: parsePrompts(below),
  };
}

/**
 * What the person typed that led to a change (the owner, 2026-11-25: "add all the prompts used
 * for each change"), as an entry lists it under "## Prompts": each prompt a quote, its lines
 * starting ">", in the order typed. A line that is no quote ends a prompt, so a blank line
 * stands between two, and ">" alone is a blank line inside one.
 */
export function parsePrompts(text) {
  const prompts = [];
  let lines = null;
  const end = () => {
    const prompt = lines?.join('\n').trim();
    if (prompt) prompts.push(prompt);
    lines = null;
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const quoted = /^ {0,3}> ?(.*)$/.exec(line);
    if (quoted) {
      lines ??= [];
      lines.push(quoted[1]);
    } else end();
  }
  end();
  return prompts;
}

/**
 * The prompts of the changes made before entries carried them (admin/changes/prompts/*.json),
 * by the change's key: { "<key>": { "change": "its first line", "prompts": ["…"] } }.
 * Anything that is not that is left out, not guessed at.
 */
export function parsePastPrompts(text) {
  const found = new Map();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return found;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return found;
  for (const [key, value] of Object.entries(body)) {
    const prompts = Array.isArray(value?.prompts)
      ? value.prompts.filter((prompt) => typeof prompt === 'string' && prompt.trim())
      : [];
    if (/^[0-9a-f]{12}$/.test(key) && prompts.length > 0) found.set(key, prompts);
  }
  return found;
}

/** A week's summary (admin/changes/weeks/<its Monday>.md): its lines, seven at most. */
export function parseWeek(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 7);
}
