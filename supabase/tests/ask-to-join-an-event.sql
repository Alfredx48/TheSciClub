-- ============================================================================
-- A member asks to join an invite-only event (20261127120000)
-- ============================================================================
-- Only an invite-only event; its org admins are told, not across a block;
-- nothing is approved on its own; only an organizer answers; Approve invites
-- this date and every later one of the series and tells them; a no is
-- silent; one ask an event.
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/ask-to-join-an-event.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1127-0000-0000-0000000000a1', 'peer', 'active', 'Oz (org admin)',   '19991127200', '1980-01-01', 'C5–C8', 'CA', false),
  ('aaaaaaaa-1127-0000-0000-0000000000a2', 'peer', 'active', 'Ola (org admin, blocked Mia)', '19991127201', '1980-01-01', 'C5–C8', 'CA', false),
  ('bbbbbbbb-1127-0000-0000-0000000000b1', 'peer', 'active', 'Mia (asks)',       '19991127202', '1981-01-01', 'C5–C8', 'CA', false),
  ('bbbbbbbb-1127-0000-0000-0000000000b2', 'peer', 'active', 'Ned (asks, is told no)', '19991127203', '1982-01-01', 'C5–C8', 'CA', false),
  ('cccccccc-1127-0000-0000-0000000000c1', 'peer', 'active', 'Ed (not an organizer)', '19991127204', '1983-01-01', 'C5–C8', 'CA', false);

insert into public.organizations (id, short_code, name, city) values
  ('dddddddd-1127-0000-0000-0000000000d1', 'PRAJ', 'Probe Rowing', 'Redwood City');
insert into public.organization_representatives (organization_id, member_id) values
  ('dddddddd-1127-0000-0000-0000000000d1', 'aaaaaaaa-1127-0000-0000-0000000000a1'),
  ('dddddddd-1127-0000-0000-0000000000d1', 'aaaaaaaa-1127-0000-0000-0000000000a2');
insert into public.member_blocks (blocker_id, blocked_id) values
  ('aaaaaaaa-1127-0000-0000-0000000000a2', 'bbbbbbbb-1127-0000-0000-0000000000b1');

insert into public.event_series (id, series_key, title, repeat_unit, repeat_every, template, first_start)
values ('eeeeeeee-1127-0000-0000-0000000000e0', 'probe-ask-join', 'Probe rowing class', 'week', 1, '{}', now() + interval '3 days');

insert into public.events (id, title, organization_id, start_time, end_time, event_format, location, city, timezone, audience, series_id, added_by) values
  ('eeeeeeee-1127-0000-0000-000000000001', 'Probe rowing class', 'dddddddd-1127-0000-0000-0000000000d1',
   now() + interval '3 days', now() + interval '3 days 1 hour', 'in_person', 'Dock', 'Redwood City', 'America/Los_Angeles', 'people',
   'eeeeeeee-1127-0000-0000-0000000000e0', 'aaaaaaaa-1127-0000-0000-0000000000a1'),
  ('eeeeeeee-1127-0000-0000-000000000002', 'Probe rowing class', 'dddddddd-1127-0000-0000-0000000000d1',
   now() + interval '10 days', now() + interval '10 days 1 hour', 'in_person', 'Dock', 'Redwood City', 'America/Los_Angeles', 'people',
   'eeeeeeee-1127-0000-0000-0000000000e0', 'aaaaaaaa-1127-0000-0000-0000000000a1'),
  ('eeeeeeee-1127-0000-0000-000000000003', 'Probe open picnic', 'dddddddd-1127-0000-0000-0000000000d1',
   now() + interval '3 days', null, 'in_person', 'Park', 'Redwood City', 'America/Los_Angeles', 'club',
   null, 'aaaaaaaa-1127-0000-0000-0000000000a1');

create temp view asked as
  select m.display_name as who, n.kind, n.count, a.display_name as asker
    from public.notifications n
    join public.members m on m.id = n.member_id
    left join public.members a on a.id = n.actor_id
   where n.member_id::text like '%-1127-%' and n.kind in ('event_join_request', 'event_notice')
   order by 1, 2;
grant select on asked to authenticated;

set local role authenticated;

\echo ''
\echo '== 1. only an invite-only event can be asked (expect ERROR: You can ask to join only an invite-only event.) =='
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-1127-0000-0000-0000000000b1","role":"authenticated"}', true) is not null as ok;
savepoint s1;
select public.ask_to_join_event('eeeeeeee-1127-0000-0000-000000000003');
rollback to savepoint s1;

