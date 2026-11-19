-- ============================================================================
-- An org admin's QR code lets their people in, until it expires (20261028960000)
-- ============================================================================
-- With joining closed: an account that claimed an organization's live code is
-- invited; one that claimed it after it expired is not (an administrator's
-- code with no organization lets people in too since 20261119130000: see
-- signup-needs-an-invite.sql, section 4a). Only its org admins make an
-- organization's code, and only administrators name an event.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/org-admin-qr-codes.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

-- Joining closed, whatever it was.
update public.club_joining set open = false where only_row;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city)
values ('aaaaaaaa-f1f1-0000-0000-00000000000a', 'peer', 'active', 'Org admin', '19990000f01', '1980-01-01', 'T1–T6', 'CA', 'Oakland');
insert into public.organizations (id, short_code, name, city)
values ('bbbbbbbb-f1f1-0000-0000-00000000000a', 'PRQA', 'Probe QR Org', 'Oakland');
insert into public.organization_representatives (organization_id, member_id)
values ('bbbbbbbb-f1f1-0000-0000-00000000000a', 'aaaaaaaa-f1f1-0000-0000-00000000000a');

-- Two accounts that will scan, with confirmed addresses.
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('cccccccc-f1f1-0000-0000-00000000000a', 'scanned-in-time@example.com', now(), 'authenticated', 'authenticated'),
  ('cccccccc-f1f1-0000-0000-00000000000b', 'scanned-too-late@example.com', now(), 'authenticated', 'authenticated');

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-f1f1-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 1. an org admin makes a code for their organization (expect a row, 72h) =='
select code is not null as made, round(extract(epoch from expires_at - now()) / 3600) as hours
  from public.create_qr_code('bbbbbbbb-f1f1-0000-0000-00000000000a', null, null, now() + interval '72 hours', 'Monday group');

\echo ''
\echo '== 2. but names no event (expect ERROR: Only an administrator names an event) =='
savepoint ev;
select public.create_qr_code('bbbbbbbb-f1f1-0000-0000-00000000000a', 'Expo', null, null, null);
rollback to savepoint ev;

\echo ''
\echo '== 3. and makes none with no organization (expect ERROR: Choose the organization) =='
savepoint none;
select public.create_qr_code(null, null, 'x@example.com', null, null);
rollback to savepoint none;

reset role;

\echo ''
\echo '== 4. scanned in time is invited; scanned after expiry is not (expect t, f) =='
-- One live code, one already expired, both the org admin's.
insert into public.qr_codes (id, code, admin_id, organization_id, expires_at)
values
  ('dddddddd-f1f1-0000-0000-00000000000a', 'probelive', 'aaaaaaaa-f1f1-0000-0000-00000000000a',
   'bbbbbbbb-f1f1-0000-0000-00000000000a', now() + interval '1 hour'),
  ('dddddddd-f1f1-0000-0000-00000000000b', 'probeold', 'aaaaaaaa-f1f1-0000-0000-00000000000a',
   'bbbbbbbb-f1f1-0000-0000-00000000000a', now() - interval '1 hour');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-f1f1-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.claim_qr_code('probelive') as claimed, public.i_am_invited() as invited;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-f1f1-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.claim_qr_code('probeold') as claimed, public.i_am_invited() as invited;
reset role;

\echo ''
\echo '== 5. what the join screen hears (expect Org admin, Probe QR Org, admits t, no email) =='
select inviter_name, organization_name, admits, contact_email
  from public.qr_code_details('probelive');

\echo ''
\echo '== 6. an administrator makes one with no organization and no email (expect t, f, <null>), and it lets people in (expect admits t, no email) =='
-- 20261119130000: it needed an email to show, and let nobody in.
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values ('aaaaaaaa-f1f1-0000-0000-00000000000b', 'mentor', 'active', 'Club admin', '19990000f02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-f1f1-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select code is not null as made, made_as_partner, contact_email
  from public.create_qr_code(null, null, null, now() + interval '24 hours', null);
reset role;
select d.admits, d.contact_email
  from public.qr_codes q, public.qr_code_details(q.code) d
 where q.admin_id = 'aaaaaaaa-f1f1-0000-0000-00000000000b';

rollback;
