-- Run on a local database with home_feed and home_startup installed.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-1903-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active1903@probe.example'),
  ('aaaaaaaa-1903-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paused1903@probe.example'),
  ('aaaaaaaa-1903-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'signup1903@probe.example');

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin) values
  ('aaaaaaaa-1903-4000-8000-000000000001', 'peer', 'active', 'Reader', '19990001931', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', false),
  ('aaaaaaaa-1903-4000-8000-000000000002', 'peer', 'suspended', 'Paused', '19990001932', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', true);

insert into public.chat_rooms (id, name, description, category, sort_order, opened_at, show_in_home) values
  ('probe-home-startup', 'Startup probe', '', 'Life', 9963, now(), true),
  ('probe-home-closed', 'Closed probe', '', 'Life', 9964, null, true);
insert into public.chat_topics (id, room_id, title, author_id, created_at, last_post_at) values
  ('aaaaaaaa-1903-4000-8000-000000000004', 'probe-home-startup', 'Startup probe', 'aaaaaaaa-1903-4000-8000-000000000001', now(), now());
insert into public.chat_posts (topic_id, author_id, body) values
  ('aaaaaaaa-1903-4000-8000-000000000004', 'aaaaaaaa-1903-4000-8000-000000000001', 'Startup probe');

set local role authenticated;

do $$
declare
  active_id constant text := 'aaaaaaaa-1903-4000-8000-000000000001';
  answer jsonb;
begin
  perform set_config('request.jwt.claim.sub', active_id, true);
  answer := public.home_startup();
  if answer ->> 'viewer' is distinct from active_id
     or answer -> 'member' ->> 'id' is distinct from active_id
     or answer -> 'member' ? 'phone'
     or answer -> 'feed' is distinct from public.home_feed()
     or not (answer -> 'feed' @> '[{"title":"Startup probe"}]'::jsonb)
     or not (answer -> 'rooms' @> '[{"id":"probe-home-startup"}]'::jsonb)
     or answer -> 'rooms' @> '[{"id":"probe-home-closed"}]'::jsonb then
    raise exception 'An active member must receive their own projected membership and the same visible feed and rooms';
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-1903-4000-8000-000000000002', true);
  answer := public.home_startup();
  if answer -> 'member' ->> 'status' is distinct from 'suspended'
     or answer -> 'feed' is distinct from 'null'::jsonb
     or answer -> 'rooms' is distinct from 'null'::jsonb then
    raise exception 'A paused account must receive its status without feed or room data';
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-1903-4000-8000-000000000003', true);
  answer := public.home_startup();
  if answer -> 'member' is distinct from 'null'::jsonb
     or answer -> 'feed' is distinct from 'null'::jsonb
     or answer -> 'rooms' is distinct from 'null'::jsonb then
    raise exception 'An account without a member row must receive no club data';
  end if;

  if has_function_privilege('anon', 'public.home_startup()', 'execute') then
    raise exception 'Signed-out visitors must not execute home_startup';
  end if;
end
$$;

rollback;
