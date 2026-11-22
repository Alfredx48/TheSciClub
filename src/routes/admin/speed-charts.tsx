import { useEffect, useRef, useState } from 'react';

/**
 * Charts for Page speed (the owner, 2026-11-04). Plain SVG and HTML: the
 * club has no chart library, and two small charts do not need one.
 *
 * Colours are --chart-1 and --chart-2 (index.css), checked for colour
 * blindness against the paper in light and dark. Text stays in ink, never in
 * a series colour; each series also has a name beside its line.
 */

export interface TrendPoint {
  /** The start of the hour or day, ISO. */
  bucket: string;
  loads: number;
  p50: number;
  p90: number;
}

export interface RequestBar {
  metric: string;
  samples: number;
  p50: number;
  p90: number;
  failed: number;
}

/** 850 ms, 1.2 s, 14 s. */
export function seconds(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${String(Math.round(ms / 1000))} s`;
}

/** A round top for the axis: 1, 2 or 5 times a power of ten, at or above `max`. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1000;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}

function bucketLabel(iso: string, unit: 'hour' | 'day', long = false): string {
  const date = new Date(iso);
  if (unit === 'hour') {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      ...(long ? { weekday: 'short' } : {}),
      timeZone: 'America/Los_Angeles',
    });
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(long ? { weekday: 'short' } : {}),
    timeZone: 'America/Los_Angeles',
  });
}

const SERIES = [
  { key: 'p50', name: 'Typical', color: 'var(--chart-1)' },
  { key: 'p90', name: 'Slow end', color: 'var(--chart-2)' },
] as const;

/**
 * How long the app took to be ready, over time: the typical time and the
 * slow end, one axis in seconds. Hover or tap for a bucket's numbers.
 */
export function SpeedTrendChart({
  points,
  unit,
  what = 'How long the app took to be ready',
}: {
  points: TrendPoint[];
  unit: 'hour' | 'day';
  /** What the chart times, said first to a screen reader. */
  what?: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const height = 200;
  const margin = { top: 12, right: 64, bottom: 26, left: 44 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const top = niceMax(Math.max(...points.map((p) => p.p90), 0));
  const ticks = [0, top / 2, top];
  const x = (index: number) =>
    margin.left + (points.length <= 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (ms: number) => margin.top + plotH - (ms / top) * plotH;
  const path = (key: 'p50' | 'p90') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join('');
  // Three or four dates along the bottom, never crowded.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 90))));
  const last = points.length - 1;
  const shown = hover ?? null;
  const point = shown === null ? undefined : points[shown];

  function pick(clientX: number, element: SVGRectElement) {
    if (points.length === 0) return;
    const left = element.getBoundingClientRect().left;
    const fraction = plotW > 0 ? (clientX - left) / plotW : 0;
    setHover(Math.min(last, Math.max(0, Math.round(fraction * last))));
  }

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-ink2">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[3px] w-4 rounded-full"
              style={{ background: s.color }}
            />
            {s.name} ({s.key})
          </span>
        ))}
      </figcaption>
      <div ref={box} className="relative mt-1 w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${what}, ${String(points.length)} ${unit === 'hour' ? 'hours' : 'days'}. The table below has the numbers.`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={margin.left}
                  x2={margin.left + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--line)"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : '2 4'}
                />
                <text
                  x={margin.left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--grey)"
                >
                  {seconds(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % every === 0 || i === last ? (
                <text
                  key={p.bucket}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={
                    i === 0 && points.length > 1 ? 'start' : i === last ? 'end' : 'middle'
                  }
                  fontSize={11}
                  fill="var(--grey)"
                >
                  {bucketLabel(p.bucket, unit)}
                </text>
              ) : null,
            )}
            {shown !== null ? (
              <line
                x1={x(shown)}
                x2={x(shown)}
                y1={margin.top}
                y2={margin.top + plotH}
                stroke="var(--grey)"
                strokeWidth={1}
              />
            ) : null}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path
                  d={path(s.key)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((p, i) =>
                  points.length <= 14 || i === shown || i === last ? (
                    <circle
                      key={p.bucket}
                      cx={x(i)}
                      cy={y(p[s.key])}
                      r={i === shown ? 5 : 4}
                      fill={s.color}
                      stroke="var(--paper)"
                      strokeWidth={2}
                    />
                  ) : null,
                )}
              </g>
            ))}
            {/* Names at the end of each line, kept apart when they meet. */}
            {points.length > 0
              ? (() => {
                  const y50 = y(points[last]?.p50 ?? 0);
                  let y90 = y(points[last]?.p90 ?? 0);
                  if (y50 - y90 < 13) y90 = y50 - 13;
                  return SERIES.map((s) => (
                    <text
                      key={s.key}
                      x={x(last) + 9}
                      y={s.key === 'p50' ? y50 : y90}
                      dy="0.32em"
                      fontSize={11}
                      fill="var(--ink2)"
                    >
                      {s.name}
                    </text>
                  ));
                })()
              : null}
            <rect
              x={margin.left}
              y={margin.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={(event) => {
                pick(event.clientX, event.currentTarget);
              }}
              onPointerDown={(event) => {
                pick(event.clientX, event.currentTarget);
              }}
              onPointerLeave={() => {
                setHover(null);
              }}
            />
          </svg>
        ) : (
          <div style={{ height }} />
        )}
        {shown !== null && point ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-[0.75rem] text-ink shadow-[0_6px_18px_rgba(10,20,35,.18)]"
            style={
              x(shown) > width / 2 ? { right: width - x(shown) + 10 } : { left: x(shown) + 10 }
            }
          >
            <p className="font-bold">{bucketLabel(point.bucket, unit, true)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.name}: {seconds(point[s.key])}
              </p>
            ))}
            <p className="text-ink2 tabular-nums">
              {point.loads} sampled {point.loads === 1 ? 'load' : 'loads'}
            </p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/**
 * The slowest requests, by their slow end (p90), longest first. A dashed line
 * marks 2 seconds. Hover, tap or focus a bar for its numbers.
 */
