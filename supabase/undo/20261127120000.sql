-- Undoes 20261127120000: no asking to join; my_notifications, push_owed and
-- push_level_allows as 20261125160000; its notifications are deleted.
begin;
delete from public.notifications where kind = 'event_join_request';
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'report',
  'invite_joined', 'event_reminder', 'org_events', 'grant_open', 'profile_reminder',
  'blocks_weekly', 'reaction', 'event_starting', 'invite_request', 'mention', 'introduction',
  'join_request', 'check_in_reminder', 'event_followup', 'calendar_invite',
  'organization_request', 'event_notice', 'family_link', 'checked_in', 'important',
  'anonymous_flagged', 'strike_given', 'strike_message', 'strike_withdrawn', 'event_changed',
  'staff_verified'
));
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
  )
  select o.*
    from every_one o
   where private.push_level_allows(
     (select s.member_id from public.push_subscriptions s where s.endpoint = o.endpoint limit 1),
     o.kind, p_event, p_key)
     and private.first_reaction_owed(p_event, p_key);
$function$;
drop function private.event_join_request_owed(text, jsonb);
drop function public.answer_event_join_request(uuid, uuid, boolean);
drop function public.event_join_requests_for(uuid);
drop function public.my_event_join_request(uuid);
drop function public.ask_to_join_event(uuid);
drop table public.event_join_requests;
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
                   'event_starting', 'check_in_reminder', 'event_changed', 'staff_verified') then
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
delete from supabase_migrations.schema_migrations where version = '20261127120000';
commit;
