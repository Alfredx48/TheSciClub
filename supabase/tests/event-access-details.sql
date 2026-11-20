-- Run against a test database with the access-details migration. Rolls back.
begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values
  ('aaaaaaaa-acce-0000-0000-000000000001', 'peer', 'active', 'Access Host', '15105550181', '1980-01-01', 'C5–C8', 'CA', true),
  ('aaaaaaaa-acce-0000-0000-000000000002', 'peer', 'active', 'Access Reader', '15105550182', '1981-01-01', 'C5–C8', 'CA', false);

insert into public.events (id, title, start_time, event_format, host_name, audience, access_details)
values
  ('eeeeeeee-acce-0000-0000-000000000001', 'Access public', now() + interval '4 days', 'online', 'Test host', 'public', 'Live captions'),
  ('eeeeeeee-acce-0000-0000-000000000002', 'Access invite only', now() + interval '4 days', 'online', 'Test host', 'people', 'Dial-in available');

set local role anon;
do $$
begin
  if (select access_details from public.public_event('eeeeeeee-acce-0000-0000-000000000001')) is distinct from 'Live captions' then
    raise exception 'Public notes missing';
  end if;
  if exists (select from public.public_event('eeeeeeee-acce-0000-0000-000000000002'))
     or exists (select access_details from public.events where id = 'eeeeeeee-acce-0000-0000-000000000002') then
    raise exception 'Invite-only notes visible to an anonymous reader';
  end if;
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-acce-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if exists (select access_details from public.events where id = 'eeeeeeee-acce-0000-0000-000000000002') then
    raise exception 'Invite-only notes visible to a non-invitee';
  end if;
  begin
    perform public.save_event(
      'eeeeeeee-acce-0000-0000-000000000001', null, 'Test host', 'Access public', '',
      now() + interval '4 days', null, 'online', '', null, null, null, null, 'Changed');
    raise exception 'Non-organizer could update access details';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"aaaaaaaa-acce-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  first_id uuid;
  series uuid;
begin
  first_id := public.save_event_series(
    null, 'Test host', 'Access repeat', '', now() + interval '4 days', null,
    'online', '', null, null, null, 'week', 1, null, 2, null, '  Live captions  ');
  perform public.save_event(first_id, null, 'Test host', 'Access repeat renamed', '',
    now() + interval '4 days', null, 'online', '', null, null, null, null);
  select series_id into series from public.events where id = first_id;
  if (select count(*) from public.events where series_id = series and access_details = 'Live captions') <> 2 then
    raise exception 'Series notes missing or lost through the old save path';
  end if;
end;
$$;
rollback;
