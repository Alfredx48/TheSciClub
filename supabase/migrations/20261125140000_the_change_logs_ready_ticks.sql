-- ============================================================================
-- The change log's ticks: ready for main
-- ============================================================================
-- The owner, 2026-11-25: On tests in the admin site's change log (admin/change-log.tsx)
-- gets "a column for ready for push to main". An administrator ticks a change once it
-- has been tried on the test site; every administrator sees the same ticks.
--
-- A change is known by its key: the first twelve hex digits of the SHA-1 of its commit's
-- first line (admin/changes.mjs), the same on tests and on main. So a tick follows its
-- change through a cherry-pick, and nothing here knows about git.
--
-- public.change_log_ready holds the ticked changes: a row is a tick, no row is none.
-- Nobody reads or writes it directly (row level security with no policy); two functions
-- for administrators do:
--   admin_change_log_ready()            the ticks, with who made each
--   admin_mark_change_ready(change, ready)   tick or untick one
-- A tick is dropped 120 days on: its change is on main long before, and no longer listed.
--
-- Used by the admin site only. Additive: the shipped apps never ask for it.
--
-- Probe: supabase/tests/change-log-ready.sql.
-- Undo: supabase/undo/20261125140000.sql.
-- ============================================================================

create table public.change_log_ready (
  change_key text primary key check (change_key ~ '^[0-9a-f]{12}$'),
  marked_by uuid references public.members (id) on delete set null,
  marked_at timestamptz not null default now()
);

comment on table public.change_log_ready is
  'The changes on tests an administrator ticked as ready for main, by the change log''s key. Read and written only through admin_change_log_ready and admin_mark_change_ready.';

alter table public.change_log_ready enable row level security;
revoke all on table public.change_log_ready from public, anon, authenticated;

create function public.admin_change_log_ready()
returns table (change_key text, marked_by text, marked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators see the change log''s ticks.' using errcode = '42501';
  end if;

  return query
    select r.change_key, m.display_name::text, r.marked_at
      from public.change_log_ready r
      left join public.members m on m.id = r.marked_by
     order by r.marked_at desc;
end;
$$;

comment on function public.admin_change_log_ready() is
  'For administrators: the changes ticked ready for main in the change log, and who ticked each.';

create function public.admin_mark_change_ready(change text, ready boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators tick a change ready.' using errcode = '42501';
  end if;
  if change is null or change !~ '^[0-9a-f]{12}$' then
    raise exception 'That is not a change''s key.' using errcode = '22023';
  end if;

  if coalesce(ready, false) then
    -- The first tick stands: it says who found the change ready.
    insert into public.change_log_ready (change_key, marked_by)
    values (change, (select auth.uid()))
    on conflict on constraint change_log_ready_pkey do nothing;
  else
    delete from public.change_log_ready r where r.change_key = change;
  end if;

  delete from public.change_log_ready r where r.marked_at < now() - interval '120 days';
end;
$$;

comment on function public.admin_mark_change_ready(text, boolean) is
  'For administrators: tick a change in the change log as ready for main, or take the tick back.';

revoke all on function public.admin_change_log_ready() from public, anon;
revoke all on function public.admin_mark_change_ready(text, boolean) from public, anon;
grant execute on function public.admin_change_log_ready() to authenticated;
grant execute on function public.admin_mark_change_ready(text, boolean) to authenticated;
