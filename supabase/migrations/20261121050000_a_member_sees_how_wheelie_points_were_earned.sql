-- ============================================================================
-- A member sees how somebody's Wheelie points were earned
-- ============================================================================
-- The owner, 2026-11-20: "We should also see updates to the peer pages with
-- their stats and corresponding point contributions", as the 2-pager has it
-- ("On each profile"): the total and the level, the points from each
-- activity, the current streak, and the questions they asked and answered,
-- each with the points it earned.
--
-- Every member's total is already shown beside their name to every member
-- (public.member_wheelies), and this is that total taken apart, so the counts
-- are for any member to see. What is listed post by post is what the caller
-- could read anyway:
--   * only signed posts: the ledger gives an anonymous one no points and no
--     writer, so it never appears;
--   * only in rooms the caller can read (chat_room_is_readable);
--   * nothing at all between two members where either has blocked the other,
--     as their profile is not shown either.
--
-- Expand only: one new function.
-- ============================================================================

create function public.member_wheelie_points(p_member uuid)
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
           'posts', (select l.posts from listed l)
         )
    into result
    from kinds k;

  return result;
end;
$$;

revoke all on function public.member_wheelie_points(uuid) from public, anon;
grant execute on function public.member_wheelie_points(uuid) to authenticated;
