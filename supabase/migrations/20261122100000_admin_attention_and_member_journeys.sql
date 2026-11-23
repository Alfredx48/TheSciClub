create table private.member_journey_runs (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  build text check (build ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  steps_ms integer[] not null,
  failed_step integer check (failed_step between 1 and 4),
  check (cardinality(steps_ms) = coalesce(failed_step, 4))
);

create table private.admin_incident_acknowledgements (
  incident text primary key,
  acknowledged_at timestamptz not null default now()
);

-- Only accept timings and the failed step. Never store bot credentials or page contents.
create function public.record_member_journey(
  p_token text, p_build text, p_steps_ms integer[], p_failed_step integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  expected text;
begin
  select decrypted_secret into expected from vault.decrypted_secrets
    where name = 'member_journey_result_token';
  if expected is null or p_token is null
     or extensions.digest(p_token, 'sha256') <> extensions.digest(expected, 'sha256') then
    raise exception 'Invalid journey report credential.' using errcode = '42501';
  end if;
  if p_steps_ms is null or cardinality(p_steps_ms) not between 1 and 4
     or array_ndims(p_steps_ms) <> 1
     or exists (select from unnest(p_steps_ms) as ms where ms is null or ms not between 0 and 120000)
     or (p_failed_step is not null and p_failed_step not between 1 and 4)
     or cardinality(p_steps_ms) <> coalesce(p_failed_step, 4) then
    raise exception 'Invalid journey result.' using errcode = '22023';
  end if;
  insert into private.member_journey_runs (build, steps_ms, failed_step)
  values (p_build, p_steps_ms, p_failed_step);

  delete from private.member_journey_runs where checked_at < now() - interval '90 days';
  delete from private.admin_incident_acknowledgements where acknowledged_at < now() - interval '365 days';
end;
$$;

revoke all on function public.record_member_journey(text,text,integer[],integer) from public, authenticated;
grant execute on function public.record_member_journey(text,text,integer[],integer) to anon;

create function private.current_admin_incidents()
returns table (incident text, kind text, opened_at timestamptz, detail text, build text, failed_step integer)
language sql stable set search_path = '' as $$
  with latest as (
    select r.* from private.member_journey_runs r order by r.id desc limit 1
  )
  select 'alert:' || a.id, a.kind, a.opened_at, a.detail, null::text, null::integer
    from private.admin_alerts a
   where (a.kind = 'app_down' and a.closed_at is null)
      or (a.kind = 'server_errors' and a.opened_at > now() - interval '2 hours')
  union all
  select 'journey:' || started.id, 'journey_failed', started.checked_at, null, latest.build, latest.failed_step
    from latest
    cross join lateral (
      select r.id, r.checked_at from private.member_journey_runs r
      where r.id > coalesce((
        select max(prior.id) from private.member_journey_runs prior
        where prior.failed_step is distinct from latest.failed_step
      ), 0)
      order by r.id limit 1
    ) started
    where latest.failed_step is not null
$$;

revoke all on function private.current_admin_incidents() from public, anon, authenticated;

create function public.admin_attention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators read incidents.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'incidents', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object('acknowledged_at', a.acknowledged_at)
                       order by a.acknowledged_at nulls first, i.opened_at desc)
      from private.current_admin_incidents() i
      left join private.admin_incident_acknowledgements a using (incident)
    ), '[]'),
    'journeys', coalesce((
      select jsonb_agg(r order by r.id desc) from (
        select * from private.member_journey_runs order by id desc limit 10
      ) r
    ), '[]')
  );
end;
$$;

create function public.admin_acknowledge_incident(p_incident text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators acknowledge incidents.' using errcode = '42501';
  end if;
  insert into private.admin_incident_acknowledgements (incident)
    select i.incident from private.current_admin_incidents() i where i.incident = p_incident
    on conflict do nothing;
end;
$$;

revoke all on function public.admin_attention() from public, anon;
revoke all on function public.admin_acknowledge_incident(text) from public, anon;
grant execute on function public.admin_attention() to authenticated;
grant execute on function public.admin_acknowledge_incident(text) to authenticated;
