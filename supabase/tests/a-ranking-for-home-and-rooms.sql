-- ============================================================================
-- One order for Home and a room's Top, Home's replies, a capped boost, and
-- the administrators told at -3 (20261118190000, 20261118195000,
-- 20261118220000, 20261118270000)
-- ============================================================================
-- Boost: Adm boosts Old twice, still 10, and Old's score stays 0 since a
-- boost is not in a score (20261118195000); a 20-day-old boost on Seen counts
-- 0; taking Old's back leaves 0.
-- The room, best first, the same for Ann and for Cal whatever each has read
-- or seen (20261118220000): last activity, 4 hours newer a vote (20261118270000;
-- 2 before, which left Moved level with Seen, fourth).
--   Moved  6 hours, 2 votes: two hours ahead
--   Mine   Ann's, 10 minutes
--   Down   1 hour, voted -2: the votes count 0, not less
--   Glance 90 minutes, seen by Ann on Home: nothing for it
--   Seen   2 hours, read by Ann: nothing for it
--   Quiet  4 days
--   Old    5 days
-- Home, Moved's replies: top is Bob's reply with 2 votes, then the latest
-- (Bob's newest), not the first Ann has not read; Cal's at -1 never. Old's,
-- with no votes: the newest, then the other.
-- Three downvotes on Old's opening post: one report, no reporter, raised by
-- votes, and a fourth does not make another. Adm reads it as raised_by_votes.
-- Run against the test project on 2026-11-18:
--   "boost: 10 10 0 0 0; order: Moved,Mine,Down,Glance,Seen,Quiet,Old, cal same;
--    moved: top,latest; old: latest,reply; reports: 1 true true"
--
--   node --env-file=.env.local <runner> supabase/tests/a-ranking-for-home-and-rooms.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  adm constant uuid := 'a5500000-1119-0000-0000-000000000021';
  ann constant uuid := 'a5500000-1119-0000-0000-000000000022';
  cal constant uuid := 'a5500000-1119-0000-0000-000000000023';
  dan constant uuid := 'a5500000-1119-0000-0000-000000000024';
  bob constant uuid := 'a5500000-1119-0000-0000-000000000025';
  t_quiet constant uuid := 'a5500000-1119-0000-0001-000000000001';
  t_down constant uuid := 'a5500000-1119-0000-0001-000000000002';
  t_moved constant uuid := 'a5500000-1119-0000-0001-000000000003';
  t_old constant uuid := 'a5500000-1119-0000-0001-000000000004';
  t_glance constant uuid := 'a5500000-1119-0000-0001-000000000005';
  t_mine constant uuid := 'a5500000-1119-0000-0001-000000000006';
  t_seen constant uuid := 'a5500000-1119-0000-0001-000000000007';
  p_quiet constant uuid := 'a5500000-1119-0000-0002-000000000001';
  p_down constant uuid := 'a5500000-1119-0000-0002-000000000002';
  p_moved constant uuid := 'a5500000-1119-0000-0002-000000000003';
  p_old constant uuid := 'a5500000-1119-0000-0002-000000000004';
  p_glance constant uuid := 'a5500000-1119-0000-0002-000000000005';
  p_mine constant uuid := 'a5500000-1119-0000-0002-000000000006';
  p_seen constant uuid := 'a5500000-1119-0000-0002-000000000007';
  r_top constant uuid := 'a5500000-1119-0000-0003-000000000001';
  r_ann constant uuid := 'a5500000-1119-0000-0003-000000000002';
  r_neg constant uuid := 'a5500000-1119-0000-0003-000000000003';
  r_dan constant uuid := 'a5500000-1119-0000-0003-000000000004';
  r_new constant uuid := 'a5500000-1119-0000-0003-000000000005';
  r_old1 constant uuid := 'a5500000-1119-0000-0003-000000000006';
  r_old2 constant uuid := 'a5500000-1119-0000-0003-000000000007';
  r_misc constant uuid := 'a5500000-1119-0000-0003-000000000008';
  boost text;
  ord text;
  moved text;
  old text;
  reports text;
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin) values
    (adm, 'peer', 'active', 'Adm', '19991119121', '1980-01-01', 'T1–T6', 'CA', true),
    (ann, 'peer', 'active', 'Ann', '19991119122', '1980-01-01', 'T1–T6', 'CA', false),
    (cal, 'peer', 'active', 'Cal', '19991119123', '1980-01-01', 'T1–T6', 'CA', false),
    (dan, 'peer', 'active', 'Dan', '19991119124', '1980-01-01', 'T1–T6', 'CA', false),
    (bob, 'peer', 'active', 'Bob', '19991119125', '1980-01-01', 'T1–T6', 'CA', false);
  insert into public.chat_rooms (id, name, description, category, sort_order, opened_at, show_in_home)
    values ('probe-1119-rank', 'Probe 1119 rank', 'For the probe.', 'Life', 9952, now(), true);
  insert into public.chat_topics (id, room_id, title, author_id, created_at) values
    (t_quiet,  'probe-1119-rank', 'Quiet',  cal, now() - interval '4 days'),
    (t_down,   'probe-1119-rank', 'Down',   bob, now() - interval '1 hour'),
    (t_moved,  'probe-1119-rank', 'Moved',  bob, now() - interval '3 days'),
    (t_old,    'probe-1119-rank', 'Old',    bob, now() - interval '6 days'),
    (t_glance, 'probe-1119-rank', 'Glance', bob, now() - interval '2 hours'),
    (t_mine,   'probe-1119-rank', 'Mine',   ann, now() - interval '10 minutes'),
    (t_seen,   'probe-1119-rank', 'Seen',   bob, now() - interval '2 hours');
  insert into public.chat_posts (id, topic_id, author_id, body, created_at) values
    (p_quiet,  t_quiet,  cal, 'Quiet',  now() - interval '4 days'),
    (p_down,   t_down,   bob, 'Down',   now() - interval '1 hour'),
    (p_moved,  t_moved,  bob, 'Moved',  now() - interval '3 days'),
    (p_old,    t_old,    bob, 'Old',    now() - interval '6 days'),
    (p_glance, t_glance, bob, 'Glance', now() - interval '2 hours'),
    (p_mine,   t_mine,   ann, 'Mine',   now() - interval '10 minutes'),
    (p_seen,   t_seen,   bob, 'Seen',   now() - interval '2 hours'),
    (r_misc,   t_down,   cal, 'A reply', now() - interval '1 hour'),
    (r_top,    t_moved,  bob, 'Top',    now() - interval '70 hours'),
    (r_ann,    t_moved,  ann, 'Ann',    now() - interval '60 hours'),
    (r_neg,    t_moved,  cal, 'Neg',    now() - interval '8 hours'),
    (r_dan,    t_moved,  dan, 'Dan',    now() - interval '7 hours'),
    (r_new,    t_moved,  bob, 'New',    now() - interval '6 hours'),
    (r_old1,   t_old,    cal, 'Old 1',  now() - interval '6 days'),
    (r_old2,   t_old,    dan, 'Old 2',  now() - interval '5 days'),
    (gen_random_uuid(), t_glance, cal, 'A reply', now() - interval '1 hour'),
    (gen_random_uuid(), t_seen,   cal, 'A reply', now() - interval '1 hour'),
    (gen_random_uuid(), t_mine,   cal, 'A reply', now() - interval '10 minutes');
  update public.chat_topics set last_post_at = now() - case id
      when t_quiet then interval '4 days' when t_down then interval '1 hour'
      when t_moved then interval '6 hours' when t_old then interval '5 days'
      when t_glance then interval '90 minutes' when t_mine then interval '10 minutes'
      else interval '2 hours' end
   where room_id = 'probe-1119-rank';
  insert into public.chat_topic_reads (topic_id, member_id, last_read_at) values
    (t_seen, ann, now()), (t_moved, ann, now() - interval '50 hours');
  insert into public.chat_post_views (post_id, member_id) values (p_glance, ann);
  insert into public.chat_post_downvotes (post_id, member_id) values
    (p_down, cal), (p_down, dan), (r_neg, dan);
  insert into public.chat_post_likes (post_id, member_id) values
    (r_top, cal), (r_top, dan), (p_moved, cal), (p_moved, dan);
  -- A boost long over.
  insert into public.chat_post_boosts (post_id, admin_id, boosted_at)
    values (p_seen, adm, now() - interval '20 days');

  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  boost := public.admin_boost_post(p_old) || ' ' || public.admin_boost_post(p_old) || ' '
        || (select s.score from public.chat_post_scores(array[p_old]) s) || ' '
        || (select s.boost from public.chat_post_scores(array[p_seen]) s) || ' '
        || public.admin_boost_post(p_old, false);

  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  select string_agg(r.title, ',') into ord from public.chat_topics_ranked('probe-1119-rank') r;
  perform set_config('request.jwt.claims', json_build_object('sub', cal, 'role', 'authenticated')::text, true);
  ord := ord || ', cal ' || case when ord = (select string_agg(r.title, ',')
    from public.chat_topics_ranked('probe-1119-rank') r) then 'same' else 'differs' end;
  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  select string_agg(x->>'kind', ',') into moved
    from public.home_topics_ranked(100) h, jsonb_array_elements(h.previews) x
   where h.topic_id = t_moved and (x->>'id')::uuid in (r_top, r_new);
  select string_agg(x->>'kind' || ':' || (x->>'id'), ',') into old
    from public.home_topics_ranked(100) h, jsonb_array_elements(h.previews) x
   where h.topic_id = t_moved;
  if old <> 'top:' || r_top || ',latest:' || r_new then
    raise exception 'RESULT moved previews wrong: %', old;
  end if;
  select string_agg(x->>'kind', ',') into old
    from public.home_topics_ranked(100) h, jsonb_array_elements(h.previews) x
   where h.topic_id = t_old;

  -- Down to -3, then -4.
  perform set_config('role', 'postgres', true);
  insert into public.chat_post_downvotes (post_id, member_id) values (p_old, cal), (p_old, dan), (p_old, ann);
  insert into public.chat_post_downvotes (post_id, member_id) values (p_old, bob);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) || ' ' || bool_and(r.reporter_id is null) || ' ' || bool_and(r.raised_by_votes)
    into reports
    from public.admin_chat_reports() r where r.post_id = p_old;

  raise exception 'RESULT boost: %; order: %; moved: %; old: %; reports: %',
    boost, ord, moved, old, reports;
end;
$$;
