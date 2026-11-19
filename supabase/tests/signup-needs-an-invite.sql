-- ============================================================================
-- An email sign-up needs an invite before the account is made (20261012040000)
-- ============================================================================
-- public.signup_needs_an_invite(event) is the Before User Created hook. It is
-- called here directly, with the payload shape GoTrue sends. The local
-- `postgres` role may not become supabase_auth_admin, so sections 1 and 2 run
-- as the function's owner and section 3 checks supabase_auth_admin's grant;
-- that GoTrue really calls it is shown end to end against the local GoTrue
-- (see the 20261012040000 notes in EMAIL-SIGN-IN-PLAN.md). Every answer is
-- printed and read against its expect line:
--
--   1. passes ({}): a pending invite's address; any address with a pending,
--      unclaimed invite's token; Google and Apple, invited or not
--   2. refused (403, the client's exact sentence): an uninvited address; a
--      blocked address even with a pending invite or a good token; a used or
--      revoked invite's address; a claimed, used or unknown token; phone,
--      anonymous and provider-less sign-ups
--   3. grants: anon and authenticated cannot call it
--   4. a live code and open joining (20261102020000): a partner's live code
--      passes; an administrator's own, a dead or an unknown code is refused;
--      open joining passes anybody but a blocked address
--
-- Run it against a local stack (never the hosted project):
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/signup-needs-an-invite.sql
--
-- One transaction, rolled back; each refusal of a grant in its own savepoint.
-- ============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset pager off
\pset null '<null>'

begin;

-- ------------------------------------------------------------------ set-up --
-- Joining closed, whatever the database it runs on says now.
update public.club_joining set open = false;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-1041-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inviter@probe.test',  now()),
  ('aaaaaaaa-1041-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'claimer@probe.test',  now());

insert into public.members (id, type, status, display_name, username, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1041-0000-0000-000000000001', 'mentor', 'active', 'Inviter', 'probe.inviter4', null, '1980-01-01', 'T1–T6', 'CA', false);

-- Each invite's token is the text after "probe-token-": its hash is what is stored.
insert into public.invites (email, status, invited_by_member_id, token_hash, claimed_by, claimed_at, consumed_at, revoked_at) values
  ('pending@probe.test', 'pending',  'aaaaaaaa-1041-0000-0000-000000000001', encode(extensions.digest('probe-token-pending', 'sha256'), 'hex'), null, null, null, null),
  ('claimed@probe.test', 'pending',  'aaaaaaaa-1041-0000-0000-000000000001', encode(extensions.digest('probe-token-claimed', 'sha256'), 'hex'), 'aaaaaaaa-1041-0000-0000-000000000002', now(), null, null),
  ('used@probe.test',    'consumed', 'aaaaaaaa-1041-0000-0000-000000000001', encode(extensions.digest('probe-token-used',    'sha256'), 'hex'), null, null, now(), null),
  ('revoked@probe.test', 'revoked',  'aaaaaaaa-1041-0000-0000-000000000001', encode(extensions.digest('probe-token-revoked', 'sha256'), 'hex'), null, null, null, now()),
  ('blocked@probe.test', 'pending',  'aaaaaaaa-1041-0000-0000-000000000001', encode(extensions.digest('probe-token-blocked', 'sha256'), 'hex'), null, null, null, null);
-- Blocked after the invite went out, and not revoked: the hook must still refuse it.
insert into public.blocked_emails (email, note) values
  ('blocked@probe.test', 'probe'),
  ('elsewhere-blocked@probe.test', 'probe');

-- The payload GoTrue sends (confirmed 2026-10-11), cut down to what is read.
create function pg_temp.ev(provider text, address text, token text default null)
returns jsonb language sql as $$
  select jsonb_build_object('user', jsonb_build_object(
    'email', coalesce(address, ''),
    'phone', '',
    'app_metadata', case when provider is null then '{}'::jsonb else jsonb_build_object('provider', provider) end,
    'user_metadata', case when token is null then '{}'::jsonb else jsonb_build_object('invite_token', token) end
  ));
$$;
grant execute on function pg_temp.ev(text, text, text) to anon, authenticated;

-- ============================================================ 1. passes ({}) --
\echo '== 1. passes: expect {} on every line =='
select 'pending address'                          as case, public.signup_needs_an_invite(pg_temp.ev('email', 'pending@probe.test')) as answer
union all select 'pending address, case and spaces', public.signup_needs_an_invite(pg_temp.ev('email', '  Pending@Probe.TEST '))
union all select 'another address + pending token',  public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', 'probe-token-pending'))
union all select 'token with spaces round it',       public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', '  probe-token-pending '))
union all select 'google, not invited',              public.signup_needs_an_invite(pg_temp.ev('google', 'nobody@probe.test'))
union all select 'apple, not invited',               public.signup_needs_an_invite(pg_temp.ev('apple', 'hidden@privaterelay.appleid.com'))
union all select 'claimed invite, its own address',  public.signup_needs_an_invite(pg_temp.ev('email', 'claimed@probe.test'));

-- ========================================================== 2. refused (403) --
\echo '== 2. refused: expect 403 and "This email is not on the invite list." on every line =='
select x.case, x.answer -> 'error' ->> 'http_code' as http_code, x.answer -> 'error' ->> 'message' as message
from (
            select 'uninvited address'                      as case, public.signup_needs_an_invite(pg_temp.ev('email', 'nobody@probe.test')) as answer
  union all select 'blocked address with pending invite',   public.signup_needs_an_invite(pg_temp.ev('email', 'blocked@probe.test'))
  union all select 'blocked address + good token',          public.signup_needs_an_invite(pg_temp.ev('email', 'elsewhere-blocked@probe.test', 'probe-token-pending'))
  union all select 'used invite''s address',                public.signup_needs_an_invite(pg_temp.ev('email', 'used@probe.test'))
  union all select 'revoked invite''s address',             public.signup_needs_an_invite(pg_temp.ev('email', 'revoked@probe.test'))
  union all select 'claimed token, another address',        public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', 'probe-token-claimed'))
  union all select 'used token',                            public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', 'probe-token-used'))
  union all select 'revoked token',                         public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', 'probe-token-revoked'))
  union all select 'unknown token',                         public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', 'probe-token-nonsense'))
  union all select 'the stored hash as a token',            public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', encode(extensions.digest('probe-token-pending', 'sha256'), 'hex')))
  union all select 'empty token',                           public.signup_needs_an_invite(pg_temp.ev('email', 'personal@probe.test', ''))
  union all select 'phone sign-up',                         public.signup_needs_an_invite(pg_temp.ev('phone', null))
  union all select 'phone sign-up, invited address field',  public.signup_needs_an_invite(pg_temp.ev('phone', 'pending@probe.test'))
  union all select 'anonymous sign-up',                     public.signup_needs_an_invite(pg_temp.ev('anonymous', null))
  union all select 'no provider, invited address',          public.signup_needs_an_invite(pg_temp.ev(null, 'pending@probe.test'))
  union all select 'empty address + good token',            public.signup_needs_an_invite(pg_temp.ev('email', '', 'probe-token-pending'))
) x;

-- =============================================================== 3. grants --
\echo '== 3. grants: expect "permission denied for function signup_needs_an_invite" twice =='
savepoint as_anon;
set local role anon;
select public.signup_needs_an_invite(pg_temp.ev('email', 'pending@probe.test'));
rollback to savepoint as_anon;

savepoint as_member;
set local role authenticated;
select public.signup_needs_an_invite(pg_temp.ev('email', 'pending@probe.test'));
rollback to savepoint as_member;

\echo '   expect t: supabase_auth_admin may call it'
select has_function_privilege('supabase_auth_admin', 'public.signup_needs_an_invite(jsonb)', 'execute') as auth_admin_can_call;

-- ==================================================== 4. codes, and joining --
create function pg_temp.scanned(address text, code text)
returns jsonb language sql as $$
  select jsonb_build_object('user', jsonb_build_object(
    'email', address,
    'phone', '',
    'app_metadata', jsonb_build_object('provider', 'email'),
    'user_metadata', jsonb_build_object('qr_code', code)
  ));
$$;

insert into public.members (id, type, status, display_name, username, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1041-0000-0000-000000000002', 'mentor', 'active', 'Maker', 'probe.maker4', null, '1980-01-01', 'T1–T6', 'CA', true);
insert into public.club_partners (member_id, title) values ('aaaaaaaa-1041-0000-0000-000000000001', 'Probe');
insert into public.qr_codes (code, admin_id, event_name, made_as_partner, expires_at, turned_off_at) values
  ('probe-partner', 'aaaaaaaa-1041-0000-0000-000000000001', 'probe', true,  null, null),
  ('probe-expired', 'aaaaaaaa-1041-0000-0000-000000000001', 'probe', true,  now() - interval '1 day', null),
  ('probe-off',     'aaaaaaaa-1041-0000-0000-000000000001', 'probe', true,  null, now()),
  ('probe-credit',  'aaaaaaaa-1041-0000-0000-000000000002', 'probe', false, null, null);

\echo '== 4a. joining closed: expect {} for the partner''s and the administrator''s live codes, 403 on the rest =='
select 'partner''s live code'     as case, public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-partner')) as answer
union all select 'administrator''s code', public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-credit'))
union all select 'blocked, live code',  public.signup_needs_an_invite(pg_temp.scanned('elsewhere-blocked@probe.test', 'probe-partner'))
union all select 'expired code',        public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-expired'))
union all select 'code turned off',     public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-off'))
union all select 'unknown code',        public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-nonsense'))
union all select 'nothing at all',      public.signup_needs_an_invite(pg_temp.ev('email', 'walked-in@probe.test'));

\echo '== 4a2. its maker no longer an administrator: expect 403 =='
savepoint demoted;
update public.members set is_admin = false where id = 'aaaaaaaa-1041-0000-0000-000000000002';
select public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-credit')) as answer;
rollback to savepoint demoted;

\echo '== 4b. joining open: expect {} twice, then 403 for the blocked address =='
update public.club_joining set open = true;
select 'anybody' as case, public.signup_needs_an_invite(pg_temp.ev('email', 'walked-in@probe.test')) as answer
union all select 'dead code, open',  public.signup_needs_an_invite(pg_temp.scanned('walked-in@probe.test', 'probe-expired'))
union all select 'blocked, open',    public.signup_needs_an_invite(pg_temp.ev('email', 'elsewhere-blocked@probe.test'));

rollback;
