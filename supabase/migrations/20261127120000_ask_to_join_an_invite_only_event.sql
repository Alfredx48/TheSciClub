-- ============================================================================
-- A member can ask to join an invite-only event
-- ============================================================================
-- The owner, 2026-11-27: an invite-only event stays invite only, but a member
-- who opens its link can press Ask to join. Its organizers are told, by
-- notification and push, and Approve on its guest list invites them, as
-- choosing them under "Only the people you choose" does (this date, and in a
-- series every later one, and they are told they are invited). Decline tells
-- nobody: they keep seeing "Asked", as a family link's no is silent
-- (20261107000000). Nothing is approved on its own: asking is never an invite
-- (the hole 20261031110000 closed for registering).
--
-- Who is told, and who may answer: whoever may change who is invited
-- (may_set_visibility): for an organization's event its org admins, for one
-- no organization hosts the member who added it, and the club's
-- administrators, who are not told. Not across a block either way: a blocked
-- organizer is not told, and the asker is not refused, only unheard.
--
-- The asker sees no more than before: not the title, time or place. One ask
-- an event; at most 20 asks a day.
--
-- my_notifications, push_owed and push_level_allows are 20261125160000's with
-- the new kind added and nothing else changed. Older copies of the iPhone app
-- show an unknown kind as "Something new in the club" and open nothing.
--
-- Undo: supabase/undo/20261127120000.sql.
-- Probe: supabase/tests/ask-to-join-an-event.sql.
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'report',
  'invite_joined', 'event_reminder', 'org_events', 'grant_open', 'profile_reminder',
  'blocks_weekly', 'reaction', 'event_starting', 'invite_request', 'mention', 'introduction',
  'join_request', 'check_in_reminder', 'event_followup', 'calendar_invite',
  'organization_request', 'event_notice', 'family_link', 'checked_in', 'important',
  'anonymous_flagged', 'strike_given', 'strike_message', 'strike_withdrawn', 'event_changed',
  'staff_verified', 'event_join_request'
));

create table public.event_join_requests (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references public.members (id) on delete set null,
  approved boolean,
  primary key (event_id, member_id)
);
create index event_join_requests_member_idx on public.event_join_requests (member_id, asked_at);
alter table public.event_join_requests enable row level security;
revoke all on public.event_join_requests from public, anon, authenticated;
comment on table public.event_join_requests is
  'A member asking to join an invite-only event, and its organizer''s answer. Through ask_to_join_event and answer_event_join_request only. See 20261127120000.';

-- ------------------------------------------------------------------ asking
-- 'asked', or 'invited' when they can already see it.
create function public.ask_to_join_event(p_event uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target public.events%rowtype;
  batch timestamptz := clock_timestamp();
  told integer;
begin
  if me is null or not public.is_active_member() then
    raise exception 'Only a member can ask to join.' using errcode = '42501';
  end if;
  select * into target from public.events e where e.id = p_event;
  -- As for any event they cannot see, the same answer whether or not it is there.
  if not found or target.audience <> 'people' then
    raise exception 'You can ask to join only an invite-only event.' using errcode = '22023';
  end if;
  if public.can_see_event(p_event) then
    return 'invited';
  end if;
  if coalesce(target.end_time, target.start_time) < now() then
    raise exception 'That event is over.' using errcode = '22023';
  end if;
  -- Asked before, answered or not: the same answer, and nobody is told again.
  if exists (select 1 from public.event_join_requests r where r.event_id = p_event and r.member_id = me) then
    return 'asked';
  end if;
  if (select count(*) from public.event_join_requests r
       where r.member_id = me and r.asked_at > now() - interval '1 day') >= 20 then
    raise exception 'You have asked to join a lot of events today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into public.event_join_requests (event_id, member_id) values (p_event, me);

  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, count, created_at)
  select o.member_id, 'event_join_request', 'event_join:' || p_event::text, me, p_event, 1, batch
    from (
      select r.member_id from public.organization_representatives r
       where target.organization_id is not null and r.organization_id = target.organization_id
      union
      select target.added_by where target.organization_id is null and target.added_by is not null
    ) o
    join public.members m on m.id = o.member_id and m.status = 'active'
   where o.member_id <> me
     and not public.members_blocked(o.member_id, me)
  on conflict (member_id, tag) where read_at is null
  do update set count = n.count + 1,
                actor_id = excluded.actor_id,
                created_at = excluded.created_at,
                seen_at = null;
  get diagnostics told = row_count;

  if told > 0 then
    perform public.push_notify_send('event_join_request', jsonb_build_object('batch', batch));
  end if;
  return 'asked';
