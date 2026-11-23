-- Run on a test database. The probe writes nothing after rollback.
begin;

select vault.create_secret('journey-probe-secret', 'member_journey_result_token')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'member_journey_result_token'
);
do $$
begin
  if has_function_privilege('anon', 'public.admin_attention()', 'execute')
     or has_function_privilege('anon', 'public.admin_acknowledge_incident(text)', 'execute') then
    raise exception 'Anonymous clients can access the attention queue';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.admin_attention();
    raise exception 'A non-admin read the attention queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_acknowledge_incident('alert:1');
    raise exception 'A non-admin acknowledged an incident';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_member_journey('wrong-token', null, array[50], 1);
    raise exception 'A client reported a run with the wrong credential';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
declare
  token text := (select decrypted_secret from vault.decrypted_secrets
                 where name = 'member_journey_result_token');
  first_incident text;
  second_incident text;
  administrator uuid;
begin
  perform public.record_member_journey(token, null, array[100, 200], 2);
  select incident into strict first_incident
    from private.current_admin_incidents() where kind = 'journey_failed';

  perform public.record_member_journey(token, null, array[150, 250], 2);
  select incident into strict second_incident
    from private.current_admin_incidents() where kind = 'journey_failed';

  if first_incident is distinct from second_incident then
    raise exception 'Repeated journey failure opened a new incident';
  end if;

  select id into strict administrator from public.members where is_admin and status = 'active' limit 1;
  perform set_config('request.jwt.claim.sub', administrator::text, true);
  perform public.admin_acknowledge_incident(first_incident);
  if not exists (
    select from jsonb_array_elements(public.admin_attention()->'incidents') i
    where i->>'incident' = first_incident and i->>'acknowledged_at' is not null
  ) then
    raise exception 'The administrator acknowledgement did not persist';
  end if;

  perform public.record_member_journey(token, null, array[50, 100, 200, 100], null);
  if exists (select from private.current_admin_incidents() where kind = 'journey_failed') then
    raise exception 'A successful journey did not close the incident';
  end if;

  perform public.record_member_journey(token, null, array[120, 200], 2);
  select incident into strict second_incident
    from private.current_admin_incidents() where kind = 'journey_failed';
  if first_incident = second_incident then
    raise exception 'A fresh failure reused a previous incident';
  end if;
end;
$$;

rollback;
