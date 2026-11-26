-- ============================================================================
-- Staff are told they are verified (20261125160000)
-- ============================================================================
-- An administrator makes a member staff: the member gets one staff_verified
-- notification naming the organization, opening /me#profession. The same
-- organization again tells nobody; another organization tells them again.
-- Nobody but an administrator can make staff.
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/staff-verified-notice.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off
\pset null '(null)'

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values ('aaaaaaaa-5555-5555-5555-555555555555', 'peer', 'active', 'Club Admin',
        '19990000050', '1980-01-01', 'T1–T6', 'CA', true),
       ('bbbbbbbb-5555-5555-5555-555555555555', 'peer', 'active', 'Pat Therapist',
        '19990000051', '1980-01-01', 'T1–T6', 'CA', false);

select id as ncs_id from public.organizations where short_code = 'NCS' \gset
select id as other_id from public.organizations where short_code <> 'NCS' and removed_at is null order by name limit 1 \gset

-- A device to push to, to see the push asked for.
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values ('bbbbbbbb-5555-5555-5555-555555555555', 'apns:sandbox:' || repeat('ab', 32), null, null);

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-5555-5555-5555-555555555555","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 1. made staff: one notification, naming the organization =='
select public.admin_set_staff('bbbbbbbb-5555-5555-5555-555555555555', :'ncs_id');
set local role postgres;
\echo '   expect: 1 | t'
select count(*) as told, bool_and(organization_id = :'ncs_id') as names_it
  from public.notifications
 where member_id = 'bbbbbbbb-5555-5555-5555-555555555555' and kind = 'staff_verified';
\echo '   expect the push: staff_verified | NorCal SCI | /me#profession'
select o.kind, o.subject, o.url
  from public.notifications n,
       lateral private.staff_verified_owed('staff_verified', jsonb_build_object('id', n.id)) o
 where n.member_id = 'bbbbbbbb-5555-5555-5555-555555555555' and n.kind = 'staff_verified';

\echo ''
\echo '== 2. what the member reads in the bell =='
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-5555-5555-5555-555555555555","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
\echo '   expect: staff_verified | NorCal SCI | /me#profession | (null)'
select kind, place, url, actor_name from public.my_notifications() where kind = 'staff_verified';
set local role postgres;

\echo ''
\echo '== 3. the same organization again tells nobody =='
update public.notifications set created_at = '2026-01-01'
 where member_id = 'bbbbbbbb-5555-5555-5555-555555555555' and kind = 'staff_verified';
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-5555-5555-5555-555555555555","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.admin_set_staff('bbbbbbbb-5555-5555-5555-555555555555', :'ncs_id');
set local role postgres;
\echo '   expect: 1 | 2026-01-01 (not told again)'
select count(*), max(created_at)::date from public.notifications
 where member_id = 'bbbbbbbb-5555-5555-5555-555555555555' and kind = 'staff_verified';

\echo ''
\echo '== 4. another organization tells them again, in the same notification =='
set local role authenticated;
select public.admin_set_staff('bbbbbbbb-5555-5555-5555-555555555555', :'other_id');
set local role postgres;
\echo '   expect: 1 | t | t'
select count(*), bool_and(organization_id = :'other_id') as the_new_one,
       bool_and(created_at > '2026-01-02') as told_now
  from public.notifications
 where member_id = 'bbbbbbbb-5555-5555-5555-555555555555' and kind = 'staff_verified';

\echo ''
\echo '== 5. a member who is not an administrator cannot make staff =='
\echo '   expect: ERROR 42501 Not an administrator'
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-5555-5555-5555-555555555555","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint not_admin;
select public.admin_set_staff('bbbbbbbb-5555-5555-5555-555555555555', :'ncs_id');
rollback to savepoint not_admin;

set local role postgres;
rollback;
