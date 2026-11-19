-- ============================================================================
-- A moved date keeps its invitation on a later date of the series
-- ============================================================================
-- The owner, 2026-11-19, moving one date of "The SCI Club Weekly": when the
-- date an invitation opens on is moved out of its series (20261118250000),
-- the invitation moves to another date still in the series, so a change to
-- the whole series finds it. It took the series' earliest date. A "this and
-- following" later part shares its series with the earlier part's dates, so
-- the Weekly's Nov 20 invitation went to Nov 13, a date of the earlier part
-- and past; a later change to it would have been applied from there. (Put
-- right by hand on live the same day: it is on Nov 27.)
--
-- Now the next date after the one moved, and only when there is none, the
-- earliest. calendar_one_date restated from 20261118250000 with that one
-- order changed.
-- ============================================================================

create or replace function private.calendar_one_date(
  opener uuid, recurrence timestamptz, seq integer, payload jsonb, cancelled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  zone constant text := 'America/Los_Angeles';
  series uuid;
  org uuid;
  h private.calendar_held_dates%rowtype;
  held boolean;
  occ uuid;
  next_opener uuid;
begin
  select e.series_id, e.organization_id into series, org from public.events e where e.id = opener;
  if series is null then
    return jsonb_build_object('status', 'single');
  end if;

  select * into h from private.calendar_held_dates x
   where x.series_id = series and x.original_start = recurrence;
  held := found;
  if held and seq < h.sequence then
    return jsonb_build_object('status', 'older');
  end if;

  -- The date's own event: the one it already became, else the series' date
  -- at that start, or on that day.
  if held then
    occ := h.event_id;
  else
    select x.id into occ from public.events x
     where x.series_id = series
       and (x.start_time at time zone zone)::date = (recurrence at time zone zone)::date
     order by (x.start_time = recurrence) desc, x.start_time
     limit 1;
  end if;

  if occ is not null then
    -- The invitation keeps a date that is still the series' as its event,
    -- so a change to the whole series finds the series (calendar_change_series).
    -- The next date after this one: a later part of a split series shares
    -- the series with the earlier part's dates, which are not its own.
    select x.id into next_opener from public.events x
     where x.series_id = series and x.id <> occ
     order by x.start_time <= (select o.start_time from public.events o where o.id = occ), x.start_time
     limit 1;
    if next_opener is not null then
      update public.calendar_invites i set event_id = next_opener where i.event_id = occ;
    end if;
  end if;

  if cancelled then
    if occ is not null then
      perform public.delete_event(occ);
    end if;
    insert into private.calendar_held_dates as x (series_id, original_start, event_id, sequence)
    values (series, recurrence, null, seq)
    on conflict (series_id, original_start)
      do update set event_id = null, sequence = excluded.sequence, held_at = now();
    return jsonb_build_object('status', 'cancelled');
  end if;

  if occ is null then
    -- Not made yet (past the 92 days the series is made for), or cancelled
    -- before: a one-off event at the new time.
    if (payload ->> 'starts')::timestamptz <= now() then
      return jsonb_build_object('status', 'none');
    end if;
    occ := private.calendar_make_event(payload || '{"repeat": null}', org);
  else
    update public.events x set series_id = null, updated_at = now() where x.id = occ;
    occ := private.calendar_change_event(occ, payload || '{"repeat": null}', org);
  end if;

  insert into private.calendar_held_dates as x (series_id, original_start, event_id, sequence)
  values (series, recurrence, occ, seq)
  on conflict (series_id, original_start)
    do update set event_id = excluded.event_id, sequence = excluded.sequence, held_at = now();
  return jsonb_build_object('status', 'changed', 'event', occ);
end;
$$;
revoke all on function private.calendar_one_date(uuid, timestamptz, integer, jsonb, boolean)
  from public, anon, authenticated;

