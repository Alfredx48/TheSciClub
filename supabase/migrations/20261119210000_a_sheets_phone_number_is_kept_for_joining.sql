-- ============================================================================
-- A phone number from an invite spreadsheet fills in the phone when they join
-- ============================================================================
-- The owner, 2026-11-19: "oh and also pull the phone column if it exists",
-- then "You don't need to display the phone in the list".
--
--   - invites.invitee_phone: the number the spreadsheet gave, as typed.
--     Only a contact number, like members.phone (20261012000000): not the old
--     phone invite's phone_raw, which is unique among live invites and checked
--     against blocked numbers.
--   - admin_invite_list keeps each person's "phone", when the app sends one.
--     The app already shipped sends none, and nothing changes for it.
--   - invite_details_for_token answers it as the phone, after a number typed
--     when registering for an event. Joining already fills an empty phone box
--     with that answer, as it does the name.
--
-- Expand only: a new column, two functions replaced with the same arguments
-- and results.
-- ============================================================================

alter table public.invites
  add column if not exists invitee_phone text
    check (invitee_phone is null or char_length(invitee_phone) between 1 and 32);

comment on column public.invites.invitee_phone is
  'A contact number from the spreadsheet the invite came from, filled in when they join. Optional. 20261119210000.';

create or replace function public.admin_invite_list(
  p_people jsonb,
  p_organization uuid default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  words text := nullif(btrim(coalesce(p_message, '')), '');
  person jsonb;
  address text;
  who text;
  number text;
  seen text[] := '{}';
  outcome text;
  made uuid;
  results jsonb := '[]'::jsonb;
begin
  if me is null or not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;
  if jsonb_typeof(p_people) is distinct from 'array' then
    raise exception 'The list did not come through.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_people) > 200 then
    raise exception 'Up to 200 people at a time.' using errcode = '22023';
  end if;
  if words is not null and char_length(words) > 1000 then
    raise exception 'The message can be up to 1,000 characters.' using errcode = '22023';
  end if;
  if p_organization is not null and not exists (
    select 1 from public.organizations o
     where o.id = p_organization and o.removed_at is null and not o.is_the_club
  ) then
    raise exception 'There is no such organization.' using errcode = 'P0002';
  end if;

  for person in select value from jsonb_array_elements(p_people) loop
    address := public.normalize_email(coalesce(person ->> 'email', ''));
    who := nullif(left(btrim(coalesce(person ->> 'name', '')), 80), '');
    -- A number nobody could mean (too long) is left off, not refused.
    number := nullif(btrim(coalesce(person ->> 'phone', '')), '');
    if number is not null and char_length(number) > 32 then
      number := null;
    end if;
    made := null;

    if not private.valid_email(address) then
      outcome := 'not_an_email';
    elsif address = any (seen) then
      outcome := 'repeat';
    elsif public.is_blocked_email(address) then
      outcome := 'blocked';
    elsif exists (select 1 from auth.users u where lower(u.email) = address) then
      outcome := 'member';
    elsif exists (
      select 1 from public.invites i
       where lower(i.email::text) = address and i.status in ('pending', 'consumed')
    ) then
      outcome := 'on_list';
    else
      begin
        insert into public.invites
          (email, invited_by_member_id, for_organization_id, note, invitee_name, invitee_phone, message)
        values
          (address::extensions.citext, me, p_organization, 'From a spreadsheet', who, number, words)
        returning id into made;
        outcome := 'added';
      exception when unique_violation then
        outcome := 'on_list';
      end;
    end if;

    if private.valid_email(address) then
      seen := seen || address;
    end if;
    results := results || jsonb_build_object(
      'email', coalesce(nullif(address, ''), person ->> 'email'),
      'name', who,
      'outcome', outcome,
      'invite_id', made
    );
  end loop;

  return results;
end;
$$;
revoke all on function public.admin_invite_list(jsonb, uuid, text) from public, anon;
grant execute on function public.admin_invite_list(jsonb, uuid, text) to authenticated;

create or replace function public.invite_details_for_token(token text)
returns table (
  email text,
  name text,
  phone text,
  event_id uuid,
  status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hash text := encode(extensions.digest(btrim(coalesce(token, '')), 'sha256'), 'hex');
begin
  update public.invites i set link_opened_at = now()
   where i.token_hash = hash and i.link_opened_at is null and i.status = 'pending';
  return query
  select lower(i.email::text), coalesce(r.name, i.invitee_name), coalesce(r.phone, i.invitee_phone),
         r.event_id, r.status
    from public.invites i
    left join public.event_registrations r
      on r.id = i.event_registration_id
     and lower(r.email::text) = lower(i.email::text)
   where i.token_hash = hash
     and i.status = 'pending'
     and i.claimed_by is null
     and i.email is not null
     and not public.is_blocked_email(i.email::text)
   limit 1;
end;
$$;
revoke all on function public.invite_details_for_token(text) from public;
grant execute on function public.invite_details_for_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
