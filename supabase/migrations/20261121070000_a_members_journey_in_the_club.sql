-- ============================================================================
-- A member's journey in the club
-- ============================================================================
-- The owner, 2026-11-20: "I think the wheelies are bit loud and everywhere
-- right now. How about we just keep it on the profile page for now and in the
-- Me tab ... Call it your journey in the club. They tap on it, and it
-- describes what they get wheelie point from and they can see their history.
-- So for the wheelie points from questions if tapped on will reveal all the
-- questions. Events will show all the events and so on."
--
-- public.member_wheelie_points (20261121050000) says more, for that history:
--   * events: each event that earned them points, with what for (Going,
--     checking in, a review), only where the reader may see the event
--     (public.can_see_event), as the events pages have it;
--   * parts: which parts of their profile earned, to the member themselves
--     only; anybody else is told how many, as before;
--   * best_streak: their longest run of days.
-- Everything it said before it still says, the same way.
--
-- Expand only: the same function, with more in what it returns.
-- ============================================================================

create or replace function public.member_wheelie_points(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
  result jsonb;
begin
  if not public.is_member() then
    raise exception 'Only a member can see Wheelie points.' using errcode = '42501';
  end if;
  if p_member is null
     or (p_member <> me and public.members_blocked(me, p_member))
     or not exists (
       select 1 from public.members m
        where m.id = p_member and m.type <> 'organization' and not m.is_seed
          and m.status <> 'removed'
     ) then
    return null;
  end if;

  with
  ledger as (
    select w.* from private.wheelie_ledger() w where w.member_id = p_member
  ),
  kinds as (
    select coalesce(jsonb_object_agg(k.kind, jsonb_build_object('count', k.n, 'points', k.points)), '{}')
             as kinds,
           coalesce(sum(k.points), 0)::integer as total
      from (
        select l.kind, count(*)::integer as n, sum(l.points)::integer as points
          from ledger l group by l.kind
      ) k
  ),
  -- The days that count towards a streak, as private.wheelie_ledger has them.
  days as (
    select d.day from private.member_active_days d where d.member_id = p_member
    union
    select (c.seen_at at time zone 'America/Los_Angeles')::date
      from public.member_device_checks c
     where c.member_id = p_member
       and (c.seen_at at time zone 'America/Los_Angeles')::date
           >= (select min(a.day) from private.member_active_days a)
  ),
  runs as (
    select d.day, d.day - (row_number() over (order by d.day))::integer as run from days d
  ),
  -- The run that reaches today, or yesterday: today may not have started yet.
  streak as (
    select count(*)::integer as days
      from runs r
     where r.run = (select r2.run from runs r2 where r2.day >= today - 1 order by r2.day desc limit 1)
  ),
  -- Their longest run of days.
  best as (
    select coalesce(max(n), 0)::integer as days
      from (select count(*) as n from runs r group by r.run) x
  ),
  -- What each event earned them: Going, checking in and a signed review. Only
  -- events the reader may see (can_see_event), as on the events pages.
  event_points as (
    select l.event_id,
           sum(l.points) filter (where l.kind = 'rsvp')::integer as rsvp,
           sum(l.points) filter (where l.kind = 'check_in')::integer as check_in,
           sum(l.points) filter (where l.kind = 'review')::integer as review,
           sum(l.points)::integer as points,
           max(l.at) as at
      from ledger l
     where l.event_id is not null
     group by l.event_id
  ),
  events as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'event_id', ep.event_id,
             'title', e.title,
             'start_time', e.start_time,
             'all_day', e.all_day,
             'timezone', e.timezone,
             'rsvp', coalesce(ep.rsvp, 0),
             'check_in', coalesce(ep.check_in, 0),
             'review', coalesce(ep.review, 0),
             'points', ep.points
           ) order by e.start_time desc, ep.event_id), '[]') as events
      from event_points ep
      join public.events e on e.id = ep.event_id
     where public.can_see_event(ep.event_id)
  ),
  -- What each of their posts earned: its own points, and the upvotes and
  -- responses it was given.
  posts as (
    select l.post_id,
           sum(l.points) filter (where l.kind in ('question', 'post', 'first_question', 'reply'))::integer as own,
           bool_or(l.kind = 'first_question') as first,
           bool_or(l.kind in ('question', 'post')) as opening,
           (count(*) filter (where l.kind = 'upvote'))::integer as upvotes,
           (count(*) filter (where l.kind = 'response'))::integer as responses,
           sum(l.points)::integer as points,
           min(l.at) filter (where l.kind in ('question', 'post', 'reply')) as at
      from ledger l
     where l.post_id is not null
     group by l.post_id
  ),
  listed as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'post_id', p.post_id,
             'topic_id', t.id,
             'room_id', t.room_id,
             'title', t.title,
             'is_question', t.is_question,
             'opening', p.opening,
             'first', p.first,
             'at', p.at,
             'own', coalesce(p.own, 0),
             'upvotes', p.upvotes,
             'responses', p.responses,
             'points', p.points
           ) order by p.at desc, p.post_id), '[]') as posts
      from posts p
      join public.chat_posts cp on cp.id = p.post_id
      join public.chat_topics t on t.id = cp.topic_id
     where p.at is not null
       and public.chat_room_is_readable(t.room_id)
  )
  select jsonb_build_object(
           'total', k.total,
           'kinds', k.kinds,
           'streak', coalesce((select s.days from streak s), 0),
           'posts', (select l.posts from listed l),
           'best_streak', (select b.days from best b),
           'events', (select e.events from events e),
           -- Which parts of the profile earned, for the member themselves: to
           -- anybody else the count says enough.
           'parts', case when p_member = me then (
             select coalesce(jsonb_agg(f.part order by f.part), '[]')
               from public.members m
               cross join lateral unnest(private.wheelie_parts_filled(m)) as f (part)
              where m.id = p_member
           ) end
         )
    into result
    from kinds k;

  return result;
end;
$$;
