-- Run on the local database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;

insert into public.members
  (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values
  ('eeeeeeee-2201-4000-8000-000000000001', 'peer', 'active', 'Event test admin', '15105550181', '1980-01-01', 'C5–C8', 'CA', true),
  ('eeeeeeee-2201-4000-8000-000000000002', 'peer', 'active', 'Event test member', '15105550182', '1981-01-01', 'C5–C8', 'CA', false);

insert into public.events (id, title, host_name, start_time, end_time, audience, added_by)
values ('eeeeeeee-2201-4000-8000-000000000003', 'Test guest list', 'Test host',
  now() - interval '2 days 2 hours', now() - interval '2 days', 'people', 'eeeeeeee-2201-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-2201-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.set_event_postal_code('eeeeeeee-2201-4000-8000-000000000003', ' 94404-1234 ');
  if (select postal_code from public.events where id = 'eeeeeeee-2201-4000-8000-000000000003')
     is distinct from '94404-1234' then
    raise exception 'ZIP+4 was not stored';
  end if;
  begin
    perform public.set_event_postal_code('eeeeeeee-2201-4000-8000-000000000003', '٩٤٤٠٤');
    raise exception 'A ZIP written in non-ASCII digits was accepted';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform public.event_guest_check_in('eeeeeeee-2201-4000-8000-000000000003', true,
      'eeeeeeee-2201-4000-8000-000000000002', null);
    raise exception 'A member outside the guest list was checked in';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"eeeeeeee-2201-4000-8000-000000000002","role":"authenticated"}';

do $$
begin
  begin
    perform public.check_in_missed('eeeeeeee-2201-4000-8000-000000000003');
    raise exception 'Missed check-in help accepted an event outside the member audience';
  exception when sqlstate 'PT404' then
    null;
  end;
end;
$$;

rollback;
