-- ============================================================================
-- An event, or one date of a repeating event, can be cancelled
-- ============================================================================
-- The owner, 2026-11-27: whoever may change an event can cancel it, as well
-- as delete it. A cancelled date stays on the calendar, marked Cancelled, so
-- members see it is off instead of finding it gone.
--
-- cancel_event: only a date added in the club (not one from a calendar) that
-- has not started. Who said Going hears by push and in the bell, Interested in
-- the bell only, as for a deletion (20261120150000), but the notice opens the
-- cancelled date. Then its RSVPs go, so no reminder, check-in or follow-up is
-- sent for it.
--
-- Nobody can say Going or Interested to a cancelled date, or register for it
-- from its public page, and no org admin's notice goes out for one. Stats'
-- Events tab leaves it out. public_event says it is cancelled.
--
-- Store builds before this one draw a cancelled date as any other; answering
-- it is refused with "This date was cancelled."
--
-- Undo: supabase/undo/20261127100000.sql.
-- Probe: supabase/tests/a-date-is-cancelled.sql.
-- ============================================================================

alter table public.events add column cancelled_at timestamptz;
comment on column public.events.cancelled_at is
  'When it was cancelled (cancel_event, 20261127100000); null while it is on.';
-- On this table a new column is unreadable until granted (20260916010000).
grant select (cancelled_at) on public.events to anon, authenticated;

-- ------------------------------------------------------------- the button
create function public.cancel_event(event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.events%rowtype;
  batch timestamptz := clock_timestamp();
  told integer;
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  select * into existing from public.events e where e.id = event for update;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if existing.feed_id is not null then
    raise exception 'This event comes from the organization''s own calendar, so it is changed there.'
      using errcode = '42501';
  end if;
  if not public.may_change_event(existing.id) then
    raise exception 'You cannot cancel this event.' using errcode = '42501';
  end if;
  if existing.cancelled_at is not null then
    raise exception 'This date is already cancelled.' using errcode = '22023';
  end if;
  if existing.start_time <= now() then
    raise exception 'Only a date that has not started can be cancelled.' using errcode = '22023';
  end if;

  -- As event_cancellation_noted (20261120150000), with the date itself.
  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, detail, count, created_at)
  select r.member_id, 'event_changed',
         case when r.status = 'going' then 'event_cancelled:' else 'event_cancelled_bell:' end
           || coalesce(existing.series_id, existing.id)::text,
         me, event, 'cancelled:' || existing.title, 1, batch
    from public.event_rsvps r
    join public.members m on m.id = r.member_id and m.status = 'active'
   where r.event_id = event
     and r.status in ('going', 'interested')
     and r.member_id is distinct from me
     and not private.blocked_between(r.member_id, me)
  on conflict (member_id, tag) where read_at is null
  do update set count = n.count + 1,
                detail = excluded.detail,
                event_id = excluded.event_id,
                actor_id = excluded.actor_id,
                created_at = excluded.created_at,
                seen_at = null;
  get diagnostics told = row_count;

  update public.events e
     set cancelled_at = now(), updated_at = now()
   where e.id = event;

  -- Nothing more is sent for it: every reminder goes to who said Going.
  delete from public.event_rsvps r where r.event_id = event;

  if told > 0 then
    perform public.push_notify_send('event_changed', jsonb_build_object('batch', batch));
  end if;
  return told;
end;
$$;

revoke all on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;

-- ------------------------------------------------- no answers to a cancelled date
-- A member's own answer only: an invitation joining an event (service role)
-- is left alone.
create function private.rsvp_refuses_a_cancelled_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and exists (
    select 1 from public.events e where e.id = new.event_id and e.cancelled_at is not null
  ) then
    raise exception 'This date was cancelled.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.rsvp_refuses_a_cancelled_date() from public, anon, authenticated;

create trigger event_rsvps_refuse_a_cancelled_date
before insert or update on public.event_rsvps
for each row
execute function private.rsvp_refuses_a_cancelled_date();

create function private.registration_refuses_a_cancelled_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.events e where e.id = new.event_id and e.cancelled_at is not null
  ) then
    raise exception 'This date was cancelled.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.registration_refuses_a_cancelled_date() from public, anon, authenticated;

