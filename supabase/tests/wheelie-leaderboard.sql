-- ============================================================================
-- The monthly leaderboard and the Hall of Top Wheelies (20261121060000)
-- ============================================================================
-- Months are Pacific. Ana asks a question at 21:00 on November 30, Pacific,
-- which is already December 1 in UTC: it counts for November. Ben asks one
-- at 23:00 on October 31, Pacific (November 1 in UTC): it counts for October.
--
-- The hall records last month once, from November 2026: at 23:30 on November
-- 30, Pacific, last month is October and nothing is recorded; at 00:30 on
-- December 1 it is November, and a second run records nothing more.
--
-- Dee asks a question now and gets forty upvotes; Ana has blocked Dee. Ben
-- sees Dee on the leaderboard at the rank Dee sees for themselves; Ana does
-- not see Dee at all.
--
-- Expected:
--   "november: ana 60, ben none | before the month ends: 0 | after: some,
--    again: 0 | dee's rank: own N, to ben N, to ana hidden"
-- Run against the test project on 2026-11-20: as expected.
--
--   node --env-file=.env.local <runner> supabase/tests/wheelie-leaderboard.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  ana constant uuid := 'a1ee0000-1122-0000-0000-000000000001';
  ben constant uuid := 'a1ee0000-1122-0000-0000-000000000002';
  dee constant uuid := 'a1ee0000-1122-0000-0000-000000000004';
  ana_q constant uuid := 'a1ee0000-1122-0000-0000-0000000000a1';
  ben_q constant uuid := 'a1ee0000-1122-0000-0000-0000000000a2';
  dee_q constant uuid := 'a1ee0000-1122-0000-0000-0000000000a4';
  dee_post constant uuid := 'a1ee0000-1122-0000-0000-0000000000b4';
  november text;
  before_end integer;
  after_end integer;
  again integer;
  own_rank text;
  ben_sees text;
  ana_sees text;
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state) values
    (ana, 'peer', 'active', 'Ana', '19991122001', '1980-01-01', 'T1–T6', null),
    (ben, 'peer', 'active', 'Ben', '19991122002', '1980-01-01', 'T1–T6', null),
    (dee, 'peer', 'active', 'Dee', '19991122004', '1980-01-01', 'T1–T6', null);
  insert into public.member_blocks (blocker_id, blocked_id) values (ana, dee);

  insert into public.chat_topics (id, room_id, author_id, title, is_question, created_at) values
    (ana_q, 'bowel', ana, 'Probe late November', true, timestamptz '2026-12-01 05:00:00+00'),
    (ben_q, 'bowel', ben, 'Probe late October', true, timestamptz '2026-11-01 06:00:00+00'),
    (dee_q, 'bowel', dee, 'Probe now', true, now());
  insert into public.chat_posts (topic_id, author_id, body, created_at) values
    (ana_q, ana, 'Probe', timestamptz '2026-12-01 05:00:00+00'),
    (ben_q, ben, 'Probe', timestamptz '2026-11-01 06:00:00+00');
  insert into public.chat_posts (id, topic_id, author_id, body) values (dee_post, dee_q, dee, 'Probe');
  insert into public.chat_post_likes (post_id, member_id)
  select dee_post, m.id from public.members m
   where m.id not in (ana, ben, dee) and m.type <> 'organization'
   limit 40;

  select 'ana ' || coalesce((select p.points::text from private.wheelie_month_points('2026-11-01') p where p.member_id = ana), 'none')
         || ', ben ' || coalesce((select p.points::text from private.wheelie_month_points('2026-11-01') p where p.member_id = ben), 'none')
    into november;

  before_end := private.record_wheelie_winners(timestamptz '2026-12-01 07:30:00+00');
  after_end := private.record_wheelie_winners(timestamptz '2026-12-01 08:30:00+00');
  again := private.record_wheelie_winners(timestamptz '2026-12-01 09:30:00+00');

  perform private.refresh_wheelies();

  perform set_config('request.jwt.claims', json_build_object('sub', dee, 'role', 'authenticated')::text, true);
  own_rank := public.wheelie_leaderboard() #>> '{me,rank}';

  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  select coalesce((select e ->> 'rank' from jsonb_array_elements(public.wheelie_leaderboard() -> 'top') e
                    where (e ->> 'member_id')::uuid = dee), 'hidden')
    into ben_sees;

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select coalesce((select e ->> 'rank' from jsonb_array_elements(public.wheelie_leaderboard() -> 'top') e
                    where (e ->> 'member_id')::uuid = dee), 'hidden')
    into ana_sees;

  raise exception 'RESULT november: % | before the month ends: % | after: %, again: % | dee''s rank: own %, to ben %, to ana %',
    november, before_end, case when after_end > 0 then 'some' else '0' end, again, own_rank, ben_sees, ana_sees;
end;
$$;
