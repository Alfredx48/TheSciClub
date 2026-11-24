import { X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useAccount } from '@/lib/account';
import {
  type DebugScreen,
  type DebugState,
  debugChain,
  debugMs,
  debugReport,
  debugState,
  markParts,
  mediaSummary,
  subscribeDebug,
  summarize,
} from '@/lib/debug-log';
import { cn } from '@/lib/utils';

/**
 * An administrator's debug mode (the owner, 2026-11-18): how long each
 * request on this screen took, and when. A small pill over the corner of
 * every screen, opening a list with a bar for each request on one time line,
 * so what waited for what can be seen. Lib and switch: lib/debug-log.ts,
 * routes/me/debug-mode.tsx.
 *
 * Nothing for anybody else, whatever their browser's storage says.
 */
export function DebugPanel() {
  const { isAdmin } = useAccount();
  const state = useSyncExternalStore(subscribeDebug, debugState, debugState);
  if (!state.enabled || !isAdmin) return null;
  return <DebugPanelView state={state} />;
}

/** The pill and its list, for whoever `DebugPanel` let through. */
export function DebugPanelView({
  state,
  startOpen = false,
}: {
  state: DebugState;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  /** A screen before this one, by its id; null is the one now shown. */
  const [chosen, setChosen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const latest = state.screens[state.screens.length - 1];
  const screen = state.screens.find((each) => each.id === chosen) ?? latest;
  const summary = screen ? summarize(screen) : null;

  if (!open) {
    const now = latest ? summarize(latest) : null;
    return (
      <button
        type="button"
        onClick={() => {
          setChosen(null);
          setOpen(true);
        }}
        aria-label="Debug: request times for this screen"
        data-target="small"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 z-40 rounded-full bg-ink px-3 py-1.5 font-mono font-semibold text-[0.75rem] text-paper opacity-90 shadow-lg md:bottom-3"
      >
        {now ? `${now.count} req · ${debugMs(latest?.cardsMs ?? now.lastReplyMs)}` : 'debug'}
      </button>
    );
  }

  return (
    <section
      aria-label="Debug: request times"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-[480px] flex-col rounded-t-[20px] border border-line bg-paper shadow-2xl md:right-3 md:left-auto md:mx-0"
    >
      <header className="flex flex-none items-start gap-2 border-line border-b px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-extrabold font-head text-[1rem] text-ink">Request times</h2>
          {/* The screen now shown, or one before it. */}
          <select
            aria-label="Screen"
            value={screen?.id ?? ''}
            onChange={(event) => {
              setChosen(Number(event.target.value));
            }}
            className="mt-1 min-h-[36px] w-full rounded-[10px] border border-line bg-paper px-2 font-mono text-[0.8125rem] text-ink"
          >
            {[...state.screens].reverse().map((each, at) => (
              <option key={each.id} value={each.id}>
                {at === 0 ? 'This screen: ' : ''}
                {each.path}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          aria-label="Close request times"
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-tint text-ink"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {screen && summary ? (
          <>
            <Summary screen={screen} />
            {/* What the columns and the bars are. */}
            <p className="mt-3 flex items-baseline gap-2 font-semibold text-[0.6875rem] text-grey uppercase tracking-[0.08em]">
              <span className="min-w-0 flex-1">
                Request · bars from 0 to {debugMs(wholeOf(screen))}
              </span>
              <span className="flex-none">Started</span>
              <span className="w-[4.5rem] flex-none text-right">Took</span>
            </p>
            <ol className="mt-1.5 space-y-2 pb-3">
              {[...screen.requests]
                .sort((a, b) => a.at - b.at)
                .map((request, at) => {
                  const whole = wholeOf(screen);
                  // Asked once the screen had loaded: marking a post seen, the badges.
                  const later = request.at > whole;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a log, only added to
                    <li key={at}>
                      <p className="flex items-baseline gap-2 font-mono text-[0.75rem] text-ink">
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {request.ok ? '' : '✕ '}
                          {request.endpoint}
                        </span>
                        <span className="flex-none text-ink2">
                          {later
                            ? `later, +${debugMs(request.at)}`
                            : `+${Math.round(request.at)} ms`}
                        </span>
                        <span
                          className={cn('w-[4.5rem] flex-none text-right font-bold', 'text-ink')}
                        >
                          {debugMs(request.ms)}
                        </span>
                      </p>
                      {/* One time line for the screen: where the bar starts is when it was asked. */}
                      {later ? null : (
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-tint">
                          <div
                            className={cn(
                              'h-1.5 rounded-full',
                              request.ok ? 'bg-emphasis' : 'bg-destructive',
                            )}
                            style={{
                              marginLeft: `${(request.at / whole) * 100}%`,
                              width: `max(3px, ${(request.ms / whole) * 100}%)`,
                            }}
                          />
                        </div>
                      )}
                      {request.detail ? (
                        <p className="mt-0.5 font-mono text-[0.6875rem] text-grey [overflow-wrap:anywhere]">
                          {request.detail}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
            </ol>
            <Media screen={screen} />
          </>
        ) : (
          <p className="py-6 text-center text-[0.875rem] text-grey">
            Nothing yet. Open a screen and its requests are listed here.
          </p>
        )}
      </div>

      <footer className="flex flex-none items-center gap-3 border-line border-t px-4 py-2.5">
        <button
          type="button"
          disabled={!screen}
          onClick={() => {
            if (!screen) return;
            void navigator.clipboard.writeText(debugReport(screen)).then(
              () => {
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                }, 2000);
              },
              () => undefined,
            );
          }}
          className="min-h-[44px] rounded-[12px] bg-action px-4 font-bold font-head text-[0.875rem] text-white disabled:opacity-50"
        >
          {copied ? 'Copied' : 'Copy as text'}
        </button>
        <p className="min-w-0 flex-1 text-[0.75rem] text-grey leading-[1.35]">
          Only you see this, on this device. Turn it off in Me, under Settings.
        </p>
      </footer>
    </section>
  );
}

/** The end of the time line: the screen's loading, and whatever it said was drawn. */
function wholeOf(screen: DebugScreen): number {
  return Math.max(
    summarize(screen).lastReplyMs,
    screen.cardsMs ?? 0,
    ...screen.marks.map((mark) => mark.ms),
    1,
  );
}

/**
 * The screen's photographs, link pictures and YouTube players, each from when
 * the browser began on it to loaded, on a time line of their own (the owner,
 * 2026-11-23).
 */
function Media({ screen }: { screen: DebugScreen }) {
  if (screen.media.length === 0) return null;
  const whole = Math.max(...screen.media.map((media) => media.at + media.ms), 1);
  return (
    <>
      <h3 className="mt-1 font-bold font-head text-[0.875rem] text-ink">Pictures and videos</h3>
      <p className="mt-1.5 flex items-baseline gap-2 font-semibold text-[0.6875rem] text-grey uppercase tracking-[0.08em]">
        <span className="min-w-0 flex-1">What · bars from 0 to {debugMs(whole)}</span>
        <span className="flex-none">Started</span>
        <span className="w-[4.5rem] flex-none text-right">Took</span>
      </p>
      <ol aria-label="Pictures and videos" className="mt-1 space-y-2 pb-3">
        {[...screen.media]
          .sort((a, b) => a.at - b.at)
          .map((media, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a log, only added to
            <li key={at}>
              <p className="flex items-baseline gap-2 font-mono text-[0.75rem] text-ink">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {media.ok ? '' : '✕ '}
                  {media.kind}
                </span>
                <span className="flex-none text-ink2">+{Math.round(media.at)} ms</span>
                <span className="w-[4.5rem] flex-none text-right font-bold">
                  {debugMs(media.ms)}
                </span>
              </p>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-tint">
                <div
                  className={cn('h-1.5 rounded-full', media.ok ? 'bg-emphasis' : 'bg-destructive')}
                  style={{
                    marginLeft: `${(media.at / whole) * 100}%`,
                    width: `max(3px, ${(media.ms / whole) * 100}%)`,
                  }}
                />
              </div>
              <p className="mt-0.5 font-mono text-[0.6875rem] text-grey [overflow-wrap:anywhere]">
                {media.downloadMs === null
                  ? 'already held, no download'
                  : `download ${debugMs(media.downloadMs)}`}{' '}
                · {media.label}
              </p>
            </li>
          ))}
      </ol>
    </>
  );
}

function Parts({ parts }: { parts: readonly { label: string; ms: number }[] }) {
  return (
    <ol className="mt-1 space-y-0.5 font-mono text-[0.75rem] text-ink">
      {parts.map((part, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a log, only added to
        <li key={at} className="flex gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 [overflow-wrap:anywhere]',
              part.label.includes(':') ? '' : 'text-ink2',
            )}
          >
            {part.label}
          </span>
          <span className="flex-none font-bold">{Math.round(part.ms)} ms</span>
        </li>
      ))}
    </ol>
  );
}

function Summary({ screen }: { screen: DebugScreen }) {
  const summary = summarize(screen);
  const chain = debugChain(screen);
  const later = summary.count - summary.loadingCount;
  const broken = screen.marks.some((mark) => markParts(screen, mark).length > 0);
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.8125rem]">
        <dt className="text-ink2">Requests</dt>
        <dd className="font-bold text-ink">
          {summary.loadingCount} while loading
          {later > 0 ? `, ${later} later` : ''}
          {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
        </dd>
        <dt className="text-ink2">Last loading reply at</dt>
        <dd className="font-bold text-ink">
          {debugMs(summary.lastReplyMs)}
          {screen.opened ? ' (from opening the app)' : ''}
        </dd>
        <dt className="text-ink2">All added (they overlap)</dt>
        <dd className="font-bold text-ink">{debugMs(summary.addedMs)}</dd>
        {screen.media.length === 0 ? null : (
          <>
            <dt className="text-ink2">Pictures and videos</dt>
            <dd className="font-bold text-ink">{mediaSummary(screen)}</dd>
          </>
        )}
        {screen.cardsMs === null ? null : (
          <>
            <dt className="text-ink2">Cards shown after</dt>
            <dd className="font-bold text-ink">{debugMs(screen.cardsMs)}</dd>
          </>
        )}
      </dl>
      <p className="mt-1 text-[0.75rem] text-grey">
        Every time is counted from reaching the screen
        {screen.opened ? ', here from opening the app' : ''}.
      </p>
      {/* When something was on the glass, and what that time was made of (the
          owner, 2026-11-18: "how long it takes for the posts to render and
          what are the constituent parts"). */}
      {screen.marks.map((mark) => {
        const parts = markParts(screen, mark);
        return (
          <div
            key={mark.label}
            className="mt-2.5 rounded-[10px] bg-tint px-2.5 py-2 text-[0.8125rem]"
          >
            <p className="flex gap-2 font-bold text-ink">
              <span className="min-w-0 flex-1">{mark.label}</span>
              <span className="flex-none">{debugMs(mark.ms)}</span>
            </p>
            {parts.length > 0 ? <Parts parts={parts} /> : null}
          </div>
        );
      })}
      {/* With no such moment said: the requests that waited for one another
          (screenshot review, 2026-11-18: the slowest alone is not the answer). */}
      {!broken && chain.length > 0 ? (
        <div className="mt-2.5 rounded-[10px] bg-tint px-2.5 py-2 text-[0.8125rem]">
          <p className="font-bold text-ink">
            {chain.length > 1 ? 'Waited for one another, in a row' : 'The last to answer'}
          </p>
          <Parts parts={chain.map((request) => ({ label: request.endpoint, ms: request.ms }))} />
        </div>
      ) : null}
    </>
  );
}