create trigger event_registrations_refuse_a_cancelled_date
before insert or update on public.event_registrations
for each row
execute function private.registration_refuses_a_cancelled_date();

-- ------------------------------------------------- no notice for a cancelled date
-- As 20261103000000, with the cancelled check.
create or replace function private.send_event_notice(p_event uuid, p_who text, p_sender uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.events%rowtype;
  batch timestamptz := clock_timestamp();
  told uuid[];
begin
  select * into target from public.events e where e.id = p_event;
  if not found or target.organization_id is null or target.cancelled_at is not null then
    return 0;
  end if;

  select coalesce(array_agg(p.member_id), '{}') into told
    from private.organization_people_ids(target.organization_id) p
    left join public.event_member_notices n
      on n.event_id = p_event and n.member_id = p.member_id
   where p.member_id is distinct from p_sender
     and private.member_sees_event(p.member_id, p_event)
     and not exists (
       select 1 from public.event_rsvps r where r.event_id = p_event and r.member_id = p.member_id
     )
     and (p_sender is null or not public.members_blocked(p_sender, p.member_id))
     and (n.last_sent_at is null or n.last_sent_at < batch - interval '12 hours')
     and case p_who
           when 'everyone' then true
           when 'not_opened' then n.member_id is not null and n.opened_at is null
           when 'no_answer' then n.member_id is not null
         end;

  if cardinality(told) = 0 then
    return 0;
  end if;

  insert into public.event_member_notices as x
    (event_id, member_id, organization_id, first_sent_at, last_sent_at)
  select p_event, t, target.organization_id, batch, batch
    from unnest(told) t
  on conflict (event_id, member_id)
  do update set last_sent_at = excluded.last_sent_at, sends = x.sends + 1;

  insert into public.notifications as n
    (member_id, kind, tag, actor_id, event_id, organization_id, detail, created_at)
  select t, 'event_notice', 'notice:' || p_event::text, p_sender, p_event,
         target.organization_id, case when p_who = 'everyone' then null else 'again' end, batch
    from unnest(told) t
  on conflict (member_id, tag) where read_at is null
  do update set created_at = excluded.created_at, actor_id = excluded.actor_id,
                detail = 'again', seen_at = null;

  insert into public.event_notice_sends (event_id, sent_by, who, recipients, sent_at)
  values (p_event, p_sender, p_who, cardinality(told), batch);

  perform public.push_notify_send(
    'event_notice',
    jsonb_build_object('event_id', p_event, 'batch', batch)
  );
  return cardinality(told);
end;
$$;

-- As 20261103000000, saying why.
create or replace function public.notify_members_of_event(p_event uuid, p_who text default 'everyone')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.events%rowtype;
begin
  select * into target from public.events e where e.id = p_event;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if target.organization_id is null
     or not (public.speaks_for(target.organization_id) or public.is_admin()) then
    raise exception 'Only the organization''s org admins can notify its members.' using errcode = '42501';
  end if;
  if target.cancelled_at is not null then
    raise exception 'That date was cancelled.' using errcode = '22023';
  end if;
  if coalesce(target.end_time, target.start_time) < now() then
    raise exception 'That event is over.' using errcode = '22023';
  end if;
  if p_who is null or p_who not in ('everyone', 'not_opened', 'no_answer') then
    raise exception 'Choose who to notify.' using errcode = '22023';
  end if;
  return private.send_event_notice(p_event, p_who, auth.uid());
end;
$$;

-- ------------------------------------------------------ Stats leaves it out
-- As 20261106060000, without cancelled dates.
create or replace function public.organization_event_notices(p_organization uuid)
returns table (
  event_id uuid,
  title text,
  start_time timestamptz,
  timezone text,
  all_day boolean,
  notified integer,
  opened integer,
  going integer,
  interested integer,
  not_opened integer,
  no_answer integer,
  can_reach integer,
  last_sent_at timestamptz,
  people_going integer,
  people_interested integer,
  audience text,
  series_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not (public.speaks_for(p_organization) or public.is_admin()) then
    raise exception 'Only its org admins can see this.' using errcode = '42501';
  end if;
  return query
    with people as materialized (
      select p.member_id from private.organization_people_ids(p_organization) p
    ),
    -- members_blocked(me, b), both ways, once.
    blocked as materialized (
      select b.blocked_id as member_id from public.member_blocks b where b.blocker_id = me
      union
      select b.blocker_id from public.member_blocks b where b.blocked_id = me
    ),
    shown as materialized (
      select e.id, e.title, e.start_time, e.timezone, e.all_day, e.audience, e.series_id
        from public.events e
       where e.organization_id = p_organization
         and e.cancelled_at is null
         and coalesce(e.end_time, e.start_time) > now() - interval '7 days'
         and (
           e.start_time > now()
           or exists (select 1 from public.event_member_notices z where z.event_id = e.id)
         )
       order by e.start_time, e.id
       limit 100
    )
    select s.id, s.title, s.start_time, s.timezone, s.all_day,
           n.notified, n.opened, n.going, n.interested, n.not_opened, n.no_answer,
           (
             select count(*)::integer
               from (
                 select p.member_id
                   from people p
                  where p.member_id is distinct from me
                    and not exists (
                      select 1 from public.event_rsvps y where y.event_id = s.id and y.member_id = p.member_id
                    )
                    and not exists (
                      select 1 from public.event_member_notices z
                       where z.event_id = s.id and z.member_id = p.member_id
                    )
                    and not exists (select 1 from blocked b where b.member_id = p.member_id)
                 offset 0 -- the cheap checks first
               ) c
              where s.audience in ('public', 'club') or private.member_sees_event(c.member_id, s.id)
           ),
           n.last_sent_at,
           a.going,
           a.interested,
           s.audience,
           s.series_id
      from shown s
      cross join lateral (
        select count(x.member_id)::integer as notified,
               count(x.opened_at)::integer as opened,
               count(x.member_id) filter (where r.status = 'going')::integer as going,
               count(x.member_id) filter (where r.status = 'interested')::integer as interested,
               count(x.member_id) filter (where x.opened_at is null and r.status is null)::integer as not_opened,
               count(x.member_id) filter (where r.status is null)::integer as no_answer,
               max(x.last_sent_at) as last_sent_at
          from public.event_member_notices x
          left join public.event_rsvps r on r.event_id = x.event_id and r.member_id = x.member_id
         where x.event_id = s.id
      ) n
      -- event_people(s.id, me) joined to its answers.
      cross join lateral (
        select count(*) filter (where y.status = 'going')::integer as going,
               count(*) filter (where y.status = 'interested')::integer as interested
          from public.event_rsvps y
          join public.members m on m.id = y.member_id and m.status = 'active'
         where y.event_id = s.id
           and (
             exists (select 1 from people p where p.member_id = y.member_id)
             or exists (
               select 1 from public.event_member_notices x
                where x.event_id = s.id and x.member_id = y.member_id
             )
           )
           and not exists (select 1 from blocked b where b.member_id = y.member_id)
      ) a
     order by s.start_time, s.id;
end;
$$;

-- ---------------------------------------------------- the public page says so
-- As 20261120230000, with cancelled_at last.
drop function public.public_event(uuid);
create function public.public_event(event uuid)
returns table (
  id uuid,
  title text,
  description text,
  description_html text,
  start_time timestamptz,
  end_time timestamptz,
  all_day boolean,
  timezone text,
  location text,
  city text,
  state text,
  event_format text,
  url text,
  registration_url text,
  photo_path text,
  photo_alt text,
  more_photos jsonb,
  organization_id uuid,
  organization_name text,
  organization_short_code text,
  organization_logo_path text,
  takes_rsvps boolean,
  access_details text,
  cancelled_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.description, e.description_html, e.start_time, e.end_time,
         e.all_day, e.timezone, e.location, e.city, e.state, e.event_format, e.url,
         e.registration_url, e.photo_path, e.photo_alt, e.more_photos,
         o.id, o.name, o.short_code, o.logo_path,
         e.feed_id is null or coalesce(o.collects_rsvps, false), e.access_details,
         e.cancelled_at
    from public.events e
    left join public.organizations o on o.id = e.organization_id and o.removed_at is null
   where e.id = event
     and (not private.event_link_is_closed(e.audience) or public.can_see_event(e.id));
$$;

revoke all on function public.public_event(uuid) from public;
grant execute on function public.public_event(uuid) to anon, authenticated;
