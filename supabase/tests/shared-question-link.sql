-- ============================================================================
-- A question an administrator shares can let people in, for 24 hours
-- (20261116200000)
-- ============================================================================
-- With joining closed: only an administrator makes the link's code; asking
-- again within the hour is the same code; the join screen hears that it lets
-- people in; an email sign-up through it is let in while it is live, and
-- refused once it has expired, been turned off, or its maker is no longer an
-- administrator. Run against the test project on 2026-11-16 as one rolled-back
-- block, every case as expected.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/shared-question-link.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

update public.club_joining set open = false where only_row;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('aaaaaaaa-5a5a-0000-0000-00000000000a', 'peer', 'active', 'Probe admin', '19990005a01', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true),
  ('aaaaaaaa-5a5a-0000-0000-00000000000b', 'peer', 'active', 'Probe member', '19990005a02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false);
insert into public.chat_rooms (id, name, description, category, sort_order, opened_at)
values ('probe-share', 'Probe share', 'For the probe.', 'Life', 9290, now());
insert into public.chat_topics (id, room_id, title, author_id, is_question)
values ('5a5a0000-0000-0000-0000-000000000001', 'probe-share', 'Which cushion?', 'aaaaaaaa-5a5a-0000-0000-00000000000b', true);

\echo ''
\echo '== 1. a member who is not an administrator, nor any organization''s admin (expect ERROR: Only an administrator, or an organization''s admin) =='
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-5a5a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint member;
select * from public.share_topic_code('5a5a0000-0000-0000-0000-000000000001');
rollback to savepoint member;
reset role;

\echo ''
\echo '== 2. an administrator, twice (expect 24 hours, the same code) =='
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-5a5a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select code as made, round(extract(epoch from expires_at - now()) / 3600) as hours
  from public.share_topic_code('5a5a0000-0000-0000-0000-000000000001') \gset
select :'made' = (select code from public.share_topic_code('5a5a0000-0000-0000-0000-000000000001')) as same_again,
       :hours as hours;
reset role;

\echo ''
\echo '== 3. what the join screen hears, signed out (expect no name: who shared it is not said, 20261119140000; admits t, no email) =='
set local role anon;
select inviter_name, admits, contact_email from public.qr_code_details(:'made');
reset role;

\echo ''
\echo '== 4. an email sign-up through it, and one with no code (expect {}, then the invite-list error) =='
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', :'made')))) as through_the_link;
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', '{}'::jsonb))) as without;

\echo ''
\echo '== 5. expired, turned off, its maker no longer an administrator (expect the error, three times) =='
update public.qr_codes set expires_at = now() - interval '1 minute' where code = :'made';
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', :'made')))) as expired;
update public.qr_codes set expires_at = now() + interval '1 hour', turned_off_at = now() where code = :'made';
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', :'made')))) as turned_off;
update public.qr_codes set turned_off_at = null where code = :'made';
update public.members set is_admin = false where id = 'aaaaaaaa-5a5a-0000-0000-00000000000a';
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', :'made')))) as maker_not_admin;

\echo ''
\echo '== 6. what a link preview, and the page before Join, may show signed out (expect the title and an empty name, then nothing three times) =='
update public.members set is_admin = true where id = 'aaaaaaaa-5a5a-0000-0000-00000000000a';
update public.qr_codes set expires_at = now() + interval '1 hour' where code = :'made';
set local role anon;
select title, inviter_name from public.shared_topic_preview(:'made', '5a5a0000-0000-0000-0000-000000000001');
select count(*) as another_topic from public.shared_topic_preview(:'made', '5a5a0000-0000-0000-0000-000000000002');
select count(*) as a_wrong_code from public.shared_topic_preview('not-a-code', '5a5a0000-0000-0000-0000-000000000001');
reset role;
update public.qr_codes set expires_at = now() - interval '1 minute' where code = :'made';
set local role anon;
select count(*) as expired from public.shared_topic_preview(:'made', '5a5a0000-0000-0000-0000-000000000001');
reset role;

\echo ''
\echo '== 7. an organization''s admin (20261119140000): a topic they can read, then one in a room not yet open (expect a row, 24 hours; then ERROR: That topic is no longer in the club.) =='
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values ('aaaaaaaa-5a5a-0000-0000-00000000000c', 'peer', 'active', 'Probe org admin', '19990005a03', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false);
insert into public.organizations (id, short_code, name, city)
values ('bbbbbbbb-5a5a-0000-0000-00000000000a', 'PRSQ', 'Probe Share Org', 'Oakland');
insert into public.organization_representatives (organization_id, member_id)
values ('bbbbbbbb-5a5a-0000-0000-00000000000a', 'aaaaaaaa-5a5a-0000-0000-00000000000c');
insert into public.chat_rooms (id, name, description, category, sort_order, opened_at)
values ('probe-share-shut', 'Probe shut', 'Not open yet.', 'Life', 9291, null);
insert into public.chat_topics (id, room_id, title, author_id, is_question)
values ('5a5a0000-0000-0000-0000-000000000003', 'probe-share-shut', 'Not for members yet', 'aaaaaaaa-5a5a-0000-0000-00000000000a', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-5a5a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select code is not null as made, round(extract(epoch from expires_at - now()) / 3600) as hours
  from public.share_topic_code('5a5a0000-0000-0000-0000-000000000001');
savepoint shut;
select * from public.share_topic_code('5a5a0000-0000-0000-0000-000000000003');
rollback to savepoint shut;
reset role;

\echo ''
\echo '== 8. it lets people in while they are an organization''s admin, and not once they are no longer one (expect {}, then the invite-list error) =='
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', (select code from public.qr_codes
    where admin_id = 'aaaaaaaa-5a5a-0000-0000-00000000000c' and made_to_share))))) as org_admins_link;
delete from public.organization_representatives where member_id = 'aaaaaaaa-5a5a-0000-0000-00000000000c';
select public.signup_needs_an_invite(jsonb_build_object('user', jsonb_build_object(
  'email', 'probe-share@example.com', 'app_metadata', jsonb_build_object('provider', 'email'),
  'user_metadata', jsonb_build_object('qr_code', (select code from public.qr_codes
    where admin_id = 'aaaaaaaa-5a5a-0000-0000-00000000000c' and made_to_share))))) as no_longer_org_admin;

rollback;
