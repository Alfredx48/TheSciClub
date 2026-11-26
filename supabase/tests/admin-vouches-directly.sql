-- ============================================================================
-- An administrator inviting in their own name
-- ============================================================================
-- Run as a signed-in administrator, because every rule here lives inside a
-- SECURITY DEFINER function that checks is_admin() and reads auth.uid().
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/admin-vouches-directly.sql
--
-- Rolls back. Reads verification through `admin_invites`, never through
-- `public.invites`: an administrator has no select policy on that table, so
-- querying it here would return nothing whatever the function did. Three
-- probes in this directory have been caught by that.
--
-- Since 20261012000000 an invite names an email address. The old steps about
-- attaching a seeded-profile claim are gone with the claim itself (the
-- seeded directory was removed in 20261010020000 and the consume trigger no
-- longer has the branch).
-- ============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY verbose
\pset pager off
\pset null '(null)'

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values ('aaaaaaaa-2222-2222-2222-222222222222', 'peer', 'active', 'Club Admin',
        '19990000030', '1980-01-01', 'T1–T6', 'CA', true),
       ('bbbbbbbb-2222-2222-2222-222222222222', 'peer', 'active', 'Ordinary',
        '19990000031', '1980-01-01', 'T1–T6', 'CA', false);

-- Every id the steps below need, captured now. As the authenticated
-- administrator an inline `select ... from members` yields null and turns an
-- expected refusal into a pass. An earlier draft of this file did exactly that.
select id as ncs_id from public.organizations where short_code = 'NCS' \gset
select id as no_invite_id from public.organizations where not can_invite limit 1 \gset

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-2222-2222-222222222222","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 1. an invite with no organization is attributed to the admin =='
\echo '   expect: invited_by_organization empty, invited_by_member Club Admin, is_admin t'
select email is not null as made from public.admin_create_invite('first@probe.test'::text, null::uuid, 'Met at an event'::text);
select invited_by_organization, invited_by_member, invited_by_member_is_admin
  from public.admin_invites where email = 'first@probe.test';

\echo ''
\echo '== 2. naming an organization still works and is attributed to it =='
\echo '   expect: NorCal SCI | empty | empty'
select email is not null as made from public.admin_create_invite('second@probe.test'::text, :'ncs_id'::uuid, null::text);
select invited_by_organization, invited_by_member, invited_by_member_is_admin
  from public.admin_invites where email = 'second@probe.test';

\echo ''
\echo '== 3. exactly one inviter is recorded, never two =='
\echo '   expect: 1 | 1 — one row with only an org, one with only a member'
select count(*) filter (where invited_by_organization is not null and invited_by_member is null) as org_only,
       count(*) filter (where invited_by_member is not null and invited_by_organization is null) as member_only
  from public.admin_invites where email in ('first@probe.test', 'second@probe.test');

\echo ''
\echo '== 4. the address is stored trimmed and lowercase, and the row is a pending invite with no phone =='
\echo '   expect: third@probe.test | pending | (null) | (null) | (null)'
select email, status, phone, token_hash, sent_at
  from public.admin_create_invite('   Third@Probe.TEST '::text, null::uuid, null::text);

\echo ''
\echo '== 5. the same address cannot be on the list twice, in any case =='
\echo '   expect: ERROR 23505 ... already on the list   (twice)'
savepoint twice;
select public.admin_create_invite('first@probe.test'::text, null::uuid, null::text);
rollback to savepoint twice;
savepoint twice_other_case;
select public.admin_create_invite('FIRST@PROBE.TEST'::text, :'ncs_id'::uuid, null::text);
rollback to savepoint twice_other_case;

\echo ''
\echo '== 5b. and something that is not an address is refused =='
\echo '   expect: ERROR 22023 ... does not look like an email address   (three times)'
savepoint not_an_address;
select public.admin_create_invite('not an address'::text, null::uuid, null::text);
rollback to savepoint not_an_address;
savepoint a_phone_number;
select public.admin_create_invite('(408) 555-2100'::text, null::uuid, null::text);
rollback to savepoint a_phone_number;
savepoint nothing;
select public.admin_create_invite(null::text, null::uuid, null::text);
rollback to savepoint nothing;

\echo ''
\echo '== 6. any organization will do, can_invite or not (the owner, 2026-11-25), but not a removed one =='
\echo '   expect: made t, then the organization named; then ERROR P0002 ... no such organization'
select email is not null as made from public.admin_create_invite('fourth@probe.test'::text, :'no_invite_id'::uuid, null::text);
select invited_by_organization is not null as under_it from public.admin_invites where email = 'fourth@probe.test';
savepoint removed_org;
set local role postgres;
update public.organizations set removed_at = now() where id = :'no_invite_id';
set local role authenticated;
select public.admin_create_invite('sixth@probe.test'::text, :'no_invite_id'::uuid, null::text);
rollback to savepoint removed_org;

\echo ''
\echo '== 7. an ordinary member cannot call it at all =='
\echo '   expect: ERROR:  Not an administrator'
savepoint not_admin;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}', true) is not null as ok;
select public.admin_create_invite('fifth@probe.test'::text, null::uuid, null::text);
rollback to savepoint not_admin;

\echo ''
\echo '== 8. the old phone signature is gone (expect ERROR: function ... does not exist) =='
savepoint old_signature;
select public.admin_create_invite('4085552100'::text, null::uuid, null::uuid, 'Met at an event'::text);
rollback to savepoint old_signature;

set local role postgres;
rollback;
