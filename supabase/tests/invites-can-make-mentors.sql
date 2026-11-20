-- ============================================================================
-- An invite can make whoever joins on it a mentor of its organization
-- (20261119200000)
-- ============================================================================
-- Only the inviter marks their own pending invites, each for an organization
-- they may make mentors for; one with no organization is refused. Joining on
-- a marked invite makes a mentor (and a member) of its organization, unless
-- the inviter may no longer make its mentors. Run against the test project
-- on 2026-11-19 as one rolled-back block, every case as expected.
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('aaaaaaaa-6e6e-0000-0000-00000000000a', 'peer', 'active', 'Probe admin', '19990006e01', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true),
  ('aaaaaaaa-6e6e-0000-0000-00000000000b', 'peer', 'active', 'Probe member', '19990006e02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false),
  ('aaaaaaaa-6e6e-0000-0000-00000000000c', 'peer', 'active', 'Probe org admin', '19990006e03', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false);
insert into public.organizations (id, short_code, name, city)
values ('bbbbbbbb-6e6e-0000-0000-00000000000a', 'PMNA', 'Probe Mentor Org', 'Oakland'),
       ('bbbbbbbb-6e6e-0000-0000-00000000000b', 'PMNB', 'Probe Other Org', 'Oakland');
insert into public.organization_representatives (organization_id, member_id)
values ('bbbbbbbb-6e6e-0000-0000-00000000000a', 'aaaaaaaa-6e6e-0000-0000-00000000000c');
insert into public.invites (id, email, status, invited_by_member_id, for_organization_id)
values
  ('cccccccc-6e6e-0000-0000-000000000001', 'probe-mentor-1@example.com', 'pending', 'aaaaaaaa-6e6e-0000-0000-00000000000c', 'bbbbbbbb-6e6e-0000-0000-00000000000a'),
  ('cccccccc-6e6e-0000-0000-000000000002', 'probe-mentor-2@example.com', 'pending', 'aaaaaaaa-6e6e-0000-0000-00000000000c', 'bbbbbbbb-6e6e-0000-0000-00000000000b'),
  ('cccccccc-6e6e-0000-0000-000000000003', 'probe-mentor-3@example.com', 'pending', 'aaaaaaaa-6e6e-0000-0000-00000000000c', null),
  ('cccccccc-6e6e-0000-0000-000000000004', 'probe-mentor-4@example.com', 'pending', 'aaaaaaaa-6e6e-0000-0000-00000000000a', 'bbbbbbbb-6e6e-0000-0000-00000000000b'),
  ('cccccccc-6e6e-0000-0000-000000000005', 'probe-mentor-5@example.com', 'pending', 'aaaaaaaa-6e6e-0000-0000-00000000000c', 'bbbbbbbb-6e6e-0000-0000-00000000000a');

\echo '1. org admin marks their own invite for their org: expect 1'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6e6e-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000001', 'cccccccc-6e6e-0000-0000-000000000005']::uuid[], true) as marked;
\echo '2. their invite for an org they do not run: expect ERROR Only that organization''s admins'
savepoint a;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000002']::uuid[], true);
rollback to savepoint a;
\echo '3. their invite with no org: expect ERROR A mentor is an organization''s'
savepoint b;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000003']::uuid[], true);
rollback to savepoint b;
\echo '4. someone else''s invite: expect ERROR Only your own invites'
savepoint c;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000004']::uuid[], true);
rollback to savepoint c;
reset role;
\echo '5. a member marking anything: expect ERROR Only your own invites'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6e6e-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint d;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000001']::uuid[], true);
rollback to savepoint d;
reset role;
\echo '6. club admin marks their invite for any org: expect 1'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6e6e-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.set_invites_mentor(array['cccccccc-6e6e-0000-0000-000000000004']::uuid[], true) as marked;
reset role;
\echo '7. the column cannot be written directly by a member (expect ERROR permission or 0 rows)'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-6e6e-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint e;
update public.invites set as_mentor = true where id = 'cccccccc-6e6e-0000-0000-000000000002';
select as_mentor as direct_write from public.invites where id = 'cccccccc-6e6e-0000-0000-000000000002';
rollback to savepoint e;
reset role;

\echo '8. joining on a mentor invite: expect Probe Mentor Org mentor, type mentor, member of it'
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, invite_id)
values ('aaaaaaaa-6e6e-0000-0000-0000000000d1', 'peer', 'active', 'Probe joiner 1', '19990006e11', '1980-01-01', 'T1–T6', 'CA', 'Oakland', 'cccccccc-6e6e-0000-0000-000000000001');
select o.name as mentor_of, g.granted_by = 'aaaaaaaa-6e6e-0000-0000-00000000000c' as granted_by_inviter
  from public.organization_mentors g join public.organizations o on o.id = g.organization_id
 where g.member_id = 'aaaaaaaa-6e6e-0000-0000-0000000000d1';
select type from public.members where id = 'aaaaaaaa-6e6e-0000-0000-0000000000d1';
select o.name as member_of, om.joined_via from public.organization_members om join public.organizations o on o.id = om.organization_id
 where om.member_id = 'aaaaaaaa-6e6e-0000-0000-0000000000d1';

\echo '9. joining on the club admin''s mentor invite for another org: expect Probe Other Org'
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, invite_id)
values ('aaaaaaaa-6e6e-0000-0000-0000000000d4', 'peer', 'active', 'Probe joiner 4', '19990006e14', '1980-01-01', 'T1–T6', 'CA', 'Oakland', 'cccccccc-6e6e-0000-0000-000000000004');
select o.name as mentor_of from public.organization_mentors g join public.organizations o on o.id = g.organization_id
 where g.member_id = 'aaaaaaaa-6e6e-0000-0000-0000000000d4';

\echo '10. an ordinary invite: expect no mentor, type peer'
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, invite_id)
values ('aaaaaaaa-6e6e-0000-0000-0000000000d2', 'peer', 'active', 'Probe joiner 2', '19990006e12', '1980-01-01', 'T1–T6', 'CA', 'Oakland', 'cccccccc-6e6e-0000-0000-000000000002');
select count(*) as mentor_rows, (select type from public.members where id = 'aaaaaaaa-6e6e-0000-0000-0000000000d2') as type
  from public.organization_mentors where member_id = 'aaaaaaaa-6e6e-0000-0000-0000000000d2';

\echo '11. the inviter is no longer that org''s admin when they join: expect no mentor'
delete from public.organization_representatives where member_id = 'aaaaaaaa-6e6e-0000-0000-00000000000c';
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, invite_id)
values ('aaaaaaaa-6e6e-0000-0000-0000000000d5', 'peer', 'active', 'Probe joiner 5', '19990006e15', '1980-01-01', 'T1–T6', 'CA', 'Oakland', 'cccccccc-6e6e-0000-0000-000000000005');
select count(*) as mentor_rows from public.organization_mentors where member_id = 'aaaaaaaa-6e6e-0000-0000-0000000000d5';

rollback;
