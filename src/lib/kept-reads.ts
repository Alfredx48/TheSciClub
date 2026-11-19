import { useMemo, useRef } from 'react';
import { onForgetSharedReads } from '@/lib/shared-reads';

/**
 * A kept tab (App.tsx KeptTabs) shown again reads again only when its last
 * read is this old, or something it shows may have changed since: this
 * device wrote, or another screen was open (a topic, an event, a form).
 * A switch straight from one tab to another within the minute asks nothing.
 */
export const KEPT_FRESH_MS = 60_000;

let epoch = 0;
const staleListeners = new Set<() => void>();

/** Anything a tab shows may have changed. */
export function keptReadsStale(): void {
  epoch += 1;
  for (const listener of staleListeners) listener();
}

/** For a shared read to let go with the tabs' (lib/own-row.ts). */
export function onKeptReadsStale(listener: () => void): void {
  staleListeners.add(listener);
}

onForgetSharedReads(keptReadsStale);

/**
 * For one hook's read: `fresh(key)` when the same read last landed under
 * KEPT_FRESH_MS ago with nothing stale since. `start(key)` returns what to
 * call when the read lands. The record lives in a ref, so only a kept tab
 * shown again, the same component, ever finds it.
 */
export function useKeptRead() {
  const last = useRef<{ key: string; at: number; epoch: number } | null>(null);
  return useMemo(
    () => ({
      fresh(key: string): boolean {
        const read = last.current;
        return (
          read !== null &&
          read.key === key &&
          read.epoch === epoch &&
          Date.now() - read.at < KEPT_FRESH_MS
        );
      },
      start(key: string): () => void {
        const at = Date.now();
        const started = epoch;
        last.current = null;
        return () => {
          last.current = { key, at, epoch: started };
        };
      },
    }),
    [],
  );
}

/** Asked of the server that change nothing a tab shows. */
const QUIET_RPCS = new Set([
  'home_startup',
  'chat_mark_posts_seen',
  'log_page_speed',
  'note_device',
  'record_sign_in',
  'record_event_view',
  'record_event_rsvp_click',
  'username_available',
  'suggest_usernames',
  'reviews_for',
  'review_options',
  'qr_code_details',
  'organization_suggestions',
  'organization_requests_waiting',
  'organization_member_count',
  'member_organizations',
  'joining_is_open',
  'invite_details_for_token',
  'invite_address_for_token',
  'introduction_for_me',
  'event_view_stats',
  'event_host_contacts',
  'event_check_in_list',
  'browse_members',
  'i_am_partner',
  'i_can_connect',
]);

/** Reads by their names: my_*, map_*, and chat's and events' readers. */
const QUIET_PREFIXES = [
  'my_',
  'map_',
  'events_within_miles',
  'chat_topics_',
  'chat_topic_for',
  'chat_topic_viewed_by_me',
  'chat_topic_room',
  'chat_topic_opening_posts',
  'chat_my_threads',
  'chat_shared_posts',
  'chat_post_view_counts',
];

/** Whether a request may change what a tab shows. Unknown kinds count. */
export function isWrite(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return true;
  }
  const rpc = /\/rest\/v1\/rpc\/([^/?]+)/.exec(path)?.[1];
  if (rpc) return !QUIET_RPCS.has(rpc) && !QUIET_PREFIXES.some((p) => rpc.startsWith(p));
  // Signing photographs' addresses is a read; a token refresh changes nothing shown.
  if (path.includes('/storage/v1/object/sign/')) return false;
  if (path.endsWith('/auth/v1/token') || path.endsWith('/auth/v1/logout')) return false;
  return true;
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): [string, string] {
  if (typeof input === 'string') return [init?.method ?? 'GET', input];
  if (input instanceof URL) return [init?.method ?? 'GET', input.href];
  return [init?.method ?? input.method, input.url];
}

/** Wraps the client's fetch: a write makes kept reads stale, sent and landed. */
export function noticeWrites(next: typeof fetch): typeof fetch {
  return (input, init) => {
    const [method, url] = requestParts(input, init);
    if (!isWrite(method, url)) return next(input, init);
    keptReadsStale();
    return next(input, init).finally(keptReadsStale);
  };
}
