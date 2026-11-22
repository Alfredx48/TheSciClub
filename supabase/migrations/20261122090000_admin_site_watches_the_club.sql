-- ============================================================================
-- The admin site watches the club
-- ============================================================================
-- The owner, 2026-11-22, for admin.thesciclub.com: the free plan's limits,
-- uptime with alerts, the app's crashes, what was emailed and pushed and
-- whether it arrived, and the releases. Everything an administrator reads
-- here is read only when they open it; what members' phones send (crashes,
-- push outcomes) is a small insert, capped like page speed.
--
--   admin_plan_usage()            the free plan: database and file storage
--                                 against their limits, connections, data
--                                 sent this month as the request logs saw it.
--   private.watch_the_app()       every 5 minutes (pg_cron): asks the app's
--                                 /version.json through pg_net, keeps the
--                                 answer, and pushes the administrators when
--                                 it fails twice running, when server errors
--                                 pile up, and when it is answering again.
--   admin_uptime(days)            those checks, the outages and the alerts.
--   log_app_errors(errors)        a member's app reports its crashes: what
--                                 broke, where in the code, on which screen,
--                                 release and kind of device. Never who.
--   admin_app_errors(days)        the crashes, alike ones counted together.
--   log_push_deliveries(...)      push-notify says what became of each push.
--   delivery_log                  and resend-events what became of each email.
--   admin_deliveries(days, email) both, by day and the latest, or one
--                                 address's (matched by its hash, never kept).
--
-- Undo: supabase/undo/20261122090000.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The free plan
-- ---------------------------------------------------------------------------

create function public.admin_plan_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start timestamptz := date_trunc('month', now(), 'UTC');
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the plan''s usage.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'database_limit', 500 * 1024 * 1024,
    'files_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0),
    'files_limit', 1024 * 1024 * 1024,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'bytes', b.bytes, 'files', b.files)
                       order by b.bytes desc)
        from (select o.bucket_id, sum((o.metadata ->> 'size')::bigint) as bytes, count(*) as files
                from storage.objects o group by o.bucket_id) b), '[]'),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('table', t.name, 'bytes', t.bytes) order by t.bytes desc)
        from (select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid) as bytes
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema')
               order by pg_total_relation_size(c.oid) desc
               limit 8) t), '[]'),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'connections_limit', current_setting('max_connections')::integer,
    -- Only what the logs carry a size for (photographs mostly do, small
    -- answers mostly do not), so at least this much.
    'sent_bytes_month', coalesce((select sum(r.bytes) from public.request_log r where r.at >= month_start), 0),
    'sent_limit', 5::bigint * 1024 * 1024 * 1024,
    'month_start', month_start,
    'members_active_month', (select count(*) from auth.users u where u.last_sign_in_at >= month_start),
    'active_limit', 50000
  );
end;
$$;

revoke all on function public.admin_plan_usage() from public, anon;
grant execute on function public.admin_plan_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- Uptime, and telling the administrators
-- ---------------------------------------------------------------------------

-- Which app this database watches: live's, or the test site's on the test
-- project (set there after this migration; see the undo file's note).
create table private.watch_settings (
  id boolean primary key default true check (id),
  app_origin text not null
);
insert into private.watch_settings (app_origin) values ('https://thesciclub.com');

create table private.uptime_checks (
  id bigint generated always as identity primary key,
  asked_at timestamptz not null default now(),
  request_id bigint,
  status integer,
  ms integer,
  ok boolean,
  error text
);
create index uptime_checks_asked_idx on private.uptime_checks (asked_at);

create table private.admin_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('app_down', 'server_errors')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  detail text
);
create index admin_alerts_open_idx on private.admin_alerts (kind, opened_at desc);

