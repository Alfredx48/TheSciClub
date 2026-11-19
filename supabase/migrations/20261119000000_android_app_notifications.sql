alter table public.push_subscriptions
  add column fcm_installation uuid,
  drop constraint push_subscriptions_endpoint_check,
  drop constraint push_subscriptions_keys_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_check check (
    (
      endpoint ~ '^https://([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|google\.com|push\.services\.mozilla\.com|notify\.windows\.com)/'
      and length(endpoint) <= 1024
    )
    or endpoint ~ '^apns:(production|sandbox):[0-9a-f]{64,200}$'
    or (endpoint ~ '^fcm:[A-Za-z0-9_:-]+$' and length(endpoint) <= 1024)
  ),
  add constraint push_subscriptions_keys_check check (
    case
      when endpoint like 'apns:%' then p256dh is null and auth is null and fcm_installation is null
      when endpoint like 'fcm:%' then p256dh is null and auth is null and fcm_installation is not null
      else fcm_installation is null and p256dh is not null and auth is not null
        and p256dh ~ '^[A-Za-z0-9_-]+=*$' and length(p256dh) between 80 and 100
        and auth ~ '^[A-Za-z0-9_-]+=*$' and length(auth) between 16 and 32
    end
  );

create unique index push_subscriptions_fcm_installation_idx
  on public.push_subscriptions (fcm_installation)
  where fcm_installation is not null;

comment on table public.push_subscriptions is
  'Private device subscriptions for web push, APNs, or FCM. Written only by the subscription RPCs.';

create function public.push_subscribe_fcm(
  app_token text,
  app_installation uuid,
  app_user_agent text default null
)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  device text;
  member uuid := auth.uid();
begin
  if public.is_active_member() is not true then
    raise exception 'Notifications cannot be turned on while your membership is paused.';
  end if;
  if app_installation is null or app_token is null or length(app_token) > 1020
     or app_token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception 'This phone sent a token the club could not use.';
  end if;

  device := 'fcm:' || app_token;
  -- Serialize token rotation and account changes on this installation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(app_installation::text, 0));
  delete from public.push_subscriptions where fcm_installation = app_installation and endpoint <> device;

  insert into public.push_subscriptions (endpoint, member_id, fcm_installation, user_agent, created_at)
  values (device, member, app_installation, left(app_user_agent, 512), clock_timestamp())
  on conflict (endpoint) do update set
    member_id = excluded.member_id,
    fcm_installation = excluded.fcm_installation,
    user_agent = excluded.user_agent,
    created_at = excluded.created_at;

  delete from public.push_subscriptions s
   where s.member_id = member and s.fcm_installation is not null
     and s.endpoint not in (
       select k.endpoint from public.push_subscriptions k
        where k.member_id = member and k.fcm_installation is not null
        order by k.created_at desc, k.endpoint
        limit 10
     );
end;
$$;

revoke all on function public.push_subscribe_fcm(text, uuid, text) from public, anon;
grant execute on function public.push_subscribe_fcm(text, uuid, text) to authenticated, service_role;
