-- ============================================================================
-- Who said Going or Interested hears when an event changes
-- ============================================================================
-- 20261120140000: Going hears of the date, time, place, in person / online,
-- the video call link and a cancellation (and 20261120150000: Interested of a
-- cancellation too, and 20261120160000: Interested in the bell only); Interested of the date, time, place
-- and in person / online only. Not whoever changed it, not across a block,
-- not for an event that is over, and not when a joined invitation's copy is
-- deleted after its RSVPs moved.
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/event-changes-told.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin) values
  ('aaaaaaaa-1120-0000-0000-00000000000a', 'peer', 'active', 'Ana (going)',      '19991120100', '1980-01-01', 'C5–C8', 'CA', false),
  ('bbbbbbbb-1120-0000-0000-00000000000b', 'peer', 'active', 'Bo (interested)',  '19991120101', '1981-01-01', 'C5–C8', 'CA', false),
  ('cccccccc-1120-0000-0000-00000000000c', 'peer', 'active', 'Cy (organizer)',   '19991120102', '1982-01-01', 'C5–C8', 'CA', true),
  ('dddddddd-1120-0000-0000-00000000000d', 'peer', 'active', 'Di (blocked Cy)',  '19991120103', '1983-01-01', 'C5–C8', 'CA', false);

insert into public.member_blocks (blocker_id, blocked_id) values
  ('dddddddd-1120-0000-0000-00000000000d', 'cccccccc-1120-0000-0000-00000000000c');

insert into public.events (id, title, host_name, start_time, end_time, event_format, location, city, timezone) values
  ('11201120-0000-0000-0000-000000000001', 'Probe meetup', 'Probe host',
   date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' + interval '7 days 18 hours',
   date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' + interval '7 days 20 hours',
   'in_person', '1 Main St', 'Oakland', 'America/Los_Angeles'),
  ('11201120-0000-0000-0000-000000000002', 'Probe last week', 'Probe host',
   now() - interval '7 days', now() - interval '7 days' + interval '2 hours', 'in_person', '1 Main St', 'Oakland', 'America/Los_Angeles'),
  ('11201120-0000-0000-0000-000000000003', 'Probe joined copy', 'Probe host',
   now() + interval '9 days', null, 'online', '', null, 'America/Los_Angeles'),
  ('11201120-0000-0000-0000-000000000004', 'Probe the one it joined', 'Probe host',
   now() + interval '9 days', null, 'online', '', null, 'America/Los_Angeles');

insert into public.event_rsvps (event_id, member_id, status, created_at) values
  ('11201120-0000-0000-0000-000000000001', 'aaaaaaaa-1120-0000-0000-00000000000a', 'going', now() - interval '1 day'),
  ('11201120-0000-0000-0000-000000000001', 'bbbbbbbb-1120-0000-0000-00000000000b', 'interested', now() - interval '1 day'),
  ('11201120-0000-0000-0000-000000000001', 'cccccccc-1120-0000-0000-00000000000c', 'going', now() - interval '1 day'),
  ('11201120-0000-0000-0000-000000000001', 'dddddddd-1120-0000-0000-00000000000d', 'going', now() - interval '1 day'),
  ('11201120-0000-0000-0000-000000000002', 'aaaaaaaa-1120-0000-0000-00000000000a', 'going', now() - interval '9 days'),
  ('11201120-0000-0000-0000-000000000003', 'aaaaaaaa-1120-0000-0000-00000000000a', 'going', now() - interval '1 day');

create temp view told as
  select m.display_name as who, n.detail, n.count, n.event_id is not null as has_event,
         split_part(n.tag, ':', 1) as tag
    from public.notifications n join public.members m on m.id = n.member_id
   where n.kind = 'event_changed' and n.member_id::text like '%-1120-%'
   order by m.display_name, n.tag;

-- As Cy, who organizes it and is going.
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-1120-0000-0000-00000000000c","role":"authenticated"}', true) is not null as ok;

\echo ''
\echo '== 1. its words changed: nobody is told (expect 0 rows) =='
update public.events set description = 'New words', title = 'Probe meetup!' where id = '11201120-0000-0000-0000-000000000001';
select * from told;

\echo ''
\echo '== 2. an hour later the same day: Ana and Bo, time; not Cy, who changed it, nor Di, who blocked him (expect Ana time, Bo time) =='
update public.events set start_time = start_time + interval '1 hour', end_time = end_time + interval '1 hour'
 where id = '11201120-0000-0000-0000-000000000001';
select * from told;

\echo ''
\echo '== 3. a video call link: Ana only, on the same notice (expect Ana time,link; Bo time) =='
update public.events set meeting_url = 'https://meet.example/x' where id = '11201120-0000-0000-0000-000000000001';
select * from told;

\echo ''
\echo '== 4. now online, and its place cleared, at once: one notice each, the format first, no place; Bo in the bell only (20261120160000) (expect Ana online,time,link event_changed; Bo online,time event_changed_bell) =='
update public.events set event_format = 'online', location = '', city = null where id = '11201120-0000-0000-0000-000000000001';
select * from told;

\echo ''
\echo '== 5. read, then a new day and hour at once: a new notice, one date however many things changed (20261120170000) (expect Ana date,time 1 / Bo date,time 1) =='
update public.notifications set read_at = now() where kind = 'event_changed' and member_id::text like '%-1120-%';
update public.events set start_time = start_time + interval '1 day 1 hour', end_time = end_time + interval '1 day 1 hour'
 where id = '11201120-0000-0000-0000-000000000001';
select t.* from told t where t.detail = 'date,time';

\echo ''
\echo '== 6. an event that is over: nobody (expect 0 rows) =='
update public.notifications set read_at = now() where kind = 'event_changed' and member_id::text like '%-1120-%';
update public.events set location = 'Elsewhere' where id = '11201120-0000-0000-0000-000000000002';
select * from public.notifications where kind = 'event_changed' and member_id::text like '%-1120-%' and read_at is null;

\echo ''
\echo '== 7. cancelled: Ana, who is going, with a push; Bo, interested, in the bell only (20261120150000) (expect Ana event_cancelled, Bo event_cancelled_bell) =='
delete from public.events where id = '11201120-0000-0000-0000-000000000001';
select m.display_name as who, n.detail, split_part(n.tag, ':', 1) as tag
  from public.notifications n join public.members m on m.id = n.member_id
 where n.kind = 'event_changed' and n.detail like 'cancelled:%' and n.member_id::text like '%-1120-%'
 order by 1;

\echo ''
\echo '== 8. ...in her bell, by its title, opening the calendar (expect Probe meetup! | /events) =='
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1120-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
select place, url from public.my_notifications() where kind = 'event_changed' and detail like 'cancelled:%';

\echo ''
\echo '== 9. a joined copy deleted once its RSVPs moved: not cancelled (expect 0 rows) =='
select set_config('request.jwt.claims', '', true) is not null as ok;
insert into public.event_rsvps (event_id, member_id, status)
select '11201120-0000-0000-0000-000000000004', member_id, status
  from public.event_rsvps where event_id = '11201120-0000-0000-0000-000000000003';
delete from public.events where id = '11201120-0000-0000-0000-000000000003';
select t.* from told t where t.detail = 'cancelled:Probe joined copy';

rollback;
