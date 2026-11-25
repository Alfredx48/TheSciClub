-- ============================================================================
-- Admin › Invite log (20261125130000)
-- ============================================================================
-- The owner, 2026-11-25: every invite email (by whom, opened, used, the
-- member it became) and every QR code and invite link (its author, who joined
-- from it), newest first. Read every answer against its expect line:
--
--   1. only the club's administrators read it
--   2. an email names its sender, says it was opened and used, and names the
--      member it became, with their id
--   3. a code names its maker and how, and lists who joined from it
--   4. newest first
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/admin-invite-log.sql
--
-- Needs 20261125120000 (qr_codes.made_as). One transaction, rolled back; the
-- expected refusal in its own savepoint. Never against the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset pager off
\pset null '<null>'

begin;

-- ------------------------------------------------------------------ set-up --
-- 01 an administrator, 02 a member; 03 joined from 01's email, 04 from 01's code.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-1126-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1126@probe.test', now()),
  ('aaaaaaaa-1126-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member1126@probe.test', now()),
  ('aaaaaaaa-1126-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emailed1126@probe.test', now()),
  ('aaaaaaaa-1126-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scanned1126@probe.test', now());

insert into public.members (id, type, status, display_name, username, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1126-0000-0000-000000000001', 'peer', 'active', 'Log Admin', 'probe.logadmin1126', '1980-01-01', 'T1–T6', 'CA', true),
  ('aaaaaaaa-1126-0000-0000-000000000002', 'peer', 'active', 'Log Member', 'probe.logmember1126', '1980-01-01', 'T1–T6', 'CA', false);

insert into public.qr_codes (id, code, admin_id, event_name, made_as, created_at) values
  ('aaaaaaaa-1126-0000-0000-0000000000c1', 'probe-log-code-1126', 'aaaaaaaa-1126-0000-0000-000000000001',
   'Log Expo', 'qr', now() + interval '2 minutes');

insert into public.invites (id, email, phone_raw, status, invited_by_member_id, sent_at, opened_at, link_opened_at, claimed_by, claimed_at, created_at) values
  ('aaaaaaaa-1126-0000-0000-0000000000e1', 'emailed1126@probe.test', '', 'pending',
   'aaaaaaaa-1126-0000-0000-000000000001', now() + interval '1 minute', now() + interval '1 minute',
   now() + interval '1 minute', 'aaaaaaaa-1126-0000-0000-000000000003', now() + interval '1 minute', now()),
  ('aaaaaaaa-1126-0000-0000-0000000000e2', 'scanned1126@probe.test', '', 'pending',
   'aaaaaaaa-1126-0000-0000-000000000001', null, null, null, null, null, now());
update public.invites set qr_code_id = 'aaaaaaaa-1126-0000-0000-0000000000c1'
 where id = 'aaaaaaaa-1126-0000-0000-0000000000e2';

insert into public.members (id, type, status, display_name, username, birth_date, level_range, state, invite_id) values
  ('aaaaaaaa-1126-0000-0000-000000000003', 'peer', 'active', 'Emailed Joiner', 'probe.emailed1126', '1990-01-01', 'T7–T12', 'CA', 'aaaaaaaa-1126-0000-0000-0000000000e1'),
  ('aaaaaaaa-1126-0000-0000-000000000004', 'peer', 'active', 'Scanned Joiner', 'probe.scanned1126', '1990-01-01', 'T7–T12', 'CA', 'aaaaaaaa-1126-0000-0000-0000000000e2');

-- ===================================================== 1. who reads it =====
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1126-0000-0000-000000000002","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
\echo '== 1. a member who is not an administrator (expect ERROR: Not an administrator) =='
savepoint member_reads;
select public.admin_invite_log();
rollback to savepoint member_reads;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1126-0000-0000-000000000001","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo '== 2. the email (expect Log Admin | t | t | t | Emailed Joiner | aaaaaaaa-1126-0000-0000-000000000003) =='
select e -> 'sentBy' ->> 'name' as sent_by,
       (e ->> 'openedAt') is not null as opened,
       (e ->> 'linkOpenedAt') is not null as clicked,
       (e ->> 'accountAt') is not null as account,
       e -> 'member' ->> 'name' as member,
       e -> 'member' ->> 'id' as member_id
  from jsonb_array_elements(public.admin_invite_log()) e
 where e ->> 'kind' = 'email' and e ->> 'id' = 'aaaaaaaa-1126-0000-0000-0000000000e1';

\echo '== 3. the code (expect Log Admin | qr | Log Expo | 1 | Scanned Joiner) =='
select c -> 'madeBy' ->> 'name' as made_by,
       c ->> 'madeAs' as made_as,
       c ->> 'event' as event,
       jsonb_array_length(c -> 'joined') as joined,
       c -> 'joined' -> 0 ->> 'name' as first_joined
  from jsonb_array_elements(public.admin_invite_log()) c
 where c ->> 'kind' = 'code' and c ->> 'id' = 'aaaaaaaa-1126-0000-0000-0000000000c1';

\echo '== 4. newest first: the code (two minutes on) before the email (one minute on) (expect code, email) =='
select string_agg(x ->> 'kind', ', ' order by n) as kinds
  from jsonb_array_elements(public.admin_invite_log()) with ordinality as t(x, n)
 where x ->> 'id' in ('aaaaaaaa-1126-0000-0000-0000000000c1', 'aaaaaaaa-1126-0000-0000-0000000000e1');

rollback;
