-- ============================================================================
-- Administrators flag anonymous posts and never see who wrote them; every
-- strike counts toward three, and three pause a membership by themselves
-- ============================================================================
--
-- The owner, 2026-11-20, after 20261120100000: administrators must not see
-- who wrote an anonymous post. They flag it instead: the post is hidden and
-- the writer is told the reason the administrator wrote. Then, tightening the
-- strike rules for everybody:
--
--   "I do think that a three strike rule makes sense. If you get three
--   strikes your account will get paused, if you get three strikes again
--   after it's unpause, you will be permanently banned. So maybe after the
--   first anonymous posting strike you lose the ability to post anonymously
--   for a month, second anonymous strike you lose the ability to post for
--   three months, third strike your account is paused."
--
-- Settled with them the same day:
--
--   - a flag is a strike. Named strikes and flags count together toward
--     strike_limit() (3), each for strike_window() (12 months);
--   - a flag also takes away anonymous posting only: one month after the
--     first, three months after the second;
--   - the third strike pauses the membership for 30 days, by itself. Before
--     this, the third strike asked an administrator to decide
--     (20260917000000). lift_strike_pauses() restores it when the 30 days
--     are up, and strikes from before the pause stop counting;
--   - after a pause for strikes, anonymous posting never comes back;
--   - three strikes after a pause close the account for good: the address
--     (or number) is blocked and the member removed, as "Remove and block"
--     does in /admin.
--
-- Administrators still see a member's named strikes and nothing of their
-- flags (active_strike_count, admin_members). They do see a pause, and a
-- pause that came early tells them flags were part of it. Said to the owner.
--
-- The database still keeps who wrote each anonymous post, in the private
-- schema: replies, flags and the pause have to reach the writer. No member,
-- administrators included, can read it through the app.
--
-- Also here: member_seen_explainers, so the one-time explanation of
-- "Anonymous" and "not a question" is shown once per account, not per device.
--
-- Expand only: tables, new functions, a notification kind, and functions
-- rewritten with the same arguments and results.
-- Probes: supabase/tests/anonymous-posts.sql, supabase/tests/strikes.sql.

-- ---------------------------------------------------------------- nobody else

