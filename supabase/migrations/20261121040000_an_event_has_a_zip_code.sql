-- ============================================================================
-- An event has a ZIP code
-- ============================================================================
-- The owner, 2026-11-20: "Can you add an optional zip code address bar that
-- autofills with auto fill addresses?" Adding or changing an event asks for
-- one, optionally; a suggested address fills it in.
--
-- events.postal_code was there already, for imported events. A member's
-- event sets it as the video call link is set (20261106070000): on its own,
-- after save_event or save_event_series, by whoever may change the event, and
-- for a repeating event its later dates too, with the template keeping it for
-- dates made later. Not inside save_event: the test project has a second
-- save_event (access details) that a changed signature would split from.
--
-- Five digits, or ZIP+4. Empty clears it.
--
-- Probe: supabase/tests/event-zip-code.sql.
-- ============================================================================

create function public.set_event_postal_code(event uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  clean text := nullif(btrim(coalesce(code, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  select * into existing from public.events e where e.id = event for update;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if not public.may_change_event(event) then
    raise exception 'You cannot change this event.' using errcode = '42501';
  end if;
  if clean is not null and clean !~ '^\d{5}(-\d{4})?$' then
    raise exception 'A ZIP code is five digits, like 94404.' using errcode = '22023';
  end if;

  update public.events e
     set postal_code = clean,
         updated_at = now()
   where e.id = event
      or (
        existing.series_id is not null
        and e.series_id = existing.series_id
        and e.feed_id is null
        and e.start_time > existing.start_time
        and public.may_post_events_for(e.organization_id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template || jsonb_build_object('postal_code', clean),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;
end;
$$;
revoke all on function public.set_event_postal_code(uuid, text) from public, anon;
grant execute on function public.set_event_postal_code(uuid, text) to authenticated;

-- A date the series makes later takes the ZIP code its template has.
create function private.event_takes_its_series_postal_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.series_id is not null and new.postal_code is null and new.feed_id is null then
    select s.template ->> 'postal_code' into new.postal_code
      from public.event_series s
     where s.id = new.series_id and s.feed_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.event_takes_its_series_postal_code() from public, anon, authenticated;

create trigger event_takes_its_series_postal_code
  before insert on public.events
  for each row execute function private.event_takes_its_series_postal_code();