\echo ''
\echo '== 2. Mia asks (expect asked) =='
select public.ask_to_join_event('eeeeeeee-1127-0000-0000-000000000001');

\echo ''
\echo '== 3. ...and still cannot see it: asking is not an invite (expect f) =='
select public.can_see_event('eeeeeeee-1127-0000-0000-000000000001');

\echo ''
\echo '== 4. Oz is told; Ola, who blocked Mia, is not (expect Oz event_join_request 1 Mia) =='
reset role;
select * from asked;

\echo ''
\echo '== 5. asking again tells nobody again (expect asked, then Oz still 1) =='
set local role authenticated;
select public.ask_to_join_event('eeeeeeee-1127-0000-0000-000000000001');
reset role;
select who, count from asked where kind = 'event_join_request';

\echo ''
\echo '== 6. Ed, not an organizer, cannot see the asks or answer (expect ERROR twice) =='
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-1127-0000-0000-0000000000c1","role":"authenticated"}', true) is not null as ok;
savepoint s6a;
select * from public.event_join_requests_for('eeeeeeee-1127-0000-0000-000000000001');
rollback to savepoint s6a;
savepoint s6b;
select public.answer_event_join_request('eeeeeeee-1127-0000-0000-000000000001', 'bbbbbbbb-1127-0000-0000-0000000000b1', true);
rollback to savepoint s6b;

\echo ''
\echo '== 7. Ned asks too; Oz sees both (expect Mia, Ned) =='
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-1127-0000-0000-0000000000b2","role":"authenticated"}', true) is not null as ok;
select public.ask_to_join_event('eeeeeeee-1127-0000-0000-000000000001');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1127-0000-0000-0000000000a1","role":"authenticated"}', true) is not null as ok;
select name from public.event_join_requests_for('eeeeeeee-1127-0000-0000-000000000001');

\echo ''
\echo '== 8. Oz approves Mia: she sees this date and the next one, and is told (expect t | t, then Mia event_notice) =='
select public.answer_event_join_request('eeeeeeee-1127-0000-0000-000000000001', 'bbbbbbbb-1127-0000-0000-0000000000b1', true);
reset role;
select private.member_sees_event('bbbbbbbb-1127-0000-0000-0000000000b1', 'eeeeeeee-1127-0000-0000-000000000001') as this_date,
       private.member_sees_event('bbbbbbbb-1127-0000-0000-0000000000b1', 'eeeeeeee-1127-0000-0000-000000000002') as next_date;
select who, kind from asked where who like 'Mia%';

\echo ''
\echo '== 9. Oz declines Ned: he is not invited, not told, and still reads asked (expect f | 0 | asked) =='
set local role authenticated;
select public.answer_event_join_request('eeeeeeee-1127-0000-0000-000000000001', 'bbbbbbbb-1127-0000-0000-0000000000b2', false);
reset role;
select private.member_sees_event('bbbbbbbb-1127-0000-0000-0000000000b2', 'eeeeeeee-1127-0000-0000-000000000001') as sees,
       (select count(*) from public.notifications n where n.member_id = 'bbbbbbbb-1127-0000-0000-0000000000b2') as told;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-1127-0000-0000-0000000000b2","role":"authenticated"}', true) is not null as ok;
select public.my_event_join_request('eeeeeeee-1127-0000-0000-000000000001');

\echo ''
\echo '== 10. answered twice (expect ERROR: That ask was already answered.) =='
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1127-0000-0000-0000000000a1","role":"authenticated"}', true) is not null as ok;
savepoint s10;
select public.answer_event_join_request('eeeeeeee-1127-0000-0000-000000000001', 'bbbbbbbb-1127-0000-0000-0000000000b2', true);
rollback to savepoint s10;

\echo ''
\echo '== 11. nobody left to answer: Oz''s notice is read; in his bell it opened the guest list (expect t, then /events/eeeeeeee-1127-0000-0000-000000000001/guests) =='
reset role;
select read_at is not null as read from public.notifications
 where member_id = 'aaaaaaaa-1127-0000-0000-0000000000a1' and kind = 'event_join_request';
set local role authenticated;
select url from public.my_notifications() where kind = 'event_join_request';

\echo ''
\echo '== 12. a member cannot read the asks table (expect ERROR: permission denied) =='
savepoint s12;
select * from public.event_join_requests;
rollback to savepoint s12;

rollback;
