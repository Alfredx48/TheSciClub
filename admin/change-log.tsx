import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { PageTabs, TabPanel, useTabParam } from '@/components/page-tabs';
import { cn } from '@/lib/utils';

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
  /** The iPhone app version built at this change: it has this and everything before it. */
  ios?: string;
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

export function ChangeLog() {
  const [part, setPart] = useTabParam(PARTS, 'tests', undefined, 'log');
  const [log, setLog] = useState<ChangeLogData | 'loading' | 'failed'>('loading');
  // What the test site says is waiting now; null until it answers, or if it does not.
  const [fresh, setFresh] = useState<{ built: string; waiting: Change[] } | null>(null);
  // The change By surface was asked to show in On main.
  const [focus, setFocus] = useState<string | null>(null);

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
    <div className="pt-3">
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
          <OnTests changes={waiting.changes} asOf={waiting.asOf} live={waiting.live} />
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
        {change.surface} · {change.by} ·{' '}
        <a
          href={`${REPOSITORY}/commit/${change.sha}`}
          aria-label={`The code of this change, ${change.sha}`}
          className="underline underline-offset-2"
        >
          code
        </a>
      </p>
    </li>
  );
}

function OnTests({
  changes,
  asOf,
  live,
}: {
  changes: Change[];
  asOf: string | null;
  live: boolean;
}) {
  return (
    <div>
      <Note>
        {count(changes.length, 'change')} on the test site and not on the live site yet: what the
        next push to the live site will bring. A change marked “No entry” has no summary written yet
        (asked for from November 26).{' '}
        {asOf
          ? live
            ? `Checked ${when(asOf)} Pacific, when the test site or the live site was last pushed.`
            : `As of ${when(asOf)} Pacific, when this site was last built: the test site did not answer for anything newer.`
          : null}
      </Note>
      {changes.length === 0 ? (
        <p className={cn(CARD, 'mt-3 text-[0.875rem] text-ink')}>
          Nothing is waiting: everything on the test site is live.
        </p>
      ) : (
        <ul className={cn(CARD, 'mt-3 divide-y divide-line py-1')}>
          {changes.map((change) => (
            <ChangeRow key={change.sha} change={change} shots="/on-tests/shots/" wantsEntry />
          ))}
        </ul>
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
}

/** A week's changes by surface, the part of the club they touched, in the surfaces' own order. */
function bySurface(releases: Release[], surfaces: string[]): [string, Dated[]][] {
  const found = new Map<string, Dated[]>();
  for (const release of releases) {
    for (const change of release.changes) {
      found.set(change.surface, [
        ...(found.get(change.surface) ?? []),
        { change, day: release.day },
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
  const weeks = useMemo(() => byWeek(releases), [releases]);
  const { isOpen, open } = useOpenWeeks(weeks);
  return (
    <div>
      <Note>
        Each week’s changes grouped by surface: the part of the club they touched. Tap a change to
        see it in On main. The surface comes from the change’s entry, or else is worked out from the
        files it changed.
      </Note>
      {weeks.map(([week, inWeek], index) => (
        <section key={week} aria-label={`Week of ${weekName(week)}`}>
          <WeekHeading week={week} current={index === 0}>
            {count(changesIn(inWeek), 'change')}
          </WeekHeading>
          {isOpen(week, index) ? (
            <div className="space-y-2">
              {bySurface(inWeek, surfaces).map(([surface, changes]) => (
                <details key={surface} className={CARD}>
                  <summary className="min-h-11 cursor-pointer content-center font-semibold text-[0.875rem] text-ink">
                    {surface}{' '}
                    <span className="font-normal text-grey">({String(changes.length)})</span>
                  </summary>
                  <ul className="divide-y divide-line text-[0.8125rem]">
                    {changes.map(({ change, day }) => (
                      <li key={change.sha}>
                        <button
                          type="button"
                          onClick={() => {
                            onShow(change.sha);
                          }}
                          className="block w-full py-2 text-left leading-[1.4]"
                        >
                          <span className="text-ink underline decoration-grey underline-offset-2">
                            {change.entry?.title ?? change.title}
                          </span>
                          <span className="mt-0.5 block text-[0.6875rem] text-grey">
                            {dayName(day)} · {change.by}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
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
