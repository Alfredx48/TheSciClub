-- Older samples keep an unknown platform.
alter table public.page_speed_samples add column platform text
  check (platform in ('ios-app', 'android-app', 'home-screen', 'browser'));

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
    (visit, kind, screen, metric, ms, ok, signed_in, installed, mobile, connection, release, failure, platform)
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
         nullif(left(s->>'failure', 16), ''),
         case when s->>'platform' in ('ios-app', 'android-app', 'home-screen', 'browser')
              then s->>'platform' end
    from (select value as s from jsonb_array_elements(samples) limit 50) x
   where s->>'kind' in ('load', 'request')
     and char_length(coalesce(s->>'visit', '')) between 8 and 40
     and char_length(coalesce(s->>'screen', '')) >= 1
     and char_length(coalesce(s->>'metric', '')) >= 1
     and jsonb_typeof(s->'ms') = 'number';
end;
$$;

create function public.admin_page_speed_by_platform(days integer default 30)
returns table (
  platform text,
  release text,
  metric text,
  samples bigint,
  p50_ms integer,
  p90_ms integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators see page speed.' using errcode = '42501';
  end if;

  return query
    select coalesce(s.platform, 'unknown'), s.release, s.metric, count(*),
           (percentile_cont(0.5) within group (order by s.ms))::integer,
           (percentile_cont(0.9) within group (order by s.ms))::integer
      from public.page_speed_samples s
     where s.created_at > now() - make_interval(days => least(greatest(coalesce(days, 30), 1), 30))
       and s.release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
       and s.kind = 'load' and s.ok
       and s.metric in ('first-paint', 'cards-after-tap')
     group by 1, s.release, s.metric
     order by 1, s.release desc, s.metric;
end;
$$;

revoke all on function public.admin_page_speed_by_platform(integer) from public, anon;
grant execute on function public.admin_page_speed_by_platform(integer) to authenticated;
