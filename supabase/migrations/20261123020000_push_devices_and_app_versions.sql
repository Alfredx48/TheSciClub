-- ============================================================================
-- Which kind of device, and which version of the app, a push or a crash was
-- ============================================================================
-- The owner, 2026-11-22: a push showed "gone" on Admin › Sent, and nothing
-- said whether it was the App Store app, the Home Screen app or a browser, or
-- which version of the app was on it. Each device the club pushes to now
-- carries its kind (iphone-store-app, iphone-app for the Home Screen one,
-- iphone for Safari…), the web release it last opened with and, in the store
-- app, the app's version; each push's outcome is logged with them. Crashes
-- carry the store app's version too.
--
-- Still never who: the kind and versions, not the device or the member.

alter table public.push_subscriptions
  add column device text,
  add column release text,
  add column app_version text,
  add column seen_at timestamptz;

-- The app, on opening with notifications on: this device's kind and versions.
create function public.note_my_push_device(
  p_endpoint text, p_device text, p_release text, p_app_version text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.push_subscriptions
     set device = left(p_device, 30),
         release = left(p_release, 20),
         app_version = left(p_app_version, 30),
         seen_at = now()
   where endpoint = p_endpoint
     and member_id = auth.uid();
$$;
revoke all on function public.note_my_push_device(text, text, text, text) from public, anon;
grant execute on function public.note_my_push_device(text, text, text, text) to authenticated;

alter table public.delivery_log
  add column device text,
  add column release text,
  add column app_version text;

alter table public.app_errors add column app_version text;

-- push-notify sends each row's endpoint; the kind and versions are looked up
-- here and the endpoint is not kept.
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
  insert into public.delivery_log (channel, kind, outcome, reason, service,
                                   device, release, app_version)
  select 'push', left(r ->> 'kind', 40), left(coalesce(r ->> 'outcome', 'unknown'), 20),
         left(r ->> 'reason', 200), left(r ->> 'service', 60),
         s.device, s.release, s.app_version
    from jsonb_array_elements(p_rows) with ordinality as x(r, n)
    left join public.push_subscriptions s on s.endpoint = x.r ->> 'endpoint'
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
  insert into public.app_errors (kind, message, source, screen, release, device, app_version)
  select left(coalesce(e ->> 'kind', 'error'), 20),
         left(e ->> 'message', 300),
         left(e ->> 'source', 200),
         left(e ->> 'screen', 80),
         left(e ->> 'release', 20),
         left(e ->> 'device', 30),
         left(e ->> 'app_version', 30)
    from jsonb_array_elements(errors) with ordinality as x(e, n)
   where x.n <= 10 and jsonb_typeof(e) = 'object' and coalesce(e ->> 'message', '') <> '';
end;
$$;

drop function public.admin_app_errors(integer);
create function public.admin_app_errors(p_days integer default 7)
returns table (kind text, message text, source text, times bigint, screens text[],
               releases text[], devices text[], app_versions text[],
               first_at timestamptz, last_at timestamptz)
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
           (array_agg(distinct e.app_version) filter (where e.app_version is not null))[1:5],
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

-- Adds by_device (pushes by kind of device and outcome) and each latest row's
-- device and versions.
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
    'by_device', coalesce((
      select jsonb_agg(jsonb_build_object('device', d.device, 'outcome', d.outcome, 'count', d.n)
                       order by d.n desc)
        from (select l.device, l.outcome, count(*) as n
                from public.delivery_log l where l.at > since and l.channel = 'push'
               group by 1, 2) d), '[]'),
    'latest', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'channel', l.channel, 'kind', l.kind,
                                          'outcome', l.outcome, 'reason', l.reason,
                                          'service', l.service, 'device', l.device,
                                          'release', l.release, 'app_version', l.app_version)
                       order by l.at desc)
        from (select * from public.delivery_log l
               where l.at > since
                 and (wanted is null or l.address_hash = wanted)
                 and (wanted is not null or l.outcome not in ('sent', 'delivered'))
               order by l.at desc limit 60) l), '[]')
  );
end;
$$;

notify pgrst, 'reload schema';
