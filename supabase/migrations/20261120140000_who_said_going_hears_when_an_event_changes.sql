-- ============================================================================
-- Who said Going or Interested hears when an event changes
-- ============================================================================
-- The owner, 2026-11-20: "only notify interested people if the date, time or
-- place changes, also if it's changed from in person to online or vice versa;
-- the rest of the changes send if they are going, including the ones I
-- mentioned."
--
-- A new kind, event_changed, in the bell and by push, which a member can
-- switch off on Me:
--
--   Going       the date, the time, the place, in person / online, the video
--               call link, and the event being cancelled (deleted)
--   Interested  the date, the time, the place, in person / online
--
-- Not its words, picture or anything else. Not for an event that is over,
-- not to whoever made the change, not across a block, not to a paused member.
-- An import counts as a change as well (its calendar is where the organizer
-- changed it).
--
-- detail lists what changed, in this order: the new format ('in_person',
-- 'online', 'hybrid') when it changed, then 'date', 'time', 'place', 'link'.
-- A cancellation's detail is 'cancelled:' and the event's title, since the
-- event is gone (and its event_id with it). Unread, a second change to the
-- same event adds to the same notice. A repeating event's dates changed or
-- cancelled together are one notice, count the number of dates.
--
-- An invitation joining the event already there (20261105120000,
-- 20261105140000) deletes one copy after moving its RSVPs to the other: no
-- notice for a member who has an RSVP, written in the same transaction or
-- to an event of that title and time, to another event.
--
-- push_owed is as 20261114100000 with this kind's push added beside
-- push_owed_every (private.event_changed_owed), not inside it. my_notifications
-- as 20261120120000, notification_badge as 20261104205000 and
-- push_level_allows as 20261114060000, each with event_changed added and
-- nothing else changed. push-notify words it, so it needs deploying; until
-- then the bell has it and the push is refused.
--
-- Probe: supabase/tests/event-changes-told.sql.
-- ============================================================================

-- -------------------------------------------------------------- the kind
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'report',
  'invite_joined', 'event_reminder', 'org_events', 'grant_open', 'profile_reminder',
  'blocks_weekly', 'reaction', 'event_starting', 'invite_request', 'mention', 'introduction',
  'join_request', 'check_in_reminder', 'event_followup', 'calendar_invite',
  'organization_request', 'event_notice', 'family_link', 'checked_in', 'important',
  'anonymous_flagged', 'strike_given', 'strike_message', 'strike_withdrawn', 'event_changed'
));

alter table public.push_muted_kinds drop constraint if exists push_muted_kinds_kind_check;
alter table public.push_muted_kinds add constraint push_muted_kinds_kind_check check (kind in (
  'group_add', 'reply_participant', 'report', 'invite_joined', 'event_reminder', 'org_events',
  'like', 'grant_open', 'profile_reminder', 'reaction', 'event_starting', 'invite_request',
  'mention', 'introduction', 'join_request', 'check_in_reminder', 'event_followup',
  'calendar_invite', 'organization_request', 'event_notice', 'family_link', 'checked_in',
  'important', 'event_changed'
));

-- ------------------------------------------------------------- what changed
-- What a place is, to compare: words and numbers only, in any case. The state
-- is left out, since events_take_a_state fills it in on its own.
create function private.event_place_key(p_location text, p_city text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(concat_ws(' ', p_location, p_city)),
                                     '[^[:alnum:]]+', ' ', 'g')), '');
$$;

-- What changed, in the order the words say it: one format, the newest given,
-- then date, time, place, link. Unknown words are dropped.
create function private.event_change_detail(p_older text[], p_newer text[])
returns text
language sql
immutable
set search_path = ''
as $$
  with formats as (
    select f from unnest(p_newer) f where f in ('in_person', 'online', 'hybrid')
    union all
    select f from unnest(p_older) f
     where f in ('in_person', 'online', 'hybrid')
       and not exists (select 1 from unnest(p_newer) g where g in ('in_person', 'online', 'hybrid'))
  ),
  every_word as (
    (select f as w, 0 as o from formats limit 1)
    union all
    select w, array_position(array['date', 'time', 'place', 'link'], w)
      from (select distinct w from unnest(coalesce(p_older, '{}') || coalesce(p_newer, '{}')) w) d
     where w in ('date', 'time', 'place', 'link')
  )
  select nullif(string_agg(w, ',' order by o), '') from every_word;
$$;

