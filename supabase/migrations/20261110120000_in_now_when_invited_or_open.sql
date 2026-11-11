-- ============================================================================
-- In now, confirm later: an invited address, or anybody while joining is open
-- ============================================================================
-- The owner, 2026-11-10: whoever passes the sign-up checks goes straight in
-- and confirms their email from Me, not only those with a code or an invite
-- link (20261104110000). That now includes an address on the invite list typed
-- on the join form, and any address while joining is open. The owner accepted
-- that somebody could join with an invited person's address; the real owner
-- takes it back with Google or Apple, or a reset link (20261104120000).
--
-- invite-signup asks this before making the account. It is the sign-up hook's
-- own rule, asked with the address alone: not blocked, and invited or open.
-- ============================================================================

create function public.email_may_join_now(p_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_address is not null
     and not (
       public.signup_needs_an_invite(
         jsonb_build_object(
           'user',
           jsonb_build_object(
             'email', p_address,
             'app_metadata', jsonb_build_object('provider', 'email')
           )
         )
       ) ? 'error'
     );
$$;

comment on function public.email_may_join_now(text) is
  'Whether an email sign-up at this address passes signup_needs_an_invite with no token or code. For invite-signup only. See 20261110120000.';

revoke all on function public.email_may_join_now(text) from public, anon, authenticated;
grant execute on function public.email_may_join_now(text) to service_role;
