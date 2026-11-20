-- Strike rules, conversations and withdrawal (20261120120000): the member and
-- the administrators can answer each other about a strike or flag; nobody
-- else can read it; on a flag, administrators never learn who wrote the post;
-- withdrawing a flag brings the post back and undoes what it cost; a pause
-- with fewer than three strikes under it is undone.
-- Run in one transaction that is rolled back.

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('bbbbbbbb-a90b-0000-0000-00000000000a', 'peer', 'active', 'Probe writer', '19990009b01', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false),
  ('bbbbbbbb-a90b-0000-0000-00000000000b', 'peer', 'active', 'Probe stranger', '19990009b02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false),
  ('bbbbbbbb-a90b-0000-0000-00000000000c', 'peer', 'active', 'Probe admin one', '19990009b03', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true),
  ('bbbbbbbb-a90b-0000-0000-00000000000d', 'peer', 'active', 'Probe admin two', '19990009b04', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true);
create temporary table probe (key text primary key, id uuid);
grant all on probe to authenticated;

\echo '1. the writer asks anonymously; admin one flags it for selling: expect the post hidden'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
insert into probe values ('topic', public.chat_create_topic_anonymously('general', 'Probe flagged question', 'Buy my cushions', '{}', true));
reset role;
insert into probe select 'post', p.id from public.chat_posts p where p.topic_id = (select id from probe where key = 'topic');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.chat_flag_anonymous_post((select id from probe where key = 'post'), 'Selling cushions.', 'selling') as files_to_delete;
savepoint s1;
select public.chat_flag_anonymous_post((select id from probe where key = 'post'), 'Again', 'not_a_rule');
rollback to savepoint s1;
reset role;
insert into probe select 'flag', f.id from private.chat_anonymous_flags f where f.post_id = (select id from probe where key = 'post');
select p.removed_at is not null as hidden, f.rule
  from public.chat_posts p, private.chat_anonymous_flags f
 where p.id = (select id from probe where key = 'post') and f.id = (select id from probe where key = 'flag');

\echo '2. the writer reads it: expect mine, rule selling, their words, no member id; their notice leads to /strikes/flag/'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select mine, rule, words, member_id is null as no_member from public.strike_summary('flag', (select id from probe where key = 'flag'));
select kind, url = '/strikes/flag/' || (select id from probe where key = 'flag') as to_conversation
  from public.my_notifications() where kind = 'anonymous_flagged';

\echo '3. the writer answers: expect both administrators told, with no actor and the answer as excerpt'
select public.strike_reply('flag', (select id from probe where key = 'flag'), 'They are my own, used.') is not null as sent;
reset role;
select member_id, actor_id is null as no_actor, detail like 'flag:%:selling' as detail_ok
  from public.notifications where kind = 'strike_message' order by member_id;

\echo '4. administrators read it: expect no member id or name, the writer as "The writer" in the thread and the notice, which leads to the conversation'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select mine, member_id is null as no_member, member_name is null as no_name from public.strike_summary('flag', (select id from probe where key = 'flag'));
select author, mine, from_member from public.strike_thread('flag', (select id from probe where key = 'flag'));
select excerpt, place, url = '/strikes/flag/' || (select id from probe where key = 'flag') as to_conversation
  from public.my_notifications() where kind = 'strike_message';
select kind, member_name is null as no_name, messages, waiting from public.admin_strike_threads() where id = (select id from probe where key = 'flag');
reset role;

\echo '5. admin two answers: expect the writer told, reading "An administrator"; admin one reads admin two by name'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.strike_reply('flag', (select id from probe where key = 'flag'), 'Used equipment goes in the Marketplace.') is not null as sent;
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select author, mine from public.strike_thread('flag', (select id from probe where key = 'flag'));
select kind, excerpt from public.my_notifications() where kind = 'strike_message';
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select author from public.strike_thread('flag', (select id from probe where key = 'flag'));
reset role;

\echo '6. a stranger can read and answer nothing: expect ERROR five times'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s6a;
select * from public.strike_summary('flag', (select id from probe where key = 'flag'));
rollback to savepoint s6a;
savepoint s6b;
select * from public.strike_thread('flag', (select id from probe where key = 'flag'));
rollback to savepoint s6b;
savepoint s6c;
select public.strike_reply('flag', (select id from probe where key = 'flag'), 'Me too');
rollback to savepoint s6c;
savepoint s6d;
select * from public.admin_strike_threads();
rollback to savepoint s6d;
savepoint s6e;
select count(*) from private.strike_messages;
rollback to savepoint s6e;
reset role;

\echo '7. admin one withdraws the flag: expect the post back as it was, no strike, anonymous posting ok, the writer told why'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.admin_withdraw_flag((select id from probe where key = 'flag'), 'Own used equipment, fine.');
savepoint s7;
select public.admin_withdraw_flag((select id from probe where key = 'flag'), 'Twice');
rollback to savepoint s7;
reset role;
select p.removed_at is null as back, p.body,
       not exists (select 1 from public.chat_removed_bodies rb where rb.post_id = p.id) as kept_copy_gone
  from public.chat_posts p where p.id = (select id from probe where key = 'post');
select private.strike_total('bbbbbbbb-a90b-0000-0000-00000000000a') as strikes,
       (select state from private.anonymous_standing('bbbbbbbb-a90b-0000-0000-00000000000a')) as anonymous;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select kind, excerpt from public.my_notifications() where kind in ('strike_withdrawn', 'anonymous_flagged') order by kind;
reset role;

\echo '8. two named strikes and a new flag pause the writer; withdrawing one named strike undoes the pause: expect paused, then active, ok'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select strikes, outcome from public.admin_strike_member('bbbbbbbb-a90b-0000-0000-00000000000a', 'Mocked a member.', 'harassment');
select strikes, outcome from public.admin_strike_member('bbbbbbbb-a90b-0000-0000-00000000000a', 'Said a supplement cures it.', 'medical_claims');
savepoint s8;
select * from public.admin_strike_member('bbbbbbbb-a90b-0000-0000-00000000000a', 'Whatever', 'nonsense');
rollback to savepoint s8;
select public.chat_flag_anonymous_post((select id from probe where key = 'post'), 'Selling again.', 'selling') as files_to_delete;
reset role;
select status, (select state from private.anonymous_standing(m.id)) as anonymous
  from public.members m where m.id = 'bbbbbbbb-a90b-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.admin_withdraw_strike(
  (select s.id from public.member_strikes s where s.member_id = 'bbbbbbbb-a90b-0000-0000-00000000000a' and s.rule = 'harassment'),
  'It was a joke between friends.');
select rule from public.admin_strikes where member_id = 'bbbbbbbb-a90b-0000-0000-00000000000a' order by rule;
reset role;
select m.status, (select state from private.anonymous_standing(m.id)) as anonymous,
       (select count(*) from public.member_strike_pauses p where p.member_id = m.id and p.undone_at is not null) as undone
  from public.members m where m.id = 'bbbbbbbb-a90b-0000-0000-00000000000a';

\echo '9. the writer reads their named strike and its notice; the stranger cannot: expect mine, their name, ERROR'
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select mine, rule, member_name from public.strike_summary('strike',
  (select s.id from public.member_strikes s where s.member_id = 'bbbbbbbb-a90b-0000-0000-00000000000a' and s.rule = 'medical_claims'));
select kind, excerpt, url like '/strikes/strike/%' as to_conversation from public.my_notifications() where kind = 'strike_given' order by excerpt;
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-a90b-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s9;
select * from public.strike_summary('strike',
  (select s.id from public.member_strikes s where s.member_id = 'bbbbbbbb-a90b-0000-0000-00000000000a' and s.rule = 'medical_claims'));
rollback to savepoint s9;
reset role;
