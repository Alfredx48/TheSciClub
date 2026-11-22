-- ============================================================================
-- Administrators read the request logs
-- ============================================================================
-- The owner, 2026-11-21: where the four administrators can read the request
-- logs (20261122040000) "in a meaningful way", as long as it slows nothing
-- down. Admin › Speed & logs › Server asks four questions:
--
--   admin_request_timeline: when was it slow? The server's typical and
--     slow-end time by hour (up to 7 days, from every request) or by day (up
--     to 90, from the 5-minute summaries).
--   admin_request_window: what was slow then? A stretch of time's requests by
--     what was asked and by kind of device, and its slowest requests.
--   admin_request_visit: what was that visit doing? One visit's requests in
--     order, that day. Nobody's name: a visit is a scrambled session.
--   admin_query_window: was it the database? The queries that took the most
--     time then, beside their usual time.
--
-- Read only when an administrator opens them, each over a bounded stretch of
-- time, so nothing a member does waits on them.
-- Undo: supabase/undo/20261122050000.sql.
-- ============================================================================

create index request_log_visit_idx on public.request_log (visit, at) where visit is not null;

create function public.admin_request_timeline(p_days integer default 1)
returns table (bucket timestamptz, requests bigint, p50_ms integer, p90_ms integer, errors bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days integer := least(greatest(coalesce(p_days, 1), 1), 90);
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the request logs.' using errcode = '42501';
  end if;

  if days <= 7 then
    return query
      select date_trunc('hour', r.at), count(*),
             (percentile_cont(0.5) within group (order by r.ms))::integer,
             (percentile_cont(0.9) within group (order by r.ms))::integer,
             count(*) filter (where r.status >= 500 or r.status = 0)
        from public.request_log r
       where r.at > now() - make_interval(days => days)
         and r.ms is not null
       group by 1
       order by 1;
  else
    -- By day, from the 5-minute summaries: the day's typical is the middle of
    -- its 5-minute typicals, weighted by how busy each was; its slow end the
    -- same of their slow ends.
    return query
      select date_trunc('day', s.bucket, 'America/Los_Angeles'), sum(s.requests)::bigint,
             (percentile_cont(0.5) within group (order by s.p50_ms))::integer,
             (percentile_cont(0.5) within group (order by s.p90_ms))::integer,
             sum(s.errors)::bigint
        from public.request_log_5min s
       where s.bucket > now() - make_interval(days => days)
       group by 1
       order by 1;
  end if;
end;
$$;

create function public.admin_request_window(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t0 timestamptz := p_from;
  t1 timestamptz := least(p_to, p_from + interval '1 day');
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the request logs.' using errcode = '42501';
  end if;
  if t0 is null or t1 is null or t1 <= t0 then
    return null;
  end if;

  with w as (
    select r.* from public.request_log r where r.at >= t0 and r.at < t1 and r.ms is not null
  )
  select jsonb_build_object(
    'requests', (select count(*) from w),
    'visits', (select count(distinct w.visit) from w),
    'endpoints', coalesce((
      select jsonb_agg(e order by (e->>'p90_ms')::integer desc) from (
        select jsonb_build_object(
                 'endpoint', w.endpoint, 'requests', count(*),
                 'p50_ms', (percentile_cont(0.5) within group (order by w.ms))::integer,
                 'p90_ms', (percentile_cont(0.9) within group (order by w.ms))::integer,
                 'max_ms', max(w.ms),
                 'errors', count(*) filter (where w.status >= 500 or w.status = 0)) as e
          from w group by w.endpoint
          order by (percentile_cont(0.9) within group (order by w.ms)) desc
          limit 15
      ) x), '[]'),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'device', d.device, 'requests', d.n, 'p50_ms', d.p50, 'p90_ms', d.p90) order by d.n desc)
        from (
          select coalesce(w.device, 'unknown') as device, count(*) as n,
                 (percentile_cont(0.5) within group (order by w.ms))::integer as p50,
                 (percentile_cont(0.9) within group (order by w.ms))::integer as p90
            from w group by 1
        ) d), '[]'),
    'slowest', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', s.at, 'endpoint', s.endpoint, 'ms', s.ms, 'status', s.status,
               'device', s.device, 'visit', s.visit) order by s.ms desc)
        from (select * from w order by w.ms desc limit 20) s), '[]')
  ) into result;
  return result;
end;
$$;

create function public.admin_request_visit(p_visit text, p_around timestamptz)
returns table (at timestamptz, endpoint text, method text, ms integer, status smallint, device text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the request logs.' using errcode = '42501';
  end if;
  -- A visit is one day's scrambled session: its requests within that day.
  return query
    select r.at, r.endpoint, r.method, r.ms, r.status, r.device
      from public.request_log r
     where r.visit = p_visit
       and r.at > p_around - interval '12 hours'
       and r.at < p_around + interval '12 hours'
     order by r.at
     limit 400;
end;
$$;

create function public.admin_query_window(p_from timestamptz, p_to timestamptz)
returns table (query text, calls bigint, total_ms integer, mean_ms numeric, usual_mean_ms numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators read the request logs.' using errcode = '42501';
  end if;
  return query
    with w as (
      select q.queryid, min(q.query) as query, sum(q.calls)::bigint as calls, sum(q.total_ms) as total
        from public.query_stats q
       where q.at >= p_from and q.at < least(p_to, p_from + interval '1 day')
       group by q.queryid
       order by sum(q.total_ms) desc
       limit 15
    ),
    usual as (
      select q.queryid, sum(q.total_ms) / nullif(sum(q.calls), 0) as mean
        from public.query_stats q
       where q.queryid in (select w.queryid from w)
         and q.at >= p_from - interval '7 days' and q.at < p_from
       group by q.queryid
    )
    select w.query, w.calls, round(w.total)::integer,
           round((w.total / nullif(w.calls, 0))::numeric, 1),
           round(u.mean::numeric, 1)
      from w left join usual u on u.queryid = w.queryid
     order by w.total desc;
end;
$$;

revoke all on function public.admin_request_timeline(integer) from public, anon;
revoke all on function public.admin_request_window(timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_request_visit(text, timestamptz) from public, anon;
revoke all on function public.admin_query_window(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_request_timeline(integer) to authenticated;
grant execute on function public.admin_request_window(timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_request_visit(text, timestamptz) to authenticated;
grant execute on function public.admin_query_window(timestamptz, timestamptz) to authenticated;
