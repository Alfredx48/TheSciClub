-- ============================================================================
-- Who made the QR code or invite link a member came by, when and how
-- (20261125120000)
-- ============================================================================
-- The owner, 2026-11-25: "when we see a user is from a QR code, it should
-- specify who and when the code was generated and how. Same with invite link."
-- Read every answer against its expect line:
--
--   1. a code made as a QR code, then the same live code asked for as a link,
--      is both; any other way is refused
--   2. the app already out, calling with five arguments, still makes codes
--   3. a member who came by it: their page (admin_member_story) and Admin ›
--      Stats (admin_sign_in_methods) say who made it, when and how
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/who-made-the-code.sql
--
-- One transaction, rolled back; the expected refusal in its own savepoint.
-- Never against the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset pager off
\pset null '<null>'

begin;

-- ------------------------------------------------------------------ set-up --
-- 01 an administrator; 02 somebody who joins from the code. Made an hour ago:
-- Admin › Stats counts accounts made before now, and now() does not move in
-- one transaction.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at) values
  ('aaaaaaaa-1125-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'maker1125@probe.test', now(), now() - interval '1 hour'),
  ('aaaaaaaa-1125-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'joiner1125@probe.test', now(), now() - interval '1 hour');

insert into public.members (id, type, status, display_name, username, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1125-0000-0000-000000000001', 'peer', 'active', 'Maker Probe', 'probe.maker1125', '1980-01-01', 'T1–T6', 'CA', true);

update public.club_joining set open = false;

-- ================================================ 1. made, and how =========
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1125-0000-0000-000000000001","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo '== 1. made as a QR code, then asked for as a link (expect qr, then the same code as qr_and_link) =='
select event_name as event, made_as as made_as
  from public.create_qr_code(null, 'Probe Expo 1125', null, null, null, 'qr');
select event_name as event, made_as as made_as,
       (select count(*) from public.qr_codes q where q.event_name = 'Probe Expo 1125') as codes
  from public.create_qr_code(null, 'Probe Expo 1125', null, null, null, 'link');

\echo '== 1b. any other way (expect ERROR: A code is made as a QR code or as a link.) =='
savepoint other_way;
select public.create_qr_code(null, 'Probe Expo 1125', null, null, null, 'poster');
rollback to savepoint other_way;

\echo '== 2. the app already out, five arguments (expect made t, made_as null) =='
select code is not null as made, made_as as made_as
  from public.create_qr_code(null, 'Old app 1125', null, null, null);

-- ======================================== 3. what an administrator reads ===
reset role;
create temp table probe_code as
  select code from public.qr_codes where event_name = 'Probe Expo 1125';
grant select on probe_code to authenticated;

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1125-0000-0000-000000000002","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
\echo '== 3. 02 claims the code and joins (expect claimed t) =='
select public.claim_qr_code((select code from probe_code)) as claimed;
insert into public.members (id, display_name, username, birth_date, level_range)
values ('aaaaaaaa-1125-0000-0000-000000000002', 'Joiner Probe', 'probe.joiner1125', '1990-01-01', 'T7–T12');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1125-0000-0000-000000000001","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
\echo '== 3a. their page (expect qr | Maker Probe | qr_and_link | t | Probe Expo 1125) =='
select s -> 'came' ->> 'way' as way,
       s -> 'came' -> 'qrCode' -> 'madeBy' ->> 'name' as made_by,
       s -> 'came' -> 'qrCode' ->> 'madeAs' as made_as,
       (s -> 'came' -> 'qrCode' ->> 'madeAt') is not null as has_made_at,
       s -> 'came' -> 'qrCode' ->> 'event' as event
  from public.admin_member_story('aaaaaaaa-1125-0000-0000-000000000002') s;
\echo '== 3b. Admin › Stats (expect qr | Maker Probe | qr_and_link | t) =='
select a -> 'cameBy' ->> 'way' as way,
       a -> 'cameBy' ->> 'madeBy' as made_by,
       a -> 'cameBy' ->> 'madeAs' as made_as,
       (a -> 'cameBy' ->> 'madeAt') is not null as has_made_at
  from jsonb_array_elements(public.admin_sign_in_methods('all') -> 'accounts') a
 where a ->> 'id' = 'aaaaaaaa-1125-0000-0000-000000000002';

rollback;
