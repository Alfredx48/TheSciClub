/**
 * copy-request-logs: copies the last 40 minutes of Supabase's own request
 * logs into public.request_log, without personal details (20261122040000;
 * the owner, 2026-11-21). Supabase keeps them a day on the free plan; the
 * club keeps them a week, and 5-minute summaries for 90 days.
 *
 * Called every 30 minutes through pg_net by private.copy_request_logs with
 * the vault's request_logs_secret, which store_request_logs checks. Deployed
 * with verify_jwt = false, like push-notify: the caller is the database.
 *
 * Reads the logs through the Management API (GET
 * /v1/projects/{ref}/analytics/endpoints/logs, ClickHouse SQL), and asks only
 * for the fields kept: no IP address, city, browser words or member id. The
 * sign-in session goes on to the database, which scrambles it with the day's
 * key and keeps only that.
 *
 * Secrets (supabase secrets set): LOGS_READ_TOKEN, a Supabase access token
 * that can read this project's logs. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */

import { keep, type LogRow } from './shape.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LOGS_READ_TOKEN = Deno.env.get('LOGS_READ_TOKEN') ?? '';
const PROJECT_REF = new URL(SUPABASE_URL || 'https://x.supabase.co').hostname.split('.')[0];
const WINDOW_MINUTES = 40;
const LIMIT = 5000;

const SQL = `
select id, timestamp,
       log_attributes['request.method'] as method,
       log_attributes['request.path'] as path,
       log_attributes['response.status_code'] as status,
       log_attributes['response.origin_time'] as ms,
       log_attributes['response.headers.content_length'] as bytes,
       log_attributes['request.sb.jwt.authorization.payload.session_id'] as session,
       log_attributes['request.headers.user_agent'] as agent,
       log_attributes['request.cf.colo'] as colo
  from logs
 where source = 'edge_logs'
 order by timestamp
 limit ${LIMIT}`;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!LOGS_READ_TOKEN) {
    console.error('copy-request-logs: LOGS_READ_TOKEN is not set');
    return reply(500, { error: 'not configured' });
  }

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_MINUTES * 60_000);
  const query = new URLSearchParams({
    sql: SQL,
    iso_timestamp_start: start.toISOString(),
    iso_timestamp_end: end.toISOString(),
  });
  const logs = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs?${query}`,
    { headers: { Authorization: `Bearer ${LOGS_READ_TOKEN}` } },
  );
  if (!logs.ok) {
    console.error(`copy-request-logs: the logs answered ${logs.status}`);
    return reply(502, { error: `logs ${logs.status}` });
  }
  const read = (await logs.json()) as { result?: LogRow[]; error?: unknown };
  if (!Array.isArray(read.result)) {
    console.error('copy-request-logs: no result', JSON.stringify(read.error ?? read).slice(0, 300));
    return reply(502, { error: 'no result' });
  }

  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  const stored = await fetch(`${SUPABASE_URL}/rest/v1/rpc/store_request_logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_secret: request.headers.get('x-request-logs-secret') ?? '',
      p_rows: read.result.map(keep),
    }),
  });
  if (!stored.ok) {
    if (stored.status === 401 || stored.status === 403)
      return reply(401, { error: 'not the copy' });
    console.error(`copy-request-logs: storing answered ${stored.status}`);
    return reply(502, { error: `store ${stored.status}` });
  }
  const added = (await stored.json()) as number;
  return reply(200, { read: read.result.length, added, full: read.result.length >= LIMIT });
});
