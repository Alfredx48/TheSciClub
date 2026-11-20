-- ============================================================================
-- Members earn Wheelie points
-- ============================================================================
-- The owner, 2026-11-20: "implement the wheelie points that we designed in the
-- 2-pager" (The SCI Club: What We're Building, "Wheelie points"). Members earn
-- them for taking part, and a wheel beside each name shows how many.
--
-- What earns what (the 2-pager's starting values, to tune later):
--   RSVP Going to an event ............ 30, once per event
--   Check in at an event .............. 100
--   Write a review .................... 100
--   Ask a question, or start a post ... 10
--   A first question .................. 50 more
--   Answer a question, or comment ..... 5
--   Each upvote a post gets ........... 10
--   Each reply or reaction it gets .... 3
--   Each part of the profile .......... 10: a photo, the injury or condition,
--                                       when injured, city, state, and each
--                                       answer in the profile survey
--   Each day of a streak .............. 5, from the second day in a row
--
-- The rules, as the 2-pager has them and as the owner chose on 2026-11-20:
--   * A downvote takes nothing away.
--   * Nobody earns from their own upvotes, replies or reactions, and an
--     administrator's boost is not an upvote.
--   * A removed post earns nothing, nor anything it was given.
--   * Anonymous questions, answers, comments and reviews earn nothing, so the
--     points beside a name can never point back to what was posted without one.
--   * Only Going earns the RSVP's 30, and keeps it only until the event's
--     check-in closes (private.check_in_closes): who checked in keeps it, who
--     did not, or changed their answer, loses it.
--   * A post that is not a question earns as a question does, without the
--     first question's 50.
--   * Streaks count from the day this went live: private.member_active_days
--     is new, and the days before it are not known well enough.
--
-- Nothing is stored point by point. private.wheelie_ledger works every point
-- out from what the club already keeps, each with the moment it was earned,
-- so a rule can change without rewriting history and a removal takes its
-- points with it. Two small new records are kept because nothing else does:
-- the days a member was active (for streaks) and when each part of a profile
-- was first filled in (so a month counts it when it happened).
--
-- public.member_wheelies holds each member's total and this month's, worked
-- out again every five minutes, for the wheels everywhere a name is shown.
--
-- Expand only: new tables, functions, a trigger and a cron job.
-- ============================================================================

-- --------------------------------------------------------- the active days --

-- One row for each Pacific day a member used the club. Written by
-- note_active_day on their first press or keystroke of the day.
create table private.member_active_days (
  member_id uuid not null references public.members (id) on delete cascade,
  day date not null,
  primary key (member_id, day)
);
revoke all on private.member_active_days from public, anon, authenticated;

create function public.note_active_day()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := auth.uid();
begin
  if member is null or not exists (
    select 1 from public.members m where m.id = member and m.status = 'active'
  ) then
    return false;
  end if;
  insert into private.member_active_days (member_id, day)
  values (member, (now() at time zone 'America/Los_Angeles')::date)
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.note_active_day() from public, anon;
grant execute on function public.note_active_day() to authenticated;

-- ------------------------------------------------------ the profile's parts --

-- The parts of a member's profile that are filled in now: 'photo', 'injury',
-- 'injury_date', 'city', 'state', and 'q:<column>' for each answer in the
-- profile survey (QUESTIONS in src/routes/profile/questions.ts, without the
-- uncounted other_organizations). A declined question is not an answer.
create function private.wheelie_parts_filled(m public.members)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when nullif(btrim(m.photo_path), '') is not null then 'photo' end,
    case when m.injury_type is not null then 'injury' end,
    case when m.injury_date is not null then 'injury_date' end,
    case when nullif(btrim(m.city), '') is not null then 'city' end,
    case when nullif(btrim(m.state), '') is not null then 'state' end
  ], null)
  || coalesce((
    select array_agg('q:' || e.key order by e.key)
      from jsonb_each(to_jsonb(m)) e
     where e.key = any (array[
             'gender', 'languages', 'how_injured', 'detail', 'marital_status',
             'has_children', 'children_when', 'independence', 'self_care',
             'employment', 'field_of_work', 'education', 'education_when',
             'interests', 'topics', 'wants_to_mentor', 'sports_equipment',
             'grants', 'bio'
           ])
       and case jsonb_typeof(e.value)
             when 'string' then btrim(e.value #>> '{}') <> ''
             when 'array' then jsonb_array_length(e.value) > 0
             when 'boolean' then true
             else false
           end
  ), '{}');
$$;
revoke all on function private.wheelie_parts_filled(public.members) from public, anon, authenticated;

-- When each part was first filled in. A part emptied keeps its row and earns
-- nothing while it is empty; filled again, it earns from the first time.
create table private.wheelie_profile_parts (
  member_id uuid not null references public.members (id) on delete cascade,
  part text not null,
  earned_at timestamptz not null default now(),
  primary key (member_id, part)
);
revoke all on private.wheelie_profile_parts from public, anon, authenticated;

create function private.wheelie_note_parts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.wheelie_profile_parts (member_id, part)
  select new.id, f.part from unnest(private.wheelie_parts_filled(new)) as f (part)
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.wheelie_note_parts() from public, anon, authenticated;

create trigger members_wheelie_parts
  after insert or update on public.members
  for each row execute function private.wheelie_note_parts();

-- What is filled in today was filled in by the day each member joined, as far
-- as anybody can now tell.
insert into private.wheelie_profile_parts (member_id, part, earned_at)
select m.id, f.part, m.created_at
  from public.members m, unnest(private.wheelie_parts_filled(m)) as f (part)
on conflict do nothing;

-- -------------------------------------------------------------- the ledger --

-- Every Wheelie point earned, by whom, for what and when. topic_id, post_id
-- and event_id say what it was for, where there is one.
create function private.wheelie_ledger()
returns table (
  member_id uuid,
  kind text,
  points integer,
  at timestamptz,
  topic_id uuid,
  post_id uuid,
  event_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
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
    select s.member_id, 'streak', 5,
           (s.day::timestamp at time zone 'America/Los_Angeles'), null, null, null
      from streaks s
     where s.nth >= 2
  )
  select l.member_id, l.kind, l.points, l.at, l.topic_id, l.post_id, l.event_id
    from ledger l
    join earners e on e.id = l.member_id;
$$;
revoke all on function private.wheelie_ledger() from public, anon, authenticated;

-- ----------------------------------------------------------------- totals --

-- Each member's Wheelie points, all time and this Pacific month, for the
-- wheels. Any member may read any member's: they are shown beside names.
create table public.member_wheelies (
  member_id uuid primary key references public.members (id) on delete cascade,
  points integer not null default 0,
  month date not null,
  month_points integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.member_wheelies enable row level security;
revoke all on public.member_wheelies from anon, authenticated;
grant select on public.member_wheelies to authenticated;
create policy "Members read Wheelie points" on public.member_wheelies
  for select to authenticated using (true);

create function private.refresh_wheelies()
returns void
language sql
security definer
set search_path = ''
as $$
  with
  month as (
    select date_trunc('month', now() at time zone 'America/Los_Angeles')::date as starts
  ),
  totals as (
    select m.id as member_id,
           coalesce(sum(l.points), 0)::integer as points,
           coalesce(sum(l.points) filter (
             where (l.at at time zone 'America/Los_Angeles')::date >= (select starts from month)
           ), 0)::integer as month_points
      from public.members m
      left join private.wheelie_ledger() l on l.member_id = m.id
     where m.type <> 'organization' and not m.is_seed
     group by m.id
  )
  insert into public.member_wheelies (member_id, points, month, month_points, updated_at)
  select t.member_id, t.points, (select starts from month), t.month_points, now()
    from totals t
  on conflict (member_id) do update
     set points = excluded.points,
         month = excluded.month,
         month_points = excluded.month_points,
         updated_at = excluded.updated_at
   where (member_wheelies.points, member_wheelies.month, member_wheelies.month_points)
         is distinct from (excluded.points, excluded.month, excluded.month_points);
$$;
revoke all on function private.refresh_wheelies() from public, anon, authenticated;

select private.refresh_wheelies();

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-wheelies';
  perform cron.schedule('refresh-wheelies', '*/5 * * * *', 'select private.refresh_wheelies()');
end; $$;
