-- ============================================================================
-- Who invite-signup may let in with no link or code (20261110120000)
-- ============================================================================
-- email_may_join_now: an invited address, or any address while joining is
-- open, and never a blocked one. Only the server (service_role) may ask: a
-- client could otherwise learn who is on the invite list.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/in-now-when-invited-or-open.sql
--
-- One transaction, rolled back; a savepoint for each expected refusal.
-- ============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset pager off

begin;

-- ------------------------------------------------------------------ set-up --
update public.club_joining set open = false;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-1110-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inviter@now.test', now());
insert into public.members (id, type, status, display_name, username, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1110-0000-0000-000000000001', 'mentor', 'active', 'Inviter', 'now.inviter', null, '1980-01-01', 'T1–T6', 'CA', false);

insert into public.invites (email, status, invited_by_member_id, token_hash) values
  ('invited@now.test', 'pending',  'aaaaaaaa-1110-0000-0000-000000000001', encode(extensions.digest('now-1', 'sha256'), 'hex')),
  ('used@now.test',    'consumed', 'aaaaaaaa-1110-0000-0000-000000000001', encode(extensions.digest('now-2', 'sha256'), 'hex')),
  ('blocked@now.test', 'pending',  'aaaaaaaa-1110-0000-0000-000000000001', encode(extensions.digest('now-3', 'sha256'), 'hex'));
insert into public.blocked_emails (email, note) values
  ('blocked@now.test', 'probe'),
  ('blocked-anyway@now.test', 'probe');

-- ------------------------------------------------------------------ closed --
-- 1. expect: t | t | f | f | f
select public.email_may_join_now('invited@now.test')  as invited,
       public.email_may_join_now('INVITED@now.test ') as any_case,
       public.email_may_join_now('used@now.test')     as used,
       public.email_may_join_now('stranger@now.test') as stranger,
       public.email_may_join_now('blocked@now.test')  as blocked;

-- 2. expect: f (null asks nothing)
select coalesce(public.email_may_join_now(null), false) as null_address;

-- -------------------------------------------------------------------- open --
update public.club_joining set open = true;

-- 3. expect: t | t | f
select public.email_may_join_now('stranger@now.test')       as stranger,
       public.email_may_join_now('invited@now.test')        as invited,
       public.email_may_join_now('blocked-anyway@now.test') as blocked;

-- ------------------------------------------------------------ who may ask --
-- 4. expect: ERROR permission denied (anon)
savepoint s4;
set local role anon;
select public.email_may_join_now('invited@now.test');
rollback to savepoint s4;

-- 5. expect: ERROR permission denied (authenticated)
savepoint s5;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1110-0000-0000-000000000001","role":"authenticated"}', true);
select public.email_may_join_now('invited@now.test');
rollback to savepoint s5;

-- 6. expect: t
savepoint s6;
set local role service_role;
select public.email_may_join_now('invited@now.test') as service_role_asks;
rollback to savepoint s6;

rollback;
