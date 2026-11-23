-- ============================================================================
-- Can a member turn notifications on for a device, and can anybody else see
-- or send to it?
-- ============================================================================
-- Step 5 is the one that matters: a subscription is an address that reaches a
-- member's lock screen, and the select policy is what keeps one member from
-- reading another's. Step 7 is the second: a device that changes hands must
-- stop notifying the member who handed it over.
--
-- Run as real signed-in roles, not as the superuser: postgres is BYPASSRLS, so
-- every policy here would be inert and the file would pass while proving
-- nothing. Every expected refusal sits in its own savepoint, or the first one
-- aborts the transaction and the rest print "current transaction is aborted",
-- which in a long log is indistinguishable from passing.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/push-subscriptions.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state)
values
  ('aaaaaaaa-4444-0000-0000-00000000000a', 'peer', 'active',    'Holder',   '19990000050', '1980-01-01', 'T1–T6', 'CA'),
  ('bbbbbbbb-4444-0000-0000-00000000000b', 'peer', 'active',    'Nosy',     '19990000051', '1981-01-01', 'T1–T6', 'CA'),
  ('dddddddd-4444-0000-0000-00000000000d', 'peer', 'suspended', 'Paused',   '19990000053', '1983-01-01', 'C5–C8', 'CA');

-- Realistic shapes: an Apple endpoint, an 87-character p256dh, a 22-character auth.
\set phone '''https://web.push.apple.com/QGuQyavXutnMH8mWDnUGfzzHmU_kaWCbzkMwHcrk0LXGE7B3/'''
-- The tablet's is the host Chromium actually issued on 2026-09-27, not the one guides quote.
\set tablet '''https://jmt17.google.com/fcm/send/dQw4w9WgXcQ:APA91bFakeTokenForTheProbe'''
\set p256dh '''BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'''
\set auth '''tBHItJI5svbpez7KI4CCXg'''

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-4444-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 0. we are a signed-in member, not the superuser (expect authenticated) =='
select current_user, auth.uid()::text as uid;

\echo ''
\echo '== 1. a member turns notifications on for their phone (expect a row) =='
select public.push_subscribe(:phone, :p256dh, :auth, 'Mozilla/5.0 (iPhone)');
select member_id::text, user_agent from public.push_subscriptions;

\echo ''
\echo '== 2. and for a tablet too: one device, one row (expect 2) =='
select public.push_subscribe(:tablet, :p256dh, :auth);
select count(*) as mine from public.push_subscriptions;

\echo ''
\echo '== 3. turning it on twice on one device is still one row (expect 2) =='
\echo '   The primary key is the endpoint; the function deletes before it inserts.'
select public.push_subscribe(:phone, :p256dh, :auth, 'Mozilla/5.0 (iPhone)');
select count(*) as mine from public.push_subscriptions;

\echo ''
\echo '== 4. there is no way in except the function (expect ERROR, permission denied) =='
\echo '   No insert grant, so no upsert, so no join-a-room bug.'
savepoint direct_insert;
insert into public.push_subscriptions (endpoint, member_id, p256dh, auth)
values ('https://web.push.apple.com/direct', 'aaaaaaaa-4444-0000-0000-00000000000a', :p256dh, :auth);
rollback to savepoint direct_insert;

\echo ''
\echo '== 4b. nor any update (expect ERROR, permission denied) =='
savepoint direct_update;
update public.push_subscriptions set user_agent = 'changed';
rollback to savepoint direct_update;

\echo ''
\echo '== 5. THE ONE THAT MATTERS: nobody reads anybody else''s (expect 0, not 2) =='
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-4444-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
select current_user, count(*) as visible_to_another_member from public.push_subscriptions;

\echo ''
\echo '== 6. ...nor deletes them (expect DELETE 0) =='
savepoint steal;
delete from public.push_subscriptions;
rollback to savepoint steal;

\echo ''
\echo '== 7. the phone changes hands: it notifies the new holder, not the old =='
\echo '   Nosy signs in on Holder''s phone and turns notifications on. The endpoint'
\echo '   is the same; the row must now be Nosy''s. (expect 1 for Nosy)'
select public.push_subscribe(:phone, :p256dh, :auth);
select count(*) as nosy_now_holds from public.push_subscriptions;

