import { lazy, Suspense, useEffect, useState } from 'react';
import { SegmentPills } from '@/components/segment-pills';
import { describeError, describeThrown } from '@/lib/describe-error';
import { ONE_VISIT_IN } from '@/lib/page-speed';
import { getSupabase } from '@/lib/supabase';
import {
  RequestBars,
  SpeedTrendChart,
  seconds,
  type TrendPoint,
} from '@/routes/admin/speed-charts';

/**
 * Page speed, for administrators (the owner, 2026-11-04; 20261104010000):
 * how long the app takes to open over time, by screen, and which requests are
 * slowest. p50 is the typical time, p90 the slow end: one in ten took longer.
 * Each chart has a table with the same numbers.
 */

export interface SpeedRow {
  kind: 'load' | 'request';
  screen: string;
  metric: string;
  samples: number;
  visits: number;
  p50: number;
  p90: number;
  max: number;
  failed: number;
}

type Failure = Parameters<typeof describeError>[0];
type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const REFUSAL = 'Could not load page speed.';

async function rows(
  name: string,
  args: Record<string, unknown>,
): Promise<Read<Record<string, unknown>[]>> {
  try {
    const { data, error } = (await getSupabase().rpc(name, args)) as {
      data: Record<string, unknown>[] | null;
      error: Failure | null;
    };
    if (error) return { ok: false, error: describeError(error, REFUSAL) };
    return { ok: true, value: data ?? [] };
  } catch (thrown) {
    return { ok: false, error: describeThrown(thrown, REFUSAL) };
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export async function fetchPageSpeed(days: number): Promise<Read<SpeedRow[]>> {
  const read = await rows('admin_page_speed', { days });
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.map((row) => ({
      kind: row.kind === 'load' ? 'load' : 'request',
      screen: text(row.screen),
      metric: text(row.metric),
      samples: Number(row.samples ?? 0),
      visits: Number(row.visits ?? 0),
      p50: Number(row.p50_ms ?? 0),
      p90: Number(row.p90_ms ?? 0),
      max: Number(row.max_ms ?? 0),
      failed: Number(row.failed ?? 0),
    })),
  };
}

/** One load timing over time (20261105000000): first-paint, cards-after-tap… */
export async function fetchPageSpeedTrend(
  days: number,
  timing: string,
): Promise<Read<TrendPoint[]>> {
  const read = await rows('admin_page_speed_trend', { days, timing });
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.map((row) => ({
      bucket: text(row.bucket),
      loads: Number(row.loads ?? 0),
      p50: Number(row.p50_ms ?? 0),
      p90: Number(row.p90_ms ?? 0),
    })),
  };
}

/** Failed requests by what was asked and why (20261122060000). */
export interface FailureRow {
  metric: string;
  failure: string;
  failed: number;
  visits: number;
  lastAt: string;
}

export async function fetchPageSpeedFailures(days: number): Promise<Read<FailureRow[]>> {
  const read = await rows('admin_page_speed_failures', { days });
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.map((row) => ({
      metric: text(row.metric),
      failure: text(row.failure),
      failed: Number(row.failed ?? 0),
      visits: Number(row.visits ?? 0),
      lastAt: text(row.last_at),
    })),
  };
}

/** A failure's reason in words. */
function why(failure: string): string {
  if (failure === 'no connection') return 'No connection: it never reached the server';
  if (failure === 'not recorded') return 'Not recorded (an app from before Nov 22)';
  const status = Number(failure);
  if (status === 401 || status === 403) return `${failure}: not allowed, or signed out`;
  if (status === 404) return `${failure}: not found`;
  if (status === 409) return `${failure}: clashed with another change`;
  if (status === 429) return `${failure}: too many requests`;
  if (status >= 500) return `${failure}: the server failed`;
  if (status >= 400) return `${failure}: refused`;
  return failure;
}

/** One release's times (20261122030000): typical / slow end, opening, moving, requests. */
export interface ReleaseRow {
  release: string;
  firstSeen: string;
  visits: number;
  openingP50: number | null;
  openingP90: number | null;
  cardsP50: number | null;
  cardsP90: number | null;
  requests: number;
  requestP50: number | null;
  requestP90: number | null;
  failed: number;
}

const msOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function fetchPageSpeedByRelease(days: number): Promise<Read<ReleaseRow[]>> {
  const read = await rows('admin_page_speed_by_release', { days });
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.map((row) => ({
      release: text(row.release),
      firstSeen: text(row.first_seen),
      visits: Number(row.visits ?? 0),
      openingP50: msOrNull(row.opening_p50_ms),
      openingP90: msOrNull(row.opening_p90_ms),
      cardsP50: msOrNull(row.cards_p50_ms),
      cardsP90: msOrNull(row.cards_p90_ms),
      requests: Number(row.requests ?? 0),
      requestP50: msOrNull(row.request_p50_ms),
      requestP90: msOrNull(row.request_p90_ms),
      failed: Number(row.failed ?? 0),
    })),
  };
}

