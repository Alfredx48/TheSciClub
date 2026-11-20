-- ============================================================================
-- Do strikes count what they should, and can the wrong people see them?
-- ============================================================================
-- Two halves. The arithmetic — withdrawn strikes and old strikes leave the
-- count, and the row stays — and the visibility, which is the half that would
-- do real harm if it were wrong: a strike is the most sensitive thing that
-- could sit against a name, and no member may see another's.
--
-- Run as real signed-in roles, not as the superuser: postgres is BYPASSRLS, so
-- every policy here would be inert and the file would pass while proving
-- nothing. Every expected refusal sits in its own savepoint, or the first one
-- aborts the transaction and the rest report nothing at all.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/strikes.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin)
values
  ('aaaaaaaa-2222-0000-0000-00000000000a', 'peer', 'active', 'The Admin', '19990000030', '1980-01-01', 'T1–T6', 'CA', true),
  ('cccccccc-2222-0000-0000-00000000000c', 'peer', 'active', 'Struck',    '19990000031', '1982-01-01', 'C5–C8', 'CA', false),
  ('dddddddd-2222-0000-0000-00000000000d', 'peer', 'active', 'Nosy',      '19990000032', '1983-01-01', 'C5–C8', 'CA', false);

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 0. we are a signed-in administrator (expect authenticated | t) =='
select current_user, public.is_admin() as admin;

\echo ''
\echo '== 1. nobody starts with one (expect 0) =='
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as strikes;

\echo ''
\echo '== 2. a strike needs a reason (expect ERROR) =='
savepoint no_reason;
select public.admin_add_strike('cccccccc-2222-0000-0000-00000000000c', '   ');
rollback to savepoint no_reason;

\echo ''
\echo '== 3. issue two (expect no error, then 2) =='
select public.admin_add_strike('cccccccc-2222-0000-0000-00000000000c', 'Sold supplements in a room');
select public.admin_add_strike('cccccccc-2222-0000-0000-00000000000c', 'Repeated what was said in a room');
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as strikes;

\echo ''
\echo '== 4. the roster agrees with the function (expect 2) =='
select strikes from public.admin_members where id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 5. withdrawing needs a reason too (expect ERROR) =='
savepoint no_withdraw_reason;
select public.admin_withdraw_strike(
  (select id from public.admin_strikes where member_id = 'cccccccc-2222-0000-0000-00000000000c' order by issued_at limit 1), '');
rollback to savepoint no_withdraw_reason;

\echo ''
\echo '== 6. withdraw one: the count drops, the row stays (expect 1, then 2) =='
select public.admin_withdraw_strike(
  (select id from public.admin_strikes where member_id = 'cccccccc-2222-0000-0000-00000000000c' order by issued_at limit 1),
  'Wrong member — meant somebody else');
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as counts_now;
select count(*) as rows_on_the_record from public.admin_strikes where member_id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 7. withdrawing it twice is refused (expect ERROR) =='
savepoint twice;
select public.admin_withdraw_strike(
  (select id from public.admin_strikes where member_id = 'cccccccc-2222-0000-0000-00000000000c' and withdrawn_at is not null limit 1),
  'again');
rollback to savepoint twice;

\echo ''
\echo '== 8. a strike older than the window stops counting (expect 1, then 0) =='
\echo '   The row is aged past strike_window() directly; there is no other way'
\echo '   to reach a year ago, and this is the arithmetic being tested.'
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as before_ageing;
set local role postgres;
update public.member_strikes set issued_at = now() - interval '13 months'
 where member_id = 'cccccccc-2222-0000-0000-00000000000c' and withdrawn_at is null;
set local role authenticated;
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as after_ageing;

\echo ''
\echo '== 9. an administrator cannot be struck (expect ERROR) =='
savepoint strike_admin;
select public.admin_add_strike('aaaaaaaa-2222-0000-0000-00000000000a', 'trying it on');
rollback to savepoint strike_admin;

\echo ''
\echo '== 10. the struck member can read their own, reason and all (expect 2 rows) =='
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-2222-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
select count(*) as mine, count(reason) as with_reasons from public.member_strikes;

\echo ''
\echo '== 11. ...and nothing through the admin view (expect 0) =='
\echo '   admin_strikes is gated on is_admin(), so an ordinary member reading'
\echo '   it gets an empty set rather than an error.'
select count(*) as through_admin_view from public.admin_strikes;

