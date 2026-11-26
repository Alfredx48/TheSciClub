import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { PageTabs, TabPanel, useTabParam } from '@/components/page-tabs';
import { cn } from '@/lib/utils';
import { getSupabase } from './supabase';

/**
 * The change log (the owner, 2026-11-25: "keep better track of all the changes we make"), in
 * four parts: what is on the test site and not live yet, every release with what it brought,
 * the same changes by the part of the club they touched, and a few lines a week.
 *
 * All of it is /changes.json, written into this site's build from the repository's history
 * (admin/changes.mjs), which also says how a change comes to have a summary and screenshots:
 * its entry, admin/changes/entries/. This site is built only when main is pushed, so what is
 * waiting on tests is asked of the test site as well (/on-tests/, cloudflare/admin/worker.ts),
 * whose own build lists it on every push to tests; without that answer the list is as of this
 * site's build, and says so.
 */

interface Shot {
  label: string;
  file: string;
}

export interface Change {
  sha: string;
  /** The same for a change on tests and on main: made from its commit's first line. */
  key: string;
  by: string;
  at: string;
  title: string;
  surface: string;
  entry?: { title: string; type?: 'new' | 'improved' | 'fix'; summary: string; shots: Shot[] };
  /** What the person typed that led to it, in order. From its entry, or the past's list. */
  prompts?: string[];
  /** The iPhone app version built at this change: it has this and everything before it. */
  ios?: string;
  /** Lines of code it added and took out, and the surfaces its files belong to (changes-lib). */
  size?: { lines: number; surfaces: string[] };
  /** Tests it added, less any it took out. */
  tests?: number;
}

export interface Release {
  id: string;
  /** A timed release, a day before releases were timed, or main since the last release. */
  kind: 'release' | 'day' | 'pending';
  at: string;
  /** Its Pacific day, and the Monday of its week. */
  day: string;
  week: string;
  changes: Change[];
}

export interface ChangeLogData {
  built: string;
  error?: string;
  surfaces?: string[];
  releases?: Release[];
  waiting?: Change[];
  weeks?: Record<string, string[]>;
}

type Part = 'tests' | 'main' | 'surface' | 'summary';
const PARTS: readonly Part[] = ['tests', 'main', 'surface', 'summary'];
const REPOSITORY = 'https://github.com/Alfredx48/TheSciClub';
const ZONE = 'America/Los_Angeles';
const CARD = 'rounded-[14px] border border-line bg-paper px-3 py-2.5';
const LINK = 'font-semibold text-ink2 underline underline-offset-2';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ZONE,
  });
}

