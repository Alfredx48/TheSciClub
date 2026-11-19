-- ============================================================================
-- What waits on a member stays on top, and is emailed after a day
-- ============================================================================
-- The owner, 2026-11-19, after a held calendar invitation sat unnoticed for
-- two days: "We need a way to keep notifications that require an action such
-- as this or approving a new member up top ... Keep priority notifications up
-- top and send an e-mail if they have not been addressed for 24 hours."
--
-- ---------------------------------------------------------------------------
-- Waiting means the thing is still undone, not the row unread
-- ---------------------------------------------------------------------------
-- Pressing a notification marks it read but answers nothing, so whether one
-- waits is read from what it is about, as it is now, for the member it went
-- to (notification_waiting_since, null when it does not wait):
--
--   report               the report is not resolved, and they are an admin
--   invite_request       its organization has open invite requests, and they
--                        still speak for it
--   join_request         somebody still asks to join its organization, and
--                        they speak for it or are an admin
--   calendar_invite      held or choose: the invitation is still held
--   organization_request asked: the request is still waiting, to an admin
--   introduction         asked: they have not answered, nobody said no, and
--                        it is neither withdrawn nor opened
--   family_link          asked: they have not answered
--
-- It is the time the oldest undone thing arrived. Whoever answers, from
-- wherever (another org admin, an older iPhone app), it stops waiting for
-- everybody at once; nothing has to be cleared.
--
-- Important messages already wait at the top until acknowledged, with their
-- own reminders (20261113140000), and are left as they are.
--
-- ---------------------------------------------------------------------------
-- The list: my_waiting_notifications()
-- ---------------------------------------------------------------------------
-- Rows shaped as my_notifications' (so the app words them the same way) plus
-- waiting_since, oldest first. A conversation's worth of rows under one tag
-- (asked to join, asked for an invite) is one row, counting what is open now
-- rather than what arrived while it was unread, and all of a member's open
-- reports are one row. A new function, so my_notifications and every app
-- that calls it are untouched; the app lists the rest below without these.
--
-- A waiting row is not forgotten at thirty days (notifications_forget).
--
-- ---------------------------------------------------------------------------
-- The email: once for each, a day after
-- ---------------------------------------------------------------------------
-- Every hour from 8 am to 7 pm in California, the daily path (push_notify_send
-- 'waiting') asks push-notify to email each member something has waited on
-- for a day: waiting_emails records and returns them, one email per member
-- listing everything that waits on them. Each notification is emailed once,
-- and a member gets at most one such email in 20 hours. A member without a
-- confirmed email address is not emailed.
-- ============================================================================

-- --------------------------------------------------------------- waiting --

create or replace function private.notification_waiting_since(n public.notifications)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with who as (
    select exists (
             select 1 from public.members m
              where m.id = n.member_id and m.status = 'active' and m.is_admin
           ) as admin,
           n.organization_id is not null and exists (
             select 1 from public.organization_representatives r
               join public.organizations o on o.id = r.organization_id and o.removed_at is null
              where r.organization_id = n.organization_id and r.member_id = n.member_id
           ) as speaks
  )
  select case
    when n.kind = 'report' then (
      select rep.created_at from public.chat_reports rep, who
       where rep.id = n.report_id and rep.resolved_at is null and who.admin
    )
    when n.kind = 'invite_request' then (
      select min(q.created_at) from public.invite_requests q, who
       where q.organization_id = n.organization_id and q.status = 'open' and who.speaks
    )
    when n.kind = 'join_request' then (
      select min(q.requested_at) from public.organization_join_requests q, who
       where q.organization_id = n.organization_id and (who.speaks or who.admin)
    )
    when n.kind = 'calendar_invite' and n.detail in ('held', 'choose') then (
      select ci.received_at from public.calendar_invites ci
       where ci.id = n.calendar_invite_id and ci.state = 'held'
    )
    when n.kind = 'organization_request' and n.detail = 'asked' then (
      select orq.created_at from public.organization_requests orq, who
       where orq.id = n.organization_request_id and orq.status = 'waiting' and who.admin
    )
    when n.kind = 'introduction' and n.detail = 'asked' then (
      select ix.created_at from public.introductions ix
       where ix.id = n.introduction_id
         and ix.withdrawn_at is null and ix.opened_at is null
         and coalesce(ix.first_answer, true) and coalesce(ix.second_answer, true)
         and ((ix.first_id = n.member_id and ix.first_answer is null)
              or (ix.second_id = n.member_id and ix.second_answer is null))
    )
    when n.kind = 'family_link' and n.detail = 'asked' then (
      select fl.created_at from public.family_links fl
       where fl.id = n.family_link_id and fl.status = 'asked' and fl.answerer_id = n.member_id
    )
  end
  from who;
