-- Undo for 20261122060000_page_speed_why_requests_failed.sql: failures no
-- longer say why. log_page_speed as 20261122030000 left it. Can be run under
-- a live website: an app that still sends a reason is fine.

drop function public.admin_page_speed_failures(integer);

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

alter table public.page_speed_samples drop column failure;
