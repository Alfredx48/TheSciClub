-- ============================================================================
-- Who made the QR code or invite link a member came by, when, and how
-- ============================================================================
-- The owner, 2026-11-25: "Can we keep track of who created a QR code. So
-- when we see a user is from a QR code, it should specify who and when the
-- code was generated and how. Same with invite link."
--
-- A QR code and an invite link are the same thing underneath: a qr_codes row
-- (20261014020000), made on Me > Create QR code or invite link, with Make QR
-- code or Make invite link, or by sharing a post (made_to_share,
-- 20261116200000). Who made it (admin_id) and when (created_at) were always
-- kept; which button was not. So:
--   * qr_codes.made_as: 'qr' or 'link', the button it was made with, and
--     'qr_and_link' once the same code is asked for the other way too
--     (create_qr_code hands back a live code made the same way). Null for a
--     code made before this, and for a shared post's (made_to_share says it).
--   * create_qr_code takes p_made_as. It is the same function with one more
--     argument, defaulted, so the app already out keeps calling it as it
--     does; the old signature goes, or the two would be ambiguous.
--   * admin_member_story's qrCode and admin_sign_in_methods' cameBy also say
--     who made the code, when, and how (and a shared post's title).
--
-- Expand only for the app already out: one new column, new keys in the JSON
-- it reads, and create_qr_code still answering its five-argument call.
-- ============================================================================

alter table public.qr_codes
  add column if not exists made_as text check (made_as in ('qr', 'link', 'qr_and_link'));

comment on column public.qr_codes.made_as is
  'How the code was made on Me: as a QR code, as an invite link, or both (the same live code asked for both ways). Null before 20261125120000 and for a shared post''s code. See 20261125120000.';

drop function public.create_qr_code(uuid, text, text, timestamptz, text);
create function public.create_qr_code(
  p_organization uuid,
  p_event_name text,
  p_contact_email text,
  p_expires_at timestamptz,
  p_notes text,
  p_made_as text default null
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
  how text := nullif(btrim(coalesce(p_made_as, '')), '');
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
  if how is not null and how not in ('qr', 'link') then
    raise exception 'A code is made as a QR code or as a link.' using errcode = '22023';
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
    -- The same code, asked for the other way: it is both now.
    if how is not null and made.made_as is distinct from how then
      update public.qr_codes q
         set made_as = case when q.made_as is null then how else 'qr_and_link' end
       where q.id = made.id
      returning q.* into made;
    end if;
    return made;
  end if;
  insert into public.qr_codes (admin_id, organization_id, event_name, contact_email, expires_at, notes, made_as_partner, made_as)
  values (auth.uid(), p_organization, event, address, expires, note, as_partner, how)
  returning * into made;
  return made;
end;
$$;

comment on function public.create_qr_code(uuid, text, text, timestamptz, text, text) is
  'Makes (or hands back the same live) QR code or invite link for the signed-in administrator, org admin or partner. p_made_as: qr or link. See 20261014020000, 20261028960000, 20261119140000 and 20261125120000.';

revoke all on function public.create_qr_code(uuid, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.create_qr_code(uuid, text, text, timestamptz, text, text) to authenticated;

create or replace function public.admin_member_story(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;

  with
  m as (
    select * from public.members where id = p_member
  ),
  inv as (
    select i.* from public.invites i join m on m.invite_id = i.id
  ),
  came as (
    select jsonb_build_object(
      'way', case
        when inv.qr_code_id is not null then 'qr'
        when inv.joined_while_open then 'open'
        when coalesce(inv.invited_by_organization_id, inv.for_organization_id) is not null then 'organization'
        else 'member'
      end,
      'claimedProfile', inv.seed_member_id is not null,
      'registered', inv.event_registration_id is not null,
      'invitedAt', inv.created_at,
      'sentAt', inv.sent_at,
      'emailOpenedAt', inv.opened_at,
      'linkOpenedAt', inv.link_opened_at,
      'acceptedAt', coalesce(inv.claimed_at, inv.consumed_at),
      'by', case when inv.invited_by_member_id is null then null else jsonb_build_object(
              'id', inv.invited_by_member_id,
              'name', (select b.display_name from public.members b where b.id = inv.invited_by_member_id)) end,
      'organization', (select o.name from public.organizations o
                        where o.id = coalesce(inv.invited_by_organization_id, inv.for_organization_id)),
      'qrCode', (select jsonb_build_object(
                     'event', q.event_name,
                     'organization', qo.name,
                     'madeBy', case when mk.id is null then null
                                 else jsonb_build_object('id', mk.id, 'name', mk.display_name) end,
                     'madeAt', q.created_at,
                     'madeAs', case when q.made_to_share then 'share' else q.made_as end,
                     'asPartner', q.made_as_partner,
                     'post', (select jsonb_build_object('id', t.id, 'roomId', t.room_id, 'title', t.title)
                                from public.chat_topics t where t.id = q.topic_id))
                   from public.qr_codes q
                   left join public.organizations qo on qo.id = q.organization_id
                   left join public.members mk on mk.id = q.admin_id
                  where q.id = inv.qr_code_id),
      'event', (select jsonb_build_object('id', e.id, 'title', e.title)
                  from public.events e
                 where e.id = coalesce(inv.event_id,
                         (select r.event_id from public.event_registrations r where r.id = inv.event_registration_id))),
      'note', inv.note,
      'message', inv.message
    ) as came
    from inv
  ),
  identities as (
    select (array_agg(i.provider order by i.created_at, i.id))[1] as first,
           coalesce(jsonb_agg(distinct i.provider), '[]'::jsonb) as linked
      from auth.identities i
     where i.user_id = p_member and i.provider <> 'phone'
  ),
  ins as (
    select count(*) as n,
           min(s.at) as first_at,
           max(s.at) as last_at
      from public.sign_ins s
     where s.user_id = p_member
  ),
  latest as (
    select distinct on (c.surface, c.os, c.browser) c.*
      from public.member_device_checks c
     where c.member_id = p_member
     order by c.surface, c.os, c.browser, c.seen_at desc
  ),
  days as (
    select count(distinct (c.seen_at at time zone 'America/Los_Angeles')::date) as n,
           max(c.seen_at) as last_at
      from public.member_device_checks c
     where c.member_id = p_member
  ),
  app as (
    select max(x.at) as last_at
      from (
        select s.at from private.app_seen s where s.user_id = p_member
        union all
        select d.seen_at from public.member_device_checks d
         where d.member_id = p_member and d.surface = 'app'
      ) x
  ),
  push as (
    select count(*) filter (where p.endpoint like 'apns:%') as app,
           count(*) filter (where p.endpoint not like 'apns:%') as web
      from public.push_subscriptions p
     where p.member_id = p_member
  ),
  did as (
    select jsonb_build_object(
      'postsViewed', (select count(*) from public.chat_post_views v where v.member_id = p_member),
      'questionsAsked', (select count(*) from public.chat_topics t
                          where t.author_id = p_member and t.is_question),
      'questionsAnswered', (select count(distinct t.id)
                              from public.chat_topics t
                              join public.chat_posts p on p.topic_id = t.id
                             where t.is_question and t.author_id is distinct from p_member
                               and p.author_id = p_member and p.removed_at is null),
      'messagesSent', (select count(*) from public.chat_messages c
                        where c.author_id = p_member and c.notice is null and c.removed_at is null),
      'eventsViewed', (select count(*) from public.event_member_views e where e.member_id = p_member),
      'eventsGoing', (select count(*) from public.event_rsvps r
                       where r.member_id = p_member and r.status = 'going'),
      'reviewsWritten', (select count(*) from public.reviews r
                          where r.author_id = p_member and not r.anonymous and r.removed_at is null)
    ) as counts
  )
  select jsonb_build_object(
    'joinedAt', m.created_at,
    'came', (select came from came),
    'askedForInvite', exists (
      select 1 from public.invite_requests r join auth.users u on u.id = p_member
       where r.email::text = lower(u.email::text)),
    'signIns', jsonb_build_object(
      'signedUpWith', identities.first,
      'linked', identities.linked,
      'count', ins.n,
      'firstAt', ins.first_at,
      'lastAt', ins.last_at
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'surface', l.surface,
               'browser', l.browser,
               'browserVersion', l.browser_version,
               'os', l.os,
               'screenWidth', l.screen_width,
               'screenHeight', l.screen_height,
               'colorScheme', l.color_scheme,
               'notifications', l.notifications,
               'appBuilt', l.app_built,
               'seenAt', l.seen_at
             ) order by l.seen_at desc)
        from latest l
    ), '[]'::jsonb),
    'appLastSeen', app.last_at,
    'notify', jsonb_build_object('app', push.app, 'web', push.web),
    'activeDays', days.n,
    'lastActive', greatest(days.last_at, ins.last_at, app.last_at),
    'recordedSince', (select min(c.seen_at) from public.member_device_checks c),
    'did', (select counts from did)
  ) into result
  from m, identities, ins, days, app, push;

  return result;
end;
$$;

comment on function public.admin_member_story(uuid) is
  'For a member''s page, to the club''s administrators only: how they came to the club (and who made the code they came by, when and how), how they sign in, their devices, notifications, days active, and what they have done. See 20261118150000, 20261118160000 and 20261125120000.';

create or replace function public.admin_sign_in_methods(period text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  span interval;
  since timestamptz;
  until timestamptz;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;

  span := case period
    when '24h' then interval '1 day' when 'prev24h' then interval '1 day'
    when '7d' then interval '7 days' when 'prev7d' then interval '7 days'
    when '30d' then interval '30 days' when 'prev30d' then interval '30 days'
    when 'all' then null
  end;
  if period is null or (span is null and period <> 'all') then
    raise exception 'Unknown period: %', period using errcode = '22023';
  end if;
  until := case when period like 'prev%' then now() - span else now() end;
  since := coalesce(until - span, '-infinity'::timestamptz);

  with
  first_identity as (
    select distinct on (i.user_id) i.user_id, i.provider
      from auth.identities i
     where i.provider <> 'phone'
     order by i.user_id, i.created_at, i.id
  ),
  linked as (
    select i.user_id, jsonb_agg(distinct i.provider order by i.provider) as methods
      from auth.identities i
     where i.provider <> 'phone'
     group by i.user_id
  ),
  in_period as (
    select * from public.sign_ins s where s.at >= since and s.at < until
  ),
  latest as (
    select distinct on (s.user_id) s.user_id, s.at, s.method, s.home_screen
      from public.sign_ins s
     order by s.user_id, s.at desc
  ),
  per_account as (
    select p.user_id, count(*) as sign_ins,
           jsonb_agg(distinct p.method order by p.method) as methods
      from in_period p
     group by p.user_id
  ),
  -- The invite that let them in; before they are a member, the one they claimed.
  arrival as (
    select distinct on (u.id) u.id as account, i.*
      from auth.users u
      left join public.members m on m.id = u.id
      join public.invites i on i.id = m.invite_id or (m.invite_id is null and i.claimed_by = u.id)
     order by u.id, i.created_at desc
  ),
  came as (
    select a.account, jsonb_build_object(
             'way', case
               when a.qr_code_id is not null then 'qr'
               when a.joined_while_open then 'open'
               when coalesce(a.invited_by_organization_id, a.for_organization_id) is not null then 'organization'
               else 'member'
             end,
             'by', case
               when a.qr_code_id is not null then coalesce(qo.name, q.event_name)
               when a.joined_while_open then null
               else coalesce(o.name, im.display_name)
             end,
             'event', q.event_name,
             'madeBy', mk.display_name,
             'madeAt', q.created_at,
             'madeAs', case when q.id is null then null when q.made_to_share then 'share' else q.made_as end
           ) as came_by
      from arrival a
      left join public.qr_codes q on q.id = a.qr_code_id
      left join public.organizations qo on qo.id = q.organization_id
      left join public.members mk on mk.id = q.admin_id
      left join public.organizations o
        on o.id = coalesce(a.invited_by_organization_id, a.for_organization_id)
      left join public.members im on im.id = a.invited_by_member_id
  ),
  accounts as (
    select u.id, u.email, u.created_at,
           f.provider as signed_up_with,
           coalesce(l.methods, '[]'::jsonb) as methods,
           m.id is not null as member, m.display_name, m.username::text as username, m.status,
           la.at as last_at, la.method as last_method, coalesce(la.home_screen, false) as last_home_screen,
           coalesce(pa.sign_ins, 0) as sign_ins,
           coalesce(pa.methods, '[]'::jsonb) as period_methods,
           c.came_by,
           exists (select 1 from public.invite_requests r where r.email::text = lower(u.email::text)) as asked
      from auth.users u
      left join first_identity f on f.user_id = u.id
      left join linked l on l.user_id = u.id
      left join public.members m on m.id = u.id
      left join latest la on la.user_id = u.id
      left join per_account pa on pa.user_id = u.id
      left join came c on c.account = u.id
  ),
  made as (
    select * from accounts a where a.created_at >= since and a.created_at < until
  )
  select jsonb_build_object(
    'asOf', now(),
    'period', period,
    'recordedSince', (select min(s.at) from public.sign_ins s),
    'signUps', coalesce((
      select jsonb_object_agg(g.method, g.n)
        from (select signed_up_with as method, count(*) as n
                from made where signed_up_with is not null group by 1) g
    ), '{}'::jsonb),
    'signIns', coalesce((
      select jsonb_object_agg(g.method, jsonb_build_object('signIns', g.n, 'people', g.people))
        from (select p.method, count(*) as n, count(distinct p.user_id) as people
                from in_period p group by 1) g
    ), '{}'::jsonb),
    'cameBy', coalesce((
      select jsonb_object_agg(g.way, g.n)
        from (select a.came_by ->> 'way' as way, count(*) as n
                from made a where a.came_by is not null group by 1) g
    ), '{}'::jsonb),
    'homeScreen', (
      select jsonb_build_object('signIns', count(*), 'people', count(distinct p.user_id))
        from in_period p where p.home_screen
    ),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'name', a.display_name,
               'username', a.username,
               'email', case when a.member then null else a.email end,
               'member', a.member,
               'status', a.status,
               'createdAt', a.created_at,
               'signedUpWith', a.signed_up_with,
               'methods', a.methods,
               'lastSignInAt', a.last_at,
               'lastSignInMethod', a.last_method,
               'lastSignInHomeScreen', a.last_home_screen,
               'signIns', a.sign_ins,
               'signInMethods', a.period_methods,
               'cameBy', a.came_by,
               'askedForInvite', a.asked
             ) order by a.last_at desc nulls last, a.created_at desc)
        from accounts a
       where (a.created_at >= since and a.created_at < until) or a.sign_ins > 0
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

comment on function public.admin_sign_in_methods(text) is
  'Admin → Stats: how each account was made and is signed in to, for a period. Names members. See 20261016000000, 20261016010000, 20261102010000 and 20261125120000.';

