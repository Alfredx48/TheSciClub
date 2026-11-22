-- ============================================================================
-- Request logs (20261122040000, 20261122050000)
-- ============================================================================
-- Only administrators read them; nobody else, not even through the tables;
-- only the copy, with the vault's secret, writes them; a session is never
-- stored as it came. Reads only what it writes, so it can be run against the
-- test project:
--
--   psql "<database url>" -f supabase/tests/request-logs.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

\echo ''
\echo '== 1. the copy with a wrong secret (expect: Not the request-log copy) =='
select public.store_request_logs('wrong', '[{"id":"probe-1","at":"2026-11-22T03:00:00Z","endpoint":"rpc:x","session":"s"}]'::jsonb);
rollback;
begin;

\echo ''
\echo '== 2. a session is stored scrambled (expect: 1, then t) =='
select public.store_request_logs(
  (select decrypted_secret from vault.decrypted_secrets where name = 'request_logs_secret'),
  '[{"id":"probe-2","at":"2026-11-22T03:00:00Z","method":"GET","endpoint":"table:events","ms":10,"session":"probe-session"}]'::jsonb);
select visit is not null and visit not like '%probe-session%' as scrambled
  from public.request_log where id = 'probe-2';

select id as member from public.members
 where not is_admin and status = 'active' and type <> 'organization' limit 1 \gset
select id as admin from public.members where is_admin and status = 'active' limit 1 \gset

\echo '== 3. a member reads nothing (expect: permission denied, then Only administrators x4) =='
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'member', 'role', 'authenticated')::text, true) is not null;
savepoint s;
select count(*) from public.request_log;
rollback to savepoint s;
select count(*) from public.admin_request_timeline(1);
rollback to savepoint s;
select public.admin_request_window(now() - interval '1 hour', now());
rollback to savepoint s;
select count(*) from public.admin_request_visit('x', now());
rollback to savepoint s;
select count(*) from public.admin_query_window(now() - interval '1 hour', now());
rollback to savepoint s;

\echo ''
\echo '== 4. an administrator reads them (expect: t) =='
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin', 'role', 'authenticated')::text, true) is not null;
select (public.admin_request_window('2026-11-22T02:59:00Z', '2026-11-22T03:01:00Z') ->> 'requests')::int >= 1 as reads;

rollback;