$$;

revoke all on function private.notification_waiting_since(public.notifications) from public, anon, authenticated;

-- What waits on one member, as the list shows it.
create or replace function private.waiting_for(p_member uuid)
returns table (
  id uuid,
  kind text,
  count integer,
  created_at timestamptz,
  seen boolean,
  read boolean,
  actor_id uuid,
  actor_name text,
  actor_photo text,
  place text,
  excerpt text,
  detail text,
  url text,
  waiting_since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select n.*, s.since,
           case when n.kind = 'report' then 'report' else n.tag end as grp
      from public.notifications n
     cross join lateral (select private.notification_waiting_since(n) as since) s
     where n.member_id = p_member
       and n.kind in ('report', 'invite_request', 'join_request', 'calendar_invite',
                      'organization_request', 'introduction', 'family_link')
       and s.since is not null
  ),
  g as (
    select distinct on (w.grp) w.*,
           min(w.since) over (partition by w.grp) as first_since,
           count(*) over (partition by w.grp) as in_group
      from w
     order by w.grp, w.created_at desc, w.id
  ),
  x as (
    select g.*,
           -- Who asked to join last, of those still asking.
           case when g.kind = 'join_request' then coalesce((
             select q.member_id from public.organization_join_requests q
              where q.organization_id = g.organization_id
              order by q.requested_at desc limit 1), g.actor_id)
           else g.actor_id end as who_id
      from g
  )
  select x.id, x.kind,
         case
           when x.kind = 'report' then x.in_group::integer
           when x.kind = 'invite_request' then (
             select count(*)::integer from public.invite_requests q
              where q.organization_id = x.organization_id and q.status = 'open')
           when x.kind = 'join_request' then (
             select count(*)::integer from public.organization_join_requests q
              where q.organization_id = x.organization_id)
           else x.count
         end,
         x.created_at, x.seen_at is not null, x.read_at is not null,
         x.who_id,
         case when x.who_id is null and x.kind in ('join_request', 'organization_request', 'introduction', 'family_link')
              then 'Deleted member' else a.display_name end,
         a.photo_path,
         case
           when x.kind in ('invite_request', 'join_request') then o.name
           when x.kind = 'calendar_invite' then ci.payload ->> 'title'
           when x.kind = 'organization_request' then orq.draft ->> 'name'
           when x.kind = 'introduction' then ox.display_name
           when x.kind = 'family_link' then
             case when fl.asker_id = x.member_id then fl.relation else private.family_inverse(fl.relation) end
         end,
         case when x.kind = 'introduction' then left(ix.note, 160) end,
         case
           -- Who asked for an invite last, of those still open.
           when x.kind = 'invite_request' then coalesce((
             select left(q.name, 40) from public.invite_requests q
              where q.organization_id = x.organization_id and q.status = 'open'
              order by q.created_at desc limit 1), x.detail)
           else x.detail
         end,
         case x.kind
           when 'report' then '/admin?tab=reports'
           when 'invite_request' then '/invites#requests'
           when 'join_request' then '/events/organizations/' || x.organization_id::text
           when 'calendar_invite' then '/events/invites'
           when 'organization_request' then '/admin?tab=organizations'
           when 'introduction' then '/introductions/' || x.introduction_id::text
           when 'family_link' then '/peers/' || x.actor_id::text
         end,
         x.first_since
    from x
    left join public.members a on a.id = x.who_id
    left join public.organizations o on o.id = x.organization_id
    left join public.calendar_invites ci on ci.id = x.calendar_invite_id
    left join public.organization_requests orq on orq.id = x.organization_request_id
    left join public.family_links fl on fl.id = x.family_link_id
    left join public.introductions ix on ix.id = x.introduction_id
    left join public.members ox
      on ox.id = case when ix.first_id = x.member_id then ix.second_id else ix.first_id end
   where not exists (
     select 1 from public.member_blocks b
      where (b.blocker_id = p_member and b.blocked_id in (x.who_id, ox.id))
         or (b.blocked_id = p_member and b.blocker_id in (x.who_id, ox.id)
             and not exists (select 1 from public.members m where m.id = p_member and m.is_admin))
   )
     and (x.kind <> 'introduction' or ox.status = 'active')
   order by x.first_since, x.id;
