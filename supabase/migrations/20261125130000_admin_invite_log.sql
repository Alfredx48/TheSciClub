-- ============================================================================
-- Admin › Invite log: every invite email, QR code and invite link, newest first
-- ============================================================================
-- The owner, 2026-11-25: "On the admin page, can we add a tab for invites and
-- keep a chronological list of all e-mail invites sent and by whom, if the
-- invites were opened and if they were used to create an account (if so what
-- account with a link to the users profile page), and QR codes generated. For
-- all QR codes and links have the author, show a list of users that created
-- profiles from them."
--
-- Nothing new is recorded. This reads, in one list, what the club keeps:
--   * an invite email (invites with an email that was sent, club and event
--     invites both, taken off the list or not): who sent it, a member or an
--     organization; when; opened (opened_at, approximate, as "How the invites
--     did" says); its link used (link_opened_at); an account made from it
--     (claimed_at, claimed_by); and the member that account became, with
--     their id for a link to their profile;
--   * a QR code or invite link (qr_codes, a shared post's link among them):
--     who made it, when, how (made_as, 20261125120000; 'share' for a shared
--     post's), what for, until when, and every member who joined from it
--     (members.invite_id → invites.qr_code_id), oldest first.
--
-- Only the club's administrators (is_admin). The newest p_limit of each
-- kind (up to 1000), merged newest first. Expand only: a new function.
-- ============================================================================

create function public.admin_invite_log(p_limit integer default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cap integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;

  with
  emails as (
    select i.sent_at as at, jsonb_build_object(
             'kind', 'email',
             'id', i.id,
             'at', i.sent_at,
             'email', lower(i.email::text),
             'name', i.invitee_name,
             'status', i.status,
             'sentBy', case when inviter.id is null then null
                         else jsonb_build_object('id', inviter.id, 'name', inviter.display_name) end,
             'organization', org.name,
             'event', case when e.id is null then null
                        else jsonb_build_object('id', e.id, 'title', e.title) end,
             'openedAt', i.opened_at,
             'linkOpenedAt', i.link_opened_at,
             'accountAt', i.claimed_at,
             'member', case when joined.id is null then null
                         else jsonb_build_object('id', joined.id, 'name', joined.display_name,
                                                 'joinedAt', joined.created_at) end
           ) as item
      from public.invites i
      left join public.organizations org on org.id = i.invited_by_organization_id
      left join public.members inviter on inviter.id = i.invited_by_member_id
      left join public.members joined on joined.id = i.claimed_by
      left join public.events e on e.id = i.event_id
     where i.sent_at is not null
       and i.email is not null
     order by i.sent_at desc, i.id desc
     limit cap
  ),
  codes as (
    select q.created_at as at, jsonb_build_object(
             'kind', 'code',
             'id', q.id,
             'at', q.created_at,
             'madeBy', case when mk.id is null then null
                         else jsonb_build_object('id', mk.id, 'name', mk.display_name) end,
             'madeAs', case when q.made_to_share then 'share' else q.made_as end,
             'organization', qo.name,
             'event', q.event_name,
             'post', (select jsonb_build_object('id', t.id, 'roomId', t.room_id, 'title', t.title)
                        from public.chat_topics t where t.id = q.topic_id),
             'expiresAt', q.expires_at,
             'turnedOffAt', q.turned_off_at,
             'joined', coalesce((
               select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name,
                                                   'joinedAt', m.created_at)
                                order by m.created_at, m.id)
                 from public.invites ci
                 join public.members m on m.invite_id = ci.id
                where ci.qr_code_id = q.id
             ), '[]'::jsonb)
           ) as item
      from public.qr_codes q
      left join public.members mk on mk.id = q.admin_id
      left join public.organizations qo on qo.id = q.organization_id
     order by q.created_at desc, q.id desc
     limit cap
  )
  select coalesce(jsonb_agg(x.item order by x.at desc), '[]'::jsonb) into result
    from (select at, item from emails union all select at, item from codes) x;

  return result;
end;
$$;

comment on function public.admin_invite_log(integer) is
  'Admin › Invite log, to the club''s administrators only: every invite email sent (by whom, opened, link used, the account and member it became) and every QR code and invite link (who made it, when, how, and who joined from it), newest first. See 20261125130000.';

revoke all on function public.admin_invite_log(integer) from public, anon;
grant execute on function public.admin_invite_log(integer) to authenticated;
