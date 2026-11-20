import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  loadStrikeThreads,
  type StrikeThreadListing,
  strikePath,
} from '@/lib/strike-conversations';
import { ruleName } from '@/lib/strike-rules';

/** How many show before "Show all". */
const FIRST = 8;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Admin → Reports: every strike and flag of the last year, each the way to its conversation
 * (20261120120000; the owner, 2026-11-20: every administrator sees and answers). The ones where
 * the member spoke last come first. A flag never says whose it is.
 */
export function StrikeThreadsSection() {
  const [threads, setThreads] = useState<StrikeThreadListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const run = { live: true };
    void loadStrikeThreads().then((result) => {
      if (!run.live) return;
      if (result.ok) setThreads(result.value);
      else setError(result.error);
    });
    return () => {
      run.live = false;
    };
  }, []);

  const ordered = threads
    ? [...threads.filter((t) => t.waiting), ...threads.filter((t) => !t.waiting)]
    : [];
  const shown = all ? ordered : ordered.slice(0, FIRST);

  return (
    <section aria-labelledby="strike-threads" className="mt-6">
      <h2
        id="strike-threads"
        className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
      >
        Strikes and flags
      </h2>
      <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
        Strikes and flags from the past year, with what members said in response. Any administrator
        can answer, signed “An administrator”, or withdraw one.
      </p>
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : threads === null ? (
        <p className="text-[0.8125rem] text-grey">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="text-[0.8125rem] text-grey">No strikes or flags in the last year.</p>
      ) : (
        <ul className="overflow-hidden rounded-[14px] border border-line bg-paper">
          {shown.map((thread) => (
            <li
              key={`${thread.kind}:${thread.id}`}
              className="border-line border-b last:border-b-0"
            >
              <Link
                to={strikePath(thread.kind, thread.id)}
                className="block px-3.5 py-3 hover:bg-tint"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 font-bold text-[0.84375rem] text-ink">
                    {thread.kind === 'flag'
                      ? 'Anonymous post flagged'
                      : (thread.memberName ?? 'A member')}
                    {' · '}
                    {ruleName(thread.rule) ?? 'No rule given'}
                  </span>
                  <span className="flex-none text-[0.75rem] text-grey">
                    {day(thread.lastAt ?? thread.givenAt)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[0.8125rem] text-ink2">
                  {thread.reason}
                </span>
                <span className="mt-1 block text-[0.75rem] text-grey">
                  {thread.withdrawnAt ? 'Withdrawn · ' : ''}
                  {thread.messages === 0
                    ? 'No messages yet'
                    : thread.messages === 1
                      ? '1 message'
                      : `${thread.messages} messages`}
                  {thread.waiting ? (
                    <span className="font-bold text-destructive"> · Waiting for an answer</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!all && ordered.length > FIRST ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
          }}
          className="mt-2 font-semibold text-[0.8125rem] text-emphasis underline"
        >
          Show all {ordered.length}
        </button>
      ) : null}
    </section>
  );
}
