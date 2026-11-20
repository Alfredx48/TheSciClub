-- ============================================================================
-- An event has a ZIP code (20261121040000)
-- ============================================================================
-- set_event_postal_code: who may, five digits or ZIP+4, a date of a series and
-- every later one, the template, a date the series makes later, and clearing.
--
--   docker exec -i supabase_db_thesciclub psql -U postgres -d postgres \
--     < supabase/tests/event-zip-code.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state)
values
  ('aaaaaaaa-21f0-0000-0000-00000000000a', 'peer', 'active', 'Org Rep',  '19990002f00', '1980-01-01', 'C5–C8', 'CA'),
  ('bbbbbbbb-21f0-0000-0000-00000000000b', 'peer', 'active', 'Ordinary', '19990002f01', '1981-01-01', 'C5–C8', 'CA');

insert into public.organizations (id, short_code, name, city, state)
values ('11111111-21f0-0000-0000-000000000001', 'PRZP', 'Probe ZIP', 'Oakland', 'CA');
insert into public.organization_representatives (organization_id, member_id)
values ('11111111-21f0-0000-0000-000000000001', 'aaaaaaaa-21f0-0000-0000-00000000000a');

insert into public.event_series (id, series_key, title, repeat_unit, repeat_every, first_start, template)
values ('55555555-21f0-0000-0000-000000000005', 'probe-zip-series', 'Probe weekly',
        'week', 1, now() + interval '7 days', '{"title": "Probe weekly"}'::jsonb);

insert into public.events (id, title, start_time, organization_id, event_format, location, series_id)
values
  ('eeeeeeee-21f0-0000-0000-000000000001', 'Probe weekly', now() + interval '7 days',
   '11111111-21f0-0000-0000-000000000001', 'in_person', '1 Main St', '55555555-21f0-0000-0000-000000000005'),
  ('eeeeeeee-21f0-0000-0000-000000000002', 'Probe weekly', now() + interval '14 days',
   '11111111-21f0-0000-0000-000000000001', 'in_person', '1 Main St', '55555555-21f0-0000-0000-000000000005'),
  ('eeeeeeee-21f0-0000-0000-000000000003', 'Probe weekly', now() + interval '21 days',
   '11111111-21f0-0000-0000-000000000001', 'in_person', '1 Main St', '55555555-21f0-0000-0000-000000000005');

\echo ''
\echo '== 1. an ordinary member (expect ERROR: You cannot change this event.) =='
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-21f0-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint ordinary;
select public.set_event_postal_code('eeeeeeee-21f0-0000-0000-000000000002', '94404');
rollback to savepoint ordinary;
reset role;

\echo ''
\echo '== 2. the rep, not a ZIP code (expect ERROR: A ZIP code is five digits, like 94404.) =='
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-21f0-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
savepoint not_zip;
select public.set_event_postal_code('eeeeeeee-21f0-0000-0000-000000000002', '9440');
rollback to savepoint not_zip;

\echo ''
\echo '== 3. the rep sets it on the second date (expect dates 1 none, 2 and 3 94404-1234; template the same) =='
select public.set_event_postal_code('eeeeeeee-21f0-0000-0000-000000000002', ' 94404-1234 ');
reset role;
select right(id::text, 1) as date, postal_code from public.events
 where series_id = '55555555-21f0-0000-0000-000000000005' order by start_time;
select template ->> 'postal_code' as template from public.event_series
 where id = '55555555-21f0-0000-0000-000000000005';

\echo ''
\echo '== 4. a date the series makes later (expect 94404-1234) =='
insert into public.events (id, title, start_time, organization_id, event_format, location, series_id)
values ('eeeeeeee-21f0-0000-0000-000000000004', 'Probe weekly', now() + interval '28 days',
        '11111111-21f0-0000-0000-000000000001', 'in_person', '1 Main St', '55555555-21f0-0000-0000-000000000005');
select postal_code from public.events where id = 'eeeeeeee-21f0-0000-0000-000000000004';

\echo ''
\echo '== 5. members read it (expect 94404-1234) =='
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-21f0-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select postal_code from public.events where id = 'eeeeeeee-21f0-0000-0000-000000000003';
reset role;

\echo ''
\echo '== 6. the rep clears it from the third date (expect 2 94404-1234, 3 and 4 none) =='
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-21f0-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select public.set_event_postal_code('eeeeeeee-21f0-0000-0000-000000000003', '');
reset role;
select right(id::text, 1) as date, postal_code from public.events
 where series_id = '55555555-21f0-0000-0000-000000000005' and id <> 'eeeeeeee-21f0-0000-0000-000000000001'
 order by start_time;

rollback;
