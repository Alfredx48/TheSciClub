-- ============================================================================
-- Who said Interested hears of every change in the bell only
-- ============================================================================
-- The owner, 2026-11-20: "Make all the interested notifications be in app
-- for bell only but group the notifications if they change multiple things
-- at once."
--
-- event_changes_told (20261120140000) notes Interested under the tag
-- event_changed_bell:, which event_changed_owed leaves out, as
-- 20261120150000 did for a cancellation: no push. Going is as before.
--
-- Grouped as before: one notice an event (a repeating event's dates changed
-- together, one notice), saying everything that changed, and a later change
-- adds to it while it is unread. Going and Interested to different dates of
-- one repeating event are two notices, one each.
--
-- Probe: supabase/tests/event-changes-told.sql.
-- ============================================================================

create or replace function private.event_changes_told()
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
    select r.member_id, r.status, c.grouping, c.id, c.start_time,
           case when r.status = 'going' then c.words else array_remove(c.words, 'link') end as words
      from changed c
      join public.event_rsvps r on r.event_id = c.id and r.status in ('going', 'interested')
      join public.members m on m.id = r.member_id and m.status = 'active'
     where cardinality(c.words) > 0
       and r.member_id is distinct from me
       and not private.blocked_between(r.member_id, me)
  ),
  each_member as (
    select o.member_id, o.status, o.grouping,
           (array_agg(o.id order by o.start_time))[1] as event_id,
           count(*)::integer as dates,
           private.event_change_detail('{}', array_agg(w)) as detail
      from owed o
      cross join lateral unnest(o.words) w
     group by o.member_id, o.status, o.grouping
  )
  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, detail, count, created_at)
  -- Interested: in the bell only, under a tag of its own that the push skips.
  select x.member_id, 'event_changed',
         case when x.status = 'going' then 'event_changed:' else 'event_changed_bell:' end
           || x.grouping::text,
         me, x.event_id,
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

create or replace function private.event_changed_owed(p_event text, p_key jsonb)
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
     and n.tag not like 'event_cancelled\_bell:%'
     and n.tag not like 'event_changed\_bell:%'
     and n.created_at = (p_key ->> 'batch')::timestamptz
     and n.read_at is null
     and not exists (
       select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_changed'
     )
     and not private.blocked_between(r.id, n.actor_id);
$$;