/** A release's build minute (UTC, as built) in Pacific time: "Nov 21, 4:31 PM". */
function releaseName(release: string): string {
  const at = new Date(`${release}Z`);
  if (Number.isNaN(at.getTime())) return release;
  return at.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
}

const pair = (p50: number | null, p90: number | null) =>
  p50 === null || p90 === null ? '—' : `${seconds(p50)} / ${seconds(p90)}`;

/**
 * Release by release, newest first (the owner, 2026-11-21), so a release that
 * made the app slower stands out beside the one before it. Each release is
 * tagged in git as release-<its build minute>.
 */
function ReleaseTable({ releases }: { releases: ReleaseRow[] }) {
  return (
    <div className="mt-1.5 overflow-x-auto rounded-[12px] border border-line bg-paper">
      <table className="w-full text-[0.8125rem] text-ink">
        <thead className="text-grey">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Release</th>
            <th className={HEAD}>Visits</th>
            <th className={HEAD}>Opening</th>
            <th className={HEAD}>Moving between screens</th>
            <th className={HEAD}>Requests</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r.release} className="border-line border-t">
              <td className="px-2 py-1.5 text-left">
                <span className="block font-bold">{releaseName(r.release)}</span>
                <span className="block font-mono text-[0.6875rem] text-grey">
                  release-{r.release.replace(':', '')}
                </span>
              </td>
              <td className={CELL}>{r.visits}</td>
              <td className={CELL}>{pair(r.openingP50, r.openingP90)}</td>
              <td className={CELL}>{pair(r.cardsP50, r.cardsP90)}</td>
              <td className={CELL}>
                {pair(r.requestP50, r.requestP90)}
                {r.failed > 0 ? (
                  <span className="block text-[0.6875rem] text-destructive">{r.failed} failed</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PERIODS = [
  ['1', '24 hours'],
  ['7', '7 days'],
  ['30', '30 days'],
] as const;

/**
 * The screens whose content is timed (CardsShown), and their names here: Events
 * and Peers since 2026-11-04, the rest since 2026-11-21 (the owner: "home feed
 * is arguably the most important").
 */
const CARD_SCREENS = [
  ['/home', 'Home feed'],
  ['/chat', 'Chat list'],
  ['/chat/t/:id', 'A conversation'],
  ['/chat/rooms/:id', 'A room'],
  ['/chat/rooms/:id/topics/:id', 'A post'],
  ['/events', 'Events'],
  ['/events/:id', 'An event'],
  ['/peers', 'Peers'],
  ['/peers/:id', 'A profile'],
  ['/me', 'Me'],
] as const;

/** Cards shown, timed from opening the app and from tapping in. */
const CARD_TIMINGS = [
  ['cards-after-open', 'From opening the app'],
  ['cards-after-tap', 'From tapping in'],
] as const;

const CELL = 'px-2 py-1.5 text-right tabular-nums';
const HEAD = 'px-2 py-1.5 text-right font-semibold';

function Subheading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 font-bold text-[0.875rem] text-ink first:mt-2">{children}</h3>;
}

function TableView({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 font-bold text-[0.8125rem] text-emphasis">
        {label}
      </summary>
      <div className="overflow-x-auto rounded-[12px] border border-line bg-paper">
        <table className="w-full text-[0.8125rem] text-ink">{children}</table>
      </div>
    </details>
  );
}

function TrendTable({ points, unit }: { points: TrendPoint[]; unit: 'hour' | 'day' }) {
  return (
    <TableView label={`The ${unit === 'hour' ? 'hourly' : 'daily'} numbers as a table`}>
      <thead className="text-grey">
        <tr>
          <th className="px-2 py-1.5 text-left font-semibold">
            {unit === 'hour' ? 'Hour' : 'Day'}
          </th>
          <th className={HEAD}>Sampled times</th>
          <th className={HEAD}>Typical</th>
          <th className={HEAD}>Slow end</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.bucket} className="border-line border-t">
            <td className="px-2 py-1.5 text-left">
              {new Date(p.bucket).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                ...(unit === 'hour' ? { hour: 'numeric' } : {}),
                timeZone: 'America/Los_Angeles',
              })}
            </td>
            <td className={CELL}>{p.loads}</td>
            <td className={CELL}>{seconds(p.p50)}</td>
            <td className={CELL}>{seconds(p.p90)}</td>
          </tr>
        ))}
      </tbody>
    </TableView>
  );
}

