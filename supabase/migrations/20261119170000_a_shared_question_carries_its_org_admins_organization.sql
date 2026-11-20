-- ============================================================================
-- A question shared by an admin of one organization carries that organization
-- ============================================================================
-- The owner, 2026-11-19: "when admin's of only one org paste a question link,
-- those links should be associated with that org."
--
-- share_topic_code, as 20261119140000, now fills in organization_id when the
-- member making the link is not a club administrator and is an admin of
-- exactly one organization still in the directory. The link is then that
-- organization's code, as one made on the QR page is:
--   - whoever joins through it becomes a member of the organization
--     (private.member_joins_their_organization, unchanged);
--   - it stands while its maker speaks for that organization
--     (private.qr_code_maker_stands, unchanged).
-- An admin of two or more organizations, and a club administrator, make a
-- link with no organization, as before: there is no one organization to pick.
-- Asked again within the hour, the same code, if it is for the same
-- organization.
--
-- Who shared it stays unsaid: qr_code_details still names nobody for a
-- shared question, and the join screen names an organization only beside an
-- inviter's name.
--
-- Expand only: one function restated, same arguments and return.
-- ============================================================================

create or replace function public.share_topic_code(p_topic uuid)
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic_title text;
  org uuid;
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

  -- The one organization they are an admin of, if only one.
  if not public.is_admin() then
    select min(r.organization_id::text)::uuid into org
      from public.organization_representatives r
      join public.organizations o on o.id = r.organization_id and o.removed_at is null
     where r.member_id = auth.uid()
    having count(*) = 1;
  end if;

  select q.* into made
    from public.qr_codes q
   where q.admin_id = auth.uid()
     and q.made_to_share
     and q.topic_id = p_topic
     and q.organization_id is not distinct from org
     and q.turned_off_at is null
     and q.created_at > now() - interval '1 hour'
     and q.expires_at > now()
   order by q.created_at desc
   limit 1;
  if not found then
    insert into public.qr_codes (admin_id, made_to_share, topic_id, organization_id, expires_at, notes)
    values (
      auth.uid(),
      true,
      p_topic,
      org,
      now() + interval '24 hours',
      btrim(left('Shared: ' || btrim(topic_title), 300))
    )
    returning * into made;
  end if;
  return query select made.id, made.code, made.expires_at;
end;
$$;

comment on function public.share_topic_code(uuid) is
  'An administrator''s or an organization admin''s code for sharing a question or other topic they can read: anyone who comes through the link in the next 24 hours may join. An admin of exactly one organization (not a club administrator) makes it for that organization, so who joins through it joins it. See 20261116200000, 20261119140000 and 20261119170000.';

revoke all on function public.share_topic_code(uuid) from public, anon;
grant execute on function public.share_topic_code(uuid) to authenticated;