-- A cancelled event's title, from its notice's detail.
create function private.event_change_title(p_detail text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_detail like 'cancelled:%' then substr(p_detail, length('cancelled:') + 1) end;
$$;

revoke all on function private.event_place_key(text, text) from public, anon, authenticated;
revoke all on function private.event_change_detail(text[], text[]) from public, anon, authenticated;
revoke all on function private.event_change_title(text) from public, anon, authenticated;

-- ------------------------------------------------------------ a change told
create function private.event_changes_told()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  batch timestamptz := clock_timestamp();
  told integer;
begin
  with changed as (
    select e.id, coalesce(e.series_id, e.id) as grouping, e.start_time,
           array_remove(array[
             case when fmt then e.event_format end,
             case when (b.start_time at time zone z.tz)::date
                       is distinct from (e.start_time at time zone z.tz)::date then 'date' end,
             case when (b.start_time at time zone z.tz)::time
                       is distinct from (e.start_time at time zone z.tz)::time
                    -- How long it is: a day later is the date alone.
                    or (b.end_time - b.start_time) is distinct from (e.end_time - e.start_time)
                    or b.all_day is distinct from e.all_day then 'time' end,
             case when not fmt
                   and not (coalesce(b.event_format, '') = 'online' and coalesce(e.event_format, '') = 'online')
                   and private.event_place_key(b.location, b.city)
                       is distinct from private.event_place_key(e.location, e.city) then 'place' end,
             case when not (fmt and e.event_format = 'in_person')
                   and nullif(btrim(b.meeting_url), '') is distinct from nullif(btrim(e.meeting_url), '')
                  then 'link' end
           ], null) as words
      from new_rows e
      join old_rows b on b.id = e.id
      left join public.data_feeds f on f.id = e.feed_id
      cross join lateral (
        select coalesce(e.timezone, f.timezone, 'America/Los_Angeles') as tz,
               b.event_format is not null and e.event_format is not null
                 and b.event_format <> e.event_format as fmt
      ) z
      -- Not for one that is over, before or after.
     where coalesce(b.end_time, b.start_time) > now()
       and coalesce(e.end_time, e.start_time) > now()
  ),
  -- Interested hear of all but the link.
  owed as (
    select r.member_id, c.grouping, c.id, c.start_time,
           case when r.status = 'going' then c.words else array_remove(c.words, 'link') end as words
      from changed c
      join public.event_rsvps r on r.event_id = c.id and r.status in ('going', 'interested')
      join public.members m on m.id = r.member_id and m.status = 'active'
     where cardinality(c.words) > 0
       and r.member_id is distinct from me
       and not private.blocked_between(r.member_id, me)
  ),
  each_member as (
    select o.member_id, o.grouping,
           (array_agg(o.id order by o.start_time))[1] as event_id,
           count(*)::integer as dates,
           private.event_change_detail('{}', array_agg(w)) as detail
      from owed o
      cross join lateral unnest(o.words) w
     group by o.member_id, o.grouping
  )
  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, detail, count, created_at)
  select x.member_id, 'event_changed', 'event_changed:' || x.grouping::text, me, x.event_id,
         x.detail, x.dates, batch
    from each_member x
   where x.detail is not null
  on conflict (member_id, tag) where read_at is null
  do update set detail = private.event_change_detail(string_to_array(n.detail, ','),
                                                     string_to_array(excluded.detail, ',')),
                count = greatest(n.count, excluded.count),
                event_id = excluded.event_id,
                actor_id = excluded.actor_id,
                created_at = excluded.created_at,
                seen_at = null;
  get diagnostics told = row_count;

  if told > 0 then
    perform public.push_notify_send('event_changed', jsonb_build_object('batch', batch));
  end if;
  return null;
end;
$$;

revoke all on function private.event_changes_told() from public, anon, authenticated;

create trigger events_changes_told
after update on public.events
referencing old table as old_rows new table as new_rows
for each statement
execute function private.event_changes_told();

-- ------------------------------------------------------- a cancellation told
-- Noted before the delete takes the RSVPs with it; pushed once the statement
-- is done, as one batch for every date it took.
create function private.event_cancellation_noted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  batch timestamptz := nullif(current_setting('sciclub.event_cancel_batch', true), '')::timestamptz;
begin
  if batch is null then
    batch := clock_timestamp();
    perform set_config('sciclub.event_cancel_batch', batch::text, true);
  end if;

  insert into public.notifications as n
    (member_id, kind, tag, actor_id, detail, count, created_at)
  select r.member_id, 'event_changed', 'event_cancelled:' || coalesce(old.series_id, old.id)::text,
         me, 'cancelled:' || old.title, 1, batch
    from public.event_rsvps r
    join public.members m on m.id = r.member_id and m.status = 'active'
   where r.event_id = old.id
     and r.status = 'going'
     and r.member_id is distinct from me
     and not private.blocked_between(r.member_id, me)
     -- Moved to the event this one joined, not cancelled.
     and not exists (
       select 1 from public.event_rsvps x
         join public.events o on o.id = x.event_id
        where x.member_id = r.member_id
          and x.event_id <> old.id
          and (x.created_at = now() or (o.title = old.title and o.start_time = old.start_time))
     )
  on conflict (member_id, tag) where read_at is null
  do update set count = n.count + 1,
                detail = excluded.detail,
                actor_id = excluded.actor_id,
                created_at = excluded.created_at,
                seen_at = null;
  return old;
