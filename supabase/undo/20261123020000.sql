-- Undo for 20261123020000_push_devices_and_app_versions.sql: the functions as
-- 20261122090000 made them, then the columns. An app that still calls
-- note_my_push_device gets "no such function", which it ignores.

drop function public.note_my_push_device(text, text, text, text);
drop function public.admin_app_errors(integer);
create or replace function public.log_push_deliveries(p_secret text, p_rows jsonb)
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

create or replace function public.log_app_errors(errors jsonb)
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

create or replace function public.admin_app_errors(p_days integer default 7)
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

create or replace function public.admin_deliveries(p_days integer default 7, p_email text default null)
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

revoke all on function public.admin_app_errors(integer) from public, anon;
grant execute on function public.admin_app_errors(integer) to authenticated;

alter table public.app_errors drop column app_version;
alter table public.delivery_log drop column device, drop column release, drop column app_version;
alter table public.push_subscriptions
  drop column device, drop column release, drop column app_version, drop column seen_at;

notify pgrst, 'reload schema';