/** A push to every administrator's devices (push-notify's 'admin_alert'). */
create function private.alert_admins(p_kind text, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.push_notify_send('admin_alert', jsonb_build_object('kind', p_kind, 'text', p_text));
exception when others then
  raise warning 'alert_admins: %', sqlerrm;
end;
$$;

revoke all on function private.alert_admins(text, text) from public, anon, authenticated;

create function private.watch_the_app()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  origin text := (select s.app_origin from private.watch_settings s);
  last_two boolean[];
  down private.admin_alerts;
  failed integer;
  total integer;
begin
  -- The answers to earlier checks. pg_net keeps a response for a while; one
  -- not there after two minutes never came.
  update private.uptime_checks c
     set status = r.status_code,
         ms = greatest(0, (extract(epoch from (r.created - c.asked_at)) * 1000)::integer),
         -- No answer code at all (a name that does not resolve, a refused
         -- connection) is a failure too, not unknown.
         ok = coalesce(r.status_code = 200, false) and not coalesce(r.timed_out, false),
         error = case
                   when r.timed_out then 'took over 10 seconds'
                   when r.error_msg is not null then left(r.error_msg, 200)
                   when r.status_code <> 200 then 'answered ' || r.status_code
                 end
    from net._http_response r
   where r.id = c.request_id and c.ok is null;
  update private.uptime_checks c
     set ok = false, error = 'no answer'
   where c.ok is null and c.asked_at < now() - interval '2 minutes';

  -- Down: the last two answered checks failed. One alert until it is back.
  select array_agg(c.ok order by c.asked_at desc) into last_two
    from (select c.ok, c.asked_at from private.uptime_checks c
           where c.ok is not null order by c.asked_at desc limit 2) c;
  select * into down from private.admin_alerts a
   where a.kind = 'app_down' and a.closed_at is null order by a.opened_at desc limit 1;
  if down.id is null and coalesce(array_length(last_two, 1), 0) = 2
     and not last_two[1] and not last_two[2] then
    insert into private.admin_alerts (kind, detail)
      values ('app_down', (select c.error from private.uptime_checks c
                            where c.ok is not null order by c.asked_at desc limit 1));
    perform private.alert_admins('app_down',
      'The app is not answering (' || coalesce((select c.error from private.uptime_checks c
        where c.ok is not null order by c.asked_at desc limit 1), 'no answer') || ').');
  elsif down.id is not null and last_two[1] then
    update private.admin_alerts set closed_at = now() where id = down.id;
    perform private.alert_admins('app_down',
      'The app is answering again, after ' ||
      greatest(1, round(extract(epoch from (now() - down.opened_at)) / 60))::text || ' minutes.');
  end if;

  -- Server errors piling up, as the copied request logs show (copied every
  -- 30 minutes, so the last 40). At most one alert in two hours.
  select count(*) filter (where r.status >= 500), count(*) into failed, total
    from public.request_log r where r.at > now() - interval '40 minutes';
  if failed >= 10 and failed * 20 > total and not exists (
    select 1 from private.admin_alerts a
     where a.kind = 'server_errors' and a.opened_at > now() - interval '2 hours'
  ) then
    insert into private.admin_alerts (kind, detail, closed_at)
      values ('server_errors', failed || ' of ' || total || ' requests', now());
    perform private.alert_admins('server_errors',
      failed || ' requests failed on the server in the last 40 minutes (of ' || total || ').');
  end if;

  -- And the next check. The time in the address keeps any cache out of it.
  insert into private.uptime_checks (request_id)
    values (net.http_get(
      url := origin || '/version.json?check=' || floor(extract(epoch from now()))::bigint,
      timeout_milliseconds := 10000));

  delete from private.uptime_checks where asked_at < now() - interval '90 days';
  delete from private.admin_alerts where opened_at < now() - interval '365 days';
end;
$$;

revoke all on function private.watch_the_app() from public, anon, authenticated;

select cron.schedule('watch-the-app', '*/5 * * * *', 'select private.watch_the_app()');

create function public.admin_uptime(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  since timestamptz := now() - make_interval(days => days);
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the uptime.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'checks', (select count(*) from private.uptime_checks c where c.asked_at > since and c.ok is not null),
    'failed', (select count(*) from private.uptime_checks c where c.asked_at > since and c.ok = false),
    'first_at', (select min(c.asked_at) from private.uptime_checks c),
    'latest', (select jsonb_build_object('at', c.asked_at, 'ok', c.ok, 'ms', c.ms, 'error', c.error)
                 from private.uptime_checks c where c.ok is not null
                order by c.asked_at desc limit 1),
    -- By hour: how many checks failed, and the slowest answer.
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'checks', h.checks, 'failed', h.failed,
                                          'p50_ms', h.p50, 'max_ms', h.max_ms) order by h.hour)
        from (select date_trunc('hour', c.asked_at) as hour, count(*) as checks,
                     count(*) filter (where not c.ok) as failed,
                     (percentile_cont(0.5) within group (order by c.ms))::integer as p50,
                     max(c.ms) as max_ms
                from private.uptime_checks c
               where c.asked_at > since and c.ok is not null
               group by 1) h), '[]'),
    -- Stretches with no check at all: the database or its scheduler was not
    -- running, which a check cannot report on itself.
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object('from', g.prev_at, 'to', g.asked_at) order by g.asked_at desc)
        from (select c.asked_at, lag(c.asked_at) over (order by c.asked_at) as prev_at
                from private.uptime_checks c where c.asked_at > since) g
       where g.asked_at - g.prev_at > interval '15 minutes'), '[]'),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'opened_at', a.opened_at,
                                          'closed_at', a.closed_at, 'detail', a.detail)
                       order by a.opened_at desc)
        from private.admin_alerts a where a.opened_at > since), '[]')
  );
