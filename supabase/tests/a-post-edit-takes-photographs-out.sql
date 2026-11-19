-- ============================================================================
-- An edit can take a post's photographs out (20261119150000): its author
-- only, only while nobody else has replied, and the earlier version keeps
-- them. Run as signed-in roles, under RLS.
-- ============================================================================
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/a-post-edit-takes-photographs-out.sql
--
-- It rolls back and is safe to re-run. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

begin;

-- ------------------------------------------------------------------- set-up
insert into public.members
  (id, type, status, display_name, phone, birth_date, level_range, state, show_in_browse, is_admin)
values
  ('aaaaaaaa-8899-0000-0000-000000000001', 'peer', 'active', 'Author A', '19990089001', '1980-01-01', 'T1–T6', 'CA', true, false),
  ('bbbbbbbb-8899-0000-0000-000000000002', 'peer', 'active', 'Other O',  '19990089002', '1981-01-01', 'C5–C8', 'CA', true, false);

update public.chat_rooms set opened_at = now() where id = 'bowel';

insert into public.chat_topics (id, room_id, author_id, title, created_at)
values ('33333333-8899-0000-0000-000000000001', 'bowel', 'aaaaaaaa-8899-0000-0000-000000000001',
        'Photographs out', now() - interval '2 minutes');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('chat', 'rooms/bowel/one.webp',   'aaaaaaaa-8899-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/bowel/two.webp',   'aaaaaaaa-8899-0000-0000-000000000001', '{"size": 1}'),
  ('chat', 'rooms/bowel/three.webp', 'aaaaaaaa-8899-0000-0000-000000000001', '{"size": 1}');
-- The opening post, by Other, then Author's reply with two photographs.
insert into public.chat_posts (id, topic_id, author_id, body, attachments, created_at) values
  ('44444444-8899-0000-0000-000000000001', '33333333-8899-0000-0000-000000000001',
   'bbbbbbbb-8899-0000-0000-000000000002', 'Photographs out', '{}', now() - interval '2 minutes'),
  ('44444444-8899-0000-0000-000000000002', '33333333-8899-0000-0000-000000000001',
   'aaaaaaaa-8899-0000-0000-000000000001', 'Two pictures.',
   '{rooms/bowel/one.webp,rooms/bowel/two.webp}', now() - interval '1 minute');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-8899-0000-0000-000000000001","role":"authenticated"}';

\set QUIET off
\echo ''
\echo '== 0. we are a signed-in ordinary member, not the superuser =='
\echo '   expect: authenticated | aaaaaaaa-8899-... | f'
select current_user, auth.uid()::text as uid, public.is_admin() as admin;

\echo ''
\echo '== 1. the author takes a photograph out of their reply and adds one =='
\echo '   expect: {rooms/bowel/two.webp,rooms/bowel/three.webp}, edited; the'
\echo '   earlier version keeps one and two.'
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.',
  '{rooms/bowel/two.webp}', '{rooms/bowel/three.webp}');
select attachments, edited_at is not null as edited
  from public.chat_posts where id = '44444444-8899-0000-0000-000000000002';
set local role postgres;
select attachments as kept_in_the_earlier_version
  from public.chat_edits where post_id = '44444444-8899-0000-0000-000000000002';
set local role authenticated;

\echo ''
\echo '== 2. kept must be photographs the post has, in its order =='
\echo '   expect: ERROR, Those photographs are not on this post, three times.'
savepoint not_on_it;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.', '{rooms/bowel/one.webp}', '{}');
rollback to savepoint not_on_it;
savepoint out_of_order;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.',
  '{rooms/bowel/three.webp,rooms/bowel/two.webp}', '{}');
rollback to savepoint out_of_order;
savepoint twice;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.',
  '{rooms/bowel/two.webp,rooms/bowel/two.webp}', '{}');
rollback to savepoint twice;

\echo ''
\echo '== 3. somebody else cannot take them out =='
\echo '   expect: ERROR, You can only edit your own post.'
set local request.jwt.claims = '{"sub":"bbbbbbbb-8899-0000-0000-000000000002","role":"authenticated"}';
savepoint not_theirs;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.', '{}', '{}');
rollback to savepoint not_theirs;

\echo ''
\echo '== 4. once somebody else replies, the photographs stay =='
\echo '   expect: ERROR, Someone has replied ... not change what it says; then'
\echo '   keeping both and adding words goes through.'
insert into public.chat_posts (topic_id, author_id, body, reply_to) values
  ('33333333-8899-0000-0000-000000000001', 'bbbbbbbb-8899-0000-0000-000000000002',
   'Nice pictures.', '44444444-8899-0000-0000-000000000002');
set local request.jwt.claims = '{"sub":"aaaaaaaa-8899-0000-0000-000000000001","role":"authenticated"}';
savepoint answered;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures.', '{rooms/bowel/three.webp}', '{}');
rollback to savepoint answered;
select public.chat_edit_post_photographs_kept(
  '44444444-8899-0000-0000-000000000002', 'Two pictures. Thanks!',
  '{rooms/bowel/two.webp,rooms/bowel/three.webp}', '{}');
select body, cardinality(attachments) as photographs
  from public.chat_posts where id = '44444444-8899-0000-0000-000000000002';

rollback;
