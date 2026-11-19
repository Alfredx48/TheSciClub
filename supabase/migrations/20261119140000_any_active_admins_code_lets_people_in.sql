-- ============================================================================
-- Any active admin's code lets people in: a club administrator's, or an
-- organization's admin's, with or without an organization chosen
-- ============================================================================
-- The owner, 2026-11-19: "Make sure these QR codes also work when we share
-- questions" and "I want to let people in even if no organization is
-- selected. As long as the invite is tied to an active admin we are OK. I
-- would say any active admin of any organization." And: "if an invite code is
-- tied to a user, we do not need to associate that new member with an
-- organization".
--
-- 20261119130000 let in whoever comes through any live code. Who may make one
-- with no organization, and have it stand, was still a club administrator
-- only (or a partner, their own code). Now an admin of any organization in the
-- directory may too:
--   - create_qr_code: an organization's admin may leave the organization out.
--     The new member is credited to them and joins no organization.
--   - share_topic_code: an organization's admin may make a question's link an
--     invite too, for a topic they can read themselves (its title shows in
--     the link's preview). Still 24 hours.
--   - qr_code_maker_stands: such a code stands while its maker is active and an
--     admin of an organization still in the directory, or a club
--     administrator. Removed as every organization's admin, or no longer
--     active, and it lets nobody in again.
-- A code for an organization is unchanged: it stands while its maker is an
-- administrator or speaks for that organization.
--
-- And who shared a question stays unsaid (below): qr_code_details names
-- nobody for a shared question's link, and shared_topic_preview never did
-- show the name but now leaves it out too.
--
-- Expand only: a new function and five restated, with the same arguments and
-- columns. The iPhone app already shipped reads qr_code_details: for a
-- shared question's link it now takes the code as one that says nothing, and
-- the sign-up still goes through, as the code itself lets them in.
-- ============================================================================

-- Whether the member is an admin of an organization still in the directory.
create or replace function private.is_org_admin(account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_representatives r
      join public.organizations o on o.id = r.organization_id and o.removed_at is null
     where r.member_id = account
  );
$$;

revoke all on function private.is_org_admin(uuid) from public, anon, authenticated;

-- As 20261029100000. A code with no organization, not a partner's, stands
-- while its maker is an administrator or an admin of any organization.
create or replace function private.qr_code_maker_stands(q public.qr_codes)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members a
     where a.id = q.admin_id and a.status = 'active'
       and (
         (q.organization_id is null and q.made_as_partner
          and exists (select 1 from public.club_partners p where p.member_id = a.id))
         or (q.organization_id is null and not q.made_as_partner
             and (a.is_admin or private.is_org_admin(a.id)))
         or (
           q.organization_id is not null
           and exists (select 1 from public.organizations o
                        where o.id = q.organization_id and o.removed_at is null)
           and (
             a.is_admin
             or exists (select 1 from public.organization_representatives r
                         where r.organization_id = q.organization_id and r.member_id = a.id)
           )
         )
       )
  );
$$;

revoke all on function private.qr_code_maker_stands(public.qr_codes) from public, anon, authenticated;

-- As 20261119130000. With no organization: an organization's admin may make
-- one too; a partner who is not an administrator still makes their own code.
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
    elsif not public.is_admin() and not private.is_org_admin(auth.uid()) then
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

-- As 20261116200000. An organization's admin may make one too, for a topic
-- they can read.
create or replace function public.share_topic_code(p_topic uuid)
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic_title text;
  made public.qr_codes;
begin
  if not (public.is_admin() or private.is_org_admin(auth.uid())) then
    raise exception 'Only an administrator, or an organization''s admin, can make a link that lets people join.' using errcode = '42501';
  end if;
  -- An organization's admin, only for a topic they can read themselves: its
  -- title shows in the link's preview (shared_topic_preview). An
  -- administrator reads every room.
  select t.title into topic_title
    from public.chat_topics t
   where t.id = p_topic
     and (
       public.is_admin()
       or (
         t.room_id = any ((select public.my_readable_room_ids())::text[])
         and not coalesce(t.author_id = any ((select private.my_hidden_member_ids())::uuid[]), false)
       )
     );
  if not found then
    raise exception 'That topic is no longer in the club.' using errcode = 'P0002';
  end if;

  select q.* into made
    from public.qr_codes q
   where q.admin_id = auth.uid()
     and q.made_to_share
     and q.topic_id = p_topic
     and q.turned_off_at is null
     and q.created_at > now() - interval '1 hour'
     and q.expires_at > now()
   order by q.created_at desc
   limit 1;
  if not found then
    insert into public.qr_codes (admin_id, made_to_share, topic_id, expires_at, notes)
    values (
      auth.uid(),
      true,
      p_topic,
      now() + interval '24 hours',
      btrim(left('Shared: ' || btrim(topic_title), 300))
    )
    returning * into made;
  end if;
  return query select made.id, made.code, made.expires_at;
end;
$$;

comment on function public.share_topic_code(uuid) is
  'An administrator''s or an organization admin''s code for sharing a question or other topic they can read: anyone who comes through the link in the next 24 hours may join. See 20261116200000 and 20261119140000.';

revoke all on function public.share_topic_code(uuid) from public, anon;
grant execute on function public.share_topic_code(uuid) to authenticated;

-- ---------------------------------------------- who shared it stays unsaid --
-- The owner, 2026-11-19: "I think sharing the question title publicly is OK,
-- as long as we do not share who shared it." A link made to share a question
-- names nobody to whoever opens it signed out: not in its preview, not on
-- the join screen. A QR code or invite link still says who it is from.

-- As 20261116200000, with the sharer's name left out for a shared question.
create or replace function public.qr_code_details(p_code text)
returns table (
  inviter_name text,
  event_name text,
  joining_open boolean,
  contact_email text,
  organization_name text,
  admits boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select case when q.made_to_share then null else a.display_name end,
         q.event_name,
         public.joining_is_open(),
         case when public.joining_is_open() or private.qr_code_lets_in(q)
              then null else q.contact_email::text end,
         o.name,
         private.qr_code_lets_in(q)
    from public.qr_codes q
    join public.members a on a.id = q.admin_id
    left join public.organizations o on o.id = q.organization_id
   where q.id = private.live_qr_code(p_code);
$$;

-- As 20261116200000: the title only. The name is empty, not null, because the
-- link preview as it was released before this asks for a string there
-- (netlify/edge-functions/topic-preview.ts); it no longer reads it.
create or replace function public.shared_topic_preview(p_code text, p_topic uuid)
returns table (title text, inviter_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.title, ''::text
    from public.qr_codes q
    join public.chat_topics t on t.id = q.topic_id
   where q.id = private.live_qr_code(p_code)
     and q.made_to_share
     and q.topic_id = p_topic;
$$;

comment on function public.shared_topic_preview(text, uuid) is
  'For a link preview: the title of a topic shared to let people in, while its code is live. Never who shared it (inviter_name is always empty since 20261119140000). See 20261116200000.';
