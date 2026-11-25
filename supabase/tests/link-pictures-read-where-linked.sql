-- ============================================================================
-- Can a member read a link's picture from a conversation they are not in?
-- ============================================================================
-- 20261018050000 (security scan of 2026-10-17, F11 and F16). Before it, every
-- active member could read every picture in link-previews, and the names are
-- the sha256 of a predictable address: step 4 found 3 and step 5 signed the
-- conversation's picture, so anybody could ask whether a link had been sent
-- in somebody else's conversation. Steps 2, 3 and 6 have to keep working, or
-- link cards lose their pictures in conversations, in rooms and on Home.
--
-- Pictures are put in storage.objects and previews on the rows as the
-- superuser (link-preview and link_preview_save do it for real); the reads
-- are as members, under RLS. Selecting storage.objects is what signing a URL
-- and listing the bucket are checked against.
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/link-pictures-read-where-linked.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

-- ------------------------------------------------------------------- set-up
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state)
values
  ('aaaaaaaa-1823-0000-0000-00000000000a', 'peer', 'active', 'Ana',      '19990002301', '1980-01-01', 'C5–C8', 'CA'),
  ('bbbbbbbb-1823-0000-0000-00000000000b', 'peer', 'active', 'Bo',       '19990002302', '1981-01-01', 'C5–C8', 'CA'),
  ('cccccccc-1823-0000-0000-00000000000c', 'peer', 'active', 'Outsider', '19990002303', '1982-01-01', 'C5–C8', 'CA');
update public.chat_rooms set opened_at = now() where id = 'bowel';

insert into public.chat_threads (id, kind, direct_key) values
  ('11111111-1823-0000-0000-000000000001', 'direct',
   'aaaaaaaa-1823-0000-0000-00000000000a:bbbbbbbb-1823-0000-0000-00000000000b');
insert into public.chat_thread_members (thread_id, member_id) values
  ('11111111-1823-0000-0000-000000000001', 'aaaaaaaa-1823-0000-0000-00000000000a'),
  ('11111111-1823-0000-0000-000000000001', 'bbbbbbbb-1823-0000-0000-00000000000b');
insert into public.chat_messages (thread_id, author_id, body, link_preview) values
  ('11111111-1823-0000-0000-000000000001', 'aaaaaaaa-1823-0000-0000-00000000000a',
   'Watch https://www.youtube.com/watch?v=probe1823',
   '{"url": "https://www.youtube.com/watch?v=probe1823", "imagePath": "probe1823-conversation.jpg",
     "youtubeId": "probe1823aa", "videos": [{"url": "https://youtu.be/probe1823bb",
     "imagePath": "probe1823-second-video.jpg", "youtubeId": "probe1823bb"}]}');

insert into public.chat_topics (id, room_id, title, author_id)
values ('22222222-1823-0000-0000-000000000001', 'bowel', 'A link',
        'aaaaaaaa-1823-0000-0000-00000000000a');
insert into public.chat_posts (topic_id, author_id, body, link_preview) values
  ('22222222-1823-0000-0000-000000000001', 'aaaaaaaa-1823-0000-0000-00000000000a',
   'Have a look https://example.org/probe1823',
   '{"url": "https://example.org/probe1823", "imagePath": "probe1823-room.jpg"}');

insert into storage.objects (bucket_id, name, metadata) values
  ('link-previews', 'probe1823-conversation.jpg', '{"size": 1}'),
  ('link-previews', 'probe1823-room.jpg',         '{"size": 1}'),
  ('link-previews', 'probe1823-nobody.jpg',       '{"size": 1}'),
  ('link-previews', 'probe1823-second-video.jpg', '{"size": 1}');

-- ======================================================= as somebody in it
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-1823-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 1. a signed-in member, not the superuser (expect authenticated) =='
select current_user;

\echo ''
\echo '== 2. Bo reads the picture of the link Ana sent him (expect probe1823-conversation.jpg) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-conversation.jpg';

\echo ''
\echo '== 3. and the room post''s (expect probe1823-room.jpg) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-room.jpg';

\echo ''
\echo '== 3b. and the second video''s, 20261125100000 (expect probe1823-second-video.jpg) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-second-video.jpg';

reset role;

-- ======================================================== as the outsider
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-1823-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;
set local role authenticated;

\echo ''
\echo '== 4. the outsider lists the bucket: only the room''s picture (expect 1) =='
select count(*) from storage.objects
 where bucket_id = 'link-previews' and name like 'probe1823-%';

\echo ''
\echo '== 5. and cannot read the conversation''s by its name (expect 0 rows) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-conversation.jpg';

\echo ''
\echo '== 5b. nor the conversation''s second video (expect 0 rows) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-second-video.jpg';

\echo ''
\echo '== 6. but reads the room post''s, as Home draws it (expect probe1823-room.jpg) =='
select name from storage.objects
 where bucket_id = 'link-previews' and name = 'probe1823-room.jpg';

reset role;

rollback;