export function RequestBars({ rows }: { rows: RequestBar[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const top = niceMax(Math.max(...rows.map((r) => r.p90), 0));
  const mark = 2000;
  const share = (ms: number) => `${String(Math.min(100, (ms / top) * 100))}%`;

  return (
    <div className="mt-1">
      <ul className="m-0 list-none space-y-1.5 p-0">
        {rows.map((row) => (
          <li key={row.metric} className="relative">
            <button
              type="button"
              aria-expanded={open === row.metric}
              // Open, not a toggle: a tap has already focused it, and a
              // toggle would close it again at once.
              onClick={() => {
                setOpen(row.metric);
              }}
              onPointerEnter={() => {
                setOpen(row.metric);
              }}
              onPointerLeave={() => {
                setOpen((current) => (current === row.metric ? null : current));
              }}
              onFocus={() => {
                setOpen(row.metric);
              }}
              onBlur={() => {
                setOpen((current) => (current === row.metric ? null : current));
              }}
              className="grid min-h-11 w-full grid-cols-[1fr_3.75rem] items-center gap-x-2 gap-y-0.5 rounded-[8px] px-1 py-1 text-left hover:bg-tint/60"
            >
              <span className="col-span-2 truncate font-mono text-[0.75rem] text-ink">
                {row.metric}
              </span>
              <span className="relative block h-3.5">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px]"
                  style={{ width: share(row.p90), background: 'var(--chart-1)' }}
                />
                {mark < top ? (
                  <span
                    aria-hidden="true"
                    className="absolute -inset-y-1 w-0 border-grey border-l border-dashed"
                    style={{ left: share(mark) }}
                  />
                ) : null}
              </span>
              <span className="text-right text-[0.75rem] text-ink2 tabular-nums">
                {seconds(row.p90)}
              </span>
            </button>
            {open === row.metric ? (
              <div
                role="status"
                className="pointer-events-none absolute right-0 bottom-full z-10 mb-1 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-[0.75rem] text-ink shadow-[0_6px_18px_rgba(10,20,35,.18)]"
              >
                <p className="font-bold font-mono">{row.metric}</p>
                <p className="tabular-nums">
                  Typical {seconds(row.p50)} · slow end {seconds(row.p90)}
                </p>
                <p className="text-ink2 tabular-nums">
                  {row.samples} sampled {row.samples === 1 ? 'request' : 'requests'}
                  {row.failed ? ` · ${String(row.failed)} failed` : ''}
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {mark < top ? (
        <p className="mt-1.5 text-[0.71875rem] text-grey">
          Bars show the slow end (p90). The dashed line is 2 seconds.
        </p>
      ) : (
        <p className="mt-1.5 text-[0.71875rem] text-grey">Bars show the slow end (p90).</p>
      )}
    </div>
  );
}
