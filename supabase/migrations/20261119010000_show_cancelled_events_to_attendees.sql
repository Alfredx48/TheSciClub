-- An RSVP holder can explain a disappearing date without keeping it on the calendar.
create table private.event_schedule_updates (
  member_id uuid not null references public.members (id) on delete cascade,
  event_id uuid not null,
  title text not null,
  previous_start timestamptz not null,
  previous_end timestamptz,
  previous_timezone text not null,
  previous_all_day boolean not null,
  new_start timestamptz,
  changed_at timestamptz not null default now(),
  primary key (member_id, event_id)
);

revoke all on private.event_schedule_updates from public, anon, authenticated;

create function private.record_event_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.event_schedule_updates (
    member_id, event_id, title, previous_start, previous_end, previous_timezone, previous_all_day
  )
  select r.member_id, old.id, old.title, old.start_time, old.end_time, old.timezone, old.all_day
  from public.event_rsvps r
  where r.event_id = old.id and r.status in ('going', 'interested')
  on conflict (member_id, event_id) do update
    set title = excluded.title, previous_start = excluded.previous_start,
        previous_end = excluded.previous_end, previous_timezone = excluded.previous_timezone,
        previous_all_day = excluded.previous_all_day, new_start = null, changed_at = now();
  return old;
end;
$$;

revoke all on function private.record_event_cancellation() from public, anon, authenticated;

create trigger record_event_cancellation
before delete on public.events
for each row
when (old.feed_id is null and old.start_time > statement_timestamp())
execute function private.record_event_cancellation();

create function public.my_event_schedule_updates(for_event uuid default null)
returns table (
  event_id uuid, title text, previous_start timestamptz, previous_end timestamptz,
  previous_timezone text, previous_all_day boolean, new_start timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.event_id, u.title, u.previous_start, u.previous_end, u.previous_timezone,
         u.previous_all_day, u.new_start
  from private.event_schedule_updates u
  where public.is_active_member()
    and u.member_id = auth.uid()
    and u.changed_at > now() - interval '30 days'
    and (for_event is null or u.event_id = for_event)
    and (u.new_start is null or public.can_see_event(u.event_id))
  order by u.changed_at desc, u.event_id
  limit 10;
$$;

revoke all on function public.my_event_schedule_updates(uuid) from public, anon;
grant execute on function public.my_event_schedule_updates(uuid) to authenticated;
