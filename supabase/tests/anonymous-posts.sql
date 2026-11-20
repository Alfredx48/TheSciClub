-- Anonymous topics and posts (20261120100000, 20261120110000): nobody but the
-- writer learns who wrote one, administrators included; administrators flag
-- them, and a flag is a strike that also pauses anonymous posting; the third
-- strike pauses the membership for 30 days, and three after that close it; the
-- writer still edits it and hears about replies; a block still hides it; the Marketplace stays named.
-- Run in one transaction that is rolled back.

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('aaaaaaaa-a90a-0000-0000-00000000000a', 'peer', 'active', 'Probe asker', '19990009a01', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false),
  ('aaaaaaaa-a90a-0000-0000-00000000000b', 'peer', 'active', 'Probe replier', '19990009a02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false),
  ('aaaaaaaa-a90a-0000-0000-00000000000c', 'peer', 'active', 'Probe admin', '19990009a03', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true),
  ('aaaaaaaa-a90a-0000-0000-00000000000d', 'peer', 'active', 'Probe blocked', '19990009a04', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false);
insert into public.member_blocks (blocker_id, blocked_id)
values ('aaaaaaaa-a90a-0000-0000-00000000000a', 'aaaaaaaa-a90a-0000-0000-00000000000d');
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values ('aaaaaaaa-a90a-0000-0000-00000000000a', 'apns:sandbox:a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9', null, null),
       ('aaaaaaaa-a90a-0000-0000-00000000000b', 'apns:sandbox:b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9', null, null);
create temporary table probe (key text primary key, id uuid);
grant all on probe to authenticated;

\echo '1. the asker asks anonymously: expect a topic with no author, and its opening post with none'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
insert into probe values ('topic', public.chat_create_topic_anonymously('general', 'Probe anonymous question', 'Is this private?', '{}', true));
reset role;
select t.author_id is null as no_author, t.anonymous, t.is_question,
       (select p.author_id is null and p.anonymous and not p.by_asker from public.chat_posts p where p.topic_id = t.id) as opening_ok,
       (select a.member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a' from private.chat_anonymous_topics a where a.topic_id = t.id) as writer_kept
  from public.chat_topics t where t.id = (select id from probe where key = 'topic');

\echo '2. another member cannot read who wrote it: expect ERROR (permission) twice, then 0 writer rows, 0 topics of theirs'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s2;
select count(*) from private.chat_anonymous_posts;
rollback to savepoint s2;
savepoint s2b;
select private.chat_post_writer(id) from public.chat_posts where topic_id = (select id from probe where key = 'topic');
rollback to savepoint s2b;
select count(*) as writers_seen_by_replier from public.chat_anonymous_writers((select id from probe where key = 'topic'));
select count(*) as my_anonymous_topics from public.my_anonymous_topic_ids();
select count(*) as posts_read, bool_and(author_id is null) as all_nameless
  from public.chat_posts where topic_id = (select id from probe where key = 'topic');

\echo '3. the replier answers with their name; the anonymous asker is told: expect reply to the asker'
with p as (
  insert into public.chat_posts (topic_id, author_id, body)
  values ((select id from probe where key = 'topic'), 'aaaaaaaa-a90a-0000-0000-00000000000b', 'Named answer')
  returning id)
insert into probe select 'named', p.id from p;
reset role;
select public.notifications_record('post', jsonb_build_object('id', (select id from probe where key = 'named')));
select kind, actor_id = 'aaaaaaaa-a90a-0000-0000-00000000000b' as actor_is_replier
  from public.notifications where member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a' and topic_id = (select id from probe where key = 'topic');
select o.kind, o.actor_name from private.push_owed_every(
  (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'),
  'post', jsonb_build_object('id', (select id from probe where key = 'named'))) o
 where o.endpoint like 'apns:sandbox:a9a9%';

\echo '4. the asker follows up anonymously: expect by_asker, nobody named, the replier told "Anonymous · Asker", the asker not told'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
with p as (
  insert into public.chat_posts (topic_id, author_id, body, anonymous)
  values ((select id from probe where key = 'topic'), null, 'Anonymous follow-up', true)
  returning id)
insert into probe select 'followup', p.id from p;
reset role;
-- One transaction gives every row the same created_at; the follow-up comes after the question.
update public.chat_posts set created_at = created_at + interval '1 second' where id = (select id from probe where key = 'followup');
select author_id is null as no_author, anonymous, by_asker from public.chat_posts where id = (select id from probe where key = 'followup');
select public.notifications_record('post', jsonb_build_object('id', (select id from probe where key = 'followup')));
select member_id = 'aaaaaaaa-a90a-0000-0000-00000000000b' as to_replier, kind, actor_id is null as no_actor
  from public.notifications where topic_id = (select id from probe where key = 'topic') and post_id = (select id from probe where key = 'followup');
select o.kind, o.actor_name, o.endpoint from private.push_owed_every(
  (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'),
  'post', jsonb_build_object('id', (select id from probe where key = 'followup'))) o
 where o.endpoint like 'apns:sandbox:_9_9%';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select kind, actor_id is null as no_actor, actor_name from public.my_notifications() where kind like 'reply%' limit 1;
reset role;

\echo '5. who wrote them: expect 2 rows (own) and their 1 topic to the asker, 0 rows to an administrator'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select count(*) as own from public.chat_anonymous_writers((select id from probe where key = 'topic'));
select array_agg(id) = array[(select id from probe where key = 'topic')] as my_topic from public.my_anonymous_topic_ids() id;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
select count(*) as admin_rows from public.chat_anonymous_writers((select id from probe where key = 'topic'));
reset role;

\echo '6. the asker edits their own; the history does not name them; the replier cannot: expect true, then ERROR'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.chat_edit_post((select id from probe where key = 'followup'), 'Anonymous follow-up, edited');
reset role;
select count(*) = 1 and bool_and(edited_by is null) as history_nameless from public.chat_edits where post_id = (select id from probe where key = 'followup');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s6;
select public.chat_edit_post((select id from probe where key = 'followup'), 'Not yours');
rollback to savepoint s6;

\echo '7. no name with anonymous, and none in the Marketplace: expect ERROR three times'
savepoint s7;
insert into public.chat_posts (topic_id, author_id, body, anonymous)
values ((select id from probe where key = 'topic'), 'aaaaaaaa-a90a-0000-0000-00000000000b', 'Named and anonymous', true);
rollback to savepoint s7;
savepoint s7b;
select public.chat_create_topic_anonymously('for-sale', 'Probe chair', 'A chair', '{}', false);
rollback to savepoint s7b;
insert into probe values ('sale', public.chat_create_topic('for-sale', 'Probe named chair', 'A chair'));
savepoint s7c;
insert into public.chat_posts (topic_id, author_id, body, anonymous)
values ((select id from probe where key = 'sale'), null, 'Anonymous offer', true);
rollback to savepoint s7c;

\echo '8. a member the asker blocked: expect 0 topics, 0 posts, 0 in the room list'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000d","role":"authenticated"}', true) is not null as ok;
select count(*) as topics from public.chat_topics where id = (select id from probe where key = 'topic');
select count(*) as anonymous_posts from public.chat_posts where topic_id = (select id from probe where key = 'topic') and anonymous;
select count(*) as listed from public.chat_topics_page('general', 40, null, null) where id = (select id from probe where key = 'topic');
reset role;

\echo '9. reporting: the replier reports it and the report names nobody; the asker cannot report their own: expect true, then ERROR'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.chat_report_post((select id from probe where key = 'followup'), 'probe') is not null as reported;
reset role;
select reported_author_id is null as names_nobody
  from public.chat_reports where post_id = (select id from probe where key = 'followup');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s9;
select public.chat_report_post((select id from probe where key = 'followup'), 'mine');
rollback to savepoint s9;

\echo '10. the asker removes their own anonymous post: expect removed, not by an administrator'
select public.chat_remove_post((select id from probe where key = 'followup')) is not null as ok;
reset role;
select removed_at is not null as removed, not removed_by_admin as by_writer from public.chat_posts where id = (select id from probe where key = 'followup');

\echo '11. a like on the anonymous question reaches its writer, a like on a named post its author: expect two rows'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
insert into public.chat_post_likes (post_id, member_id)
select p.id, 'aaaaaaaa-a90a-0000-0000-00000000000b' from public.chat_posts p
 where p.topic_id = (select id from probe where key = 'topic') and p.author_id is null and not p.by_asker and p.removed_at is null;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
insert into public.chat_post_likes (post_id, member_id) values ((select id from probe where key = 'named'), 'aaaaaaaa-a90a-0000-0000-00000000000a');
reset role;
select public.notifications_record('like', jsonb_build_object('post_id', p.id, 'member_id', 'aaaaaaaa-a90a-0000-0000-00000000000b'))
  from public.chat_posts p where p.topic_id = (select id from probe where key = 'topic') and p.author_id is null and not p.by_asker and p.removed_at is null;
select public.notifications_record('like', jsonb_build_object('post_id', (select id from probe where key = 'named'), 'member_id', 'aaaaaaaa-a90a-0000-0000-00000000000a'));
select m.display_name as told, n.kind from public.notifications n join public.members m on m.id = n.member_id
 where n.kind = 'like' and n.topic_id = (select id from probe where key = 'topic') order by 1;

\echo '12. the lists still run and show the anonymous topic to everybody else: expect 1 in each, home 0 or 1'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select count(*) as page from public.chat_topics_page('general', 40, null, null) where id = (select id from probe where key = 'topic');
select count(*) as ranked from public.chat_topics_ranked('general', 400, 0) where id = (select id from probe where key = 'topic');
select count(*) as listed from public.chat_topics_for('general') where id = (select id from probe where key = 'topic');
select count(*) as one from public.chat_topic_for((select id from probe where key = 'topic'));
select count(*) <= 1 as home_ran from public.home_topics_ranked(400) where topic_id = (select id from probe where key = 'topic');
select count(*) <= 1 as shown_ran from public.home_topics_shown('all', 'new', 400) where topic_id = (select id from probe where key = 'topic');
reset role;

\echo '13. the speed limit counts anonymous posts as the writer''s, one at a time as the site sends them: expect refused at their 21st this minute'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
create temporary table burst (refused_at integer);
do $$
declare
  had integer := 2;  -- the question and the follow-up
  i integer;
begin
  for i in had + 1 .. 25 loop
    begin
      insert into public.chat_posts (topic_id, author_id, body, anonymous)
      values ((select id from probe where key = 'topic'), null, 'burst ' || i, true);
    exception when others then
      insert into burst values (i);
      return;
    end;
  end loop;
end $$;
select refused_at from burst;
reset role;

\echo '14. flags: the replier cannot flag, nor anybody a named post (ERROR twice); the first flag hides the post, tells the asker month:reason and pauses anonymous posting about a month (ERROR to post); the second says three_months'
create temporary table flaggable as
  select p.id, row_number() over (order by p.created_at, p.id) as n
    from public.chat_posts p
    join private.chat_anonymous_posts a on a.post_id = p.id
   where a.member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a' and p.removed_at is null
     and p.topic_id = (select id from probe where key = 'topic') and p.body like 'burst %';
grant select on flaggable to authenticated;
select count(*) >= 3 as enough from flaggable;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s14;
select public.chat_flag_anonymous_post((select id from flaggable where n = 1), 'not mine to flag');
rollback to savepoint s14;
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s14b;
select public.chat_flag_anonymous_post((select id from probe where key = 'named'), 'named');
rollback to savepoint s14b;
select public.chat_flag_anonymous_post((select id from flaggable where n = 1), 'probe reason 1') is not null as flagged;
reset role;
select p.removed_at is not null and p.removed_by_admin as hidden from public.chat_posts p where p.id = (select id from flaggable where n = 1);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select kind, place, excerpt like 'burst %' as own_words, detail = 'month:probe reason 1' as detail, url like '/chat/rooms/general/topics/%' as to_topic, actor_name is null as nobody_named
  from public.my_notifications() where kind = 'anonymous_flagged';
select state, paused_until between now() + interval '27 days' and now() + interval '32 days' as a_month, flags from public.my_anonymous_standing();
savepoint s14c;
select public.chat_create_topic_anonymously('general', 'While paused', 'x', '{}', false);
rollback to savepoint s14c;
select count(*) as told_their_own from public.my_anonymous_strikes();
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.chat_flag_anonymous_post((select id from flaggable where n = 2), 'probe reason 2') is not null as flagged;
reset role;
select split_part(detail, ':', 1) as second_costs from public.notifications where post_id = (select id from flaggable where n = 2);
select state, paused_until > now() + interval '85 days' as three_months from private.anonymous_standing('aaaaaaaa-a90a-0000-0000-00000000000a');

\echo '15. an administrator never sees flags as strikes (expect 0, 0); one named strike makes three: (1, paused, ~30 days), the asker is paused, anonymous posting ended'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.active_strike_count('aaaaaaaa-a90a-0000-0000-00000000000a') as named_only, (select strikes from public.admin_members where id = 'aaaaaaaa-a90a-0000-0000-00000000000a') as roster;
select strikes, outcome, paused_until between now() + interval '29 days' and now() + interval '31 days' as thirty_days
  from public.admin_strike_member('aaaaaaaa-a90a-0000-0000-00000000000a', 'probe named strike');
reset role;
select status from public.members where id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
select state from private.anonymous_standing('aaaaaaaa-a90a-0000-0000-00000000000a');

\echo '16. thirty days on, the pause lifts by itself: (1 lifted, active, 0 strikes counting), and anonymous posting stays gone (ERROR)'
update public.member_strikes set issued_at = issued_at - interval '40 days' where member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
update private.chat_anonymous_flags set flagged_at = flagged_at - interval '40 days' where member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
update public.member_strike_pauses set paused_at = now() - interval '31 days', ends_at = now() - interval '1 day' where member_id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
select private.lift_strike_pauses() as lifted;
select status, private.strike_total('aaaaaaaa-a90a-0000-0000-00000000000a') as counting from public.members where id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint s16;
select public.chat_create_topic_anonymously('general', 'After the pause', 'x', '{}', false);
rollback to savepoint s16;
reset role;

\echo '17. after the pause, three more close the account: a flag (ended:), a named strike (none), another (closed); the member is gone'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.chat_flag_anonymous_post((select id from flaggable where n = 3), 'probe reason 3') is not null as flagged;
reset role;
select split_part(detail, ':', 1) as third_costs from public.notifications where post_id = (select id from flaggable where n = 3);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-a90a-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select strikes, outcome from public.admin_strike_member('aaaaaaaa-a90a-0000-0000-00000000000a', 'probe named two');
select strikes, outcome from public.admin_strike_member('aaaaaaaa-a90a-0000-0000-00000000000a', 'probe named three');
reset role;
select count(*) as still_a_member from public.members where id = 'aaaaaaaa-a90a-0000-0000-00000000000a';
