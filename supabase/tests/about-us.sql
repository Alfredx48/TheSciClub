-- ============================================================================
-- About us: what anybody can see of the team, and nothing more
-- ============================================================================
-- 20261115150000: the public page gets each team member's name, photo, role
-- and injury level and year. Never the city, age, or injury month and day,
-- and (20261120130000) never the last name or the username;
-- nobody who is not on the team; and only the team's photos without an
-- account.
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/about-us.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city,
                            injury_date, injury_date_precision, photo_path) values
  ('aaaaaaaa-1115-0000-0000-00000000000a', 'mentor', 'active', 'Al Probename', '19991115100', '1980-02-03', 'C5–C8', 'CA', 'Probeville',
   '2011-07-19', 'day', 'aaaaaaaa-1115-0000-0000-00000000000a/profile.webp'),
  ('aaaaaaaa-1115-0000-0000-00000000000b', 'peer', 'active', 'Bea (not team)', '19991115101', '1981-01-01', 'C5–C8', 'CA', 'Elsewhere',
   null, null, 'aaaaaaaa-1115-0000-0000-00000000000b/profile.webp'),
  ('aaaaaaaa-1115-0000-0000-00000000000c', 'peer', 'suspended', 'Cy (team, suspended)', '19991115102', '1982-01-01', 'C5–C8', 'CA', null,
   null, null, null);

update public.members set username = 'al.probename' where id = 'aaaaaaaa-1115-0000-0000-00000000000a';

insert into private.about_us_team (member_id, position) values
  ('aaaaaaaa-1115-0000-0000-00000000000a', 1),
  ('aaaaaaaa-1115-0000-0000-00000000000c', 2);

set local role anon;

-- Expect: Al only, last name hidden, injury_year 2011.
select t->>'display_name' as name, t->>'last_name_hidden' as last_name_hidden,
       t->>'injury_year' as year, t->>'injury_date_precision' as precision
  from public.about_us_team() t
 where t->>'id' like 'aaaaaaaa-1115-%';

-- Expect: f, f, f, f: nothing carries the city, birth date, the injury's day or the last name.
select string_agg(t::text, ' ') like '%Probeville%' as city_sent,
       string_agg(t::text, ' ') like '%1980%' as birth_sent,
       string_agg(t::text, ' ') like '%07-19%' as injury_day_sent,
       string_agg(t::text, ' ') ilike '%probename%' as last_name_sent
  from public.about_us_team() t;

-- Expect: t, t, f.
select public.about_us_photo_is_public('aaaaaaaa-1115-0000-0000-00000000000a/profile.webp') as team_photo,
       public.about_us_photo_is_public('aaaaaaaa-1115-0000-0000-00000000000a/profile.thumb.webp') as team_thumb,
       public.about_us_photo_is_public('aaaaaaaa-1115-0000-0000-00000000000b/profile.webp') as other_photo;

-- Expect: permission denied.
select count(*) from private.about_us_team;

reset role;
rollback;