end;
$$;

revoke all on function public.ask_to_join_event(uuid) from public, anon;
grant execute on function public.ask_to_join_event(uuid) to authenticated;

-- Whether the caller has asked: 'asked' (answered or not, as a no is silent), or null.
create function public.my_event_join_request(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'asked'::text from public.event_join_requests r
   where r.event_id = p_event and r.member_id = auth.uid();
$$;

revoke all on function public.my_event_join_request(uuid) from public, anon;
grant execute on function public.my_event_join_request(uuid) to authenticated;

-- ---------------------------------------------------------------- answering
-- The asks not yet answered, for its organizers. Not across a block.
create function public.event_join_requests_for(p_event uuid)
returns table (member_id uuid, name text, username text, photo_path text, asked_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.may_set_visibility(p_event) then
    raise exception 'Only the event''s organizers can see this.' using errcode = '42501';
  end if;
  return query
    select m.id, m.display_name, m.username::text, m.photo_path, r.asked_at
      from public.event_join_requests r
      join public.members m on m.id = r.member_id and m.status = 'active'
     where r.event_id = p_event
       and r.answered_at is null
       and not public.members_blocked(auth.uid(), m.id)
     order by r.asked_at;
end;
$$;

revoke all on function public.event_join_requests_for(uuid) from public, anon;
grant execute on function public.event_join_requests_for(uuid) to authenticated;

-- Approve: invited to this date, and in a series every later one, and told,
-- as set_event_visibility (20261106030000) invites. Decline: nobody is told.
create function public.answer_event_join_request(p_event uuid, p_member uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target public.events%rowtype;
  dates uuid[];
  batch timestamptz := clock_timestamp();
begin
  if me is null or not private.may_set_visibility(p_event) then
    raise exception 'Only the event''s organizers can answer this.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Approve or decline.' using errcode = '22023';
  end if;
  update public.event_join_requests r
     set answered_at = now(), answered_by = me, approved = p_approve
   where r.event_id = p_event and r.member_id = p_member and r.answered_at is null;
  if not found then
    raise exception 'That ask was already answered.' using errcode = 'P0002';
  end if;
  -- Its other organizers have nothing left to answer.
  update public.notifications n set read_at = coalesce(n.read_at, now())
   where n.kind = 'event_join_request' and n.event_id = p_event
     and not exists (select 1 from public.event_join_requests r
                      where r.event_id = p_event and r.answered_at is null);
  if not p_approve then
    return;
  end if;

  select * into target from public.events e where e.id = p_event;
  if not exists (select 1 from public.members m where m.id = p_member and m.status = 'active')
     or public.members_blocked(me, p_member) then
    raise exception 'That member cannot be invited.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(e.id), '{}') into dates
    from public.events e
   where e.id = target.id
      or (target.series_id is not null and e.series_id = target.series_id
          and e.start_time >= target.start_time);
  insert into public.event_invitees (event_id, member_id, invited_by)
  select d, p_member, me from unnest(dates) d
  on conflict (event_id, member_id) do nothing;

  if target.organization_id is not null then
    insert into public.event_member_notices as x
      (event_id, member_id, organization_id, first_sent_at, last_sent_at)
    values (target.id, p_member, target.organization_id, batch, batch)
    on conflict (event_id, member_id)
    do update set last_sent_at = excluded.last_sent_at, sends = x.sends + 1;
  end if;
  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, organization_id, detail, created_at)
  values (p_member, 'event_notice', 'notice:' || target.id::text, me, target.id,
          target.organization_id, null, batch)
  on conflict (member_id, tag) where read_at is null
  do update set created_at = excluded.created_at, actor_id = excluded.actor_id,
                detail = null, seen_at = null;
  perform public.push_notify_send(
    'event_notice', jsonb_build_object('event_id', target.id, 'batch', batch));
end;
$$;

revoke all on function public.answer_event_join_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.answer_event_join_request(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ the push
-- subject the event, actor_name who asked, photo_count how many are asking.
create function private.event_join_request_owed(p_event text, p_key jsonb)
returns table(endpoint text, p256dh text, auth text, kind text, actor_name text, body text, photo_count integer, subject text, detail text, url text, tag text, badge integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth,
         'event_join_request'::text, a.display_name, null::text, n.count,
         e.title, null::text, '/events/' || e.id::text || '/guests', n.tag,
         public.notification_badge(r.id)
    from public.notifications n
    join public.events e on e.id = n.event_id
    join public.members r on r.id = n.member_id and r.status = 'active'
    join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
    left join public.members a on a.id = n.actor_id
   where p_event = 'event_join_request'
     and n.kind = 'event_join_request'
     and n.created_at = (p_key ->> 'batch')::timestamptz
     and n.read_at is null
     and not private.blocked_between(r.id, n.actor_id);
$$;

revoke all on function private.event_join_request_owed(text, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_owed(p_secret text, p_event text, p_key jsonb)
 RETURNS TABLE(endpoint text, p256dh text, auth text, kind text, actor_name text, body text, photo_count integer, subject text, detail text, url text, tag text, badge integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- push_owed_every checks the secret, for both.
  with every_one as (
    select o.* from private.push_owed_every(p_secret, p_event, p_key) o
    union all
    select c.* from private.event_changed_owed(p_event, p_key) c
    union all
    select v.* from private.staff_verified_owed(p_event, p_key) v
    union all
    select j.* from private.event_join_request_owed(p_event, p_key) j
  )
  select o.*
    from every_one o
   where private.push_level_allows(
     (select s.member_id from public.push_subscriptions s where s.endpoint = o.endpoint limit 1),
     o.kind, p_event, p_key)
     and private.first_reaction_owed(p_event, p_key);
$function$;

-- ------------------------------------------------ the bell and push level
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
              when n.actor_id is null and n.kind in ('direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'reaction', 'mention', 'introduction', 'join_request', 'organization_request', 'family_link', 'checked_in', 'important', 'event_join_request')
              then 'Deleted member' else a.display_name end,
         a.photo_path,
         case
           when n.kind in ('direct', 'group', 'group_add', 'important')
                or (n.kind = 'reaction' and n.thread_id is not null) then
             coalesce(t.name, (select e.title from public.events e where e.id = t.event_id))
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention', 'anonymous_flagged') then tp.title
           when n.kind in ('event_reminder', 'event_starting', 'check_in_reminder', 'event_followup', 'event_notice', 'checked_in', 'event_join_request') then ev.title
           -- A cancelled event is gone; its title is kept in detail (20261120140000).
           when n.kind = 'event_changed' then coalesce(ev.title, private.event_change_title(n.detail))
           when n.kind in ('org_events', 'grant_open', 'invite_request', 'join_request', 'staff_verified') then o.name
           when n.kind = 'invite_joined' then j.display_name
           when n.kind = 'calendar_invite' then ci.payload ->> 'title'
           when n.kind = 'organization_request' then orq.draft ->> 'name'
           -- Who they are being introduced to; to the partner, the group.
           when n.kind = 'introduction' and n.detail = 'opened' and t.id is not null then t.name
           when n.kind = 'introduction' then ox.display_name
           -- What the actor is to the reader (20261107100000).
           -- To an administrator, who answered: the member, or on a flag the writer.
           when n.kind = 'strike_message' and public.is_admin()
                and private.strike_owner(split_part(n.detail, ':', 1), split_part(n.detail, ':', 2)::uuid)
                    is distinct from n.member_id then
             coalesce((select sm.display_name from public.member_strikes s
                         join public.members sm on sm.id = s.member_id
                        where split_part(n.detail, ':', 1) = 'strike'
                          and s.id = split_part(n.detail, ':', 2)::uuid), 'The writer')
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
           when n.kind = 'strike_message' then
             (select left(sm.body, 160) from private.strike_messages sm
               where coalesce(sm.strike_id, sm.flag_id) = split_part(n.detail, ':', 2)::uuid
                 and sm.author_id is distinct from n.member_id
               order by sm.created_at desc limit 1)
           when n.kind = 'strike_given' then
             (select left(s.reason, 160) from public.member_strikes s where s.id = split_part(n.detail, ':', 2)::uuid)
           when n.kind = 'strike_withdrawn' and split_part(n.detail, ':', 1) = 'strike' then
             (select left(s.withdrawn_reason, 160) from public.member_strikes s where s.id = split_part(n.detail, ':', 2)::uuid)
           when n.kind = 'strike_withdrawn' then
             (select left(fl2.withdrawn_reason, 160) from private.chat_anonymous_flags fl2 where fl2.id = split_part(n.detail, ':', 2)::uuid)
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
           when n.kind = 'anonymous_flagged' then coalesce(
             '/strikes/flag/' || (select fl2.id::text from private.chat_anonymous_flags fl2
                                   where fl2.post_id = n.post_id order by fl2.flagged_at desc limit 1),
             '/chat/rooms/' || tp.room_id || '/topics/' || tp.id::text)
           when n.kind in ('strike_message', 'strike_given', 'strike_withdrawn') then
             '/strikes/' || split_part(n.detail, ':', 1) || '/' || split_part(n.detail, ':', 2)
           when n.kind = 'report' then '/admin?tab=reports'
           when n.kind = 'blocks_weekly' then '/admin?tab=reports#blocks'
           -- From a QR code or link: the administrators' tally, or for an
           -- org admin, who joined (20261028970000).
           when n.kind = 'invite_joined' and n.detail like 'qr:%' and public.is_admin() then '/admin?tab=invites'
           when n.kind = 'invite_joined' and n.detail like 'qr:%' then '/peers/' || n.joined_id::text
           when n.kind = 'invite_joined' then '/invites'
           when n.kind in ('event_reminder', 'event_starting', 'event_notice', 'checked_in') then '/events/' || n.event_id::text
           when n.kind = 'event_changed' then coalesce('/events/' || n.event_id::text, '/events')
           when n.kind = 'check_in_reminder' then '/events/' || n.event_id::text || '/check-in'
           when n.kind = 'event_followup' then '/events/' || n.event_id::text || '/review'
           when n.kind in ('org_events', 'grant_open', 'join_request') then '/events/organizations/' || n.organization_id::text
           when n.kind = 'invite_request' then '/invites#requests'
           when n.kind = 'staff_verified' then '/me#profession'
           when n.kind = 'event_join_request' then '/events/' || n.event_id::text || '/guests'
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
       when n.kind = 'strike_message' then public.is_admin()
         or private.strike_owner(split_part(n.detail, ':', 1), split_part(n.detail, ':', 2)::uuid) = auth.uid()
       when n.kind = 'organization_request' and n.detail = 'asked' then public.is_admin()
       -- Only while they still speak for its organization.
       when n.kind = 'invite_request' then public.speaks_for(n.organization_id)
       when n.kind = 'join_request' then public.speaks_for(n.organization_id) or public.is_admin()
       -- Only while they may still change who is invited.
       when n.kind = 'event_join_request' then private.may_set_visibility(n.event_id)
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

CREATE OR REPLACE FUNCTION private.push_level_allows(p_member uuid, p_kind text, p_event text, p_key jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  chosen text := (select p.level from private.push_levels p where p.member_id = p_member);
begin
  if chosen is null then
    return true;
  end if;

  -- What needs you, at every level.
  if p_event = 'important'
     or p_kind in ('direct', 'mention', 'important', 'invite_request', 'join_request',
                   'organization_request', 'family_link', 'calendar_invite', 'report',
                   'event_starting', 'check_in_reminder', 'event_changed', 'staff_verified',
                   'event_join_request') then
    return true;
  end if;

  if chosen = 'balanced' then
    return p_kind not in ('like', 'reaction', 'org_events', 'grant_open', 'blocks_weekly',
                          'profile_reminder', 'invite_joined', 'event_followup');
  end if;

  -- Only what needs me: a group message only when it names them.
  if p_event = 'message' then
    return exists (
      select 1 from public.chat_messages m
       where m.id = (p_key ->> 'id')::uuid
         and private.message_names(m.body, p_member)
    );
  end if;
  return false;
end;
$function$;
