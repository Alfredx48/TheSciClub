-- ============================================================================
-- A change to one date of a repeating invitation is copied (20261118250000)
-- ============================================================================
-- The owner, 2026-11-18: one date of "The SCI Club Weekly" was moved in
-- Google Calendar, and the club answered that it could not copy it.
--
-- Expect, in the one row it answers:
--   steps: added, updated, ignored (older), cancelled, updated, updated,
--          ignored (could not be verified)
--   third_kept_id: true, third: not in the series, moved, "Moved words", 1 going
--   series_dates: days 21 and 28 only (0, 7 and 14 are held apart), "New words"
--   first: not in the series, an hour later, still "Old words"
--   opener_is_series: true (the invitation keeps a date still in the series)
--   split_opener_next: true (a moved date's invitation goes to the next date,
--          not an earlier one of the series; 20261119110000)
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/calendar-invite-one-date.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0d0d-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'onedate-owner@probe.example');
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('aaaaaaaa-0d0d-0000-0000-00000000000a', 'peer', 'active', 'Owner', '19990000d41', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', false),
  ('bbbbbbbb-0d0d-0000-0000-00000000000b', 'peer', 'active', 'Going', '19990000d42', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', false);
insert into public.organizations (id, short_code, name, city) values
  ('dddddddd-0d0d-0000-0000-00000000000d', 'PROD', 'Probe One Date Org', 'Sacramento');
insert into public.organization_representatives (organization_id, member_id) values
  ('dddddddd-0d0d-0000-0000-00000000000d', 'aaaaaaaa-0d0d-0000-0000-00000000000a');

create temporary table pt as
select date_trunc('hour', now() + interval '2 days') as t1,
       public.event_series_step('week', 1, date_trunc('hour', now() + interval '2 days'), 1) as t2,
       public.event_series_step('week', 1, date_trunc('hour', now() + interval '2 days'), 2) as t3;
create temporary table pp as
select jsonb_build_object(
  'uid', 'probe-one-date@google.com',
  'sequence', 0, 'method', 'REQUEST', 'cancelled', false, 'recurrenceId', null,
  'title', 'Probe Weekly', 'description', 'Old words',
  'location', '', 'url', 'https://meet.google.com/abc-defg-hij', 'format', 'online',
  'city', null, 'state', null,
  'starts', to_jsonb(t1), 'ends', to_jsonb(t1 + interval '1 hour'),
  'allDay', false, 'timezone', 'America/Los_Angeles',
  'repeat', jsonb_build_object('unit', 'week', 'every', 1, 'endsOn', null, 'endsAfter', null),
  'repeatNote', null) as base
from pt;
create temporary table pr (step text, r jsonb);
grant select on pt, pp to service_role;
grant insert, select on pr to service_role;

set local role service_role;
-- 1. The weekly invitation.
insert into pr select '1 add', public.calendar_invite_receive('onedate-owner@probe.example', true, null, base) from pp;
reset role;
-- Somebody is going to the third date.
insert into public.event_rsvps (event_id, member_id, status)
select e.id, 'bbbbbbbb-0d0d-0000-0000-00000000000b', 'going'
  from public.events e join public.calendar_invites i on i.uid = 'probe-one-date@google.com'
  join public.events o on o.id = i.event_id
 where e.series_id = o.series_id and e.start_time = (select t3 from pt);
create temporary table third as
select e.id from public.events e join public.event_rsvps r on r.event_id = e.id
 where r.member_id = 'bbbbbbbb-0d0d-0000-0000-00000000000b';
grant select on third to service_role;

set local role service_role;
-- 2. The third date moved a day and two hours later, with its own words.
insert into pr select '2 move third', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('sequence', 1, 'repeat', null, 'recurrenceId', to_jsonb(t3),
    'starts', to_jsonb(t3 + interval '26 hours'), 'ends', to_jsonb(t3 + interval '27 hours'),
    'description', 'Moved words')) from pp, pt;
-- 3. A late, older copy of that change.
insert into pr select '3 older', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('sequence', 0, 'repeat', null, 'recurrenceId', to_jsonb(t3),
    'starts', to_jsonb(t3), 'ends', to_jsonb(t3 + interval '1 hour'))) from pp, pt;
