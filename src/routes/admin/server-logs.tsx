import { useEffect, useState } from 'react';
import { SegmentPills } from '@/components/segment-pills';
import { describeError, describeThrown } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';
import { SpeedTrendChart, seconds, type TrendPoint } from '@/routes/admin/speed-charts';

/**
 * Admin › Speed & logs › Server (the owner, 2026-11-21; 20261122050000): the
 * club's own copy of every request's server time (20261122040000), read four
 * ways. When was it slow (the timeline and its slowest hours), what was slow
 * then (a stretch of time's requests, devices and slowest requests), what was
 * that visit doing (one visit's requests in order, nobody named), and was it
 * the database (its queries then, beside their usual time).
 *
 * Loaded only when an administrator opens it, and each read is over a
 * bounded stretch of time, so nothing a member does waits on it.
 */

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
type Failure = Parameters<typeof describeError>[0];

const REFUSAL = 'Could not load the request logs.';

async function call<T>(name: string, args: Record<string, unknown>): Promise<Read<T>> {
  try {
    const { data, error } = (await getSupabase().rpc(name, args)) as {
      data: T | null;
      error: Failure | null;
    };
    if (error) return { ok: false, error: describeError(error, REFUSAL) };
    if (data === null) return { ok: false, error: REFUSAL };
    return { ok: true, value: data };
  } catch (thrown) {
    return { ok: false, error: describeThrown(thrown, REFUSAL) };
  }
}

interface TimelineRow {
  bucket: string;
  requests: number;
  p50_ms: number | null;
  p90_ms: number | null;
  errors: number;
}

interface EndpointRow {
  endpoint: string;
  requests: number;
  p50_ms: number;
  p90_ms: number;
  max_ms: number;
  errors: number;
}

interface SlowRequest {
  at: string;
  endpoint: string;
  /** Null only for a failed request that was never answered. */
  ms: number | null;
  status: number | null;
  device: string | null;
  visit: string | null;
}

interface WindowRead {
  requests: number;
  visits: number;
  endpoints: EndpointRow[];
  devices: { device: string; requests: number; p50_ms: number; p90_ms: number }[];
  slowest: SlowRequest[];
  /** Refused or failed, earliest first (20261122080000); absent before it. */
  failed?: SlowRequest[];
}

interface VisitStep {
  at: string;
  endpoint: string;
  method: string;
  ms: number | null;
  status: number | null;
}

interface QueryRow {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number | null;
  usual_mean_ms: number | null;
}

const PERIODS = [
  ['1', '24 hours'],
  ['7', '7 days'],
  ['90', '90 days'],
] as const;

const CELL = 'px-2 py-1.5 text-right tabular-nums';
const HEAD = 'px-2 py-1.5 text-right font-semibold';
const LEFT = 'px-2 py-1.5 text-left';

const DEVICES: Record<string, string> = {
  iphone: 'iPhone',
  android: 'Android',
  phone: 'Other phone',
  computer: 'Computer',
  server: 'The club’s own jobs',
  unknown: 'Unknown',
};

function when(iso: string, withDay = true): string {
  return new Date(iso).toLocaleString('en-US', {
    ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    second: withDay ? undefined : '2-digit',
    timeZone: 'America/Los_Angeles',
  });
}

/** To the second, with the day: when a failure happened. */
function whenToSecond(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
}

/** A datetime-local value, in Pacific time as the club's are. */
function localInput(date: Date): string {
  const pacific = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pacific.getFullYear()}-${pad(pacific.getMonth() + 1)}-${pad(pacific.getDate())}T${pad(pacific.getHours())}:${pad(pacific.getMinutes())}`;
}

/** Back from Pacific time: the offset of that moment in Los Angeles. */
function fromInput(value: string): Date | null {
  const naive = new Date(`${value}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const pacific = new Date(naive.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const utc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive.getTime() + (utc.getTime() - pacific.getTime()));
}

/** What a failed request's status means, in a few words. */
function failureMeaning(status: number | null): string {
  if (!status) return 'never answered: the connection dropped or the phone gave up';
  if (status === 401) return 'not signed in: the sign-in was missing or had run out';
  if (status === 403) return 'not allowed';
  if (status === 404) return 'not found';
  if (status === 409) return 'clashed with something already saved';
  if (status === 429) return 'too many requests at once';
  if (status >= 500) return 'the server failed';
  return 'refused: the request was not one the server would take';
}

function Subheading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 font-bold text-[0.875rem] text-ink first:mt-2">{children}</h3>;
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 overflow-x-auto rounded-[12px] border border-line bg-paper">
      <table className="w-full text-[0.8125rem] text-ink">{children}</table>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="py-2 text-[0.8125rem] text-destructive">
      {text}
    </p>
  );
}

