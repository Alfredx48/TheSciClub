-- ============================================================================
-- The request logs list the requests that failed
-- ============================================================================
-- The owner, 2026-11-22: "I want to be able to go and look at the logs at
-- 8:16 like you did and see what the error was." An opening at 8:16 had its
-- membership read refused (401) a second after renewing its sign-in; the
-- Server view counted only server errors (500s) and showed a refused request
-- only if it was among the slowest twenty.
--
-- admin_request_window now also answers 'failed': every request in the
-- stretch that was refused or failed (400 and up, or never answered), up to
-- the latest 50, earliest first, each with its visit so its trail can open.
-- Its Failed column counts the same. Read only when an administrator looks.
-- Undo: supabase/undo/20261122080000.sql.
-- ============================================================================

create or replace function public.admin_request_window(p_from timestamptz, p_to timestamptz)
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
                 'errors', count(*) filter (where w.status >= 400 or w.status = 0)) as e
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
        from (select * from w order by w.ms desc limit 20) s), '[]'),
    'failed', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', f.at, 'endpoint', f.endpoint, 'ms', f.ms, 'status', f.status,
               'device', f.device, 'visit', f.visit) order by f.at)
        from (
          select r.* from public.request_log r
           where r.at >= t0 and r.at < t1 and (r.status >= 400 or r.status = 0)
           order by r.at desc
           limit 50
        ) f), '[]')
  ) into result;
  return result;
end;
$$;