\echo ''
\echo '== 7b. and Holder has only the tablet left (expect 1, the Google one) =='
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-4444-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
select endpoint like 'https://jmt17.google.com/%' as is_the_tablet from public.push_subscriptions;

\echo ''
\echo '== 8. an endpoint that is not a push service is refused (expect ERROR x5) =='
\echo '   The sender will POST to whatever is stored here.'
savepoint not_push_1;
select public.push_subscribe('https://evil.example/collect', :p256dh, :auth);
rollback to savepoint not_push_1;
savepoint not_push_2;
select public.push_subscribe('https://push.apple.com.evil.example/x', :p256dh, :auth);
rollback to savepoint not_push_2;
savepoint not_push_3;
select public.push_subscribe('http://web.push.apple.com/x', :p256dh, :auth);
rollback to savepoint not_push_3;
savepoint not_push_4;
select public.push_subscribe('https://user@web.push.apple.com/x', :p256dh, :auth);
rollback to savepoint not_push_4;
savepoint not_push_5;
select public.push_subscribe('https://google.com.evil.example/fcm/send/x', :p256dh, :auth);
rollback to savepoint not_push_5;

\echo ''
\echo '== 9. keys that are not keys are refused (expect ERROR, keys_check) =='
savepoint bad_keys;
select public.push_subscribe('https://web.push.apple.com/other', 'short', :auth);
rollback to savepoint bad_keys;

\echo ''
\echo '== 10. a paused member cannot turn notifications on (expect ERROR, a sentence) =='
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-4444-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
savepoint paused_on;
select public.push_subscribe('https://web.push.apple.com/paused', :p256dh, :auth);
rollback to savepoint paused_on;

\echo ''
\echo '== 11. ...but can turn them off (expect DELETE 1) =='
set local role postgres;
insert into public.push_subscriptions (endpoint, member_id, p256dh, auth)
values ('https://web.push.apple.com/paused', 'dddddddd-4444-0000-0000-00000000000d', :p256dh, :auth);
set local role authenticated;
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/paused';

\echo ''
\echo '== 12. a signed-out visitor can neither read nor subscribe (expect ERROR x2) =='
select set_config('request.jwt.claims', '{"role":"anon"}', true) is not null as ok;
set local role anon;
savepoint anon_read;
select count(*) from public.push_subscriptions;
rollback to savepoint anon_read;
savepoint anon_write;
select public.push_subscribe('https://web.push.apple.com/anon', :p256dh, :auth);
rollback to savepoint anon_write;

\echo ''
\echo '== 12b. a device's kind and versions are noted only by its holder (20261123020000; expect null, then iphone-app) =='
set local role postgres;
insert into public.push_subscriptions (endpoint, member_id, p256dh, auth)
values ('https://web.push.apple.com/noted', 'aaaaaaaa-4444-0000-0000-00000000000a', :p256dh, :auth);
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-4444-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.note_my_push_device('https://web.push.apple.com/noted', 'computer', 'x', 'y');
set local role postgres;
select device as after_another_member from public.push_subscriptions
 where endpoint = 'https://web.push.apple.com/noted';
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-4444-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.note_my_push_device('https://web.push.apple.com/noted', 'iphone-app', '2026-11-23T02:00', null);
set local role postgres;
select device as after_its_holder, release from public.push_subscriptions
 where endpoint = 'https://web.push.apple.com/noted';

\echo ''
\echo '== 13. removing a member takes their devices with them (expect 1, then 0) =='
set local role postgres;
select count(*) as before_removal from public.push_subscriptions
 where member_id = 'aaaaaaaa-4444-0000-0000-00000000000a';
delete from public.members where id = 'aaaaaaaa-4444-0000-0000-00000000000a';
select count(*) as after_removal from public.push_subscriptions
 where member_id = 'aaaaaaaa-4444-0000-0000-00000000000a';

rollback;