function Loading() {
  return (
    <p role="status" className="py-2 text-[0.8125rem] text-grey">
      Loading…
    </p>
  );
}

export default function ServerLogs() {
  const [days, setDays] = useState<string>('1');
  const [timeline, setTimeline] = useState<Read<TimelineRow[]> | null>(null);
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null);

  useEffect(() => {
    let live = true;
    setTimeline(null);
    void call<TimelineRow[]>('admin_request_timeline', { p_days: Number(days) }).then((read) => {
      if (live) setTimeline(read);
    });
    return () => {
      live = false;
    };
  }, [days]);

  const unit = Number(days) <= 7 ? 'hour' : 'day';
  const rows = timeline?.ok ? timeline.value : [];
  const points: TrendPoint[] = rows
    .filter((r) => r.p50_ms !== null && r.p90_ms !== null)
    .map((r) => ({ bucket: r.bucket, loads: r.requests, p50: r.p50_ms ?? 0, p90: r.p90_ms ?? 0 }));
  // The slowest hours (or days) with enough requests to say something.
  const slowest = rows
    .filter((r) => r.requests >= 10 && r.p90_ms !== null)
    .sort((a, b) => (b.p90_ms ?? 0) - (a.p90_ms ?? 0))
    .slice(0, 5);
  const span = unit === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  return (
    <div>
      <p className="mt-1 text-[0.75rem] text-ink2 leading-[1.45]">
        How long the club’s server took to answer every request, from its own logs: who asked is
        never kept. If the server was quick and phones were slow, look at phones and their network.
      </p>

      <Subheading>When was it slow?</Subheading>
      <SegmentPills segments={PERIODS} value={days} onChange={setDays} className="pt-0" />
      {timeline === null ? (
        <Loading />
      ) : !timeline.ok ? (
        <Problem text={timeline.error} />
      ) : points.length === 0 ? (
        <p className="py-2 text-[0.8125rem] text-ink2">No requests kept for this period yet.</p>
      ) : (
        <>
          <SpeedTrendChart points={points} unit={unit} what="How long the server took to answer" />
          {slowest.length > 0 ? (
            <>
              <p className="mt-2 text-[0.75rem] text-ink2">
                The slowest {unit === 'hour' ? 'hours' : 'days'}: open one to see what was slow.
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {slowest.map((r) => (
                  <button
                    key={r.bucket}
                    type="button"
                    onClick={() => {
                      const from = new Date(r.bucket);
                      setRange({ from, to: new Date(from.getTime() + span) });
                    }}
                    className="min-h-11 rounded-full border border-line px-3 text-[0.78125rem] text-ink hover:bg-tint"
                  >
                    {new Date(r.bucket).toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      ...(unit === 'hour' ? { hour: 'numeric' } : {}),
                      timeZone: 'America/Los_Angeles',
                    })}{' '}
                    · {seconds(r.p90_ms ?? 0)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <Subheading>What was slow then?</Subheading>
      <RangePicker
        range={range}
        onLook={(from, to) => {
          setRange({ from, to });
        }}
      />
      {range ? (
        <Moment key={`${range.from.toISOString()}-${range.to.toISOString()}`} range={range} />
      ) : null}
    </div>
  );
}

function RangePicker({
  range,
  onLook,
}: {
  range: { from: Date; to: Date } | null;
  onLook: (from: Date, to: Date) => void;
}) {
  const now = new Date();
  const [from, setFrom] = useState(
    localInput(range?.from ?? new Date(now.getTime() - 60 * 60 * 1000)),
  );
  const [to, setTo] = useState(localInput(range?.to ?? now));
  useEffect(() => {
    if (range) {
      setFrom(localInput(range.from));
      setTo(localInput(range.to));
    }
  }, [range]);
  const start = fromInput(from);
  const end = fromInput(to);
  const ok = start !== null && end !== null && end > start;
  return (
    <form
      className="mt-1 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (start && end && ok) onLook(start, end);
      }}
    >
      <label className="flex flex-col text-[0.75rem] text-ink2">
        From (Pacific)
        <input
          type="datetime-local"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
          }}
          className="mt-0.5 min-h-11 rounded-[10px] border border-line bg-paper px-2 text-[0.8125rem] text-ink"
        />
      </label>
      <label className="flex flex-col text-[0.75rem] text-ink2">
        To
        <input
          type="datetime-local"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
          }}
          className="mt-0.5 min-h-11 rounded-[10px] border border-line bg-paper px-2 text-[0.8125rem] text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={!ok}
        className="min-h-11 rounded-full bg-action px-4 font-bold text-[0.8125rem] text-white disabled:opacity-40"
      >
        Look
      </button>
      <p className="w-full text-[0.71875rem] text-grey">Up to a day at a time.</p>
    </form>
  );
}