-- 4. The second date cancelled.
insert into pr select '4 cancel second', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('sequence', 2, 'repeat', null, 'cancelled', true, 'recurrenceId', to_jsonb(t2),
    'starts', to_jsonb(t2), 'ends', to_jsonb(t2 + interval '1 hour'))) from pp, pt;
-- 5. The first date moved too: the invitation now keeps a later date.
insert into pr select '5 move first', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('sequence', 3, 'repeat', null, 'recurrenceId', to_jsonb(t1),
    'starts', to_jsonb(t1 + interval '1 hour'), 'ends', to_jsonb(t1 + interval '2 hours'))) from pp, pt;
-- 6. The whole series changed: new words.
insert into pr select '6 series', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('sequence', 4, 'description', 'New words')) from pp;
-- 7. Not verified.
insert into pr select '7 unverified', public.calendar_invite_receive('onedate-owner@probe.example', false, null,
  base || jsonb_build_object('sequence', 5, 'repeat', null, 'recurrenceId', to_jsonb(t3),
    'starts', to_jsonb(t3), 'ends', to_jsonb(t3 + interval '1 hour'))) from pp, pt;
reset role;

-- 8. A later part of a split series opens on a date after others of its
-- series (20261119110000). Its own date moved, it keeps the next date, not
-- the earlier one.
set local role service_role;
insert into pr select '8 split add', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('uid', 'probe-split@google.com')) from pp;
reset role;
update public.calendar_invites i set event_id = e.id
  from public.events o, public.events e, pt
 where i.uid = 'probe-split@google.com' and o.id = i.event_id
   and e.series_id = o.series_id and e.start_time = pt.t2;
set local role service_role;
insert into pr select '8 split move', public.calendar_invite_receive('onedate-owner@probe.example', true, null,
  base || jsonb_build_object('uid', 'probe-split@google.com', 'sequence', 1, 'repeat', null,
    'recurrenceId', to_jsonb(t2), 'starts', to_jsonb(t2 + interval '1 hour'),
    'ends', to_jsonb(t2 + interval '2 hours'))) from pp, pt;
reset role;

select jsonb_build_object(
  'steps', (select jsonb_agg(jsonb_build_object('step', step, 'outcome', r ->> 'outcome', 'reason', r ->> 'reason') order by step) from pr),
  'third_kept_id', (select (r ->> 'event')::uuid = (select id from third) from pr where step = '2 move third'),
  'third', (select jsonb_build_object('series', e.series_id is not null, 'moved', e.start_time = t3 + interval '26 hours',
              'words', e.description, 'going', (select count(*) from public.event_rsvps r where r.event_id = e.id))
              from public.events e, pt where e.id = (select id from third)),
  'series_dates', (select jsonb_agg(jsonb_build_object('day', (e.start_time at time zone 'America/Los_Angeles')::date - (t1 at time zone 'America/Los_Angeles')::date, 'words', e.description) order by e.start_time)
              from public.events e, pt
             where e.series_id = (select o.series_id from public.events o join public.calendar_invites i on i.event_id = o.id
                                    where i.uid = 'probe-one-date@google.com')
               and e.start_time < t3 + interval '15 days'),
  'opener_is_series', (select o.series_id is not null from public.events o join public.calendar_invites i on i.event_id = o.id
                        where i.uid = 'probe-one-date@google.com'),
  'first', (select jsonb_build_object('series', e.series_id is not null, 'words', e.description, 'hour_later', e.start_time = t1 + interval '1 hour')
              from public.events e, pt where e.id = (select (r ->> 'event')::uuid from pr where step = '5 move first')),
  'split_opener_next', (select e.start_time = pt.t3 from public.calendar_invites i
                          join public.events e on e.id = i.event_id, pt
                         where i.uid = 'probe-split@google.com'),
  'held', (select jsonb_agg(jsonb_build_object('has_event', h.event_id is not null, 'seq', h.sequence) order by h.original_start)
             from private.calendar_held_dates h)
) as result;

rollback;
