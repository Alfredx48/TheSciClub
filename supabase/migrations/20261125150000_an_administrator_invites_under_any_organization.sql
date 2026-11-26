-- ============================================================================
-- An administrator invites under any organization
-- ============================================================================
-- The owner, 2026-11-25: the club's administrators "can choose any
-- organization to invite under". create_my_invite and admin_invite_list
-- already take any organization from an administrator; the email
-- admin_create_invite (20261012000000) still asked for can_invite, which only
-- 4 of the directory's organizations have. It now takes any organization
-- that has not been removed. Everything else is as it was; the versions with
-- a name and a message (20261115160000, 20261117160000) call this one.
--
-- Undo: the same function with the can_invite check of 20261012000000.
-- Probe: supabase/tests/admin-vouches-directly.sql, step 6.
-- ============================================================================

create or replace function public.admin_create_invite(
  raw_email text,
  organization_id uuid default null,
  note text default null
)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := public.normalize_email(raw_email);
  created public.invites;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator';
  end if;
  if not private.valid_email(address) then
    raise exception 'That does not look like an email address' using errcode = '22023';
  end if;
  if organization_id is not null
     and not exists (
       select 1 from public.organizations o where o.id = organization_id and o.removed_at is null
     ) then
    raise exception 'There is no such organization.' using errcode = 'P0002';
  end if;
  if public.is_blocked_email(address) then
    raise exception 'That email address is blocked from the club and cannot be invited';
  end if;
  if exists (
    select 1 from public.invites i
     where lower(i.email::text) = address and i.status in ('pending', 'consumed')
  ) then
    raise exception 'That email address is already on the list' using errcode = '23505';
  end if;

  insert into public.invites (email, invited_by_organization_id, invited_by_member_id, note)
  values (
    address::extensions.citext,
    organization_id,
    case when organization_id is null then auth.uid() end,
    nullif(btrim(coalesce(note, '')), '')
  )
  returning * into created;

  return created;
end;
$$;

revoke all on function public.admin_create_invite(text, uuid, text) from public, anon;
grant execute on function public.admin_create_invite(text, uuid, text) to authenticated;