end;
$$;

revoke all on function public.admin_uptime(integer) from public, anon;
grant execute on function public.admin_uptime(integer) to authenticated;

-- What push-notify sends for 'admin_alert': every administrator's devices,
-- in push_owed's shape, opening the admin site. The secret is the trigger's.
create function public.push_admin_alert_owed(p_secret text, p_key jsonb)
returns table (endpoint text, p256dh text, auth text, kind text, actor_name text, body text,
               photo_count integer, subject text, detail text, url text, tag text, badge integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret is distinct from (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'
  ) then
    raise exception 'Not the notification trigger.' using errcode = '42501';
  end if;
  return query
    select s.endpoint, s.p256dh, s.auth, 'admin_alert'::text, null::text,
           left(p_key ->> 'text', 300), 0, null::text, p_key ->> 'kind',
           'https://admin.thesciclub.com/'::text, 'admin-alert:' || coalesce(p_key ->> 'kind', ''),
           null::integer
      from public.members m
      join public.push_subscriptions s on s.member_id = m.id
     where m.is_admin and m.status = 'active';
end;
$$;

revoke all on function public.push_admin_alert_owed(text, jsonb) from public, anon, authenticated;
grant execute on function public.push_admin_alert_owed(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The app's crashes
-- ---------------------------------------------------------------------------

create table public.app_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  message text not null,
  source text,
  screen text,
  release text,
  device text
);
create index app_errors_at_idx on public.app_errors (at);
alter table public.app_errors enable row level security;
-- No policies: written by log_app_errors, read by admin_app_errors.

create function public.log_app_errors(errors jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(errors) <> 'array' or jsonb_array_length(errors) = 0 then
    return;
  end if;
  -- A flood (a loop, or somebody sending them on purpose) stops here.
  if (select count(*) from public.app_errors where at > now() - interval '10 minutes') > 2000 then
    return;
  end if;
  insert into public.app_errors (kind, message, source, screen, release, device)
  select left(coalesce(e ->> 'kind', 'error'), 20),
         left(e ->> 'message', 300),
         left(e ->> 'source', 200),
         left(e ->> 'screen', 80),
         left(e ->> 'release', 20),
         left(e ->> 'device', 20)
    from jsonb_array_elements(errors) with ordinality as x(e, n)
   where x.n <= 10 and jsonb_typeof(e) = 'object' and coalesce(e ->> 'message', '') <> '';
end;
$$;

revoke all on function public.log_app_errors(jsonb) from public;
grant execute on function public.log_app_errors(jsonb) to anon, authenticated;

create function public.admin_app_errors(p_days integer default 7)
returns table (kind text, message text, source text, times bigint, screens text[],
               releases text[], devices text[], first_at timestamptz, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the app''s errors.' using errcode = '42501';
  end if;
  return query
    select e.kind, e.message, e.source, count(*),
           (array_agg(distinct e.screen) filter (where e.screen is not null))[1:5],
           (array_agg(distinct e.release) filter (where e.release is not null))[1:5],
           array_agg(distinct e.device) filter (where e.device is not null),
           min(e.at), max(e.at)
      from public.app_errors e
     where e.at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
     group by e.kind, e.message, e.source
     order by max(e.at) desc
     limit 100;
end;
$$;

revoke all on function public.admin_app_errors(integer) from public, anon;
grant execute on function public.admin_app_errors(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- What was emailed and pushed
-- ---------------------------------------------------------------------------

create table public.delivery_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  channel text not null check (channel in ('email', 'push')),
  -- A push: what it was about (message, report…). An email: its subject.
  kind text,
  outcome text not null,
  reason text,
  -- A push: the service (Apple, Google, Mozilla…). Never the device.
  service text,
  -- An email: sha256 of the address, lower-cased, to look one up. Never the address.
  address_hash text,
  -- Resend's id, so its later events (delivered, bounced) join the sending.
  message_id text
);
create index delivery_log_at_idx on public.delivery_log (at);
create index delivery_log_address_idx on public.delivery_log (address_hash) where address_hash is not null;
alter table public.delivery_log enable row level security;
-- No policies: written by push-notify and resend-events, read by admin_deliveries.

create function public.log_push_deliveries(p_secret text, p_rows jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret is distinct from (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'
  ) then
    raise exception 'Not the notification trigger.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return;
  end if;
  insert into public.delivery_log (channel, kind, outcome, reason, service)
  select 'push', left(r ->> 'kind', 40), left(coalesce(r ->> 'outcome', 'unknown'), 20),
         left(r ->> 'reason', 200), left(r ->> 'service', 60)
    from jsonb_array_elements(p_rows) with ordinality as x(r, n)
   where x.n <= 2000 and jsonb_typeof(r) = 'object';
end;
$$;

revoke all on function public.log_push_deliveries(text, jsonb) from public, anon, authenticated;
grant execute on function public.log_push_deliveries(text, jsonb) to service_role;

create function public.admin_deliveries(p_days integer default 7, p_email text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  wanted text := case when nullif(trim(p_email), '') is null then null
                      else encode(sha256(convert_to(lower(trim(p_email)), 'UTF8')), 'hex') end;
begin
  if not public.is_admin() then
    raise exception 'Only administrators read what was sent.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_outcome', coalesce((
      select jsonb_agg(jsonb_build_object('channel', d.channel, 'kind', d.kind,
                                          'outcome', d.outcome, 'count', d.n)
                       order by d.channel, d.n desc)
        from (select l.channel, l.kind, l.outcome, count(*) as n
                from public.delivery_log l where l.at > since
               group by 1, 2, 3) d), '[]'),
    'latest', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'channel', l.channel, 'kind', l.kind,
                                          'outcome', l.outcome, 'reason', l.reason,
                                          'service', l.service) order by l.at desc)
        from (select * from public.delivery_log l
               where l.at > since
                 and (wanted is null or l.address_hash = wanted)
                 and (wanted is not null or l.outcome not in ('sent', 'delivered'))
               order by l.at desc limit 60) l), '[]')
  );
end;
$$;

revoke all on function public.admin_deliveries(integer, text) from public, anon;
grant execute on function public.admin_deliveries(integer, text) to authenticated;

-- Kept 90 days, crashes 30.
select cron.schedule('tidy-admin-watch', '17 4 * * *', $$
  delete from public.app_errors where at < now() - interval '30 days';
  delete from public.delivery_log where at < now() - interval '90 days';
$$);

notify pgrst, 'reload schema';
