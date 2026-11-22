-- ============================================================================
-- Why a request failed
-- ============================================================================
-- The owner, 2026-11-21, on "24 failed" in Admin's page speed by release:
-- which requests, and why? Each failed request now says why: the server's
-- status ("401", "500"), or "no connection" when it never answered. A request
-- cancelled by leaving the screen is no longer sent at all (page-speed.ts):
-- those 24 were a robot leaving Chat before its requests finished.
--
-- Administrators see the failures by request and reason, newest period first,
-- under Speed & logs › On phones.
--
-- Expand only. Undo: supabase/undo/20261122060000.sql.
-- ============================================================================

alter table public.page_speed_samples add column failure text;

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
    (visit, kind, screen, metric, ms, ok, signed_in, installed, mobile, connection, release, failure)
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
         nullif(left(s->>'release', 20), ''),
         nullif(left(s->>'failure', 16), '')
    from (select value as s from jsonb_array_elements(samples) limit 50) x
   where s->>'kind' in ('load', 'request')
     and char_length(coalesce(s->>'visit', '')) between 8 and 40
     and char_length(coalesce(s->>'screen', '')) >= 1
     and char_length(coalesce(s->>'metric', '')) >= 1
     and jsonb_typeof(s->'ms') = 'number';
end;
$$;

create function public.admin_page_speed_failures(days integer default 7)
returns table (metric text, failure text, failed bigint, visits bigint, last_at timestamptz)
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
    select s.metric, coalesce(s.failure, 'not recorded'), count(*), count(distinct s.visit),
           max(s.created_at)
      from public.page_speed_samples s
     where s.kind = 'request' and not s.ok
       and s.created_at > now() - make_interval(days => least(greatest(coalesce(days, 7), 1), 30))
     group by 1, 2
     order by 3 desc
     limit 30;
end;
$$;

revoke all on function public.admin_page_speed_failures(integer) from public, anon;
grant execute on function public.admin_page_speed_failures(integer) to authenticated;
