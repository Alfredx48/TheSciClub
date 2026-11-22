-- ============================================================================
-- Page speed by release
-- ============================================================================
-- The owner, 2026-11-21: "if we log every request and how long it took ...
-- we could pinpoint regressions". Each sample now says which release of the
-- app took it: the build's minute (VITE_APP_BUILT, as /version.json has it),
-- which the Site workflow also tags in git as release-<minute>. Administrators
-- see the typical and slow-end times release by release, so a release that
-- made the app slower stands out beside the one before it.
--
-- Expand only: a nullable column (samples from older copies of the app have
-- none), log_page_speed keeping it, and a new reading function.
--
-- Undo: supabase/undo/20261122030000.sql.
-- ============================================================================

alter table public.page_speed_samples add column release text;

create or replace function public.log_page_speed(samples jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(samples) <> 'array' or jsonb_array_length(samples) = 0 then
    return;
  end if;
  if (select count(*) from public.page_speed_samples
       where created_at > now() - interval '10 minutes') > 20000 then
    return;
  end if;

  insert into public.page_speed_samples
    (visit, kind, screen, metric, ms, ok, signed_in, installed, mobile, connection, release)
  select left(s->>'visit', 40),
         s->>'kind',
         left(s->>'screen', 80),
         left(s->>'metric', 80),
         least(greatest(round((s->>'ms')::numeric), 0), 600000)::integer,
         coalesce((s->>'ok')::boolean, true),
         (select auth.uid()) is not null,
         coalesce((s->>'installed')::boolean, false),
         coalesce((s->>'mobile')::boolean, false),
         nullif(left(s->>'connection', 12), ''),
         nullif(left(s->>'release', 20), '')
    from (select value as s from jsonb_array_elements(samples) limit 50) x
   where s->>'kind' in ('load', 'request')
     and char_length(coalesce(s->>'visit', '')) between 8 and 40
     and char_length(coalesce(s->>'screen', '')) >= 1
     and char_length(coalesce(s->>'metric', '')) >= 1
     and jsonb_typeof(s->'ms') = 'number';
end;
$$;

-- For administrators: each release's typical (p50) and slow-end (p90) times,
-- newest release first, over the last `days`. Opening the app is the time to
-- first paint; moving inside it is cards-after-tap; requests are every
-- request to the club together.
create function public.admin_page_speed_by_release(days integer default 7)
returns table (
  release text,
  first_seen timestamptz,
  visits bigint,
  opening_p50_ms integer,
  opening_p90_ms integer,
  cards_p50_ms integer,
  cards_p90_ms integer,
  requests bigint,
  request_p50_ms integer,
  request_p90_ms integer,
  failed bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators see page speed.' using errcode = '42501';
  end if;

  return query
    select s.release,
           min(s.created_at),
           count(distinct s.visit),
           (percentile_cont(0.5) within group (order by s.ms) filter (where s.metric = 'first-paint'))::integer,
           (percentile_cont(0.9) within group (order by s.ms) filter (where s.metric = 'first-paint'))::integer,
           (percentile_cont(0.5) within group (order by s.ms) filter (where s.metric = 'cards-after-tap'))::integer,
           (percentile_cont(0.9) within group (order by s.ms) filter (where s.metric = 'cards-after-tap'))::integer,
           count(*) filter (where s.kind = 'request'),
           (percentile_cont(0.5) within group (order by s.ms) filter (where s.kind = 'request'))::integer,
           (percentile_cont(0.9) within group (order by s.ms) filter (where s.kind = 'request'))::integer,
           count(*) filter (where s.kind = 'request' and not s.ok)
      from public.page_speed_samples s
     where s.release is not null
       and s.created_at > now() - make_interval(days => least(greatest(coalesce(days, 7), 1), 30))
     group by s.release
     order by s.release desc;
end;
$$;

revoke all on function public.admin_page_speed_by_release(integer) from public, anon;
grant execute on function public.admin_page_speed_by_release(integer) to authenticated;
