-- ============================================================================
-- Request logs, kept by the club
-- ============================================================================
-- The owner, 2026-11-21: "if we did have a slowdown later on at an event or
-- with someone we can look back at the logs and see why it slowed down that
-- day at a certain time". Supabase already logs every request the app makes,
-- with how long it took, but keeps them a day on the free plan, with each
-- member's id, IP address and city. Nothing on anybody's phone changes.
--
-- 1. public.request_log: every request, copied every 30 minutes by the
--    copy-request-logs function (pg_net, as push-notify is called), with no
--    personal details: when, what was asked (rpc:home_feed, table:events,
--    storage:public, never arguments or file names), status, the server's
--    milliseconds, the size of the answer, the kind of device (iPhone,
--    Android, computer), Cloudflare's data centre, and `visit`: the sign-in
--    session scrambled with a key made each day and deleted the next, so one
--    visit's requests can be read in order that day and never traced to
--    anybody, then or later. Kept 7 days.
-- 2. public.request_log_5min: each 5 minutes' requests by what was asked,
--    typical, slow end and slowest, and errors. Kept 90 days.
-- 3. public.query_stats: every 5 minutes, how much time each database query
--    took in those 5 minutes (pg_stat_statements, whose queries carry $1 in
--    place of any value). Kept 30 days.
--
-- Read by administrators (Admin's page speed, later) and by the owner's
-- sessions through the database. Undo: supabase/undo/20261122040000.sql.
-- ============================================================================

-- ------------------------------------------------------------- tables --

create table public.request_log (
  id text primary key,
  at timestamptz not null,
  method text not null,
  endpoint text not null,
  status smallint,
  ms integer,
  bytes integer,
  visit text,
  device text,
  colo text
);
create index request_log_at_idx on public.request_log (at);
alter table public.request_log enable row level security;
revoke all on public.request_log from public, anon, authenticated;
comment on table public.request_log is
  'Every request to the club, from Supabase''s own logs, without personal details. 7 days. 20261122040000.';

create table public.request_log_5min (
  bucket timestamptz not null,
  endpoint text not null,
  requests integer not null,
  p50_ms integer,
  p90_ms integer,
  max_ms integer,
  errors integer not null,
  primary key (bucket, endpoint)
);
alter table public.request_log_5min enable row level security;
revoke all on public.request_log_5min from public, anon, authenticated;

create table public.query_stats (
  at timestamptz not null,
  queryid bigint not null,
  query text not null,
  calls bigint not null,
  total_ms double precision not null,
  primary key (at, queryid)
);
alter table public.query_stats enable row level security;
revoke all on public.query_stats from public, anon, authenticated;

-- The day's key for `visit`, and the last cumulative numbers for query_stats.
create table private.request_log_keys (
  day date primary key,
  key bytea not null
);
create table private.query_stats_last (
  queryid bigint primary key,
  calls bigint not null,
  total_ms double precision not null
);

-- ------------------------------------------------------------- storing --

-- What copy-request-logs hands over: up to 5,000 requests a call, each
-- {id, at, method, endpoint, status, ms, bytes, session, device, colo}. The
-- session is scrambled here and never stored as it came.
create function public.store_request_logs(p_secret text, p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  day_key bytea;
  stored integer;
begin
  if p_secret is null or p_secret is distinct from (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'request_logs_secret'
  ) then
    raise exception 'Not the request-log copy.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;

  insert into private.request_log_keys (day, key)
  values (today, extensions.gen_random_bytes(32))
  on conflict (day) do nothing;
  select k.key into day_key from private.request_log_keys k where k.day = today;

  insert into public.request_log (id, at, method, endpoint, status, ms, bytes, visit, device, colo)
  select left(r->>'id', 64),
         (r->>'at')::timestamptz,
         left(coalesce(r->>'method', ''), 8),
         left(coalesce(r->>'endpoint', ''), 80),
         nullif(r->>'status', '')::smallint,
         nullif(r->>'ms', '')::integer,
         nullif(r->>'bytes', '')::integer,
         case when coalesce(r->>'session', '') = '' then null
              else left(encode(extensions.hmac(r->>'session', encode(day_key, 'hex'), 'sha256'), 'hex'), 16)
         end,
         left(r->>'device', 12),
         left(r->>'colo', 8)
    from (select value as r from jsonb_array_elements(p_rows) limit 5000) x
   where coalesce(r->>'id', '') <> '' and coalesce(r->>'at', '') <> ''
  on conflict (id) do nothing;
  get diagnostics stored = row_count;
  return stored;
end;
$$;

revoke all on function public.store_request_logs(text, jsonb) from public, anon, authenticated;
grant execute on function public.store_request_logs(text, jsonb) to service_role;

-- Every 30 minutes: ask copy-request-logs to copy the last 40 (overlapping,
-- so nothing falls between two runs; a request copied twice is kept once).
-- Off until the vault has request_logs_url.
create function private.copy_request_logs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select s.decrypted_secret into target from vault.decrypted_secrets s where s.name = 'request_logs_url';
  if target is null or target = '' then
    return;
  end if;
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'request_logs_secret';
  perform net.http_post(
    url := target,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-request-logs-secret', secret),
    timeout_milliseconds := 60000
  );
end;
$$;

-- ------------------------------------------------------------- query stats --

-- What each query took in the last 5 minutes: today's totals less the last
-- ones. The 50 that took the most; a reset of pg_stat_statements starts over.
create function private.snapshot_query_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := date_trunc('minute', now());
begin
  create temporary table if not exists query_stats_now on commit drop as
    select s.queryid, min(s.query) as query, sum(s.calls)::bigint as calls,
           sum(s.total_exec_time) as total_ms
      from extensions.pg_stat_statements s
     where s.queryid is not null
     group by s.queryid;

  -- The first run only notes where things stand: its totals go back months.
  if exists (select 1 from private.query_stats_last) then
  insert into public.query_stats (at, queryid, query, calls, total_ms)
  select now_at, n.queryid, left(n.query, 400),
         n.calls - coalesce(l.calls, 0), n.total_ms - coalesce(l.total_ms, 0)
    from query_stats_now n
    left join private.query_stats_last l on l.queryid = n.queryid
   where n.calls - coalesce(l.calls, 0) > 0
     and n.total_ms - coalesce(l.total_ms, 0) > 0
   order by n.total_ms - coalesce(l.total_ms, 0) desc
   limit 50
  on conflict do nothing;
  end if;

  delete from private.query_stats_last;
  insert into private.query_stats_last (queryid, calls, total_ms)
  select n.queryid, n.calls, n.total_ms from query_stats_now n;
end;
$$;

-- ------------------------------------------------------------- tidying --

-- Hourly: each finished 5 minutes summed up, then what is past keeping goes,
-- and the keys of days gone with it, so no visit can be traced afterwards.
create function private.tidy_request_logs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.request_log_5min (bucket, endpoint, requests, p50_ms, p90_ms, max_ms, errors)
  select to_timestamp(floor(extract(epoch from r.at) / 300) * 300),
         r.endpoint,
         count(*),
         (percentile_cont(0.5) within group (order by r.ms))::integer,
         (percentile_cont(0.9) within group (order by r.ms))::integer,
         max(r.ms),
         count(*) filter (where r.status >= 500 or r.status = 0)
    from public.request_log r
   where r.at < to_timestamp(floor(extract(epoch from now()) / 300) * 300)
     and r.at > now() - interval '3 hours'
   group by 1, 2
  on conflict (bucket, endpoint) do update
    set requests = excluded.requests, p50_ms = excluded.p50_ms, p90_ms = excluded.p90_ms,
        max_ms = excluded.max_ms, errors = excluded.errors;

  delete from public.request_log where at < now() - interval '7 days';
  delete from public.request_log_5min where bucket < now() - interval '90 days';
  delete from public.query_stats where at < now() - interval '30 days';
  delete from private.request_log_keys
   where day < (now() at time zone 'America/Los_Angeles')::date;
end;
$$;

revoke all on function private.copy_request_logs() from public, anon, authenticated;
revoke all on function private.snapshot_query_stats() from public, anon, authenticated;
revoke all on function private.tidy_request_logs() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('copy-request-logs', 'snapshot-query-stats', 'tidy-request-logs');
  perform cron.schedule('copy-request-logs', '*/30 * * * *', 'select private.copy_request_logs()');
  perform cron.schedule('snapshot-query-stats', '*/5 * * * *', 'select private.snapshot_query_stats()');
  perform cron.schedule('tidy-request-logs', '17 * * * *', 'select private.tidy_request_logs()');
end;
$$;
