-- ============================================================================
-- Whoever shares a question as an invite chooses its organization
-- ============================================================================
-- The owner, 2026-11-19: "Let's have an org selector when the user says to
-- let people join through a link. Default to the org of the user when they
-- only have one, for multi org admins, default to no org. For thesciclub
-- admins, let them select other org, which opens up a search box to select
-- from the full list of orgs."
--
-- share_topic_code(p_topic, p_organization) beside share_topic_code(p_topic)
-- (20261119170000), which the app as shipped still calls and which still
-- picks the organization itself. Here the share sheet says which:
--   - none (null): the link joins people to the club only;
--   - an organization still in the directory that the member is an admin of;
--   - a club administrator: any organization still in the directory.
-- The link is then that organization's code: who joins through it joins it
-- (private.member_joins_their_organization), and it stands while its maker
-- speaks for it or is an administrator (private.qr_code_maker_stands). Both
-- unchanged. The default the sheet offers is the sheet's (share-post.tsx).
--
-- Asked again within the hour for the same topic and organization, the same
-- code.
--
-- Expand only: a new function; nothing restated.
-- ============================================================================

create function public.share_topic_code(p_topic uuid, p_organization uuid)
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
  -- As share_topic_code(uuid): an organization's admin, only for a topic they
  -- can read themselves, as its title shows in the link's preview.
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

  if p_organization is not null then
    if not exists (select 1 from public.organizations o
                    where o.id = p_organization and o.removed_at is null) then
      raise exception 'That organization is no longer in the directory.' using errcode = 'P0002';
    end if;
    if not (public.is_admin() or public.speaks_for(p_organization)) then
      raise exception 'Only that organization''s admins can make a link for it.' using errcode = '42501';
    end if;
  end if;

  select q.* into made
    from public.qr_codes q
   where q.admin_id = auth.uid()
     and q.made_to_share
     and q.topic_id = p_topic
     and q.organization_id is not distinct from p_organization
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
      p_organization,
      now() + interval '24 hours',
      btrim(left('Shared: ' || btrim(topic_title), 300))
    )
    returning * into made;
  end if;
  return query select made.id, made.code, made.expires_at;
end;
$$;

comment on function public.share_topic_code(uuid, uuid) is
  'A code for sharing a topic as an invite for 24 hours, for the organization chosen (null: the club only). An organization''s admin chooses one of theirs; an administrator any in the directory. See 20261119190000.';

revoke all on function public.share_topic_code(uuid, uuid) from public, anon;
grant execute on function public.share_topic_code(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
