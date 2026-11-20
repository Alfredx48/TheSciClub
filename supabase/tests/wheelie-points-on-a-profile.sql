-- ============================================================================
-- What a profile shows of somebody's Wheelie points (20261121050000)
-- ============================================================================
-- Ana asks a question in an open room; Cy upvotes it and reacts to it, and
-- Ben answers it. Ana also asks one in a room nobody can read yet, and one
-- anonymously. Ana has blocked Dee. Ana was active yesterday and today.
--
-- Ben, looking at Ana's profile, sees all her points counted, the question in
-- the open room listed with what it earned, and neither the one in the closed
-- room nor the anonymous one. Dee sees nothing; nor does somebody signed out.
--
-- Expected:
--   "ben sees: total 91 | first_question 1/50, question 2/20, response 2/6,
--    streak 1/5, upvote 1/10 | streak 2 | Probe open: 60 own, 1 up, 2 resp = 76
--    | dee sees: null | signed out: refused"
-- (profile parts left out; the closed room's question counts in question 2/20
-- but is not listed, and the anonymous one is neither.)
-- Run against the test project on 2026-11-20: as expected.
--
--   node --env-file=.env.local <runner> supabase/tests/wheelie-points-on-a-profile.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  ana constant uuid := 'a1ee0000-1121-0000-0000-000000000001';
  ben constant uuid := 'a1ee0000-1121-0000-0000-000000000002';
  cy  constant uuid := 'a1ee0000-1121-0000-0000-000000000003';
  dee constant uuid := 'a1ee0000-1121-0000-0000-000000000004';
  open_q constant uuid := 'a1ee0000-1121-0000-0000-0000000000a1';
  closed_q constant uuid := 'a1ee0000-1121-0000-0000-0000000000a2';
  hidden_q constant uuid := 'a1ee0000-1121-0000-0000-0000000000a3';
  asked constant uuid := 'a1ee0000-1121-0000-0000-0000000000b1';
  today date := (now() at time zone 'America/Los_Angeles')::date;
  seen jsonb;
  result text;
  signed_out text;
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state) values
    (ana, 'peer', 'active', 'Ana', '19991121001', '1980-01-01', 'T1–T6', null),
    (ben, 'peer', 'active', 'Ben', '19991121002', '1980-01-01', 'T1–T6', null),
    (cy,  'peer', 'active', 'Cy',  '19991121003', '1980-01-01', 'T1–T6', null),
    (dee, 'peer', 'active', 'Dee', '19991121004', '1980-01-01', 'T1–T6', null);
  insert into public.member_blocks (blocker_id, blocked_id) values (ana, dee);

  insert into public.chat_rooms (id, name, description, category, sort_order, opened_at)
  select 'probe-closed', 'Probe closed', 'Probe', r.category, 999, null
    from public.chat_rooms r where r.id = 'bowel';

  insert into public.chat_topics (id, room_id, author_id, title, is_question, created_at) values
    (open_q, 'bowel', ana, 'Probe open', true, now() - interval '2 hours'),
    (closed_q, 'probe-closed', ana, 'Probe closed', true, now() - interval '1 hour');
  insert into public.chat_posts (id, topic_id, author_id, body, created_at) values
    (asked, open_q, ana, 'Probe open', now() - interval '2 hours');
  insert into public.chat_posts (topic_id, author_id, body, created_at) values
    (open_q, ben, 'Probe answer', now() - interval '90 minutes'),
    (closed_q, ana, 'Probe closed', now() - interval '1 hour');
  insert into public.chat_post_likes (post_id, member_id) values (asked, cy);
  insert into public.chat_post_reactions (target_id, member_id, emoji, topic_id)
    values (asked, cy, '👍', open_q);

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  insert into public.chat_topics (id, room_id, author_id, title, is_question, anonymous)
    values (hidden_q, 'bowel', null, 'Probe anonymous', true, true);
  insert into public.chat_posts (topic_id, author_id, body, anonymous)
    values (hidden_q, null, 'Probe anonymous', true);

  insert into private.member_active_days (member_id, day) values (ana, today - 1), (ana, today);

  -- Ben looks.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  seen := public.member_wheelie_points(ana);
  select 'ben sees: total ' || (seen ->> 'total') || ' | '
         || (select string_agg(k.key || ' ' || (k.value ->> 'count') || '/' || (k.value ->> 'points'), ', ' order by k.key)
               from jsonb_each(seen -> 'kinds') k where k.key <> 'profile')
         || ' | streak ' || (seen ->> 'streak') || ' | '
         || coalesce((select string_agg(
                (p ->> 'title') || ': ' || (p ->> 'own') || ' own, ' || (p ->> 'upvotes') || ' up, '
                || (p ->> 'responses') || ' resp = ' || (p ->> 'points'), '; ')
              from jsonb_array_elements(seen -> 'posts') p), 'nothing listed')
    into result;

  -- Dee, blocked, looks.
  perform set_config('request.jwt.claims', json_build_object('sub', dee, 'role', 'authenticated')::text, true);
  result := result || ' | dee sees: ' || coalesce(public.member_wheelie_points(ana)::text, 'null');

  -- Nobody signed in.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.member_wheelie_points(ana);
    signed_out := 'allowed';
  exception when insufficient_privilege then
    signed_out := 'refused';
  end;

  raise exception 'RESULT % | signed out: %', result, signed_out;
end;
$$;