/** The server's own logs (20261122050000), fetched only once Server is chosen. */
const ServerLogs = lazy(() => import('@/routes/admin/server-logs'));

const VIEWS = [
  ['phones', 'On phones'],
  ['server', 'Server'],
] as const;

/**
 * Speed & logs (the owner, 2026-11-21): how fast the app is on people's
 * phones, and, under Server, how fast the club's server answered, from its own
 * request logs. Reading one asks nothing of the other.
 */
export function PageSpeedSection() {
  const [view, setView] = useState<'phones' | 'server'>('phones');
  return (
    <section aria-labelledby="page-speed-heading">
      <h2 id="page-speed-heading" className="mb-3 font-extrabold font-head text-[1rem] text-ink">
        Speed &amp; logs
      </h2>
      <SegmentPills segments={VIEWS} value={view} onChange={setView} className="pt-0" />
      {view === 'phones' ? (
        <PhoneSpeed />
      ) : (
        <Suspense
          fallback={
            <p role="status" className="py-4 text-[0.8125rem] text-grey">
              Loading…
            </p>
          }
        >
          <ServerLogs />
        </Suspense>
      )}
    </section>
  );
}

function PhoneSpeed() {
  const [days, setDays] = useState<string>('7');
  const [speed, setSpeed] = useState<SpeedRow[] | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [cardsTrend, setCardsTrend] = useState<TrendPoint[] | null>(null);
  const [releases, setReleases] = useState<ReleaseRow[] | null>(null);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSpeed(null);
    setTrend(null);
    setCardsTrend(null);
    setReleases(null);
    setError(null);
    void Promise.all([
      fetchPageSpeed(Number(days)),
      fetchPageSpeedTrend(Number(days), 'first-paint'),
      fetchPageSpeedTrend(Number(days), 'cards-after-tap'),
      fetchPageSpeedByRelease(Number(days)),
      fetchPageSpeedFailures(Number(days)),
    ]).then(([summary, opening, cards, byRelease, failed]) => {
      if (!live) return;
      if (!summary.ok) setError(summary.error);
      else if (!opening.ok) setError(opening.error);
      else if (!cards.ok) setError(cards.error);
      else {
        setSpeed(summary.value);
        setTrend(opening.value);
        setCardsTrend(cards.value);
        // Before 20261122030000 is applied there is nothing by release; the rest still shows.
        setReleases(byRelease.ok ? byRelease.value : []);
        setFailures(failed.ok ? failed.value : []);
      }
    });
    return () => {
      live = false;
    };
  }, [days]);

  const unit = days === '1' ? 'hour' : 'day';
  const loads = speed?.filter((r) => r.kind === 'load') ?? [];
  const cardsOf = (screen: string, timing: string) =>
    loads.find((r) => r.screen === screen && r.metric === timing);
  const firstPaints = loads
    .filter((r) => r.metric === 'first-paint')
    .sort((a, b) => b.samples - a.samples);
  const requests = (speed?.filter((r) => r.kind === 'request') ?? [])
    .slice()
    .sort((a, b) => b.p90 - a.p90)
    .slice(0, 12);

  return (
    <div>
      <SegmentPills segments={PERIODS} value={days} onChange={setDays} className="pt-0" />
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : speed === null || trend === null || cardsTrend === null ? (
        <p role="status" className="py-4 text-[0.8125rem] text-grey">
          Loading…
        </p>
      ) : speed.length === 0 ? (
        <p className="py-4 text-[0.8125rem] text-ink2">Nothing measured in this period yet.</p>
      ) : (
        <>
          <Subheading>By release</Subheading>
          <p className="mt-0.5 text-[0.75rem] text-ink2 leading-[1.45]">
            Newest first, so a release that made the app slower stands out beside the one before it.
            Typical (p50) / slow end (p90).
          </p>
          {releases && releases.length > 0 ? (
            <ReleaseTable releases={releases} />
          ) : (
            <p className="py-2 text-[0.8125rem] text-ink2">No release has been measured yet.</p>
          )}

          <Subheading>Each screen’s content</Subheading>
          <p className="mt-0.5 text-[0.75rem] text-ink2 leading-[1.45]">
            Until the screen shows its content with real data, not the grey placeholders or Loading.
          </p>
          <div className="mt-1.5 overflow-x-auto rounded-[12px] border border-line bg-paper">
            <table className="w-full text-[0.8125rem] text-ink">
              <thead className="text-grey">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Screen</th>
                  {CARD_TIMINGS.map(([timing, label]) => (
                    <th key={timing} className={HEAD}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CARD_SCREENS.map(([screen, name]) => (
                  <tr key={screen} className="border-line border-t">
                    <td className="px-2 py-1.5 text-left font-bold">{name}</td>
                    {CARD_TIMINGS.map(([timing]) => {
                      const row = cardsOf(screen, timing);
                      return (
                        <td key={timing} className={CELL}>
                          {row ? (
                            <>
                              {seconds(row.p50)} / {seconds(row.p90)}
                              <span className="block text-[0.6875rem] text-grey">
                                {row.samples} sampled {row.samples === 1 ? 'time' : 'times'}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[0.71875rem] text-grey">Typical (p50) / slow end (p90).</p>

          <Subheading>Cards after tapping in, {unit === 'hour' ? 'by hour' : 'by day'}</Subheading>
          {cardsTrend.length > 0 ? (
            <>
              <SpeedTrendChart points={cardsTrend} unit={unit} />
              <TrendTable points={cardsTrend} unit={unit} />
            </>
          ) : (
            <p className="py-2 text-[0.8125rem] text-ink2">Nothing timed in this period yet.</p>
          )}

          <Subheading>
            First paint on opening the app, {unit === 'hour' ? 'by hour' : 'by day'}
          </Subheading>
          {trend.length > 0 ? (
            <>
              <SpeedTrendChart points={trend} unit={unit} />
              <TrendTable points={trend} unit={unit} />
            </>
          ) : (
            <p className="py-2 text-[0.8125rem] text-ink2">No app opens in this period.</p>
          )}
          {firstPaints.length > 0 ? (
            <TableView label="First paint by the screen it opened on">
              <thead className="text-grey">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Screen</th>
                  <th className={HEAD}>Sampled opens</th>
                  <th className={HEAD}>Typical</th>
                  <th className={HEAD}>Slow end</th>
                </tr>
              </thead>
              <tbody>
                {firstPaints.map((row) => (
                  <tr key={row.screen} className="border-line border-t">
                    <td className="px-2 py-1.5 text-left font-mono text-[0.75rem]">{row.screen}</td>
                    <td className={CELL}>{row.samples}</td>
                    <td className={CELL}>{seconds(row.p50)}</td>
                    <td className={CELL}>{seconds(row.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </TableView>
          ) : null}

          <Subheading>Slowest requests</Subheading>
          {requests.length > 0 ? (
            <>
              <RequestBars rows={requests} />
              <TableView label="The requests as a table">
                <thead className="text-grey">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">Request</th>
                    <th className={HEAD}>Sampled</th>
                    <th className={HEAD}>Typical</th>
                    <th className={HEAD}>Slow end</th>
                    <th className={HEAD}>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((row) => (
                    <tr key={row.metric} className="border-line border-t">
                      <td className="px-2 py-1.5 text-left font-mono text-[0.75rem]">
                        {row.metric}
                      </td>
                      <td className={CELL}>{row.samples}</td>
                      <td className={CELL}>{seconds(row.p50)}</td>
                      <td className={CELL}>{seconds(row.p90)}</td>
                      <td className={CELL}>{row.failed || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </TableView>
            </>
          ) : (
            <p className="py-2 text-[0.8125rem] text-ink2">No requests in this period.</p>
          )}

          <Subheading>Failed requests</Subheading>
          <p className="mt-0.5 text-[0.75rem] text-ink2 leading-[1.45]">
            What failed, and why. A request cancelled by leaving a screen is not counted.
          </p>
          {failures.length > 0 ? (
            <div className="mt-1.5 overflow-x-auto rounded-[12px] border border-line bg-paper">
              <table className="w-full text-[0.8125rem] text-ink">
                <thead className="text-grey">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">Request</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Why</th>
                    <th className={HEAD}>Failed</th>
                    <th className={HEAD}>Visits</th>
                    <th className={HEAD}>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((f) => (
                    <tr key={`${f.metric}-${f.failure}`} className="border-line border-t">
                      <td className="px-2 py-1.5 text-left font-mono text-[0.75rem]">{f.metric}</td>
                      <td className="px-2 py-1.5 text-left text-[0.78125rem]">{why(f.failure)}</td>
                      <td className={CELL}>{f.failed}</td>
                      <td className={CELL}>{f.visits}</td>
                      <td className={CELL}>
                        {new Date(f.lastAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: 'America/Los_Angeles',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-2 text-[0.8125rem] text-ink2">Nothing failed in this period.</p>
          )}
        </>
      )}
      <p className="mt-2 text-[0.75rem] text-grey leading-[1.45]">
        Measured on people’s own devices, not tied to anybody, and kept 30 days. One visit in{' '}
        {ONE_VISIT_IN} is measured, so every count here is a sample, about 1/{ONE_VISIT_IN} of the
        real number. Typical (p50) is the middle time; the slow end (p90) is where one in ten took
        longer.
      </p>
    </div>
  );
}
