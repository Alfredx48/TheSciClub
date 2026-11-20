-- ============================================================================
-- An invite can make whoever joins on it a mentor of its organization
-- ============================================================================
-- The owner, 2026-11-19: "When admins are sending out invites individually or
-- from a spreadsheet let them specify that these users will be mentors. If
-- they join, they should automatically be mentors for the org the admin
-- selected."
--
--   - invites.as_mentor: false unless set.
--   - set_invites_mentor(p_invites, p_mentor): the inviter marks their own
--     pending invites, each for an organization they may make mentors for
--     (may_make_mentors_for: a club administrator, or that organization's
--     admin), as grant_mentor asks. All of them or none. The invite forms
--     call it after adding an invite and before its email goes.
--   - members_become_their_invites_mentors: when a member joins on such an
--     invite, they become a mentor of its organization (organization_mentors,
--     as grant_mentor does, granted by the inviter), which also makes them a
--     member of it (20261103120000) and sets their type (sync_mentor_type).
--     Only while the inviter still may make that organization's mentors and
--     the organization is still in the directory.
--
-- Expand only: a column with a default, a new function, a new trigger. The
-- invite RPCs and the app already shipped are untouched.
-- ============================================================================

alter table public.invites
  add column if not exists as_mentor boolean not null default false;

comment on column public.invites.as_mentor is
  'Whoever joins on this invite becomes a mentor of its organization (for_organization_id, else invited_by_organization_id). Set by set_invites_mentor. See 20261119200000.';

-- The organization an invite makes its member a member of: as
-- private.member_joins_their_organization reads it, without a code's.
create or replace function private.invite_organization(i public.invites)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select coalesce(i.for_organization_id, i.invited_by_organization_id);
$$;

revoke all on function private.invite_organization(public.invites) from public, anon, authenticated;

create or replace function public.set_invites_mentor(p_invites uuid[], p_mentor boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted uuid[] := coalesce(array(select distinct x from unnest(p_invites) x where x is not null), '{}');
  changed integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(wanted) w
     where not exists (
       select 1 from public.invites i
        where i.id = w
          and i.invited_by_member_id = auth.uid()
          and i.status = 'pending'
     )
  ) then
    raise exception 'Only your own invites, not yet used, can be made a mentor''s.' using errcode = '42501';
  end if;
  if p_mentor and exists (
    select 1 from public.invites i
     where i.id = any (wanted)
       and (
         private.invite_organization(i) is null
         or not exists (select 1 from public.organizations o
                         where o.id = private.invite_organization(i) and o.removed_at is null)
       )
  ) then
    raise exception 'A mentor is an organization''s: choose the organization they join.' using errcode = '22023';
  end if;
  if p_mentor and exists (
    select 1 from public.invites i
     where i.id = any (wanted)
       and not public.may_make_mentors_for(private.invite_organization(i))
  ) then
    raise exception 'Only that organization''s admins can make its mentors.' using errcode = '42501';
  end if;

  update public.invites i
     set as_mentor = p_mentor
   where i.id = any (wanted);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

comment on function public.set_invites_mentor(uuid[], boolean) is
  'The inviter marks their own pending invites as making a mentor of the organization each is for, or not. See 20261119200000.';

revoke all on function public.set_invites_mentor(uuid[], boolean) from public, anon;
grant execute on function public.set_invites_mentor(uuid[], boolean) to authenticated;

-- After consume_invite_for_new_member has tied the member to their invite.
create or replace function private.member_becomes_their_invites_mentor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invite_id is null or new.status <> 'active' or new.is_seed then
    return null;
  end if;
  insert into public.organization_mentors (organization_id, member_id, granted_by)
  select o.id, new.id, i.invited_by_member_id
    from public.invites i
    join public.organizations o on o.id = private.invite_organization(i) and o.removed_at is null
    join public.members a on a.id = i.invited_by_member_id and a.status = 'active'
   where i.id = new.invite_id
     and i.as_mentor
     and (
       a.is_admin
       or exists (select 1 from public.organization_representatives r
                   where r.organization_id = o.id and r.member_id = a.id)
     )
  on conflict do nothing;
  if found then
    perform private.sync_mentor_type(new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.member_becomes_their_invites_mentor() from public, anon, authenticated;

drop trigger if exists members_become_their_invites_mentors on public.members;
create trigger members_become_their_invites_mentors
  after insert on public.members
  for each row execute function private.member_becomes_their_invites_mentor();

notify pgrst, 'reload schema';
