-- ============================================================================
-- A change counts the dates it changed, not the things
-- ============================================================================
-- The owner, 2026-11-20: "what does the (3 dates) mean?" One event moved to
-- another day and time and made in person said "(3 dates)": event_changes_told
-- (20261120160000) counted its rows after splitting what changed into one row
-- a word. It counts the events now. As 20261120160000 otherwise.
--
-- Probe: supabase/tests/event-changes-told.sql (5.).
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
           -- Dates, not the words: one row a word by now.
           count(distinct o.id)::integer as dates,
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
