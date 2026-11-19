-- ============================================================================
-- An administrator's code lets people in, as an organization's does
-- ============================================================================
-- The owner, 2026-11-19: "When I invite people with my invite QR code and they
-- put in their email it does not let them through ... They have to. Request an
-- invite from me".
--
-- An administrator's code with no organization only gave credit
-- (20261014020000): while joining was closed, whoever scanned it was turned
-- away at sign-up and asked to request an invite from its maker. Now every
-- live code lets in whoever comes through it, as an organization's, a
-- partner's and a shared question's do (20261028960000, 20261029100000,
-- 20261116200000). A code is still live only while it is not turned off, not
-- expired, and its maker still stands (private.live_qr_code and
-- private.qr_code_maker_stands, unchanged): an administrator's only while
-- they are an administrator. Codes already made, printed or shared let people
-- in from now on.
--
-- Expand only: two functions restated, no table touched.
--   - private.qr_code_lets_in: the sign-up hook, invite-signup's check,
--     qr_code_admits and qr_code_details all ask it, and qr_code_details then
--     names no email to ask.
--   - public.create_qr_code: an administrator's code with no organization no
--     longer needs an email, as there is no one to show it to. The iPhone app
--     already shipped still sends one, and it is still kept. An administrator
--     who is also a partner makes an administrator's code, as the page has
--     always offered them (a partner's own code was made only when they left
--     the email out, which the page never let them do).
-- ============================================================================

create or replace function private.qr_code_lets_in(q public.qr_codes)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select q.id is not null;
$$;

comment on function private.qr_code_lets_in(public.qr_codes) is
  'Whether a code lets in whoever comes through it while live: every code does since 20261119130000 (an administrator''s with no organization only gave credit before).';

revoke all on function private.qr_code_lets_in(public.qr_codes) from public, anon, authenticated;

-- As 20261029100000. With no organization: an administrator's code needs no
-- email now; a partner who is not an administrator makes their own code.
create or replace function public.create_qr_code(
  p_organization uuid,
  p_event_name text,
  p_contact_email text,
  p_expires_at timestamptz,
  p_notes text
)
returns public.qr_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  event text := nullif(btrim(coalesce(p_event_name, '')), '');
  address text := public.normalize_email(nullif(btrim(coalesce(p_contact_email, '')), ''));
  note text := nullif(btrim(coalesce(p_notes, '')), '');
  -- To the hour, rounded up: no code expires sooner than asked.
  expires timestamptz := case when p_expires_at is null then null
    else date_trunc('hour', p_expires_at)
         + case when p_expires_at = date_trunc('hour', p_expires_at) then interval '0' else interval '1 hour' end
  end;
  as_partner boolean := false;
  made public.qr_codes;
begin
  if p_organization is null then
    if not public.is_admin() and private.is_partner(auth.uid()) then
      as_partner := true;
    elsif not public.is_admin() then
      raise exception 'Choose the organization the code is for.' using errcode = '42501';
    end if;
    if address is not null and not private.valid_email(address) then
      address := null;
    end if;
  else
    if not (public.is_admin() or public.speaks_for(p_organization)) then
      raise exception 'Only that organization''s admins can make its codes.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.organizations where id = p_organization and removed_at is null) then
      raise exception 'That organization is no longer in the directory.' using errcode = 'P0002';
    end if;
    if address is not null and not private.valid_email(address) then
      address := null;
    end if;
  end if;
  if event is not null and not public.is_admin() then
    raise exception 'Only an administrator names an event on a code.' using errcode = '42501';
  end if;
  if event is not null and char_length(event) > 80 then
    raise exception 'Keep the event name to 80 characters.' using errcode = '22023';
  end if;
  if note is not null and char_length(note) > 300 then
    raise exception 'Keep the note to 300 characters.' using errcode = '22023';
  end if;
  if p_expires_at is not null
     and (p_expires_at <= now() or p_expires_at > now() + interval '366 days') then
    raise exception 'Choose when the code expires: within a year from now.' using errcode = '22023';
  end if;
  select q.* into made
    from public.qr_codes q
   where q.admin_id = auth.uid()
     and q.turned_off_at is null
     and (q.expires_at is null or q.expires_at > now())
     and q.organization_id is not distinct from p_organization
     and q.made_as_partner = as_partner
     and q.event_name is not distinct from event
     and q.contact_email is not distinct from address::extensions.citext
     and q.expires_at is not distinct from expires
     and q.notes is not distinct from note
   order by q.created_at desc
   limit 1;
  if found then
    return made;
  end if;
  insert into public.qr_codes (admin_id, organization_id, event_name, contact_email, expires_at, notes, made_as_partner)
  values (auth.uid(), p_organization, event, address, expires, note, as_partner)
  returning * into made;
  return made;
end;
$$;

