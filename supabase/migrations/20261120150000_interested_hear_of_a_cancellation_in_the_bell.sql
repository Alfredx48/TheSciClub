-- ============================================================================
-- Who said Interested hears of a cancellation too, in the bell only
-- ============================================================================
-- The owner, 2026-11-20, of telling Interested when an event is cancelled:
-- "Yes but only send out as in an in app bell notification for interested."
--
-- event_cancellation_noted (20261120140000) notes Interested as well as
-- Going, under the tag event_cancelled_bell:, which event_changed_owed leaves
-- out, so they get no push. Both as 20261120140000 otherwise.
--
-- Probe: supabase/tests/event-changes-told.sql.
-- ============================================================================

create or replace function private.event_cancellation_noted()
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
  -- Interested: in the bell only, under a tag of its own that the push skips.
  select r.member_id, 'event_changed',
         case when r.status = 'going' then 'event_cancelled:' else 'event_cancelled_bell:' end
           || coalesce(old.series_id, old.id)::text,
         me, 'cancelled:' || old.title, 1, batch
    from public.event_rsvps r
    join public.members m on m.id = r.member_id and m.status = 'active'
   where r.event_id = old.id
     and r.status in ('going', 'interested')
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
     and n.created_at = (p_key ->> 'batch')::timestamptz
     and n.read_at is null
     and not exists (
       select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_changed'
     )
     and not private.blocked_between(r.id, n.actor_id);
$$;
