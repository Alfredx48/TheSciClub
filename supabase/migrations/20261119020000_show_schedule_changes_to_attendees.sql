create function private.record_event_reschedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.event_schedule_updates (
    member_id, event_id, title, previous_start, previous_end,
    previous_timezone, previous_all_day, new_start
  )
  select r.member_id, new.id, new.title, old.start_time, old.end_time,
         coalesce(old.timezone, 'America/Los_Angeles'), old.all_day, new.start_time
  from public.event_rsvps r
  where r.event_id = new.id and r.status in ('going', 'interested')
  on conflict (member_id, event_id) do update
    set title = excluded.title, previous_start = excluded.previous_start,
        previous_end = excluded.previous_end, previous_timezone = excluded.previous_timezone,
        previous_all_day = excluded.previous_all_day, new_start = excluded.new_start,
        changed_at = now();
  return new;
end;
$$;

revoke all on function private.record_event_reschedule() from public, anon, authenticated;

create trigger record_event_reschedule
after update of start_time, end_time, timezone, all_day on public.events
for each row
when (
  old.feed_id is null and (old.start_time > statement_timestamp() or new.start_time > statement_timestamp())
  and (old.start_time, old.end_time, old.timezone, old.all_day)
       is distinct from (new.start_time, new.end_time, new.timezone, new.all_day)
)
execute function private.record_event_reschedule();
