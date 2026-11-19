\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('a5960000-0000-0000-0000-000000000001', 'schedule-one@example.com'),
  ('a5960000-0000-0000-0000-000000000002', 'schedule-two@example.com');
insert into public.members (id, type, status, display_name, birth_date, level_range, state) values
  ('a5960000-0000-0000-0000-000000000001', 'peer', 'active', 'Schedule One', '1980-01-01', 'C5–C8', 'CA'),
  ('a5960000-0000-0000-0000-000000000002', 'peer', 'active', 'Schedule Two', '1980-01-01', 'C5–C8', 'CA');
insert into public.events (id, title, start_time, audience, host_name) values
  ('a5960000-0000-0000-0000-000000000003', 'Schedule probe', now() + interval '2 days', 'people', 'Test host');
insert into public.event_rsvps (event_id, member_id, status) values
  ('a5960000-0000-0000-0000-000000000003', 'a5960000-0000-0000-0000-000000000001', 'going');

update public.events set start_time = start_time + interval '1 day'
where id = 'a5960000-0000-0000-0000-000000000003';

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"a5960000-0000-0000-0000-000000000001"}', true);
  assert (select new_start - previous_start from public.my_event_schedule_updates()) = interval '1 day';
  perform set_config('request.jwt.claims', '{"sub":"a5960000-0000-0000-0000-000000000002"}', true);
  assert not exists (select from public.my_event_schedule_updates());
  assert not has_function_privilege('anon', 'public.my_event_schedule_updates(uuid)', 'execute');
end;
$$;
reset role;

delete from public.events where id = 'a5960000-0000-0000-0000-000000000003';
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"a5960000-0000-0000-0000-000000000001"}', true);
  assert (select count(*) from public.my_event_schedule_updates() where new_start is null) = 1;
  perform set_config('request.jwt.claims', '{"sub":"a5960000-0000-0000-0000-000000000002"}', true);
  assert not exists (select from public.my_event_schedule_updates());
end;
$$;
rollback;
