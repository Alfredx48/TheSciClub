import { screenOf } from '@/lib/page-speed';

/**
 * The app's crashes, for administrators (the owner, 2026-11-22; Admin site › Errors, from
 * log_app_errors in 20261122090000). What broke, where in the app's code, on which screen, in
 * which release, and on what kind of device. Never who, and nothing a member typed: addresses,
 * ids and long numbers are taken out of the message before it is sent.
 *
 * Each crash is sent once a page load, ten at most, a few seconds after the first so several
 * go together; a page being closed sends what is waiting. A failure to send is dropped.
 */

export interface AppError {
  kind: 'error' | 'promise' | 'render';
  message: string;
  source: string | null;
  screen: string;
  release: string | null;
  device: string;
}

type Sender = (errors: AppError[]) => Promise<unknown>;

const MAX_A_LOAD = 10;
const WAIT_MS = 3000;

/** Browser noise that is not the app's to fix. */
const IGNORED = [
  /^Script error\.?$/i, // another site's script: the browser says nothing more
  /ResizeObserver loop/i,
  /^Load failed$/i, // a request cut off as the page closed (Safari)
  /^Failed to fetch$/i, // offline: page speed counts those
  /^NetworkError when attempting to fetch resource\.?$/i,
  /AbortError/i,
  /The operation was aborted/i,
];

/** The message without anything that could be somebody's. */
export function scrub(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/https?:\/\/[^\s'")]+/g, (url) => {
      try {
        const u = new URL(url);
        return `${u.origin}${u.pathname.replace(/[0-9a-f-]{20,}/gi, '<id>')}`;
      } catch {
        return '<url>';
      }
    })
    .replace(/\b\d{5,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Where in the app's own code: the first line of the stack that is ours, as file:line:column. */
export function sourceOf(stack: string | undefined, origin: string): string | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
    const at = line.indexOf(origin);
    if (at < 0) continue;
    const place = /^\/([^\s)]+?:\d+:\d+)/.exec(line.slice(at + origin.length));
    if (place?.[1]) return place[1].slice(0, 200);
  }
  return null;
}

export function deviceOf(userAgent: string, standalone: boolean): string {
  const kind = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iphone'
    : userAgent.includes('Android')
      ? 'android'
      : 'computer';
  return standalone ? `${kind}-app` : kind;
}

let send: Sender | null = null;
let waiting: AppError[] = [];
const seen = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!send || waiting.length === 0) return;
  const batch = waiting;
  waiting = [];
  void send(batch).catch(() => undefined);
}

/** Keep one crash for sending, unless it is noise or already kept this load. */
export function noteError(kind: AppError['kind'], thrown: unknown, filename?: string): void {
  if (!send || seen.size >= MAX_A_LOAD) return;
  const error = thrown instanceof Error ? thrown : null;
  const raw = error
    ? `${error.name}: ${error.message}`
    : typeof thrown === 'string'
      ? thrown
      : String(thrown);
  if (IGNORED.some((pattern) => pattern.test(error?.message ?? raw))) return;
  const origin = window.location.origin;
  const source =
    sourceOf(error?.stack, origin) ??
    (filename?.startsWith(origin) ? filename.slice(origin.length + 1).slice(0, 200) : null);
  // A script of another site's (an extension, a widget) is not the app's.
  if (!source && filename && !filename.startsWith(origin)) return;
  const message = scrub(raw);
  const key = `${kind}|${message}|${source ?? ''}`;
  if (!message || seen.has(key)) return;
  seen.add(key);
  waiting.push({
    kind,
    message,
    source,
    screen: screenOf(window.location.pathname),
    release: import.meta.env.VITE_APP_BUILT ?? null,
    device: deviceOf(
      navigator.userAgent,
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
        (navigator as { standalone?: boolean }).standalone === true,
    ),
  });
  timer ??= setTimeout(flush, WAIT_MS);
}

/** From main.tsx: listen for crashes and send them with `sender`. */
export function startAppErrors(sender: Sender): void {
  send = sender;
  window.addEventListener('error', (event) => {
    noteError('error', event.error ?? event.message, event.filename);
  });
  window.addEventListener('unhandledrejection', (event) => {
    noteError('promise', event.reason);
  });
  window.addEventListener('pagehide', flush);
}

/** For tests. */
export function resetAppErrors(): void {
  send = null;
  waiting = [];
  seen.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