end;
$$;

create function private.event_cancellations_pushed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch text := nullif(current_setting('sciclub.event_cancel_batch', true), '');
begin
  if batch is not null then
    perform set_config('sciclub.event_cancel_batch', '', true);
    if exists (
      select 1 from public.notifications n
       where n.kind = 'event_changed' and n.created_at = batch::timestamptz and n.read_at is null
    ) then
      perform public.push_notify_send('event_changed', jsonb_build_object('batch', batch::timestamptz));
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.event_cancellation_noted() from public, anon, authenticated;
revoke all on function private.event_cancellations_pushed() from public, anon, authenticated;

create trigger events_cancellation_noted
before delete on public.events
for each row
when (old.start_time > now())
execute function private.event_cancellation_noted();

create trigger events_cancellations_pushed
after delete on public.events
for each statement
execute function private.event_cancellations_pushed();

-- ------------------------------------------------------------------ the push
-- subject the event's title, detail what changed, count how many dates.
create function private.event_changed_owed(p_event text, p_key jsonb)
returns table(endpoint text, p256dh text, auth text, kind text, actor_name text, body text, photo_count integer, subject text, detail text, url text, tag text, badge integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth,
         'event_changed'::text, a.display_name, null::text, n.count,
         coalesce(e.title, private.event_change_title(n.detail)),
         n.detail,
         coalesce('/events/' || e.id::text, '/events'), n.tag,
         public.notification_badge(r.id)
    from public.notifications n
    left join public.events e on e.id = n.event_id
    join public.members r on r.id = n.member_id and r.status = 'active'
    join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
    left join public.members a on a.id = n.actor_id
   where p_event = 'event_changed'
     and n.kind = 'event_changed'
     and n.created_at = (p_key ->> 'batch')::timestamptz
     and n.read_at is null
     and not exists (
       select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_changed'
     )
     and not private.blocked_between(r.id, n.actor_id);
$$;

revoke all on function private.event_changed_owed(text, jsonb) from public, anon, authenticated;

-- push_owed_every is asked first, so a wrong secret still raises.
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
  )
  select o.*
    from every_one o
   where private.push_level_allows(
     (select s.member_id from public.push_subscriptions s where s.endpoint = o.endpoint limit 1),
     o.kind, p_event, p_key)
     and private.first_reaction_owed(p_event, p_key);
$function$;

-- ------------------------------------------------ the bell, badge and level
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
           -- A cancelled event is gone; its title is kept in detail (20261120140000).
           when n.kind = 'event_changed' then coalesce(ev.title, private.event_change_title(n.detail))
           when n.kind in ('org_events', 'grant_open', 'invite_request', 'join_request') then o.name
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

CREATE OR REPLACE FUNCTION public.notification_badge(member uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(distinct case
           when n.kind in ('direct', 'group', 'group_add') then 'messages'
           when n.kind in ('reply', 'reply_participant') then 'replies'
           when n.kind in ('event_reminder', 'event_starting', 'check_in_reminder', 'event_followup', 'org_events', 'event_notice', 'event_changed') then 'events'
           when n.kind in ('report', 'blocks_weekly') then 'reports'
           else n.kind
         end)::integer
    from public.notifications n
    join public.members r on r.id = n.member_id and r.status = 'active'
    left join public.chat_messages m on m.id = n.message_id
    left join public.chat_topics tp on tp.id = n.topic_id
    left join public.chat_rooms rm on rm.id = tp.room_id
    left join public.chat_posts p on p.id = n.post_id
   where n.member_id = member
     and n.seen_at is null
     and n.created_at > now() - interval '30 days'
     and not exists (
       select 1 from public.push_muted_kinds x
        where x.member_id = member
          and x.kind = case n.kind when 'blocks_weekly' then 'report' else n.kind end
     )
     and case
       when n.kind in ('direct', 'group', 'group_add') then exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = member
       )
       when n.kind = 'reaction' and n.thread_id is not null then m.removed_at is null and exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = member
       )
       when n.kind in ('reply', 'reply_participant') then
         rm.opened_at is not null or (r.is_admin and r.status = 'active')
       when n.kind in ('like', 'reaction', 'mention') then p.removed_at is null
         and (rm.opened_at is not null or (r.is_admin and r.status = 'active'))
       when n.kind in ('report', 'blocks_weekly') then r.is_admin and r.status = 'active'
       else true
     end
     and not exists (
       select 1 from public.member_blocks b
        where (b.blocker_id = member and b.blocked_id in (n.actor_id, tp.author_id))
           or (b.blocked_id = member and b.blocker_id in (n.actor_id, tp.author_id) and not r.is_admin)
     );
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
                   'event_starting', 'check_in_reminder', 'event_changed') then
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
