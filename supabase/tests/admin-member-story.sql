-- ============================================================================
-- A member's story is for the club's administrators only (20261118150000)
-- ============================================================================
-- Adm, an administrator, reads how Ivy came: invited by Men, a member, with
-- a message, and seen on two days. Men, a mentor, and Ivy herself are
-- refused: devices, sign-ins and days active are an administrator's alone.
-- So is a member's address for an administrator's own email
-- (admin_member_email, 20261121010000): Men is refused it, as is Ivy her own.
-- Run against the test project on 2026-11-18:
--   "adm: member/Men/See you Saturday/2 days; men: refused; ivy: refused",
--   and on 2026-11-20 "...; email adm: allowed, men: refused, ivy: refused".
--
--   node --env-file=.env.local <runner> supabase/tests/admin-member-story.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  adm constant uuid := 'a5500000-1118-0000-0000-000000000011';
  men constant uuid := 'a5500000-1118-0000-0000-000000000012';
  ivy constant uuid := 'a5500000-1118-0000-0000-000000000013';
  invite uuid;
  story jsonb;
  read_adm text;
  read_men text := 'allowed';
  read_ivy text := 'allowed';
  email_adm text := 'refused';
  email_men text := 'allowed';
  email_ivy text := 'allowed';
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, is_admin) values
    (adm, 'peer',   'active', 'Adm', '19991118111', '1980-01-01', 'T1–T6', 'CA', true),
    (men, 'mentor', 'active', 'Men', '19991118112', '1980-01-01', 'T1–T6', 'CA', false),
    (ivy, 'peer',   'active', 'Ivy', '19991118113', '1980-01-01', 'T1–T6', 'CA', false);
  insert into public.invites (email, status, invited_by_member_id, message)
    values ('ivy1118@probe.test', 'consumed', men, 'See you Saturday')
    returning id into invite;
  update public.members set invite_id = invite where id = ivy;
  insert into public.member_device_checks (member_id, seen_at, surface, browser, os, notifications) values
    (ivy, now() - interval '3 days', 'browser', 'Safari', 'iOS', null),
    (ivy, now(), 'home_screen', 'Safari', 'iOS', 'allowed');

  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  story := public.admin_member_story(ivy);
  begin
    perform public.admin_member_email(ivy);
    email_adm := 'allowed';
  exception when others then null;
  end;
  read_adm := (story -> 'came' ->> 'way') || '/' || (story -> 'came' -> 'by' ->> 'name') || '/'
           || (story -> 'came' ->> 'message') || '/' || (story ->> 'activeDays') || ' days';

  perform set_config('request.jwt.claims', json_build_object('sub', men, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_member_story(ivy);
  exception when others then read_men := 'refused';
  end;
  begin
    perform public.admin_member_email(ivy);
  exception when others then email_men := 'refused';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', ivy, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_member_story(ivy);
  exception when others then read_ivy := 'refused';
  end;
  begin
    perform public.admin_member_email(ivy);
  exception when others then email_ivy := 'refused';
  end;

  raise exception 'RESULT adm: %; men: %; ivy: %; email adm: %, men: %, ivy: %',
    read_adm, read_men, read_ivy, email_adm, email_men, email_ivy;
end;
$$;