function Moment({ range }: { range: { from: Date; to: Date } }) {
  const [moment, setMoment] = useState<Read<WindowRead> | null>(null);
  const [queries, setQueries] = useState<Read<QueryRow[]> | null>(null);
  const [visit, setVisit] = useState<(SlowRequest & { list: 'failed' | 'slowest' }) | null>(null);

  useEffect(() => {
    let live = true;
    const args = { p_from: range.from.toISOString(), p_to: range.to.toISOString() };
    void Promise.all([
      call<WindowRead>('admin_request_window', args),
      call<QueryRow[]>('admin_query_window', args),
    ]).then(([w, q]) => {
      if (!live) return;
      setMoment(w);
      setQueries(q);
    });
    return () => {
      live = false;
    };
  }, [range]);

  if (moment === null) return <Loading />;
  if (!moment.ok) return <Problem text={moment.error} />;
  const m = moment.value;
  if (m.requests === 0) {
    return <p className="py-2 text-[0.8125rem] text-ink2">No requests kept for that time.</p>;
  }

  return (
    <div>
      <p className="mt-2 text-[0.8125rem] text-ink">
        {when(range.from.toISOString())} to {when(range.to.toISOString())}:{' '}
        <strong>{m.requests}</strong> requests from <strong>{m.visits}</strong>{' '}
        {m.visits === 1 ? 'visit' : 'visits'}.
      </p>

      <Table>
        <thead className="text-grey">
          <tr>
            <th className={`${LEFT} font-semibold`}>Request, slowest first</th>
            <th className={HEAD}>Requests</th>
            <th className={HEAD}>Typical</th>
            <th className={HEAD}>Slow end</th>
            <th className={HEAD}>Slowest</th>
            <th className={HEAD}>Failed</th>
          </tr>
        </thead>
        <tbody>
          {m.endpoints.map((e) => (
            <tr key={e.endpoint} className="border-line border-t">
              <td className={`${LEFT} font-mono text-[0.75rem]`}>{e.endpoint}</td>
              <td className={CELL}>{e.requests}</td>
              <td className={CELL}>{seconds(e.p50_ms)}</td>
              <td className={CELL}>{seconds(e.p90_ms)}</td>
              <td className={CELL}>{seconds(e.max_ms)}</td>
              <td className={CELL}>{e.errors || '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Subheading>By kind of device</Subheading>
      <Table>
        <thead className="text-grey">
          <tr>
            <th className={`${LEFT} font-semibold`}>Device</th>
            <th className={HEAD}>Requests</th>
            <th className={HEAD}>Typical</th>
            <th className={HEAD}>Slow end</th>
          </tr>
        </thead>
        <tbody>
          {m.devices.map((d) => (
            <tr key={d.device} className="border-line border-t">
              <td className={LEFT}>{DEVICES[d.device] ?? d.device}</td>
              <td className={CELL}>{d.requests}</td>
              <td className={CELL}>{seconds(d.p50_ms)}</td>
              <td className={CELL}>{seconds(d.p90_ms)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Subheading>Failed requests</Subheading>
      {m.failed === undefined ? null : m.failed.length === 0 ? (
        <p className="text-[0.8125rem] text-ink2">None failed then.</p>
      ) : (
        <>
          <p className="text-[0.75rem] text-ink2">
            Every request refused or failed then, earliest first. Open one to see what that visit
            did around it.
          </p>
          <ul className="mt-1.5 divide-y divide-line rounded-[12px] border border-line bg-paper">
            {m.failed.map((f, i) => (
              <li key={`${f.at}-${String(i)}`}>
                <button
                  type="button"
                  disabled={!f.visit}
                  onClick={() => {
                    setVisit({ ...f, list: 'failed' });
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-tint disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[0.75rem] text-ink">
                      {f.endpoint}
                    </span>
                    <span className="block text-[0.71875rem] text-grey">
                      {whenToSecond(f.at)} · {DEVICES[f.device ?? 'unknown'] ?? f.device}
                      {f.visit ? '' : ' · before signing in'}
                    </span>
                    <span className="block text-[0.71875rem] text-destructive">
                      {f.status ? String(f.status) : 'No answer'}: {failureMeaning(f.status)}
                    </span>
                  </span>
                  {f.ms === null ? null : (
                    <span className="flex-none font-bold tabular-nums">{seconds(f.ms)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {visit?.visit && visit.list === 'failed' ? (
            <VisitTrail
              key={`${visit.visit}-${visit.at}`}
              visit={visit.visit}
              around={visit.at}
              slow={visit}
              onClose={() => {
                setVisit(null);
              }}
            />
          ) : null}
        </>
      )}

      <Subheading>The slowest requests</Subheading>
      <p className="text-[0.75rem] text-ink2">
        Open one to see what that visit did, in order. Nobody is named: a visit is a scrambled
        session that cannot be traced to a member.
      </p>
      <ul className="mt-1.5 divide-y divide-line rounded-[12px] border border-line bg-paper">
        {m.slowest.map((s, i) => (
          <li key={`${s.at}-${String(i)}`}>
            <button
              type="button"
              disabled={!s.visit}
              onClick={() => {
                setVisit({ ...s, list: 'slowest' });
              }}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-tint disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-[0.75rem] text-ink">
                  {s.endpoint}
                </span>
                <span className="block text-[0.71875rem] text-grey">
                  {when(s.at)} · {DEVICES[s.device ?? 'unknown'] ?? s.device}
                  {s.status && s.status >= 400 ? ` · failed (${String(s.status)})` : ''}
                  {s.visit ? '' : ' · before signing in'}
                </span>
              </span>
              <span className="flex-none font-bold tabular-nums">{seconds(s.ms ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>
      {visit?.visit && visit.list === 'slowest' ? (
        <VisitTrail
          key={`${visit.visit}-${visit.at}`}
          visit={visit.visit}
          around={visit.at}
          slow={visit}
          onClose={() => {
            setVisit(null);
          }}
        />
      ) : null}

      <Subheading>Was it the database?</Subheading>
      <p className="text-[0.75rem] text-ink2">
        The queries that took the most time then, and their usual time over the week before.
      </p>
      {queries === null ? (
        <Loading />
      ) : !queries.ok ? (
        <Problem text={queries.error} />
      ) : queries.value.length === 0 ? (
        <p className="py-2 text-[0.8125rem] text-ink2">No query timings kept for that time.</p>
      ) : (
        <Table>
          <thead className="text-grey">
            <tr>
              <th className={`${LEFT} font-semibold`}>Query</th>
              <th className={HEAD}>Times run</th>
              <th className={HEAD}>Each, then</th>
              <th className={HEAD}>Each, usually</th>
            </tr>
          </thead>
          <tbody>
            {queries.value.map((q) => {
              const slower =
                q.mean_ms !== null &&
                q.usual_mean_ms !== null &&
                q.mean_ms >= q.usual_mean_ms * 1.5 &&
                q.mean_ms - q.usual_mean_ms >= 20;
              return (
                <tr key={q.query} className="border-line border-t">
                  <td
                    className={`${LEFT} max-w-[16rem] truncate font-mono text-[0.71875rem]`}
                    title={q.query}
                  >
                    {q.query}
                  </td>
                  <td className={CELL}>{q.calls}</td>
                  <td className={`${CELL} ${slower ? 'font-bold text-destructive' : ''}`}>
                    {q.mean_ms === null ? '—' : seconds(q.mean_ms)}
                    {slower ? ' ↑' : ''}
                  </td>
                  <td className={CELL}>
                    {q.usual_mean_ms === null ? '—' : seconds(q.usual_mean_ms)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function VisitTrail({
  visit,
  around,
  slow,
  onClose,
}: {
  visit: string;
  around: string;
  slow: SlowRequest;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState<Read<VisitStep[]> | null>(null);
  useEffect(() => {
    let live = true;
    void call<VisitStep[]>('admin_request_visit', { p_visit: visit, p_around: around }).then(
      (read) => {
        if (live) setSteps(read);
      },
    );
    return () => {
      live = false;
    };
  }, [visit, around]);

  return (
    <section
      aria-label="What that visit did"
      className="mt-2 rounded-[12px] border border-emphasis bg-paper p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-bold text-[0.8125rem] text-ink">What that visit did</h4>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full px-3 font-semibold text-[0.78125rem] text-emphasis hover:bg-tint"
        >
          Close
        </button>
      </div>
      {steps === null ? (
        <Loading />
      ) : !steps.ok ? (
        <Problem text={steps.error} />
      ) : (
        <ol className="mt-1 max-h-[22rem] overflow-y-auto text-[0.78125rem]">
          {steps.value.map((step, i) => {
            const isSlow = step.at === slow.at && step.endpoint === slow.endpoint;
            return (
              <li
                key={`${step.at}-${String(i)}`}
                className={`flex justify-between gap-2 border-line border-t px-1 py-1 first:border-t-0 ${isSlow ? 'bg-tint font-bold' : ''}`}
              >
                <span className="min-w-0 truncate">
                  <span className="text-grey tabular-nums">{when(step.at, false)}</span>{' '}
                  <span className="font-mono text-[0.75rem]">{step.endpoint}</span>
                  {step.status && step.status >= 400 ? (
                    <span className="text-destructive"> failed ({step.status})</span>
                  ) : null}
                </span>
                <span className="flex-none tabular-nums">
                  {step.ms === null ? '—' : seconds(step.ms)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
