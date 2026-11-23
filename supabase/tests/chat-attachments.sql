-- ============================================================================
-- Photographs in chat: what the rows hold, and what SQL can settle about the
-- bucket. Run as members, under RLS.
-- ============================================================================
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/chat-attachments.sql
--
-- It rolls back and is safe to re-run. Do not point it at the hosted project.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE ADDING A STORAGE STEP
-- ---------------------------------------------------------------------------
-- The bucket's *read* policy is the load-bearing part of 20260918200000 and
-- it is exercised here — a row can be put in storage.objects as the superuser
-- and then selected as a member, and RLS decides. Uploads and deletes cannot
-- be: `storage.protect_delete()` refuses every direct delete before RLS is
-- consulted, and an insert as a member does not go through the API's own
-- checks (the size limit, the mime types). Those are proved through the API
-- with real tokens by `pnpm check-chat-photo-policy`, which is the other half
-- of this file. See supabase/tests/photo-cleanup.sql for the afternoon that
-- taught this.
--
-- Two steps carry the feature and are marked in place:
--
--   6  — somebody outside a direct conversation cannot read a photograph in
--        it. **THE step.** chat_file_is_readable() is definer, so the select
--        policy on chat_messages is protecting nothing here; the
--        is_thread_member() line inside it is the entire defence between a
--        picture of somebody's pressure sore and every member with a URL.
--   9  — an administrator can read a photograph only once it is named on a
--        report, and not before. Sabotage chat_file_is_reported() to `true`
--        and step 9a must go red.
--
-- Step 0 prints current_user because as the superuser every step below turns
-- green while proving nothing. Every expected refusal has its own savepoint.
-- ============================================================================
\set ON_ERROR_STOP off
\set QUIET on
\pset pager off
begin;
-- ------------------------------------------------------------------- set-up
insert into public.members
  (id, type, status, display_name, phone, birth_date, level_range, state, show_in_browse, is_admin)
values
  ('aaaaaaaa-9999-0000-0000-000000000001', 'peer',   'active',    'Ada A',      '19990009001', '1980-01-01', 'T1–T6', 'CA', true, false),
  ('bbbbbbbb-9999-0000-0000-000000000002', 'peer',   'active',    'Bo B',       '19990009002', '1981-01-01', 'C5–C8', 'CA', true, false),
  ('dddddddd-9999-0000-0000-000000000004', 'peer',   'active',    'Onlooker O', '19990009004', '1983-01-01', 'L1–S5', 'CA', true, false),
  ('99999999-9999-0000-0000-000000000007', 'mentor', 'active',    'Admin A',    '19990009007', '1986-01-01', 'T1–T6', 'CA', true, true);
update public.chat_rooms set opened_at = now() where id = 'bowel';
update public.chat_rooms set opened_at = null where id = 'skin';
-- Nobody joins bowel: writing needs no membership since 20260930000000, and
-- step 11 is the one that used to depend on Ada having joined.
insert into public.chat_topics (id, room_id, title, author_id)
values ('11111111-9999-0000-0000-00000000a001', 'bowel', 'What fits in a rucksack',
        'aaaaaaaa-9999-0000-0000-000000000001');
