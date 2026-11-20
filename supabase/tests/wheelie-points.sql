-- ============================================================================
-- Who earns which Wheelie points (20261121030000)
-- ============================================================================
-- Ana asks a question. Cy upvotes it and Ana upvotes it herself; Ben answers,
-- Ana follows up, Cy reacts to Ben's answer. Ben's second answer is removed
-- after Cy upvoted it, and Ben asks a question anonymously. Ana said Going to
-- an event that ended without checking in; Ben said Going and checked in, and
-- reviewed it; Cy reviewed it anonymously and is Going to one still to come.
-- Ana was active three days in a row, missed one, and came back.
--
-- Expected, kind by kind (profile parts aside):
--   ana: first_question 50, question 10, reply 5, response 3, streak 10, upvote 10
--   ben: check_in 100, reply 5, response 3, review 100, rsvp 30
--   cy:  rsvp 30
-- Run against the test project on 2026-11-20:
--   "ana: first_question 50, question 10, reply 5, response 3, streak 10, upvote 10 |
--    ben: check_in 100, reply 5, response 3, review 100, rsvp 30 | cy: rsvp 30"
--
--   node --env-file=.env.local <runner> supabase/tests/wheelie-points.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  ana constant uuid := 'a1ee0000-1120-0000-0000-000000000001';
  ben constant uuid := 'a1ee0000-1120-0000-0000-000000000002';
  cy  constant uuid := 'a1ee0000-1120-0000-0000-000000000003';
  question constant uuid := 'a1ee0000-1120-0000-0000-0000000000a1';
  asked constant uuid := 'a1ee0000-1120-0000-0000-0000000000b1';
  answer constant uuid := 'a1ee0000-1120-0000-0000-0000000000b2';
  followup constant uuid := 'a1ee0000-1120-0000-0000-0000000000b3';
  removed constant uuid := 'a1ee0000-1120-0000-0000-0000000000b4';
  hidden constant uuid := 'a1ee0000-1120-0000-0000-0000000000a2';
  ended constant uuid := 'a1ee0000-1120-0000-0000-0000000000e1';
  coming constant uuid := 'a1ee0000-1120-0000-0000-0000000000e2';
  today date := (now() at time zone 'America/Los_Angeles')::date;
  result text;
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state) values
    (ana, 'peer', 'active', 'Ana', '19991120001', '1980-01-01', 'T1–T6', null),
    (ben, 'peer', 'active', 'Ben', '19991120002', '1980-01-01', 'T1–T6', null),
    (cy,  'peer', 'active', 'Cy',  '19991120003', '1980-01-01', 'T1–T6', null);

  insert into public.chat_topics (id, room_id, author_id, title, is_question, created_at)
    values (question, 'bowel', ana, 'Probe question', true, now() - interval '1 hour');
  insert into public.chat_posts (id, topic_id, author_id, body, created_at) values
    (asked,    question, ana, 'Probe question', now() - interval '60 minutes'),
    (answer,   question, ben, 'Probe answer',   now() - interval '50 minutes'),
    (followup, question, ana, 'Probe thanks',   now() - interval '40 minutes'),
    (removed,  question, ben, 'Probe removed',  now() - interval '30 minutes');
  insert into public.chat_post_likes (post_id, member_id) values
    (asked, cy), (asked, ana), (removed, cy);
  insert into public.chat_post_reactions (target_id, member_id, emoji, topic_id)
    values (answer, cy, '👍', question);
  update public.chat_posts set removed_at = now(), body = '' where id = removed;

  -- Ben's anonymous question: no author on the row, recorded as his.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  insert into public.chat_topics (id, room_id, author_id, title, is_question, anonymous)
    values (hidden, 'bowel', null, 'Probe anonymous', true, true);
  insert into public.chat_posts (topic_id, author_id, body, anonymous)
    values (hidden, null, 'Probe anonymous', true);
  perform set_config('request.jwt.claims', '', true);

  insert into public.events (id, title, host_name, start_time, end_time) values
    (ended, 'Ended probe', 'Probe host', now() - interval '4 days', now() - interval '4 days' + interval '2 hours'),
    (coming, 'Coming probe', 'Probe host', now() + interval '3 days', null);
  insert into public.event_rsvps (event_id, member_id, status) values
    (ended, ana, 'going'), (ended, ben, 'going'), (coming, cy, 'going');
  insert into public.event_check_ins (event_id, member_id) values (ended, ben);
  insert into public.reviews (event_id, author_id, anonymous, rating, body) values
    (ended, ben, false, 5, 'Probe review'),
    (ended, cy, true, 4, 'Probe anonymous review');

  insert into private.member_active_days (member_id, day) values
    (ana, today - 4), (ana, today - 3), (ana, today - 2), (ana, today);

  select string_agg(who || ': ' || kinds, ' | ' order by who) into result
    from (
      select case l.member_id when ana then 'ana' when ben then 'ben' else 'cy' end as who,
             string_agg(l.kind || ' ' || l.total, ', ' order by l.kind) as kinds
        from (
          select w.member_id, w.kind, sum(w.points) as total
            from private.wheelie_ledger() w
           where w.member_id in (ana, ben, cy) and w.kind <> 'profile'
           group by w.member_id, w.kind
        ) l
       group by l.member_id
    ) x;

  raise exception 'RESULT %', result;
end;
$$;
