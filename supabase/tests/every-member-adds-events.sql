-- ============================================================================
-- Every member can add an event (20261123130000)
-- ============================================================================
-- A member who speaks for no organization adds one in their own name, and
-- changes and deletes it; nobody else but an administrator may; an event for
-- an organization stays its organizers'; a suspended member adds nothing.
--
--   docker exec -i supabase_db_thesciclub psql -U postgres -d postgres \
--     < supabase/tests/every-member-adds-events.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values
  ('aaaaaaaa-ad0e-0000-0000-00000000000a', 'peer', 'active', 'Adder',   '19990000ad0', '1980-01-01', 'C5–C8', 'CA', false),
  ('bbbbbbbb-ad0e-0000-0000-00000000000b', 'peer', 'active', 'Another', '19990000ad1', '1981-01-01', 'C5–C8', 'CA', false),
  ('cccccccc-ad0e-0000-0000-00000000000c', 'peer', 'active', 'The Admin', '19990000ad2', '1982-01-01', 'T1–T6', 'CA', true);

insert into public.organizations (id, short_code, name, city, state)
values ('11111111-ad0e-0000-0000-000000000001', 'PRAD', 'Probe Org', 'Oakland', 'CA');

create temporary table made (id uuid) on commit drop;
grant select, insert on made to authenticated;

\echo ''
\echo '== 1. a member adds one in their own name (expect a row, added_by Adder) =='
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-ad0e-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
insert into made
select public.save_event(null, null, 'Adder', 'Probe picnic', '', now() + interval '3 days',
  now() + interval '3 days 2 hours', 'in_person', 'Lake Merritt', 'Oakland', null, null, 'CA');
reset role;
select e.host_name as host, m.display_name as added_by from public.events e
  join made on made.id = e.id join public.members m on m.id = e.added_by;

\echo ''
\echo '== 2. for an organization they do not speak for (expect ERROR: You cannot add events for that organization.) =='
set local role authenticated;
savepoint for_org;
select public.save_event(null, '11111111-ad0e-0000-0000-000000000001', null, 'Not mine', '', now() + interval '3 days',
  now() + interval '3 days 1 hour', 'in_person', 'Somewhere', 'Oakland', null, null, 'CA');
rollback to savepoint for_org;

\echo ''
\echo '== 3. they may change their own (expect true), and do (expect Probe picnic 2) =='
select public.may_change_event((select id from made)) as may_change;
select public.save_event((select id from made), null, 'Adder', 'Probe picnic 2', '', now() + interval '3 days',
  now() + interval '3 days 2 hours', 'in_person', 'Lake Merritt', 'Oakland', null, null, 'CA') is not null as saved;
reset role;
select e.title from public.events e join made on made.id = e.id;

\echo ''
\echo '== 4. another member (expect false, then ERROR You cannot change this event., ERROR You cannot delete this event.) =='
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-ad0e-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.may_change_event((select id from made)) as may_change;
savepoint other_change;
select public.save_event((select id from made), null, 'Another', 'Taken', '', now() + interval '3 days',
  now() + interval '3 days 2 hours', 'in_person', 'x', 'y', null, null, 'CA');
rollback to savepoint other_change;
savepoint other_delete;
select public.delete_event((select id from made));
rollback to savepoint other_delete;
reset role;

\echo ''
\echo '== 5. an administrator may (expect true) =='
select set_config('request.jwt.claims', '{"sub":"cccccccc-ad0e-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.may_change_event((select id from made)) as may_change;
reset role;

\echo ''
\echo '== 6. suspended, the adder may not change it (expect false) nor add one (expect ERROR: Only a member can add an event.) =='
update public.members set status = 'suspended' where id = 'aaaaaaaa-ad0e-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-ad0e-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.may_change_event((select id from made)) as may_change;
savepoint suspended_add;
select public.save_event(null, null, 'Adder', 'Probe again', '', now() + interval '3 days',
  now() + interval '3 days 2 hours', 'in_person', 'Lake Merritt', 'Oakland', null, null, 'CA');
rollback to savepoint suspended_add;
reset role;
update public.members set status = 'active' where id = 'aaaaaaaa-ad0e-0000-0000-00000000000a';

\echo ''
\echo '== 7. the adder deletes it (expect 0 left) =='
set local role authenticated;
select public.delete_event((select id from made)) is not null as done;
reset role;
select count(*) as left_over from public.events e join made on made.id = e.id;

rollback;