$$;

revoke all on function private.waiting_for(uuid) from public, anon, authenticated;

create or replace function public.my_waiting_notifications()
returns table (
  id uuid,
  kind text,
  count integer,
  created_at timestamptz,
  seen boolean,
  read boolean,
  actor_id uuid,
  actor_name text,
  actor_photo text,
  place text,
  excerpt text,
  detail text,
  url text,
  waiting_since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.* from private.waiting_for(auth.uid()) w where public.is_member();
$$;

revoke all on function public.my_waiting_notifications() from public, anon;
grant execute on function public.my_waiting_notifications() to authenticated;

-- A waiting row outlives the thirty days.
create or replace function public.notifications_forget()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications n
   where n.created_at < now() - interval '30 days'
     and private.notification_waiting_since(n) is null;
$$;

revoke all on function public.notifications_forget() from public, anon, authenticated;

-- ----------------------------------------------------------------- email --

create table if not exists private.waiting_emailed (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  emailed_at timestamptz not null default now()
);

create index if not exists waiting_emailed_member_recent
  on private.waiting_emailed (member_id, emailed_at desc);

revoke all on private.waiting_emailed from public, anon, authenticated;

-- Each member owed the email now, with what waits on them; recorded as it is
-- returned, so a second run does not send it again.
create or replace function public.waiting_emails(p_secret text, p_key jsonb)
returns table (email text, name text, items jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret is distinct from (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'
  ) then
    raise exception 'Not the notification trigger.' using errcode = '42501';
  end if;

  return query
    with due as (
      select n.id, n.member_id
        from public.notifications n
        join public.members r on r.id = n.member_id and r.status = 'active'
       where n.kind in ('report', 'invite_request', 'join_request', 'calendar_invite',
                        'organization_request', 'introduction', 'family_link')
         and private.notification_waiting_since(n) <= now() - interval '24 hours'
         and not exists (select 1 from private.waiting_emailed e where e.notification_id = n.id)
         and not exists (
           select 1 from private.waiting_emailed e
            where e.member_id = n.member_id and e.emailed_at > now() - interval '20 hours'
         )
         and private.confirmed_email(r.id) is not null
         and not private.email_unproven(r.id)
    ),
    told as (
      insert into private.waiting_emailed (notification_id, member_id)
      select d.id, d.member_id from due d
      on conflict do nothing
      returning member_id
    ),
    listed as (
      select t.member_id,
             (select jsonb_agg(jsonb_build_object(
                       'kind', w.kind, 'count', w.count, 'actor', w.actor_name,
                       'place', w.place, 'detail', w.detail, 'url', w.url,
                       'since', w.waiting_since) order by w.waiting_since)
                from private.waiting_for(t.member_id) w) as items
        from (select distinct told.member_id from told) t
    )
    select private.confirmed_email(l.member_id)::text, r.display_name, l.items
      from listed l
      join public.members r on r.id = l.member_id
     where l.items is not null;
end;
$$;

revoke all on function public.waiting_emails(text, jsonb) from public, anon, authenticated;
grant execute on function public.waiting_emails(text, jsonb) to service_role;

-- In waking hours in California; push-notify does the sending.
create or replace function public.waiting_emails_send()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if extract(hour from now() at time zone 'America/Los_Angeles') not between 8 and 19 then
    return;
  end if;
  perform public.push_notify_send('waiting', jsonb_build_object('at', now()));
end;
$$;

revoke all on function public.waiting_emails_send() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'waiting-emails';
  perform cron.schedule('waiting-emails', '20 * * * *', 'select public.waiting_emails_send()');
end;
$$;