\echo ''
\echo '== 11b. an ADMINISTRATOR reading the table sees everybody (expect 2) =='
\echo '   Not a bug — the two select policies are ORed, and an administrator is'
\echo '   meant to read every strike. It is a trap for a client that assumes an'
\echo '   unfiltered select means "mine": Me said "Two strikes" to an'
\echo '   administrator holding one, until loadMyStrikes started filtering on'
\echo '   member_id. Pinned here so the policy change that would break it again'
\echo '   is visible in this file.'
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
select count(*) as unfiltered_as_admin from public.member_strikes;
select count(*) as filtered_to_their_own from public.member_strikes
 where member_id = 'aaaaaaaa-2222-0000-0000-00000000000a';

\echo ''
\echo '== 12. another member sees none of them (expect 0) =='
\echo '   The one that would do real harm if it were wrong.'
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-2222-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
select count(*) as visible_to_a_stranger from public.member_strikes;

\echo ''
\echo '== 13. and cannot issue one (expect ERROR) =='
savepoint peer_strikes;
select public.admin_add_strike('cccccccc-2222-0000-0000-00000000000c', 'I do not like them');
rollback to savepoint peer_strikes;

-- ---------------------------------------------------------------------------
-- The limit. 20260917000000, and since 20261120110000 the pause.
-- ---------------------------------------------------------------------------
-- Struck is back to zero counting strikes by now: one was withdrawn at step 6
-- and the other aged out at step 8. Both rows are still on the record, which
-- is the point of starting from here rather than from a fresh member — the cap
-- must count what counts, not what exists.

\echo ''
\echo '== 14. back as the administrator, and Struck counts none (expect t, then 0) =='
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
select public.is_admin() as admin;
select public.active_strike_count('cccccccc-2222-0000-0000-00000000000c') as counting_now;
select count(*) as rows_still_on_the_record from public.admin_strikes
 where member_id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 15. each strike reports the new count, and the third pauses (expect 1 none, 2 none, 3 paused) =='
\echo '   20261120110000: the third strike pauses the membership for 30 days by'
\echo '   itself, where 20260917000000 refused a fourth and asked an administrator.'
select strikes, outcome from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Sold supplements');
select strikes, outcome from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Repeated a room');
select strikes, outcome, paused_until > now() + interval '29 days' as thirty_days
  from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Medical advice as fact');
select status from public.admin_members where id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 16. the pause is theirs and the administrators to read, nobody else''s (expect 1, 1, 0) =='
select count(*) as admin_reads from public.member_strike_pauses where member_id = 'cccccccc-2222-0000-0000-00000000000c';
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-2222-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
select count(*) as own_reads from public.member_strike_pauses;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-2222-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
select count(*) as stranger_reads from public.member_strike_pauses;

\echo ''
\echo '== 17. nobody writes a pause by hand (expect ERROR twice) =='
savepoint pause_by_hand;
insert into public.member_strike_pauses (member_id, ends_at) values ('dddddddd-2222-0000-0000-00000000000d', now());
rollback to savepoint pause_by_hand;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
savepoint admin_pause_by_hand;
insert into public.member_strike_pauses (member_id, ends_at) values ('dddddddd-2222-0000-0000-00000000000d', now());
rollback to savepoint admin_pause_by_hand;

\echo ''
\echo '== 18. Resume ends it early, and the count starts again (expect active, 0) =='
select public.admin_set_member_status('cccccccc-2222-0000-0000-00000000000c', 'active');
set local role postgres;
-- The strikes were given in this transaction, before the pause; put them a
-- day before it, as they would be.
update public.member_strikes set issued_at = now() - interval '2 days' where member_id = 'cccccccc-2222-0000-0000-00000000000c';
update public.member_strike_pauses set paused_at = now() - interval '1 day' where member_id = 'cccccccc-2222-0000-0000-00000000000c';
set local role authenticated;
select status, public.active_strike_count(id) as counting from public.admin_members where id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 19. after a pause, three more close the account for good (expect none, none, closed, then 0 rows) =='
select outcome from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Again one');
select outcome from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Again two');
select outcome from public.admin_strike_member('cccccccc-2222-0000-0000-00000000000c', 'Again three');
select count(*) as still_there from public.admin_members where id = 'cccccccc-2222-0000-0000-00000000000c';

\echo ''
\echo '== 20. the explanations shown once: a member marks their own and reads only their own (expect 1, ERROR, 1) =='
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-2222-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
insert into public.member_seen_explainers (explainer) values ('anonymous');
select count(*) as mine from public.member_seen_explainers;
savepoint someone_elses;
insert into public.member_seen_explainers (member_id, explainer) values ('aaaaaaaa-2222-0000-0000-00000000000a', 'anonymous');
rollback to savepoint someone_elses;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-2222-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
insert into public.member_seen_explainers (explainer) values ('not_a_question');
select count(*) as only_their_own from public.member_seen_explainers;

rollback;