/** A day as '2026-11-24', said: Tue, Nov 24. */
function dayName(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** A week by its Monday: Nov 16 to 22, or Nov 30 to Dec 6. */
export function weekName(monday: string): string {
  const first = new Date(`${monday}T12:00:00Z`);
  const last = new Date(first.getTime() + 6 * 86_400_000);
  const month = (date: Date) => date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const end =
    month(first) === month(last)
      ? String(last.getUTCDate())
      : `${month(last)} ${String(last.getUTCDate())}`;
  return `${month(first)} ${String(first.getUTCDate())} to ${end}`;
}

const count = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[0.75rem] text-ink2 leading-[1.45]">{children}</p>;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Who marked a waiting change ready for main, and when. */
interface ReadyMark {
  by: string | null;
  at: string;
}

/**
 * The ticks on what is waiting (the owner, 2026-11-25: "a column for ready for push to main"):
 * an administrator ticks a change once it has been tried on the test site. Kept in the club's
 * database (change_log_ready, 20261125140000) under the change's key, so every administrator
 * sees the same ticks and a tick follows its change until it is on main.
 */
export interface ReadyMarks {
  /** The changes ticked, by key. Null when the database could not say (no table yet, say). */
  load: () => Promise<Map<string, ReadyMark> | null>;
  /** Ticks or unticks one. A sentence if it was refused. */
  set: (key: string, ready: boolean) => Promise<string | null>;
}

const databaseMarks: ReadyMarks = {
  async load() {
    const { data, error } = (await getSupabase().rpc('admin_change_log_ready')) as {
      data: { change_key: string; marked_by: string | null; marked_at: string }[] | null;
      error: { message: string } | null;
    };
    if (error || !data) return null;
    return new Map(data.map((row) => [row.change_key, { by: row.marked_by, at: row.marked_at }]));
  },
  async set(key, ready) {
    const { error } = (await getSupabase().rpc('admin_mark_change_ready', {
      change: key,
      ready,
    })) as { error: { message: string } | null };
    return error ? error.message : null;
  },
};

export function ChangeLog({ marks = databaseMarks }: { marks?: ReadyMarks }) {
  const [part, setPart] = useTabParam(PARTS, 'tests', undefined, 'log');
  const [log, setLog] = useState<ChangeLogData | 'loading' | 'failed'>('loading');
  // What the test site says is waiting now; null until it answers, or if it does not.
  const [fresh, setFresh] = useState<{ built: string; waiting: Change[] } | null>(null);
  // The change By surface was asked to show in On main.
  const [focus, setFocus] = useState<string | null>(null);
  // How tall the site's own tab row is, which stays at the top of the screen: a week's heading
  // in By surface stays just under it (--log-top). Nothing if that row does not stick.
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector('[role="tablist"]')?.parentElement;
      const sticks = bar ? getComputedStyle(bar).position === 'sticky' : false;
      setBarHeight(bar && sticks ? Math.floor(bar.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    let live = true;
    void readJson<ChangeLogData>('/changes.json').then((body) => {
      if (live) setLog(body ?? 'failed');
    });
    void readJson<{ built?: string; waiting?: Change[] }>('/on-tests/on-tests.json').then(
      (body) => {
        if (live && body?.built && Array.isArray(body.waiting)) {
          setFresh({ built: body.built, waiting: body.waiting });
        }
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const releases = useMemo(() => (typeof log === 'object' ? (log.releases ?? []) : []), [log]);
  const waiting = useMemo(() => {
    if (typeof log !== 'object') return { changes: [], asOf: null, live: false };
    // The newer of the two lists; and nothing main has had since the test site listed it.
    const useFresh = fresh !== null && fresh.built > log.built;
    const onMain = new Set(releases.flatMap((release) => release.changes.map((c) => c.key)));
    const source = useFresh ? fresh.waiting : (log.waiting ?? []);
    return {
      changes: source.filter((change) => !onMain.has(change.key)),
      asOf: useFresh ? fresh.built : log.built,
      live: fresh !== null,
    };
  }, [log, fresh, releases]);

  if (log === 'loading') return <p className="py-3 text-[0.8125rem] text-grey">Loading…</p>;
  if (log === 'failed' || log.error) {
    return (
      <p role="alert" className="py-3 text-[0.8125rem] text-destructive">
        Could not read the change log{typeof log === 'object' && log.error ? `: ${log.error}` : '.'}
      </p>
    );
  }

  return (
    <div className="pt-3" style={{ '--log-top': `${String(barHeight)}px` } as CSSProperties}>
      <PageTabs
        id="change-log"
        label="Parts of the change log"
        value={part}
        onChange={setPart}
        nested
        fill
        tabs={[
          { value: 'tests', label: 'On tests' },
          { value: 'main', label: 'On main' },
          { value: 'surface', label: 'By surface' },
          { value: 'summary', label: 'Summary' },
        ]}
      />
      <TabPanel id="change-log" value={part} className="pt-3">
        {part === 'tests' ? (
          <OnTests
            changes={waiting.changes}
            asOf={waiting.asOf}
            live={waiting.live}
            lastPush={releases.find((release) => release.kind === 'release')?.at ?? null}
            marks={marks}
          />
        ) : part === 'main' ? (
          <OnMain releases={releases} focus={focus} />
        ) : part === 'surface' ? (
          <BySurface
            releases={releases}
            surfaces={log.surfaces ?? []}
            onShow={(sha) => {
              setFocus(sha);
              setPart('main');
            }}
          />
        ) : (
          <Summary releases={releases} weeks={log.weeks ?? {}} surfaces={log.surfaces ?? []} />
        )}
      </TabPanel>
    </div>
  );
}

const TYPES = { new: 'New', improved: 'Improved', fix: 'Fix' } as const;
/** Entries were asked for from here on (CLAUDE.md, The change log): midnight Pacific. */
const ENTRIES_FROM = '2026-11-26T08:00:00.000Z';
const TAG = 'mr-1.5 rounded-full border border-line px-1.5 py-px font-semibold text-[0.6875rem]';

/**
 * How big a change is and how many tests it added, each a coloured pill (the owner, 2026-11-25:
 * "a couple details, maybe with some color coding. One for change size (lines of code and number
 * of surfaces/tabs impacted), the other for number of tests added"). Green, yellow, orange and
 * red, far enough apart to tell at a glance in light and dark; the words say the same, so the
 * colour is never all there is to go on.
 */
type Level = 0 | 1 | 2 | 3;
const LEVEL_COLOUR: Record<Level, string> = {
  0: '#3fa34d',
  1: '#d9a300',
  2: '#ea6c14',
  3: '#d1302a',
};
const SIZE_NAMES = ['Small', 'Medium', 'Large', 'Huge'] as const;
/** Lines of code up to which a change is small, medium and large; beyond, huge. */
const SIZE_LINES = [50, 250, 1000] as const;
/** From this many surfaces a change is one size bigger than its lines say. */
const MANY_SURFACES = 3;

export function sizeLevel(size: { lines: number; surfaces: string[] }): Level {
  const byLines = SIZE_LINES.filter((most) => size.lines >= most).length;
  return Math.min(3, byLines + (size.surfaces.length >= MANY_SURFACES ? 1 : 0)) as Level;
}

/** Tests added: the rule is usually one a change (CLAUDE.md, Tests), so more is yellow, then orange. */
function testsLevel(tests: number): Level | null {
  if (tests <= 0) return null;
  return tests <= 2 ? 0 : tests <= 5 ? 1 : 2;
}

function Dot({ level }: { level: Level | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 flex-none rounded-full"
      style={{ backgroundColor: level === null ? 'var(--grey)' : LEVEL_COLOUR[level] }}
    />
  );
}

function Pill({ level, children }: { level: Level | null; children: ReactNode }) {
  const colour = level === null ? 'var(--grey)' : LEVEL_COLOUR[level];
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-[9px] border px-2 py-px font-semibold text-[0.6875rem] text-ink"
      style={{
        backgroundColor: `color-mix(in srgb, ${colour} ${level === null ? 8 : 18}%, transparent)`,
        borderColor: `color-mix(in srgb, ${colour} ${level === null ? 40 : 65}%, transparent)`,
      }}
    >
      <Dot level={level} />
      {children}
    </span>
  );
}

const lines = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'line' : 'lines'}`;

function list(names: string[]): string {
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** "Large · 232 lines across 3 surfaces (one size up): Events, Home and Chat" and "1 test added". */
function SizeAndTests({ change }: { change: Change }) {
  const { size, tests } = change;
  if (!size && tests === undefined) return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-1.5">
      {size ? <Pill level={sizeLevel(size)}>{sizeWords(size, change.surface)}</Pill> : null}
      {tests !== undefined ? (
        <Pill level={testsLevel(tests)}>
          {tests === 0
            ? 'No tests added'
            : tests > 0
              ? `${count(tests, 'test')} added`
              : `${count(-tests, 'test')} taken out`}
        </Pill>
      ) : null}
    </p>
  );
}

function sizeWords(size: { lines: number; surfaces: string[] }, surface: string): string {
  const name = SIZE_NAMES[sizeLevel(size)];
  if (size.lines === 0) return `${name} · no lines of code`;
  const surfaces = size.surfaces.length;
  if (surfaces === 0) {
    return `${name} · ${lines(size.lines)} ${surface === 'Other' ? 'of shared code' : 'behind the scenes'}`;
  }
  if (surfaces === 1) return `${name} · ${lines(size.lines)} in ${size.surfaces[0] ?? ''}`;
  // The surface it is listed under first, as the line above names it.
  const named = [...size.surfaces].sort((a, b) => Number(b === surface) - Number(a === surface));
  // Bigger than its lines alone make it: said, so it does not read as a mistake against the key.
  const bumped = surfaces >= MANY_SURFACES && size.lines < SIZE_LINES[2] ? ' (one size up)' : '';
  return `${name} · ${lines(size.lines)} across ${String(surfaces)} surfaces${bumped}: ${list(named)}`;
}

/** What the pills' colours mean, under On tests' summary. */
function SizeKey() {
  const item = (level: Level | null, text: string) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Dot level={level} />
      {text}
    </span>
  );
  return (
    <div className="mt-2.5 space-y-1 border-line border-t pt-2.5 text-[0.75rem] text-ink2 leading-[1.45]">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-grey">Size</span>
        {item(0, `Small, under ${String(SIZE_LINES[0])} lines`)}
        {item(1, `Medium, under ${String(SIZE_LINES[1])}`)}
        {item(2, `Large, under ${SIZE_LINES[2].toLocaleString('en-US')}`)}
        {item(3, `Huge, ${SIZE_LINES[2].toLocaleString('en-US')} or more`)}
      </p>
      <p className="text-grey">
        Lines of code added and taken out; tests, notes and pictures are not counted. A change that
        touches {String(MANY_SURFACES)} or more surfaces is one size up.
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-grey">Tests</span>
        {item(0, '1 or 2, the usual')}
        {item(1, '3 to 5')}
        {item(2, '6 or more')}
        {item(null, 'None, or taken out')}
      </p>
    </div>
  );
}

/** One change: its entry's title and summary where it has one, else its commit's first line. */
function ChangeRow({
  change,
  shots,
  lit = false,
  wantsEntry = false,
}: {
  change: Change;
  /** Where its screenshots are served from. */
  shots: string;
  lit?: boolean;
  /** Not released yet: one without an entry says so, while it can still be written. */
  wantsEntry?: boolean;
}) {
  return (
    <li
      id={`change-${change.sha}`}
      className={cn('scroll-mt-24 py-2', lit && '-mx-2 rounded-[10px] bg-tint px-2')}
    >
      {change.ios ? (
        <p className="mb-2.5 rounded-[8px] border border-line bg-canvas px-2 py-1.5 font-semibold text-[0.75rem] text-ink">
          iPhone app {change.ios} was built here. It includes this change and everything below it.
        </p>
      ) : null}
      <ChangeBody change={change} shots={shots} wantsEntry={wantsEntry} />
    </li>
  );
}

/** What a change says of itself: title, summary and screenshots, then its surface and code. */
function ChangeBody({
  change,
  shots,
  wantsEntry = false,
  author = true,
}: {
  change: Change;
  shots: string;
  wantsEntry?: boolean;
  /** Left out where the row says who pushed it. */
  author?: boolean;
}) {
  return (
    <>
      <p className={cn('text-[0.875rem] text-ink leading-[1.4]', change.entry && 'font-semibold')}>
        {change.entry?.type ? (
          <span className={cn(TAG, 'text-ink2')}>{TYPES[change.entry.type]}</span>
        ) : wantsEntry && !change.entry && change.at >= ENTRIES_FROM ? (
          <span className={cn(TAG, 'text-destructive')}>No entry</span>
        ) : null}
        {change.entry?.title ?? change.title}
      </p>
      {change.entry?.summary ? (
        <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">{change.entry.summary}</p>
      ) : null}
      {change.entry && change.entry.shots.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {change.entry.shots.map((shot) => (
            <figure key={shot.file} className="m-0">
              {/* A small picture; the whole one opens on a tap. */}
              <a href={`${shots}${shot.file}`} target="_blank" rel="noreferrer">
                <img
                  src={`${shots}${shot.file}`}
                  alt={shot.label ? `${shot.label}: ${change.entry?.title ?? ''}` : ''}
                  loading="lazy"
                  className="max-h-[220px] max-w-full rounded-[10px] border border-line"
                />
              </a>
              {shot.label ? (
                <figcaption className="mt-1 text-[0.6875rem] text-grey">{shot.label}</figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}
      <p className="mt-0.5 text-[0.6875rem] text-grey">
        {change.surface} · {author ? `${change.by} · ` : ''}
        <a
          href={`${REPOSITORY}/commit/${change.sha}`}
          aria-label={`The code of this change, ${change.sha}`}
          className="underline underline-offset-2"
        >
          code
        </a>
      </p>
      <SizeAndTests change={change} />
      {change.prompts && change.prompts.length > 0 ? (
        <Prompts prompts={change.prompts} by={change.by} />
      ) : null}
    </>
  );
}

/**
 * What was typed to get a change made (the owner, 2026-11-25: "add all the prompts used for
 * each change ... in an expandable view"): closed, how many; open, each as it was typed, in
 * order. Drawn only once opened: a week is hundreds of changes.
 */
function Prompts({ prompts, by }: { prompts: string[]; by: string }) {
  const [open, setOpen] = useState(false);
  const numbered = prompts.map((text, at) => ({ text, at }));
  return (
    <details
      className="mt-0.5"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      {/* The whole line is pressed, and on a phone it is as tall as a finger needs. */}
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-[0.8125rem] text-ink2 md:min-h-8">
        {count(prompts.length, 'prompt')}
      </summary>
      {open ? (
        <>
          <p className="text-[0.75rem] text-ink2 leading-[1.45]">
            What {by} typed in the conversation behind this change. Changes that came out of the
            same conversation show the same prompts. Other people’s names and anything private are
            left out.
          </p>
          <ol className="mt-1.5 mb-3 space-y-2">
            {numbered.map((prompt) => (
              <li key={prompt.at} className="flex gap-2">
                {/* Which came first, where there is more than one. */}
                {prompts.length > 1 ? (
                  <span
                    aria-hidden="true"
                    className="w-4 flex-none pt-1.5 text-right font-semibold text-[0.75rem] text-grey"
                  >
                    {prompt.at + 1}
                  </span>
                ) : null}
                {/* As typed, line breaks and all; a run of spaces shows as one. */}
                <p className="max-h-72 min-w-0 flex-1 overflow-y-auto whitespace-pre-line break-words rounded-[8px] border-line border-l-[3px] bg-canvas px-2.5 py-1.5 text-[0.8125rem] text-ink2 leading-[1.45]">
                  {prompt.text}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </details>
  );
}

/** "Pushed by Wojtek at 8:55 AM on Nov 17": who wrote a waiting change and when it reached tests. */
export function pushedLine(change: Pick<Change, 'by' | 'at'>): string {
  const at = new Date(change.at);
  const time = at.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ZONE,
  });
  const month = at.toLocaleDateString('en-US', { month: 'short', timeZone: ZONE });
  const day = Number(at.toLocaleDateString('en-US', { day: 'numeric', timeZone: ZONE }));
  const clock = time.replace(/\s?(AM|PM)$/, (_, half: string) => half.toLowerCase());
  return `Pushed by ${change.by} at ${clock} on ${month} ${ordinal(day)}`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 22nd. */
function ordinal(n: number): string {
  const tens = n % 100;
  const end = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${String(n)}${end}`;
}

/** How long ago, in whole days: today, 1 day, 16 days. */
function daysSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : count(days, 'day');
}

/** "Alfred 51, Wojtek 22": how many of the changes fall under each name, most first. */
function shares(changes: Change[], of: (change: Change) => string): string {
  const found = new Map<string, number>();
  for (const change of changes) found.set(of(change), (found.get(of(change)) ?? 0) + 1);
  return (
    [...found]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      // A name and its number stay on one line.
      .map(([name, n]) => `${name} ${String(n)}`.replaceAll(' ', '\u00a0'))
      .join(', ')
  );
}

/** The columns of On tests from a tablet's width: the change, who pushed it when, and the tick. */
const WAITING_COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_15.5rem_8.5rem] md:gap-x-5';

