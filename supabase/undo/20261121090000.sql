-- Undo 20261121090000: the card works out everybody's points again, and the
-- one-member ledger goes.
CREATE OR REPLACE FUNCTION public.member_wheelie_points(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- What they gave is listed apart, below.
       and l.kind not in ('voted', 'reacted')
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
  ,
  -- Their votes and reactions on others' posts, newest first, as the ledger
  -- counts them; to the member themselves only, since a downvote is never
  -- shown to anybody else (20261118180000), and only in rooms they may read.
  given as (
    select g.kind, g.emoji, g.at, g.post_id
      from (
        select 'upvote'::text as kind, null::text as emoji, l.liked_at as at, l.post_id
          from public.chat_post_likes l where l.member_id = p_member
        union all
        select 'downvote', null, d.downvoted_at, d.post_id
          from public.chat_post_downvotes d where d.member_id = p_member
        union all
        select 'reaction', r.emoji, rm.made_at, r.target_id
          from public.chat_post_reactions r
          left join private.reaction_made rm on rm.target_id = r.target_id and rm.member_id = r.member_id
         where r.member_id = p_member and r.emoji is not null
      ) g
     where p_member = me
       and exists (
         select 1 from ledger l
          where l.post_id = g.post_id
            and l.kind = case when g.kind = 'reaction' then 'reacted' else 'voted' end
       )
  ),
  given_listed as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'post_id', g.post_id,
             'topic_id', t.id,
             'room_id', t.room_id,
             'title', t.title,
             'kind', g.kind,
             'emoji', g.emoji,
             'at', coalesce(g.at, cp.created_at),
             'points', 1
           ) order by coalesce(g.at, cp.created_at) desc, g.post_id, g.kind), '[]') as given
      from given g
      join public.chat_posts cp on cp.id = g.post_id
      join public.chat_topics t on t.id = cp.topic_id
     where public.chat_room_is_readable(t.room_id)
  )
  select jsonb_build_object(
           'total', k.total,
           'kinds', k.kinds,
           'streak', coalesce((select s.days from streak s), 0),
           'posts', (select l.posts from listed l),
           'best_streak', (select b.days from best b),
           'events', (select e.events from events e),
           'given', case when p_member = me then (select g.given from given_listed g) end,
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
$function$;

CREATE OR REPLACE FUNCTION private.wheelie_ledger()
 RETURNS TABLE(member_id uuid, kind text, points integer, at timestamp with time zone, topic_id uuid, post_id uuid, event_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with
  earners as (
    select m.id from public.members m where m.type <> 'organization' and not m.is_seed
  ),
  opening as (
    select distinct on (p.topic_id) p.topic_id, p.id as post_id
      from public.chat_posts p
     order by p.topic_id, p.created_at, p.id
  ),
  -- Posts still standing, with who wrote them where they were signed.
  posts as (
    select p.id, p.topic_id, p.author_id, p.created_at, p.reply_to,
           o.post_id = p.id as is_opening, t.is_question
      from public.chat_posts p
      join public.chat_topics t on t.id = p.topic_id
      join opening o on o.topic_id = p.topic_id
     where p.removed_at is null
  ),
  first_questions as (
    select distinct on (p.author_id) p.author_id, p.topic_id, p.id, p.created_at
      from posts p
     where p.is_opening and p.is_question and p.author_id is not null
     order by p.author_id, p.created_at, p.id
  ),
  -- Each reply answers the post it quotes, or else the topic's opening post,
  -- and is that post's writer's response unless they wrote it themselves.
  -- An anonymous reply is somebody's (private.chat_anonymous_posts), so the
  -- asker's own anonymous follow-up is not a response to them either.
  responses as (
    select target.author_id, target.topic_id, target.id as post_id, q.created_at
      from posts q
      left join private.chat_anonymous_posts a on a.post_id = q.id
      join opening o on o.topic_id = q.topic_id
      join posts target on target.id = coalesce(q.reply_to, o.post_id)
     where not q.is_opening
       and target.author_id is not null
       and target.id <> q.id
       and coalesce(q.author_id, a.member_id) is distinct from target.author_id
  ),
  streak_days as (
    select d.member_id, d.day
      from private.member_active_days d
    union
    -- Older copies of the app note the device, not the day; after launch,
    -- either counts.
    select c.member_id, (c.seen_at at time zone 'America/Los_Angeles')::date
      from public.member_device_checks c
     where (c.seen_at at time zone 'America/Los_Angeles')::date
           >= (select min(day) from private.member_active_days)
  ),
  -- Days in a row share day minus their place in the member's list.
  runs as (
    select s.member_id, s.day,
           s.day - (row_number() over (partition by s.member_id order by s.day))::integer as run
      from streak_days s
  ),
  streaks as (
    select r.member_id, r.day,
           row_number() over (partition by r.member_id, r.run order by r.day) as nth
      from runs r
  ),
  -- Who wrote each standing post, an anonymous one too, so nobody earns for
  -- voting on or reacting to their own.
  writers as (
    select p.id, p.topic_id, coalesce(p.author_id, a.member_id) as writer
      from posts p
      left join private.chat_anonymous_posts a on a.post_id = p.id
  ),
  ledger as (
    -- Questions and posts.
    select p.author_id as member_id,
           case when p.is_question then 'question' else 'post' end as kind,
           10 as points, p.created_at as at, p.topic_id, p.id as post_id, null::uuid as event_id
      from posts p
     where p.is_opening and p.author_id is not null
    union all
    select f.author_id, 'first_question', 50, f.created_at, f.topic_id, f.id, null
      from first_questions f
    union all
    -- Answers and comments.
    select p.author_id, 'reply', 5, p.created_at, p.topic_id, p.id, null
      from posts p
     where not p.is_opening and p.author_id is not null
    union all
    -- Upvotes from somebody else. A boost is not one.
    select p.author_id, 'upvote', 10, l.liked_at, p.topic_id, p.id, null
      from public.chat_post_likes l
      join posts p on p.id = l.post_id
     where p.author_id is not null and l.member_id <> p.author_id
    union all
    -- Reactions from somebody else.
    select p.author_id, 'response', 3, coalesce(rm.made_at, p.created_at), p.topic_id, p.id, null
      from public.chat_post_reactions r
      join posts p on p.id = r.target_id
      left join private.reaction_made rm on rm.target_id = r.target_id and rm.member_id = r.member_id
     where r.emoji is not null and p.author_id is not null and r.member_id <> p.author_id
    union all
    -- Replies from somebody else.
    select r.author_id, 'response', 3, r.created_at, r.topic_id, r.post_id, null
      from responses r
    union all
    -- Going, kept while check-in is open and after it by who checked in.
    select v.member_id, 'rsvp', 30, v.created_at, null, null, v.event_id
      from public.event_rsvps v
      join public.events e on e.id = v.event_id
     where v.status = 'going'
       and (
         now() < private.check_in_closes(e.start_time, e.end_time, e.all_day)
         or exists (
           select 1 from public.event_check_ins c
            where c.event_id = v.event_id and c.member_id = v.member_id
         )
       )
    union all
    select c.member_id, 'check_in', 100, c.checked_in_at, null, null, c.event_id
      from public.event_check_ins c
    union all
    -- Signed reviews still up.
    select r.author_id, 'review', 100, r.created_at, null, null, r.event_id
      from public.reviews r
     where r.author_id is not null and not r.anonymous and r.removed_at is null
    union all
    -- Each part of the profile filled in now, from when it first was.
    select m.id, 'profile', 10, coalesce(pp.earned_at, m.created_at), null, null, null
      from public.members m
      cross join lateral unnest(private.wheelie_parts_filled(m)) as f (part)
      left join private.wheelie_profile_parts pp on pp.member_id = m.id and pp.part = f.part
    union all
    -- Upvotes and downvotes given to somebody else's post (the owner,
    -- 2026-11-21): a point each, either way. One kind for both, so a total
    -- shown to others never says how many were downvotes.
    select l.member_id, 'voted', 1, l.liked_at, w.topic_id, w.id, null
      from public.chat_post_likes l
      join writers w on w.id = l.post_id
     where w.writer is distinct from l.member_id
    union all
    select d.member_id, 'voted', 1, d.downvoted_at, w.topic_id, w.id, null
      from public.chat_post_downvotes d
      join writers w on w.id = d.post_id
     where w.writer is distinct from d.member_id
    union all
    -- Reactions given to somebody else's post: a point each.
    select r.member_id, 'reacted', 1, coalesce(rm.made_at, w_post.created_at), w.topic_id, w.id, null
      from public.chat_post_reactions r
      join writers w on w.id = r.target_id
      join posts w_post on w_post.id = r.target_id
      left join private.reaction_made rm on rm.target_id = r.target_id and rm.member_id = r.member_id
     where r.emoji is not null and w.writer is distinct from r.member_id
    union all
    select s.member_id, 'streak', 5,
           (s.day::timestamp at time zone 'America/Los_Angeles'), null, null, null
      from streaks s
     where s.nth >= 2
  )
  select l.member_id, l.kind, l.points, l.at, l.topic_id, l.post_id, l.event_id
    from ledger l
    join earners e on e.id = l.member_id;
$function$;

drop function private.wheelie_ledger(uuid);