create or replace function public.chat_anonymous_writers(topic uuid)
returns table (post_id uuid, member_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.post_id, a.member_id, m.display_name
    from public.chat_topics t
    join public.chat_posts p on p.topic_id = t.id
    join private.chat_anonymous_posts a on a.post_id = p.id
    left join public.members m on m.id = a.member_id
   where t.id = topic
     and public.is_member()
     and public.chat_room_is_readable(t.room_id)
     and a.member_id = auth.uid();
$$;

comment on function public.chat_anonymous_writers(uuid) is
  'The anonymous posts in a topic that the reader wrote. Nobody else, administrators included, is told. See 20261120110000.';

create or replace function public.chat_report_post(post uuid, report_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  topic public.chat_topics;
  room public.chat_rooms;
begin
  -- Definer, so RLS is off in here and nothing above has checked anything. The
  -- Phase 2 lesson: every gate this function relies on, it states itself.
  --
  -- is_member() and not is_active_member(): somebody who has been paused should
  -- still be able to say what was done to them. Being unable to write in a room
  -- is not the same as being unable to report what somebody wrote in one.
  if not public.is_member() then
    raise exception 'Only a member can report something.' using errcode = '42501';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  select * into topic from public.chat_topics t where t.id = target.topic_id;
  select * into room from public.chat_rooms r where r.id = topic.room_id;

  -- The caller has to be able to read it. Without this, anybody holding a post
  -- id could push a closed room's contents onto the administrators' screen.
  if not public.chat_room_is_readable(topic.room_id) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  if private.chat_post_writer(target.id) = auth.uid() then
    raise exception 'You cannot report your own post. Remove it instead.'
      using errcode = '42501';
  end if;

  -- A blank body is nothing to report, and a report whose snapshot is '' tells
  -- an administrator nothing. Whoever removed it has already acted.
  if target.removed_at is not null then
    raise exception 'That post has already been removed.' using errcode = '42501';
  end if;

  insert into public.chat_reports
    (kind, context_kind, post_id, reporter_id, reported_author_id,
     body_snapshot, attachments, written_at, place, topic_id, room_id, note)
  values
    ('post', 'room', target.id, auth.uid(), target.author_id,
     target.body, target.attachments, target.created_at,
     room.name || ' › ' || topic.title, topic.id, room.id,
     nullif(btrim(coalesce(report_note, '')), ''))
  -- Reporting twice is one row and no error. A member who taps it again
  -- because nothing visibly happened has not done anything wrong.
  on conflict (reporter_id, post_id) do nothing;
end;
$$;

-- Reports already made name nobody either.
update public.chat_reports r
   set reported_author_id = null
  from public.chat_posts p
 where p.id = r.post_id and p.anonymous and r.reported_author_id is not null;

-- ---------------------------------------------------------------- flags

-- One row per flagged post. post_id is cleared, never the row, if the post
-- itself goes: a flag stays against the writer.
create table if not exists private.chat_anonymous_flags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid unique references public.chat_posts (id) on delete set null,
  member_id uuid not null references public.members (id) on delete cascade,
  flagged_by uuid references public.members (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  flagged_at timestamptz not null default clock_timestamp()
);
create index if not exists chat_anonymous_flags_member
  on private.chat_anonymous_flags (member_id, flagged_at);

alter table private.chat_anonymous_flags enable row level security;
revoke all on private.chat_anonymous_flags from public, anon, authenticated;

-- ---------------------------------------------------------------- strike pauses

-- A membership paused by its third strike. ends_at is when it comes back;
-- lifted_at is when it did (lift_strike_pauses, or an administrator pressing
-- Resume). Strikes from before paused_at stop counting.
create table if not exists public.member_strike_pauses (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  paused_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz not null,
  lifted_at timestamptz
);
create index if not exists member_strike_pauses_member
  on public.member_strike_pauses (member_id, paused_at desc);

comment on table public.member_strike_pauses is
  'Memberships paused by their third strike, for 30 days. Written only by the database. See 20261120110000.';

alter table public.member_strike_pauses enable row level security;

drop policy if exists "a member reads their own strike pauses" on public.member_strike_pauses;
create policy "a member reads their own strike pauses"
  on public.member_strike_pauses for select to authenticated
  using (member_id = (select auth.uid()));

drop policy if exists "an administrator reads every strike pause" on public.member_strike_pauses;
create policy "an administrator reads every strike pause"
  on public.member_strike_pauses for select to authenticated
  using ((select public.is_admin()));

revoke all on public.member_strike_pauses from public, anon, authenticated;
grant select on public.member_strike_pauses to authenticated;
grant select, insert, update, delete on public.member_strike_pauses to service_role;

-- Where the count starts: the latest pause for strikes, or the beginning.
create or replace function private.strikes_count_from(who uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(p.paused_at), '-infinity'::timestamptz)
    from public.member_strike_pauses p
   where p.member_id = who;
$$;

-- Every strike that counts: named and anonymous, in the last year, since the
-- latest pause.
create or replace function private.strike_total(who uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*)
       from public.member_strikes s
      where s.member_id = who
        and s.withdrawn_at is null
        and s.issued_at > now() - public.strike_window()
        and s.issued_at > private.strikes_count_from(who))
    + (select count(*)
         from private.chat_anonymous_flags f
        where f.member_id = who
          and f.flagged_at > now() - public.strike_window()
          and f.flagged_at > private.strikes_count_from(who))
  )::integer;
$$;

