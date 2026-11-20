-- ============================================================================
-- An administrator emails a member from their own mail app
-- ============================================================================
-- The owner, 2026-11-20: "a button for admins on the peer page asking them to
-- fill in their mentor profile and install the app ... Maybe a button that
-- says create e-mail", and "I want it to come from me. Maybe a mailto link.
-- Something I can do on my phone."
--
-- The page writes the email; the administrator's own mail app sends it. All
-- the page needs is where to send it: the member's sign-in address, which
-- Admin → Members already shows administrators (admin_member_search,
-- 20261029230000, through private.account_email). This hands over that one
-- address, for one member, to the club's administrators and nobody else.
--
-- Expand only: a new function.
-- ============================================================================

create function public.admin_member_email(p_member uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;
  return private.account_email(p_member);
end;
$$;

revoke all on function public.admin_member_email(uuid) from public, anon;
grant execute on function public.admin_member_email(uuid) to authenticated;
