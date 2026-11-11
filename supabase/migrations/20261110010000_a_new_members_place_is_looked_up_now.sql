-- ============================================================================
-- A new member's place is looked up now, not overnight
-- ============================================================================
-- The owner, 2026-11-10: a friend who had just joined was missing from Peers,
-- because only the nightly import placed a new zip or town, and the list
-- could not measure him. Saving a city, state or zip that leaves the member
-- unplaced now starts the Geocode workflow (private.geocode_send,
-- 20261026000000), which places members' zips and towns first. Runs after
-- member_placed and member_moved (trigger names sort), so member_places is
-- already worked out. Never blocks the save.
-- ============================================================================

create or replace function private.look_up_unplaced_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if not exists (select 1 from private.member_places p where p.member_id = new.id) then
      perform private.geocode_send();
    end if;
  exception when others then
    raise warning 'look_up_unplaced_member: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.look_up_unplaced_member() from public, anon, authenticated;

drop trigger if exists member_unplaced_looked_up on public.members;
create trigger member_unplaced_looked_up
  after insert on public.members
  for each row
  when (new.zip is not null or new.city is not null)
  execute function private.look_up_unplaced_member();

drop trigger if exists member_unplaced_moved on public.members;
create trigger member_unplaced_moved
  after update of city, state, zip on public.members
  for each row
  when (old.city is distinct from new.city
     or old.state is distinct from new.state
     or old.zip is distinct from new.zip)
  execute function private.look_up_unplaced_member();