-- What a strike just given does: nothing yet ('none'), pause the membership
-- for 30 days ('paused'), or, after an earlier pause, close the account for
-- good ('closed'). Called by an administrator's strike or flag, so
-- admin_delete_member's own checks pass. Never touches an administrator.
create or replace function private.apply_strikes(who uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_admin boolean;
  address text;
  phone_number text;
begin
  select m.is_admin into target_is_admin from public.members m where m.id = who;
  if not found or target_is_admin then
    return 'none';
  end if;
  if private.strike_total(who) < public.strike_limit() then
    return 'none';
  end if;

  if exists (select 1 from public.member_strike_pauses p where p.member_id = who) then
    -- Closed for good: blocked, then removed, as removeAndBlock does.
    address := private.confirmed_email(who);
    select nullif(btrim(coalesce(u.phone, '')), '') into phone_number from auth.users u where u.id = who;
    if address is not null then
      insert into public.blocked_emails (email, blocked_by, note)
      values (address::extensions.citext, auth.uid(), 'Three strikes after a pause for strikes.')
      on conflict do nothing;
    end if;
    if phone_number is not null then
      insert into public.blocked_numbers (phone_raw, reason, blocked_by)
      values (phone_number, 'Three strikes after a pause for strikes.', auth.uid())
      on conflict do nothing;
    end if;
    perform public.admin_delete_member(who);
    return 'closed';
  end if;

  insert into public.member_strike_pauses (member_id, ends_at)
  values (who, clock_timestamp() + interval '30 days');
  update public.members set status = 'suspended' where id = who and status = 'active';
  return 'paused';
end;
$$;

revoke all on function private.strikes_count_from(uuid) from public, anon, authenticated;
revoke all on function private.strike_total(uuid) from public, anon, authenticated;
revoke all on function private.apply_strikes(uuid) from public, anon, authenticated;

-- Thirty days are up: the membership comes back, unless an administrator
-- paused it again by hand in the meantime (a second open pause, or none).
create or replace function private.lift_strike_pauses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifted integer;
begin
  with ended as (
    update public.member_strike_pauses p
       set lifted_at = now()
     where p.lifted_at is null and p.ends_at <= now()
    returning p.member_id
  )
  update public.members m
     set status = 'active'
    from ended
   where m.id = ended.member_id and m.status = 'suspended';
  get diagnostics lifted = row_count;
  return lifted;
end;
$$;

revoke all on function private.lift_strike_pauses() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lift-strike-pauses';
  perform cron.schedule('lift-strike-pauses', '7 * * * *', 'select private.lift_strike_pauses()');
end;
$$;

-- An administrator's named strikes, since the latest pause. Flags are not
-- here: an administrator must not be able to tell whose post they flagged.
create or replace function public.active_strike_count(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target = auth.uid() or auth.uid() is null or public.is_admin() then (
      select count(*)::integer
        from public.member_strikes
       where member_id = target
         and withdrawn_at is null
         and issued_at > now() - public.strike_window()
         and issued_at > private.strikes_count_from(target)
    )
  end;
$$;

-- An administrator gives a strike, and is told what it did. Replaces the
-- refusal of a fourth (20260917000000): the third now pauses by itself.
create or replace function public.admin_strike_member(target uuid, strike_reason text)
returns table (strikes integer, outcome text, paused_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_admin boolean;
  target_status text;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator';
  end if;
  if length(btrim(coalesce(strike_reason, ''))) = 0 then
    raise exception 'A strike needs a reason';
  end if;

  -- One strike at a time per member (20260917000000).
  select m.is_admin, m.status into target_is_admin, target_status
    from public.members m where m.id = target for update;
  if not found then
    raise exception 'No such member';
  end if;
  if target_is_admin then
    raise exception 'An administrator cannot be given a strike';
  end if;
  if target_status = 'removed' then
    raise exception 'Their membership has already ended.';
  end if;

  insert into public.member_strikes (member_id, reason, issued_by)
  values (target, btrim(strike_reason), auth.uid());

  strikes := public.active_strike_count(target);
  outcome := private.apply_strikes(target);
  if outcome = 'paused' then
    select p.ends_at into paused_until from public.member_strike_pauses p
     where p.member_id = target order by p.paused_at desc limit 1;
  end if;
  return next;
end;
$$;

comment on function public.admin_strike_member(uuid, text) is
  'An administrator gives a strike. Returns the named strikes that count, and what happened: none, paused (30 days) or closed (for good). See 20261120110000.';

revoke all on function public.admin_strike_member(uuid, text) from public, anon;
grant execute on function public.admin_strike_member(uuid, text) to authenticated;

-- The old name, for an app that still calls it: the same strike, the count.
create or replace function public.admin_add_strike(target uuid, strike_reason text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select s.strikes from public.admin_strike_member(target, strike_reason) s;
$$;

revoke all on function public.admin_add_strike(uuid, text) from public, anon;
grant execute on function public.admin_add_strike(uuid, text) to authenticated;

-- Resume, by an administrator, ends a pause for strikes early too.
create or replace function public.admin_set_member_status(target uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_is_admin boolean;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator';
  end if;
  if new_status not in ('active', 'suspended', 'removed') then
    raise exception 'Unknown status: %', new_status;
  end if;
  if target = auth.uid() then
    raise exception 'You cannot change your own membership status';
  end if;

  select is_admin into target_is_admin from public.members where id = target;
  if not found then
    raise exception 'No such member';
  end if;
  if target_is_admin then
    raise exception 'An administrator''s membership cannot be changed from the application';
  end if;

  update public.members set status = new_status where id = target;
  if new_status = 'active' then
    update public.member_strike_pauses
       set lifted_at = now()
     where member_id = target and lifted_at is null;
  end if;
end;
$$;

-- The member's own anonymous strikes, with the reason they were told.
create or replace function public.my_anonymous_strikes()
returns table (reason text, flagged_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.reason, f.flagged_at
    from private.chat_anonymous_flags f
   where f.member_id = auth.uid()
   order by f.flagged_at desc;
$$;

comment on function public.my_anonymous_strikes() is
  'The calling member''s strikes for anonymous posts, newest first. See 20261120110000.';

revoke all on function public.my_anonymous_strikes() from public, anon;
grant execute on function public.my_anonymous_strikes() to authenticated;

-- ---------------------------------------------------------------- anonymous standing

-- Whether a member may post anonymously: 'ok'; 'paused' until a time (a
-- month after one flag, three months after the latest of two or more, in the
-- last year); or 'ended', once the membership has been paused for strikes.
-- flags is how many of their flags are in the last year.
create or replace function private.anonymous_standing(who uuid)
returns table (state text, paused_until timestamptz, flags integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  latest timestamptz;
  pause_ends timestamptz;
begin
  select count(*)::integer, max(f.flagged_at) into flags, latest
    from private.chat_anonymous_flags f
   where f.member_id = who and f.flagged_at > now() - public.strike_window();

  if exists (select 1 from public.member_strike_pauses p where p.member_id = who) then
    state := 'ended';
    return next;
    return;
  end if;
  if flags > 0 then
    pause_ends := latest + case when flags = 1 then interval '1 month' else interval '3 months' end;
    if now() < pause_ends then
      state := 'paused';
      paused_until := pause_ends;
      return next;
      return;
    end if;
  end if;
  state := 'ok';
  return next;
end;
$$;

revoke all on function private.anonymous_standing(uuid) from public, anon, authenticated;

create or replace function public.my_anonymous_standing()
returns table (state text, paused_until timestamptz, flags integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.state, s.paused_until, s.flags
    from private.anonymous_standing(auth.uid()) s
   where public.is_member();
$$;

comment on function public.my_anonymous_standing() is
  'Whether the calling member may post anonymously: ok, paused until a time, or ended. See 20261120110000.';

revoke all on function public.my_anonymous_standing() from public, anon;
grant execute on function public.my_anonymous_standing() to authenticated;

-- ---------------------------------------------------------------- refusing

create or replace function private.chat_anonymous_topic_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  standing text;
  back_on timestamptz;
begin
  if not new.anonymous then
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'Only a member can post anonymously.' using errcode = '42501';
  end if;
  if exists (select 1 from public.chat_rooms r where r.id = new.room_id and r.category = 'Classifieds') then
    raise exception 'A post in the Marketplace carries your name, so people can reach you.'
      using errcode = '22023';
  end if;
  -- Flagged (20261120110000): anonymous posting is paused for a while, or
  -- gone for good once the membership has been paused for strikes.
  select s.state, s.paused_until into standing, back_on from private.anonymous_standing(auth.uid()) s;
  if standing = 'paused' then
    raise exception 'You can post anonymously again on %.',
      trim(to_char(back_on at time zone 'America/Los_Angeles', 'FMMonth FMDD, YYYY'))
      using errcode = '42501';
  elsif standing = 'ended' then
    raise exception 'You can no longer post anonymously: your membership was paused for strikes.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.chat_anonymous_post_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  standing text;
  back_on timestamptz;
begin
  if not new.anonymous then
    new.by_asker := false;
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'Only a member can post anonymously.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.chat_topics t
      join public.chat_rooms r on r.id = t.room_id
     where t.id = new.topic_id and r.category = 'Classifieds'
  ) then
    raise exception 'A post in the Marketplace carries your name, so people can reach you.'
      using errcode = '22023';
  end if;
  -- Flagged (20261120110000): anonymous posting is paused for a while, or
  -- gone for good once the membership has been paused for strikes.
  select s.state, s.paused_until into standing, back_on from private.anonymous_standing(auth.uid()) s;
  if standing = 'paused' then
    raise exception 'You can post anonymously again on %.',
      trim(to_char(back_on at time zone 'America/Los_Angeles', 'FMMonth FMDD, YYYY'))
      using errcode = '42501';
  elsif standing = 'ended' then
    raise exception 'You can no longer post anonymously: your membership was paused for strikes.'
      using errcode = '42501';
  end if;
  -- The asker following up under their own anonymous question: not its
  -- opening post, which is the question.
  new.by_asker := exists (
      select 1 from private.chat_anonymous_topics a
       where a.topic_id = new.topic_id and a.member_id = auth.uid()
    )
    and exists (select 1 from public.chat_posts p where p.topic_id = new.topic_id);
  return new;
end;
$$;

-- ---------------------------------------------------------------- flagging

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'report',
  'invite_joined', 'event_reminder', 'org_events', 'grant_open', 'profile_reminder',
  'blocks_weekly', 'reaction', 'event_starting', 'invite_request', 'mention', 'introduction',
  'join_request', 'check_in_reminder', 'event_followup', 'calendar_invite',
  'organization_request', 'event_notice', 'family_link', 'checked_in', 'important',
  'anonymous_flagged'
));

-- An administrator flags an anonymous post: it is hidden as a removal is, the
-- flag is a strike against its writer, and the writer is told why. detail is
-- what it cost them, a colon, the reason: 'month' or 'three_months' without
-- anonymous posting; 'paused', their third strike; 'ended', anonymous posting
-- already gone. A flag that closes the account tells nobody: there is no
-- account left to tell. Returns the files to delete, as chat_remove_post does.
create or replace function public.chat_flag_anonymous_post(post uuid, reason text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  writer uuid;
  why text := nullif(btrim(coalesce(reason, '')), '');
  outcome text;
  standing text;
  counted integer;
  cost text;
  files text[];
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can flag a post.' using errcode = '42501';
  end if;
  if why is null then
    raise exception 'Say why it is flagged: the person who wrote it is told.' using errcode = '22023';
  end if;
  if char_length(why) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = '22023';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found or not exists (
    select 1 from public.chat_topics t
     where t.id = target.topic_id and public.chat_room_is_readable(t.room_id)
  ) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;
  if not target.anonymous then
    raise exception 'Only an anonymous post can be flagged.' using errcode = '22023';
  end if;
  if target.removed_at is not null then
    raise exception 'That post has already been removed.' using errcode = '42501';
  end if;

  writer := private.chat_post_writer(target.id);
  if writer = auth.uid() then
    raise exception 'You cannot flag your own post. Remove it instead.' using errcode = '42501';
  end if;

  files := public.chat_remove_post(target.id);
  if writer is null then
    return files;
  end if;

  -- One strike at a time per member, as admin_strike_member.
  perform 1 from public.members m where m.id = writer for update;
  insert into private.chat_anonymous_flags (post_id, member_id, flagged_by, reason)
  values (target.id, writer, auth.uid(), why);

  outcome := private.apply_strikes(writer);
  if outcome = 'closed' then
    return files;
  end if;
  if outcome = 'paused' then
    cost := 'paused';
  else
    select s.state, s.flags into standing, counted from private.anonymous_standing(writer) s;
    cost := case
      when standing = 'ended' then 'ended'
      when counted <= 1 then 'month'
      else 'three_months'
    end;
  end if;

  insert into public.notifications (member_id, kind, tag, topic_id, post_id, detail)
  values (writer, 'anonymous_flagged', 'anonymous_flagged:' || target.id::text,
          target.topic_id, target.id, cost || ':' || why)
  on conflict do nothing;
  return files;
end;
$$;

comment on function public.chat_flag_anonymous_post(uuid, text) is
  'An administrator flags an anonymous post: it is hidden, it is a strike against its writer, and the writer is told the reason. See 20261120110000.';

revoke all on function public.chat_flag_anonymous_post(uuid, text) from public, anon;
grant execute on function public.chat_flag_anonymous_post(uuid, text) to authenticated;

-- The writer reads the flag: the topic, their hidden words, the reason.
CREATE OR REPLACE FUNCTION public.my_notifications(before timestamp with time zone DEFAULT NULL::timestamp with time zone, max_rows integer DEFAULT 40)
 RETURNS TABLE(id uuid, kind text, count integer, created_at timestamp with time zone, seen boolean, read boolean, actor_id uuid, actor_name text, actor_photo text, place text, excerpt text, detail text, url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.id, n.kind, n.count, n.created_at, n.seen_at is not null, n.read_at is not null,
         n.actor_id,
         case when n.actor_id is null and p.anonymous and n.kind in ('reply', 'reply_participant', 'mention')
              then private.chat_byline(true, p.by_asker, null)
              when n.actor_id is null and n.kind in ('direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'reaction', 'mention', 'introduction', 'join_request', 'organization_request', 'family_link', 'checked_in', 'important')
              then 'Deleted member' else a.display_name end,
         a.photo_path,
         case
           when n.kind in ('direct', 'group', 'group_add', 'important')
                or (n.kind = 'reaction' and n.thread_id is not null) then
             coalesce(t.name, (select e.title from public.events e where e.id = t.event_id))
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention', 'anonymous_flagged') then tp.title
           when n.kind in ('event_reminder', 'event_starting', 'check_in_reminder', 'event_followup', 'event_notice', 'checked_in') then ev.title
           when n.kind in ('org_events', 'grant_open', 'invite_request', 'join_request') then o.name
           when n.kind = 'invite_joined' then j.display_name
           when n.kind = 'calendar_invite' then ci.payload ->> 'title'
           when n.kind = 'organization_request' then orq.draft ->> 'name'
           -- Who they are being introduced to; to the partner, the group.
           when n.kind = 'introduction' and n.detail = 'opened' and t.id is not null then t.name
           when n.kind = 'introduction' then ox.display_name
           -- What the actor is to the reader (20261107100000).
           when n.kind = 'family_link' then
             case when fl.asker_id = n.member_id then fl.relation else private.family_inverse(fl.relation) end
         end,
         case
           when (n.kind in ('direct', 'group', 'important') or (n.kind = 'reaction' and n.thread_id is not null))
                and m.removed_at is null then
             left(nullif(btrim(m.body), ''), 160)
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention')
                and p.removed_at is null then
             left(nullif(btrim(p.body), ''), 160)
           -- The writer's own words, kept when the post was hidden.
           when n.kind = 'anonymous_flagged' then left(nullif(btrim(rb.body), ''), 160)
           when n.kind = 'grant_open' then gr.name
           when n.kind = 'event_notice' then o.name
           when n.kind = 'introduction' and n.detail = 'asked' then left(ix.note, 160)
         end,
         n.detail,
         case
           when n.kind in ('direct', 'group', 'important')
                or (n.kind = 'reaction' and n.thread_id is not null) then
             '/chat/t/' || n.thread_id::text || coalesce('?message=' || n.message_id::text, '')
           when n.kind = 'group_add' then '/chat/t/' || n.thread_id::text
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention') then
             '/chat/rooms/' || tp.room_id || '/topics/' || tp.id::text
               || coalesce('?post=' || n.post_id::text, '')
           when n.kind = 'anonymous_flagged' then '/chat/rooms/' || tp.room_id || '/topics/' || tp.id::text
           when n.kind = 'report' then '/admin?tab=reports'
           when n.kind = 'blocks_weekly' then '/admin?tab=reports#blocks'
           -- From a QR code or link: the administrators' tally, or for an
           -- org admin, who joined (20261028970000).
           when n.kind = 'invite_joined' and n.detail like 'qr:%' and public.is_admin() then '/admin?tab=invites'
           when n.kind = 'invite_joined' and n.detail like 'qr:%' then '/peers/' || n.joined_id::text
           when n.kind = 'invite_joined' then '/invites'
           when n.kind in ('event_reminder', 'event_starting', 'event_notice', 'checked_in') then '/events/' || n.event_id::text
           when n.kind = 'check_in_reminder' then '/events/' || n.event_id::text || '/check-in'
           when n.kind = 'event_followup' then '/events/' || n.event_id::text || '/review'
           when n.kind in ('org_events', 'grant_open', 'join_request') then '/events/organizations/' || n.organization_id::text
           when n.kind = 'invite_request' then '/invites#requests'
           when n.kind = 'calendar_invite' and n.detail in ('held', 'choose') then '/events/invites'
           when n.kind = 'calendar_invite' and ci.event_id is not null then '/events/' || ci.event_id::text
           when n.kind = 'calendar_invite' then '/events'
           when n.kind = 'organization_request' and n.detail = 'asked' then '/admin?tab=organizations'
           when n.kind = 'organization_request' and orq.organization_id is not null
             then '/events/organizations/' || orq.organization_id::text
           when n.kind = 'organization_request' then '/events?segment=orgs'
           when n.kind = 'profile_reminder' and n.detail = 'details' then '/profile/details'
           when n.kind = 'profile_reminder' then '/profile?resume'
           -- A partner who is not in it goes to their page.
           when n.kind = 'introduction' and n.detail = 'opened'
                and not exists (select 1 from public.chat_thread_members x
                                 where x.thread_id = n.thread_id and x.member_id = n.member_id)
             then '/partner'
           when n.kind = 'introduction' and n.detail = 'opened' then '/chat/t/' || n.thread_id::text
           when n.kind = 'introduction' then '/introductions/' || n.introduction_id::text
           when n.kind = 'family_link' then '/peers/' || n.actor_id::text
         end
    from public.notifications n
    left join public.members a on a.id = n.actor_id
    left join public.chat_threads t on t.id = n.thread_id
    left join public.chat_messages m on m.id = n.message_id
    left join public.chat_topics tp on tp.id = n.topic_id
    left join public.chat_posts p on p.id = n.post_id
    left join public.chat_removed_bodies rb on rb.post_id = n.post_id and n.kind = 'anonymous_flagged'
    left join public.events ev on ev.id = n.event_id
    left join public.organizations o on o.id = n.organization_id
    left join public.members j on j.id = n.joined_id
    left join public.organization_grants gr on gr.id = n.grant_id
    left join public.introductions ix on ix.id = n.introduction_id
    left join public.calendar_invites ci on ci.id = n.calendar_invite_id
    left join public.organization_requests orq on orq.id = n.organization_request_id
    left join public.family_links fl on fl.id = n.family_link_id
    left join public.members ox
      on ox.id = case when ix.first_id = n.member_id then ix.second_id else ix.first_id end
   where n.member_id = auth.uid()
     and public.is_member()
     and (before is null or n.created_at < before)
     and n.created_at > now() - interval '30 days'
     and case
       when n.kind in ('direct', 'group', 'group_add', 'important') then exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind in ('reply', 'reply_participant') then public.chat_room_is_readable(tp.room_id)
       -- A like is about the post, so it goes with the post.
       when n.kind = 'like' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind = 'reaction' and n.thread_id is not null then m.removed_at is null and exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind = 'reaction' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind = 'mention' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind in ('report', 'blocks_weekly') then public.is_admin()
       when n.kind = 'organization_request' and n.detail = 'asked' then public.is_admin()
       -- Only while they still speak for its organization.
       when n.kind = 'invite_request' then public.speaks_for(n.organization_id)
       when n.kind = 'join_request' then public.speaks_for(n.organization_id) or public.is_admin()
       when n.kind = 'introduction' and n.detail = 'opened' then ix.introduced_by = auth.uid() or exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind = 'introduction' then ix.id is not null and ox.status = 'active'
       when n.kind = 'family_link' then fl.id is not null
       else true
     end
     and not exists (
       select 1 from public.member_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id in (n.actor_id, tp.author_id, ox.id))
           or (b.blocked_id = auth.uid() and b.blocker_id in (n.actor_id, tp.author_id, ox.id)
               and not public.is_admin())
     )
   order by n.created_at desc, n.id
   limit least(greatest(coalesce(max_rows, 40), 1), 100);
$function$;

-- ---------------------------------------------------------------- explained once

-- The explanations shown once per account: what "Anonymous" means, and what
-- leaving "This is a question" unticked does. A row means it has been shown.
create table if not exists public.member_seen_explainers (
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  explainer text not null check (explainer ~ '^[a-z_]{1,40}$'),
  seen_at timestamptz not null default now(),
  primary key (member_id, explainer)
);

comment on table public.member_seen_explainers is
  'Which one-time explanations a member has been shown. See 20261120110000.';

alter table public.member_seen_explainers enable row level security;

drop policy if exists "a member reads the explanations they have seen" on public.member_seen_explainers;
create policy "a member reads the explanations they have seen"
  on public.member_seen_explainers for select to authenticated
  using (member_id = (select auth.uid()));

drop policy if exists "a member marks an explanation seen" on public.member_seen_explainers;
create policy "a member marks an explanation seen"
  on public.member_seen_explainers for insert to authenticated
  with check (member_id = (select auth.uid()));

revoke all on public.member_seen_explainers from public, anon, authenticated;
grant select, insert on public.member_seen_explainers to authenticated;
grant select, insert, update, delete on public.member_seen_explainers to service_role;

notify pgrst, 'reload schema';
