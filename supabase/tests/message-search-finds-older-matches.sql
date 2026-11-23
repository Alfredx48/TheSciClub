-- ============================================================================
-- Message search finds older matches (20261123120000)
-- ============================================================================
-- Sam is in a group with 210 newer messages that only contain "ran"
-- ("brand new") and one older one that starts a word with it ("Ran says
-- hi"). The old client read 200 and found nothing; search_my_messages finds
-- the older one. Also: accents and apostrophes fold, _ splits words, a
-- removed message, a notice and a group Sam is not in are never found, and
-- a page of 2 reads on from its cursor without repeats. Run against the
-- test project on 2026-11-23: "ran: Ran says hi; jose: José came; obrien:
-- Ask O'Brien; parakh: see pranav_parakh; elsewhere: 0; page1: brand new
-- 210|brand new 209; page2: brand new 208|brand new 207". The old read of
-- 200 then filtering gave "ran: NOTHING" on the same rows.
--
--   node --env-file=.env.local <runner> supabase/tests/message-search-finds-older-matches.sql
--
-- Ends in an exception, so nothing is kept. Do not point it at the hosted project.
-- ============================================================================

do $$
declare
  sam constant uuid := 'a5500000-1123-0000-0000-000000000001';
  other constant uuid := 'a5500000-1123-0000-0000-000000000002';
  mine constant uuid := 'a5500000-1123-0000-0000-0000000000a1';
  theirs constant uuid := 'a5500000-1123-0000-0000-0000000000a2';
  ran text; jose text; obrien text; parakh text; hidden text; page1 text; page2 text;
  last_at timestamptz; last_id uuid;
begin
  insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state) values
    (sam,   'peer', 'active', 'Sam', '19991123101', '1980-01-01', 'T1–T6', 'CA'),
    (other, 'peer', 'active', 'Oth', '19991123102', '1980-01-01', 'T1–T6', 'CA');
  insert into public.chat_threads (id, kind, name) values (mine, 'group', 'Mine'), (theirs, 'group', 'Theirs');
  insert into public.chat_thread_members (thread_id, member_id) values (mine, sam), (mine, other), (theirs, other);

  insert into public.chat_messages (thread_id, author_id, body, created_at) values
    (mine, other, 'Ran says hi', now() - interval '1 day'),
    (mine, other, 'José came', now() - interval '20 hours'),
    (mine, other, 'Ask O''Brien', now() - interval '19 hours'),
    (mine, other, 'see pranav_parakh', now() - interval '18 hours'),
    (theirs, other, 'Ran elsewhere', now() - interval '17 hours');
  insert into public.chat_messages (thread_id, author_id, body, created_at, removed_at)
    values (mine, other, 'Ran but taken back', now() - interval '16 hours', now());
  insert into public.chat_messages (thread_id, author_id, body, created_at, notice)
    values (mine, other, 'Ran was added', now() - interval '15 hours', 'added');
  insert into public.chat_messages (thread_id, author_id, body, created_at)
    select mine, other, 'brand new ' || g, now() - interval '1 hour' + g * interval '1 second'
      from generate_series(1, 210) g;

  perform set_config('request.jwt.claims', '{"sub":"a5500000-1123-0000-0000-000000000001","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select string_agg(body, '|') into ran from public.search_my_messages(array['ran']);
  select string_agg(body, '|') into jose from public.search_my_messages(array['jose']);
  select string_agg(body, '|') into obrien from public.search_my_messages(array['obrien']);
  select string_agg(body, '|') into parakh from public.search_my_messages(array['parakh'], mine);
  select count(*)::text into hidden from public.search_my_messages(array['elsewhere']);

  select string_agg(body, '|' order by created_at desc), max(created_at)
    into page1 from (select * from public.search_my_messages(array['brand'], mine, null, null, 2)) s;
  select created_at, id into last_at, last_id
    from public.search_my_messages(array['brand'], mine, null, null, 2) order by created_at limit 1;
  select string_agg(body, '|' order by created_at desc)
    into page2 from public.search_my_messages(array['brand'], mine, last_at, last_id, 2);

  raise exception 'RESULT ran: %; jose: %; obrien: %; parakh: %; elsewhere: %; page1: %; page2: %',
    ran, jose, obrien, parakh, hidden, page1, page2;
end;
$$;
