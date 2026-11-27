-- ============================================================================
-- A date is cancelled, not deleted (20261127100000)
-- ============================================================================
-- Only whoever may change it cancels it, and only before it starts. Going is
-- told with a push, Interested in the bell, not across a block, and the
-- notice opens the date. Its answers go; nobody can answer it or register for
-- it after.
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/a-date-is-cancelled.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1127-0000-0000-00000000000a', 'peer', 'active', 'Ana (going)',      '19991127100', '1980-01-01', 'C5–C8', 'CA', false),
  ('bbbbbbbb-1127-0000-0000-00000000000b', 'peer', 'active', 'Bo (interested)',  '19991127101', '1981-01-01', 'C5–C8', 'CA', false),
  ('cccccccc-1127-0000-0000-00000000000c', 'peer', 'active', 'Cy (added it)',    '19991127102', '1982-01-01', 'C5–C8', 'CA', false),
  ('dddddddd-1127-0000-0000-00000000000d', 'peer', 'active', 'Di (blocked Cy)',  '19991127103', '1983-01-01', 'C5–C8', 'CA', false),
  ('eeeeeeee-1127-0000-0000-00000000000e', 'peer', 'active', 'Ed (a stranger)',  '19991127104', '1984-01-01', 'C5–C8', 'CA', false);

insert into public.member_blocks (blocker_id, blocked_id) values
  ('dddddddd-1127-0000-0000-00000000000d', 'cccccccc-1127-0000-0000-00000000000c');

insert into public.events (id, title, host_name, start_time, end_time, event_format, location, city, timezone, added_by) values
  ('11271127-0000-0000-0000-000000000001', 'Probe weekly', 'Cy', now() + interval '7 days', now() + interval '7 days 2 hours',
   'in_person', '1 Main St', 'Oakland', 'America/Los_Angeles', 'cccccccc-1127-0000-0000-00000000000c'),
  ('11271127-0000-0000-0000-000000000002', 'Probe started', 'Cy', now() - interval '1 hour', now() + interval '1 hour',
   'in_person', '1 Main St', 'Oakland', 'America/Los_Angeles', 'cccccccc-1127-0000-0000-00000000000c');

insert into public.event_rsvps (event_id, member_id, status) values
  ('11271127-0000-0000-0000-000000000001', 'aaaaaaaa-1127-0000-0000-00000000000a', 'going'),
  ('11271127-0000-0000-0000-000000000001', 'bbbbbbbb-1127-0000-0000-00000000000b', 'interested'),
  ('11271127-0000-0000-0000-000000000001', 'dddddddd-1127-0000-0000-00000000000d', 'going');

grant select on public.notifications to authenticated;

set local role authenticated;

\echo ''
\echo '== 1. a member who did not add it cannot cancel it (expect ERROR: You cannot cancel this event.) =='
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-1127-0000-0000-00000000000e","role":"authenticated"}', true) is not null as ok;
savepoint s1;
select public.cancel_event('11271127-0000-0000-0000-000000000001');
rollback to savepoint s1;

\echo ''
\echo '== 2. one that has started cannot be cancelled (expect ERROR: Only a date that has not started can be cancelled.) =='
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-1127-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
savepoint s2;
select public.cancel_event('11271127-0000-0000-0000-000000000002');
rollback to savepoint s2;

\echo ''
\echo '== 3. Cy cancels it: Ana and Bo told; Di, who blocked him, not (expect 2) =='
select public.cancel_event('11271127-0000-0000-0000-000000000001') as told;

\echo ''
\echo '== 4. cancelled, and no answers left (expect t | 0) =='
reset role;
select e.cancelled_at is not null as cancelled,
       (select count(*) from public.event_rsvps r where r.event_id = e.id) as answers
  from public.events e where e.id = '11271127-0000-0000-0000-000000000001';

\echo ''
\echo '== 5. Ana by push (event_cancelled), Bo in the bell (event_cancelled_bell), both on the date (expect Ana event_cancelled t / Bo event_cancelled_bell t) =='
select m.display_name as who, split_part(n.tag, ':', 1) as tag,
       n.event_id = '11271127-0000-0000-0000-000000000001' as on_the_date
  from public.notifications n join public.members m on m.id = n.member_id
 where n.kind = 'event_changed' and n.member_id::text like '%-1127-%'
 order by 1;

\echo ''
\echo '== 6. in Ana''s bell it opens the date (expect Probe weekly | /events/11271127-0000-0000-0000-000000000001) =='
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1127-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
select place, url from public.my_notifications() where kind = 'event_changed';

\echo ''
\echo '== 7. Ana cannot say Going to it again (expect ERROR: This date was cancelled.) =='
savepoint s7;
insert into public.event_rsvps (event_id, member_id, status)
values ('11271127-0000-0000-0000-000000000001', 'aaaaaaaa-1127-0000-0000-00000000000a', 'going');
rollback to savepoint s7;

\echo ''
\echo '== 8. nobody can register for it from its page (expect ERROR: This date was cancelled.) =='
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) is not null as ok;
savepoint s8;
select public.register_for_event('11271127-0000-0000-0000-000000000001', 'Guest', 'guest@example.com', null, 'going');
rollback to savepoint s8;

\echo ''
\echo '== 9. Cy cannot cancel it twice (expect ERROR: This date is already cancelled.) =='
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-1127-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
savepoint s9;
select public.cancel_event('11271127-0000-0000-0000-000000000001');
rollback to savepoint s9;

\echo ''
\echo '== 10. its public page says so (expect t) =='
select cancelled_at is not null as cancelled from public.public_event('11271127-0000-0000-0000-000000000001');

rollback;