function OnTests({
  changes,
  asOf,
  live,
  lastPush,
  marks,
}: {
  changes: Change[];
  asOf: string | null;
  live: boolean;
  /** When main was last pushed, for the summary. */
  lastPush: string | null;
  marks: ReadyMarks;
}) {
  // The ticks: being read, not to be had (null), or by change.
  const [ready, setReady] = useState<Map<string, ReadyMark> | null | 'reading'>('reading');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void marks.load().then((found) => {
      if (live) setReady(found);
    });
    return () => {
      live = false;
    };
  }, [marks]);

  // Shown at once and taken back if the database refuses.
  const mark = async (key: string, on: boolean) => {
    if (!(ready instanceof Map)) return;
    const before = ready;
    const next = new Map(ready);
    if (on) next.set(key, { by: 'you', at: new Date().toISOString() });
    else next.delete(key);
    setReady(next);
    setProblem(null);
    const refused = await marks.set(key, on);
    if (refused) {
      setReady(before);
      setProblem(`That tick was not saved: ${refused}`);
    }
  };

  const ticked =
    ready instanceof Map ? changes.filter((change) => ready.has(change.key)).length : 0;
  const unwritten = changes.filter((c) => !c.entry && c.at >= ENTRIES_FROM).length;
  const sized = changes.flatMap((change) => (change.size ? [change.size] : []));
  const testsTotal = changes.reduce((sum, change) => sum + Math.max(0, change.tests ?? 0), 0);
  const withTests = changes.filter((change) => (change.tests ?? 0) > 0).length;
  const takenOut = changes.reduce((sum, change) => sum + Math.max(0, -(change.tests ?? 0)), 0);
  const oldest = changes.reduce<string | null>(
    (first, change) => (first === null || change.at < first ? change.at : first),
    null,
  );
  const newest = changes.reduce<string | null>(
    (last, change) => (last === null || change.at > last ? change.at : last),
    null,
  );
  // With many waiting, the ticked ones can be put away to see what is left to try.
  const [hideTicked, setHideTicked] = useState(false);
  const shown =
    hideTicked && ready instanceof Map
      ? changes.filter((change) => !ready.has(change.key))
      : changes;

  return (
    <div>
      <Note>
        On the test site and not on the live site yet: what the next push to main will bring. Tick
        Ready for main once you have tried a change on the test site; every administrator sees the
        ticks.{' '}
        {asOf
          ? live
            ? `This list was last updated ${when(asOf)} Pacific, and updates whenever the test site or the live site is pushed.`
            : `This list is as of ${when(asOf)} Pacific, when this site was last built: the test site did not answer for anything newer.`
          : null}
      </Note>
      {changes.length === 0 ? (
        <p className={cn(CARD, 'mt-3 text-[0.875rem] text-ink')}>
          Nothing is waiting: everything on the test site is live.
        </p>
      ) : (
        <>
          <section aria-label="Summary of what is waiting" className={cn(CARD, 'mt-3')}>
            <h3 className="font-bold font-head text-[1rem] text-ink">
              {count(changes.length, 'change')} waiting for main
            </h3>
            <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.8125rem] text-ink leading-[1.45]">
              <dt className="text-grey">Ready for main</dt>
              <dd>
                {ready === 'reading'
                  ? 'Reading…'
                  : ready === null
                    ? 'Not available: the ticks could not be read from the club’s database.'
                    : `${String(ticked)} ticked, ${String(changes.length - ticked)} not yet`}
              </dd>
              <dt className="text-grey">Pushed by</dt>
              <dd>{shares(changes, (change) => change.by)}</dd>
              <dt className="text-grey">Surfaces</dt>
              <dd>{shares(changes, (change) => change.surface)}</dd>
              {sized.length > 0 ? (
                <>
                  <dt className="text-grey">Size</dt>
                  <dd>
                    {lines(sized.reduce((sum, size) => sum + size.lines, 0))} of code:{' '}
                    {SIZE_NAMES.map((name, level) => ({
                      name,
                      level: level as Level,
                      n: sized.filter((size) => sizeLevel(size) === level).length,
                    }))
                      .filter(({ n }) => n > 0)
                      .map(({ name, level, n }, at) => (
                        <span key={name} className="whitespace-nowrap">
                          {at > 0 ? ', ' : ''}
                          <span className="mr-1 inline-flex align-middle">
                            <Dot level={level} />
                          </span>
                          {String(n)} {name.toLowerCase()}
                        </span>
                      ))}
                  </dd>
                  <dt className="text-grey">Tests</dt>
                  <dd>
                    {testsTotal === 0
                      ? 'None added'
                      : `${String(testsTotal)} added, in ${String(withTests)} of the ${count(changes.length, 'change')}`}
                    {testsTotal > 0 ? ': ' : null}
                    {(
                      [
                        [0, '1 or 2'],
                        [1, '3 to 5'],
                        [2, '6 or more'],
                      ] as const
                    )
                      .map(([level, words]) => ({
                        level,
                        words,
                        n: changes.filter((change) => testsLevel(change.tests ?? 0) === level)
                          .length,
                      }))
                      .filter(({ n }) => n > 0)
                      .map(({ level, words, n }, at) => (
                        <span key={level} className="whitespace-nowrap">
                          {at > 0 ? ', ' : ''}
                          <span className="mr-1 inline-flex align-middle">
                            <Dot level={level} />
                          </span>
                          {String(n)} with {words}
                        </span>
                      ))}
                    {takenOut > 0 ? `; ${count(takenOut, 'test')} taken out` : null}
                  </dd>
                </>
              ) : null}
              {newest ? (
                <>
                  <dt className="text-grey">Newest</dt>
                  <dd>Pushed to tests {when(newest)}</dd>
                </>
              ) : null}
              {oldest ? (
                <>
                  <dt className="text-grey">Oldest</dt>
                  <dd>
                    On tests since {when(oldest)} ({daysSince(oldest)})
                  </dd>
                </>
              ) : null}
              {lastPush ? (
                <>
                  <dt className="text-grey">Main</dt>
                  <dd>Last pushed {when(lastPush)}</dd>
                </>
              ) : null}
              {unwritten > 0 ? (
                <>
                  <dt className="text-grey">No entry</dt>
                  <dd>{count(unwritten, 'change')} with no summary written yet</dd>
                </>
              ) : null}
            </dl>
            {sized.length > 0 ? <SizeKey /> : null}
          </section>
          {problem ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive">
              {problem}
            </p>
          ) : null}
          {ready instanceof Map && ticked > 0 ? (
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.8125rem] text-ink2">
              <input
                type="checkbox"
                checked={hideTicked}
                onChange={(event) => {
                  setHideTicked(event.target.checked);
                }}
                className="h-5 w-5 flex-none accent-action"
              />
              Show only what is not ticked yet
            </label>
          ) : null}
          <div className={cn(CARD, 'mt-3 py-1')}>
            <div
              aria-hidden="true"
              className={cn(
                'hidden border-line border-b py-2 font-semibold text-[0.75rem] text-grey',
                WAITING_COLUMNS,
              )}
            >
              <span>Change</span>
              <span>Pushed to tests</span>
              <span>Ready for main</span>
            </div>
            <ul className="divide-y divide-line">
              {shown.map((change) => {
                const tick = ready instanceof Map ? ready.get(change.key) : undefined;
                return (
                  <li key={change.sha} className={cn('py-2.5', WAITING_COLUMNS)}>
                    <div>
                      <ChangeBody
                        change={change}
                        shots="/on-tests/shots/"
                        wantsEntry
                        author={false}
                      />
                    </div>
                    <p className="mt-1 text-[0.75rem] text-ink2 leading-[1.4] md:mt-0.5">
                      {pushedLine(change)}
                    </p>
                    {ready instanceof Map ? (
                      <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.8125rem] text-ink md:mt-0 md:min-h-0 md:items-start">
                        <input
                          type="checkbox"
                          checked={tick !== undefined}
                          onChange={(event) => {
                            void mark(change.key, event.target.checked);
                          }}
                          className="h-5 w-5 flex-none accent-action"
                        />
                        <span>
                          {/* Under its column's heading the words are only for a screen reader. */}
                          <span className={tick ? 'md:sr-only' : undefined}>Ready for main</span>
                          {tick ? (
                            <span className="block text-[0.6875rem] text-grey md:text-[0.75rem]">
                              Ticked by {tick.by ?? 'an administrator'},{' '}
                              {new Date(tick.at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                timeZone: ZONE,
                              })}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/** The releases week by week, newest first. */
function byWeek(releases: Release[]): [string, Release[]][] {
  const weeks = new Map<string, Release[]>();
  for (const release of releases) {
    weeks.set(release.week, [...(weeks.get(release.week) ?? []), release]);
  }
  return [...weeks].sort((a, b) => b[0].localeCompare(a[0]));
}

const changesIn = (releases: Release[]) => releases.reduce((n, r) => n + r.changes.length, 0);

/** "119 changes in 12 pushes"; only the changes for a week with days from before pushes were timed. */
function tally(releases: Release[]): string {
  const changes = count(changesIn(releases), 'change');
  return releases.every((release) => release.kind === 'release')
    ? `${changes} in ${count(releases.length, 'push', 'pushes')}`
    : changes;
}

/** Which weeks are open: the newest two, and any the reader opens. */
function useOpenWeeks(weeks: [string, Release[]][]) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (week: string, index: number) => index < 2 || opened.has(week);
  const open = (week: string) => {
    setOpened((current) => new Set(current).add(week));
  };
  return { isOpen, open, count: weeks.length };
}

function WeekHeading({
  week,
  current,
  children,
}: {
  week: string;
  /** The newest week, which is not over. */
  current: boolean;
  children?: ReactNode;
}) {
  return (
    <h3 className="mt-5 mb-2 flex flex-wrap items-baseline gap-x-2 font-bold font-head text-[1rem] text-ink">
      Week of {weekName(week)}
      {current ? ', so far' : ''}
      {children ? <span className="font-normal text-[0.75rem] text-grey">{children}</span> : null}
    </h3>
  );
}

function ShowWeek({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(LINK, 'min-h-11 text-[0.8125rem]')}>
      {children}
    </button>
  );
}

function OnMain({ releases, focus }: { releases: Release[]; focus: string | null }) {
  const weeks = useMemo(() => byWeek(releases), [releases]);
  const { isOpen, open } = useOpenWeeks(weeks);
  // The week of the change asked for is opened, then the change is brought into view.
  const focusWeek = focus
    ? (releases.find((release) => release.changes.some((c) => c.sha === focus))?.week ?? null)
    : null;
  useEffect(() => {
    if (!focus) return;
    document.getElementById(`change-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  return (
    <div>
      <Note>
        Every push to the live site and what it brought, newest first. Times are Pacific. Before
        November 22, pushes were not timed, so those changes are listed by day. A marker shows where
        each iPhone app version was built.
      </Note>
      {weeks.map(([week, inWeek], index) => (
        <section key={week} aria-label={`Week of ${weekName(week)}`}>
          <WeekHeading week={week} current={index === 0}>
            {tally(inWeek)}
          </WeekHeading>
          {isOpen(week, index) || week === focusWeek ? (
            <ul className="space-y-2">
              {inWeek.map((release) => (
                <li key={release.id} className={CARD}>
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[0.875rem] text-ink">
                      {release.kind === 'release'
                        ? `Pushed ${when(release.at)}`
                        : release.kind === 'day'
                          ? `${dayName(release.day)} (not timed)`
                          : 'Since the last push of the app'}
                    </span>
                    <span className="text-[0.75rem] text-grey">
                      {count(release.changes.length, 'change')}
                    </span>
                  </p>
                  <ul className="mt-1 divide-y divide-line">
                    {release.changes.map((change) => (
                      <ChangeRow
                        key={change.sha}
                        change={change}
                        shots="/change-shots/"
                        lit={change.sha === focus}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <ShowWeek
              onClick={() => {
                open(week);
              }}
            >
              Show this week
            </ShowWeek>
          )}
        </section>
      ))}
    </div>
  );
}

/** A change and the day it was pushed. */
interface Dated {
  change: Change;
  day: string;
  week: string;
}

/** The quarter of a day: '2026-Q4'. The day is already a Pacific one. */
export function quarterOf(day: string): string {
  return `${day.slice(0, 4)}-Q${String(Math.ceil(Number(day.slice(5, 7)) / 3))}`;
}

const QUARTERS = ['January to March', 'April to June', 'July to September', 'October to December'];

/** '2026-Q4' said: October to December 2026. */
export function quarterName(quarter: string): string {
  return `${QUARTERS[Number(quarter.slice(6)) - 1] ?? quarter} ${quarter.slice(0, 4)}`;
}

/** Some pushes' changes by surface, the part of the club they touched, in the surfaces' own order. */
function bySurface(releases: Release[], surfaces: string[]): [string, Dated[]][] {
  const found = new Map<string, Dated[]>();
  for (const release of releases) {
    for (const change of release.changes) {
      found.set(change.surface, [
        ...(found.get(change.surface) ?? []),
        { change, day: release.day, week: release.week },
      ]);
    }
  }
  const order = (surface: string) => {
    const at = surfaces.indexOf(surface);
    return at === -1 ? surfaces.length : at;
  };
  return [...found].sort((a, b) => order(a[0]) - order(b[0]));
}

function BySurface({
  releases,
  surfaces,
  onShow,
}: {
  releases: Release[];
  surfaces: string[];
  onShow: (sha: string) => void;
}) {
  // Quarters outside, newest first; each surface opens on its own weeks (the owner,
  // 2026-11-25: "a timeline by week within each expansion", where each week had listed every
  // surface again).
  const quarters = useMemo(() => {
    const found = new Map<string, Release[]>();
    for (const release of releases) {
      const quarter = quarterOf(release.day);
      found.set(quarter, [...(found.get(quarter) ?? []), release]);
    }
    return [...found].sort((a, b) => b[0].localeCompare(a[0]));
  }, [releases]);
  // The newest week of all, which is not over.
  const currentWeek = releases.reduce((newest, r) => (r.week > newest ? r.week : newest), '');
  return (
    <div>
      <Note>
        Each quarter’s changes grouped by surface: the part of the club they touched. Open a surface
        to see its changes week by week, newest first, and tap a change to see it in On main. A
        change’s surface is the one its entry names, or else a guess from the files it touched.
      </Note>
      {quarters.map(([quarter, inQuarter], index) => (
        <section
          key={quarter}
          aria-label={quarterName(quarter)}
          className={index === 0 ? 'mt-5' : 'mt-9 border-line border-t pt-6'}
        >
          <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 font-bold font-head text-[1.125rem] text-ink">
            {quarterName(quarter)}
            {index === 0 ? ', so far' : ''}
            <span className="font-normal text-[0.75rem] text-grey">
              {count(changesIn(inQuarter), 'change')}
            </span>
          </h3>
          <div className="space-y-2">
            {bySurface(inQuarter, surfaces).map(([surface, changes]) => (
              <SurfaceTimeline
                key={surface}
                surface={surface}
                changes={changes}
                currentWeek={currentWeek}
                onShow={onShow}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** What the two surfaces that are not a part of the club hold, said beside their counts. */
const CATCH_ALLS: Record<string, string | undefined> = {
  'Behind the scenes': 'deploys, speed checks and notes that nobody sees',
  Other: 'shared code and database changes that belong to no one surface',
};

/** One surface in a quarter: closed, its count; open, its weeks, the newest of them open. */
function SurfaceTimeline({
  surface,
  changes,
  currentWeek,
  onShow,
}: {
  surface: string;
  changes: Dated[];
  currentWeek: string;
  onShow: (sha: string) => void;
}) {
  // Drawn only once opened: a quarter of one surface can be hundreds of changes.
  const [open, setOpen] = useState(false);
  const weeks = useMemo(() => {
    const found = new Map<string, Dated[]>();
    for (const dated of changes) found.set(dated.week, [...(found.get(dated.week) ?? []), dated]);
    return [...found].sort((a, b) => b[0].localeCompare(a[0]));
  }, [changes]);
  return (
    <details
      className={CARD}
      onToggle={(event) => {
        // A week inside toggling is not this.
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-[0.875rem] text-ink">
        {surface}{' '}
        <span className="ml-1 font-normal text-[0.75rem] text-grey">
          {count(changes.length, 'change')}
          {CATCH_ALLS[surface] ? `: ${CATCH_ALLS[surface]}` : ''}
        </span>
      </summary>
      {open ? (
        <div className="space-y-1.5 pb-1">
          {weeks.map(([week, inWeek], index) => (
            <SurfaceWeek
              key={week}
              surface={surface}
              week={week}
              changes={inWeek}
              current={week === currentWeek}
              startsOpen={index === 0}
              onShow={onShow}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

/**
 * One week of a surface. Its heading names the surface too and stays under the site's tabs
 * while its changes scroll, so somebody far down a long week still knows where they are; a
 * press closes it. The day is said once, over the changes pushed that day.
 */
function SurfaceWeek({
  surface,
  week,
  changes,
  current,
  startsOpen,
  onShow,
}: {
  surface: string;
  week: string;
  changes: Dated[];
  current: boolean;
  startsOpen: boolean;
  onShow: (sha: string) => void;
}) {
  const [open, setOpen] = useState(startsOpen);
  return (
    <details
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="sticky top-[var(--log-top,0px)] z-[1] flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-2 rounded-[8px] bg-tint px-2.5 py-2.5 font-semibold text-[0.8125rem] text-ink [&::-webkit-details-marker]:hidden">
        {/* The row is a flex one, which drops the browser's own triangle. */}
        <span aria-hidden="true" className="w-3.5 text-[0.9375rem] text-ink2 leading-none">
          {open ? '▾' : '▸'}
        </span>
        <span>
          <span className="text-ink2">{surface} · </span>
          Week of {weekName(week)}
          {current ? ', so far' : ''}
        </span>
        <span className="font-normal text-[0.6875rem] text-grey">
          {count(changes.length, 'change')}
        </span>
      </summary>
      {open ? (
        <ul className="px-1 pb-2 text-[0.8125rem]">
          {changes.map(({ change, day }, index) => (
            <li key={change.sha}>
              {index === 0 || changes[index - 1]?.day !== day ? (
                <p className="mt-3 mb-0.5 font-semibold text-[0.6875rem] text-grey">
                  {dayName(day)}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onShow(change.sha);
                }}
                className="flex w-full items-start justify-between gap-3 py-1.5 text-left leading-[1.4]"
              >
                <span className="text-ink">
                  {change.entry?.title ?? change.title}
                  <span className="text-grey"> · {change.by}</span>
                </span>
                <span aria-hidden="true" className="text-grey">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function Summary({
  releases,
  weeks: written,
  surfaces,
}: {
  releases: Release[];
  weeks: Record<string, string[]>;
  surfaces: string[];
}) {
  const weeks = useMemo(() => byWeek(releases), [releases]);
  return (
    <div>
      <Note>
        Each week in seven lines at most, written once the week is over (admin/changes/weeks/ in the
        repository). The counts under each are worked out from the pushes.
      </Note>
      {weeks.map(([week, inWeek], index) => {
        const lines = written[week] ?? [];
        const parts = bySurface(inWeek, surfaces)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 5)
          .map(([surface, changes]) => `${surface} ${String(changes.length)}`);
        return (
          <section key={week} aria-label={`Week of ${weekName(week)}`}>
            <WeekHeading week={week} current={index === 0} />
            <div className={CARD}>
              {lines.length > 0 ? (
                <ul className="list-disc space-y-1.5 pl-5 text-[0.875rem] text-ink leading-[1.45]">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.875rem] text-ink2">
                  {index === 0
                    ? 'This week’s summary is written when the week is over.'
                    : 'No summary was written for this week.'}
                </p>
              )}
              <p className="mt-2 border-line border-t pt-2 text-[0.75rem] text-grey">
                {tally(inWeek)}. Most in: {parts.join(' · ')}.
              </p>
            </div>
          </section>
        );
      })}
    </div>
  );
}