-- A direct conversation between Ada and Bo. Onlooker is not in it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';
select public.chat_open_direct('bbbbbbbb-9999-0000-0000-000000000002') as dm \gset
reset role;
-- Two files, put there as the superuser: one in the conversation, one in the
-- room. The API is what puts real ones there; these rows are the situation.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('chat', 'threads/' || :'dm' || '/private.webp', 'bbbbbbbb-9999-0000-0000-000000000002', '{"size": 1}'),
  ('chat', 'rooms/bowel/open.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/skin/closed.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}'),
  -- Ada's, uploaded before step 11 names them: a post names only its author's
  -- uploads (20261018020000).
  ('chat', 'rooms/bowel/p1.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/bowel/p2.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';

\echo ''
\echo '== 0. we are a signed-in ordinary member, not the superuser =='
\echo '   expect: authenticated | aaaaaaaa-9999-... | f'
select current_user, auth.uid(), public.is_admin();

\echo ''
\echo '== 1. a message with a photograph, and one with a photograph and no words =='
\echo '   expect: two rows. The check is words *or* a picture.'
insert into public.chat_messages (thread_id, author_id, body, attachments)
values (:'dm', 'aaaaaaaa-9999-0000-0000-000000000001', 'Look at this.',
        array['threads/' || :'dm' || '/a.webp']);
insert into public.chat_messages (thread_id, author_id, body, attachments)
values (:'dm', 'aaaaaaaa-9999-0000-0000-000000000001', '',
        array['threads/' || :'dm' || '/b.webp', 'threads/' || :'dm' || '/c.webp']);
select body, cardinality(attachments) as photographs from public.chat_messages
 where thread_id = :'dm' order by created_at;

\echo ''
\echo '== 2. no words and no picture is still refused =='
\echo '   expect: ERROR.'
savepoint nothing_at_all;
insert into public.chat_messages (thread_id, author_id, body, attachments)
values (:'dm', 'aaaaaaaa-9999-0000-0000-000000000001', '   ', '{}');
rollback to savepoint nothing_at_all;

\echo ''
\echo '== 3. a 51st photograph is refused =='
\echo '   expect: ERROR. Fifty is the constraint, not the client (it was four until'
\echo '   20261123040000).'
savepoint fifty_one;
insert into public.chat_messages (thread_id, author_id, body, attachments)
values (:'dm', 'aaaaaaaa-9999-0000-0000-000000000001', 'Fifty-one',
        array(select 'threads/' || :'dm' || '/' || n || '.webp' from generate_series(1, 51) n));
rollback to savepoint fifty_one;

\echo ''
\echo '== 4. a path under another conversation''s folder is refused =='
\echo '   expect: ERROR. A row that lies about where its pictures are is a row'
\echo '   that lies; the read policy would refuse the file anyway.'
savepoint elsewhere;
insert into public.chat_messages (thread_id, author_id, body, attachments)
values (:'dm', 'aaaaaaaa-9999-0000-0000-000000000001', 'Borrowed',
        array['threads/00000000-0000-0000-0000-000000000000/x.webp']);
rollback to savepoint elsewhere;

\echo ''
\echo '== 5. a member of the conversation can read its photograph =='
\echo '   expect: 1. The select policy on storage.objects, as Ada.'
select count(*) as ada_sees from storage.objects
 where bucket_id = 'chat' and name = 'threads/' || :'dm' || '/private.webp';

\echo ''
\echo '== 6. *** somebody outside the conversation cannot ***'
\echo '   expect: 0, as Onlooker. THE step. Sabotage the is_thread_member()'
\echo '   check inside chat_file_is_readable() and this must go to 1.'
set local request.jwt.claims = '{"sub":"dddddddd-9999-0000-0000-000000000004","role":"authenticated"}';
select count(*) as onlooker_sees from storage.objects
 where bucket_id = 'chat' and name = 'threads/' || :'dm' || '/private.webp';

\echo ''
\echo '== 7. a room''s photograph is readable by any member, joined or not =='
\echo '   expect: 1, as Onlooker, who has not joined bowel. Full history.'
select count(*) as onlooker_sees_the_room_photo from storage.objects
 where bucket_id = 'chat' and name = 'rooms/bowel/open.webp';

\echo ''
\echo '== 8. a closed room''s photograph is not =='
\echo '   expect: 0, as Onlooker.'
select count(*) as onlooker_sees_the_closed_room_photo from storage.objects
 where bucket_id = 'chat' and name = 'rooms/skin/closed.webp';

\echo ''
\echo '== 9. an administrator is not in the conversation and cannot read it =='
\echo '   expect: 0, as Admin. Private even from administrators, pictures too.'
set local request.jwt.claims = '{"sub":"99999999-9999-0000-0000-000000000007","role":"authenticated"}';
select count(*) as admin_sees from storage.objects
 where bucket_id = 'chat' and name = 'threads/' || :'dm' || '/private.webp';

\echo ''
\echo '== 9a. *** until Bo''s photograph is reported, when they can read that one ***'
\echo '   expect: 1 then 0 — the reported file, and not the neighbouring one.'
\echo '   Set-up: Bo sends a message carrying private.webp; Ada reports it.'
reset role;
insert into public.chat_messages (id, thread_id, author_id, body, attachments)
values ('22222222-9999-0000-0000-00000000b001', :'dm', 'bbbbbbbb-9999-0000-0000-000000000002',
        'Nasty', array['threads/' || :'dm' || '/private.webp']);
insert into public.chat_messages (id, thread_id, author_id, body, attachments)
values ('22222222-9999-0000-0000-00000000b002', :'dm', 'bbbbbbbb-9999-0000-0000-000000000002',
        'Also nasty, not reported', array['threads/' || :'dm' || '/neighbour.webp']);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('chat', 'threads/' || :'dm' || '/neighbour.webp', 'bbbbbbbb-9999-0000-0000-000000000002', '{"size": 1}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';
select public.chat_report_message('22222222-9999-0000-0000-00000000b001', 'The picture.');
set local request.jwt.claims = '{"sub":"99999999-9999-0000-0000-000000000007","role":"authenticated"}';
select count(*) as admin_sees_the_reported_one from storage.objects
 where bucket_id = 'chat' and name = 'threads/' || :'dm' || '/private.webp';
select count(*) as admin_sees_the_neighbour from storage.objects
 where bucket_id = 'chat' and name = 'threads/' || :'dm' || '/neighbour.webp';
select cardinality(attachments) as paths_on_the_report from public.admin_chat_reports()
 where message_id = '22222222-9999-0000-0000-00000000b001';

\echo ''
\echo '== 10. taking a message back blanks its photographs and keeps the record =='
\echo '   expect: 0 on the row, 1 in chat_removed_bodies.'
set local request.jwt.claims = '{"sub":"bbbbbbbb-9999-0000-0000-000000000002","role":"authenticated"}';
select public.chat_remove_message('22222222-9999-0000-0000-00000000b001');
reset role;
select cardinality(attachments) as on_the_row from public.chat_messages
 where id = '22222222-9999-0000-0000-00000000b001';
select cardinality(attachments) as in_the_record from public.chat_removed_bodies
 where message_id = '22222222-9999-0000-0000-00000000b001';
set local role authenticated;

\echo ''
\echo '== 11. a topic starts with photographs on its first post =='
\echo '   expect: 2, as Ada, who has joined nothing (20260930000000).'
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';
select public.chat_create_topic('bowel', 'With pictures', 'Here they are.',
                                array['rooms/bowel/p1.webp', 'rooms/bowel/p2.webp']) as topic \gset
select cardinality(attachments) as on_the_first_post from public.chat_posts where topic_id = :'topic';

\echo ''
\echo '== 12. the three-argument form is gone, and the room function still works =='
\echo '   expect: t — chat_create_room calls with three arguments and the'
\echo '   default serves.'
select public.chat_create_room('Shoulder pain nine', 'Overuse, and what helped.', 'Body',
                               'First', 'First post.') is not null as room_made;

\echo ''
\echo '== 12a. a new room gets photographs on its first post afterwards =='
\echo '   expect: a room id, then 2. The folder cannot exist before the room, so'
\echo '   the files go up second and chat_add_first_post_photographs names them.'
select public.chat_create_room('Shoulder pain ten', 'Overuse, and what helped.', 'Body',
                               'First', 'First post.') as new_room \gset
\echo :new_room
reset role;
-- The two files Ada uploaded after the room came back, as the API would put them.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('chat', 'rooms/' || :'new_room' || '/one.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/' || :'new_room' || '/two.webp', 'aaaaaaaa-9999-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/' || :'new_room' || '/bos.webp', 'bbbbbbbb-9999-0000-0000-000000000002', '{"size": 1}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';

\echo '   12b. somebody else''s file is refused (expect: ERROR, have not been uploaded)'
savepoint not_hers;
select public.chat_add_first_post_photographs(:'new_room',
  array['rooms/' || :'new_room' || '/one.webp', 'rooms/' || :'new_room' || '/bos.webp']);
rollback to savepoint not_hers;

\echo '   12c. a file in another room''s folder is refused (expect: ERROR, not in this room)'
savepoint elsewhere;
select public.chat_add_first_post_photographs(:'new_room', array['rooms/bowel/open.webp']);
rollback to savepoint elsewhere;

\echo '   12d. somebody who did not start the room is refused (expect: ERROR, Only the member who started)'
set local request.jwt.claims = '{"sub":"bbbbbbbb-9999-0000-0000-000000000002","role":"authenticated"}';
savepoint not_starter;
select public.chat_add_first_post_photographs(:'new_room', array['rooms/' || :'new_room' || '/bos.webp']);
rollback to savepoint not_starter;
set local request.jwt.claims = '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}';

\echo '   12e. the starter''s own two go on (expect: 2)'
select public.chat_add_first_post_photographs(:'new_room',
  array['rooms/' || :'new_room' || '/one.webp', 'rooms/' || :'new_room' || '/two.webp']);
select cardinality(p.attachments) as on_the_first_post
from public.chat_posts p join public.chat_topics t on t.id = p.topic_id
where t.room_id = :'new_room';

\echo '   12f. and not a second time (expect: ERROR, already has its photographs)'
savepoint twice;
select public.chat_add_first_post_photographs(:'new_room', array['rooms/' || :'new_room' || '/one.webp']);
rollback to savepoint twice;

\echo ''
\echo '== 13. the bucket is private and sized =='
\echo '   expect: f | 2097152 | {image/webp,image/jpeg,image/png}'
reset role;
select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'chat';

rollback;
\echo ''
\echo '== rolled back =='
