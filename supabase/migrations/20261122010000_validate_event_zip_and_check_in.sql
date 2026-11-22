-- Keep ZIP validation consistent with the form and enforce the event audience.
create or replace function public.set_event_postal_code(event uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  clean text := nullif(btrim(coalesce(code, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  select * into existing from public.events e where e.id = event for update;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if not public.may_change_event(event) then
    raise exception 'You cannot change this event.' using errcode = '42501';
  end if;
  if clean is not null and clean !~ '^[0123456789]{5}(-[0123456789]{4})?$' then
    raise exception 'A ZIP code is five digits, like 94404.' using errcode = '22023';
  end if;

  update public.events e
     set postal_code = clean,
         updated_at = now()
   where e.id = event
      or (
        existing.series_id is not null
        and e.series_id = existing.series_id
        and e.feed_id is null
        and e.start_time > existing.start_time
        and public.may_post_events_for(e.organization_id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template || jsonb_build_object('postal_code', clean),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;
end;
$$;

create or replace function public.event_guest_check_in(
  p_event uuid,
  p_checked boolean,
  p_member uuid default null,
  p_registration uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  found_event record;
  ticked boolean;
  joined text;
  first_push boolean;
begin
  if me is null or not public.may_change_event(p_event) then
    raise exception 'Only the event''s organizers can check guests in.' using errcode = '42501';
  end if;
  if (p_member is null) = (p_registration is null) then
    raise exception 'Say which guest.' using errcode = '22023';
  end if;

  select e.id, e.start_time, e.organization_id into found_event
    from public.events e where e.id = p_event;
  if p_checked and now() < found_event.start_time then
    raise exception 'Guests can be checked in once the event has started.' using errcode = '22023';
  end if;

  if p_member is not null then
    if not p_checked then
      delete from public.event_check_ins c where c.event_id = p_event and c.member_id = p_member;
      delete from public.notifications n
       where n.member_id = p_member and n.tag = 'checked_in:' || p_event::text and n.read_at is null;
      return;
    end if;
    if not exists (
      select 1 from public.event_rsvps r
       where r.event_id = p_event and r.member_id = p_member and r.status = 'going'
    ) then
      raise exception 'They are not on the guest list.' using errcode = '22023';
    end if;

    insert into public.event_check_ins (event_id, member_id, checked_in_by)
    values (p_event, p_member, me)
    on conflict do nothing
    returning true into ticked;
    -- Already in, by themselves or another organizer: nothing more to do.
    if ticked is null then
      return;
    end if;

    -- As check_in_to_event: the hosting organization, joined or asked. Not
    -- for a member whose Going came from an organizer typing in their email
    -- (20261113130000): they never chose this event, let alone its host.
    if not exists (
      select 1 from public.event_registrations g
       where g.event_id = p_event and g.member_id = p_member and g.added_by is not null
    ) then
      insert into public.organization_join_requests (organization_id, member_id)
      select o.id, p_member
        from public.organizations o
       where o.id = found_event.organization_id
         and o.removed_at is null
         and o.joins_need_approval
         and not exists (
           select 1 from public.organization_members om
            where om.organization_id = o.id and om.member_id = p_member
         )
      on conflict do nothing;

      with added as (
        insert into public.organization_members (organization_id, member_id, joined_via, event_id)
        select o.id, p_member, 'check_in', p_event
          from public.organizations o
         where o.id = found_event.organization_id
           and o.removed_at is null
           and not o.joins_need_approval
        on conflict do nothing
        returning organization_id
      )
      select o.name into joined
        from added a
        join public.organizations o on o.id = a.organization_id;
    end if;

    -- Told, unless they ticked themselves (an organizer on their own list).
    if p_member <> me then
      insert into public.notifications as n
        (member_id, kind, tag, actor_id, event_id, organization_id, detail)
      values (p_member, 'checked_in', 'checked_in:' || p_event::text, me, p_event,
              case when joined is not null then found_event.organization_id end, joined)
      on conflict (member_id, tag) where read_at is null
      do update set created_at = clock_timestamp(), actor_id = excluded.actor_id,
                    organization_id = excluded.organization_id, detail = excluded.detail,
                    seen_at = null;
      -- Pushed once per event (20261113130000): ticking and unticking again
      -- brings the bell entry back, silently.
      insert into private.checked_in_pushed (event_id, member_id)
      values (p_event, p_member)
      on conflict do nothing
      returning true into first_push;
      if first_push then
        perform public.push_notify_send(
          'checked_in', jsonb_build_object('event_id', p_event, 'member_id', p_member));
      end if;
    end if;
    return;
  end if;

  update public.event_registrations g
     set checked_in_at = case when p_checked then coalesce(g.checked_in_at, now()) end,
         checked_in_by = case when p_checked then coalesce(g.checked_in_by, me) end
   where g.id = p_registration and g.event_id = p_event;
  if not found then
    raise exception 'They are not on the guest list.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.check_in_missed(p_event uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  found_event record;
  closes timestamptz;
  helper uuid;
  key text;
  found_thread uuid;
begin
  if me is null or not public.is_active_member() then
    raise exception 'Only an active member can send a message.' using errcode = '42501';
  end if;

  select e.id, e.start_time, e.end_time, e.all_day, e.organization_id, e.added_by
    into found_event
    from public.events e
   where e.id = p_event and public.can_see_event(e.id);
  if not found then
    raise sqlstate 'PT404' using message = 'This event is not on the calendar.';
  end if;

  closes := private.check_in_closes(found_event.start_time, found_event.end_time, found_event.all_day);
  if now() <= closes then
    raise exception 'Check-in for this event is still open.' using errcode = '22023';
  end if;
  if now() > closes + interval '7 days' then
    raise exception 'Check-in for this event closed more than a week ago.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.event_check_ins c where c.event_id = p_event and c.member_id = me
  ) then
    raise exception 'You checked in to this event.' using errcode = '22023';
  end if;

  select m.id into helper
    from public.members m
   where m.id = found_event.added_by
     and m.status = 'active'
     and m.id <> me
     and not public.members_blocked(me, m.id);

  if helper is null then
    select m.id into helper
      from public.organization_representatives r
      join public.members m on m.id = r.member_id
     where r.organization_id = found_event.organization_id
       and m.status = 'active'
       and m.id <> me
       and not public.members_blocked(me, m.id)
     order by r.created_at, m.id
     limit 1;
  end if;

  if helper is null then
    select m.id into helper
      from public.members m
     where m.is_admin
       and m.status = 'active'
       and m.id <> me
       and not public.members_blocked(me, m.id)
     order by m.created_at, m.id
     limit 1;
  end if;

  if helper is null then
    raise exception 'There is nobody to message about this event.' using errcode = 'P0002';
  end if;

  key := least(me, helper)::text || ':' || greatest(me, helper)::text;

  select t.id into found_thread from public.chat_threads t where t.direct_key = key;
  if found_thread is null then
    insert into public.chat_threads (kind, direct_key, created_by)
    values ('direct', key, me)
    on conflict (direct_key) do nothing
    returning id into found_thread;

    if found_thread is null then
      select t.id into found_thread from public.chat_threads t where t.direct_key = key;
    end if;
  end if;

  insert into public.chat_thread_members (thread_id, member_id)
  values (found_thread, me), (found_thread, helper)
  on conflict (thread_id, member_id) do nothing;

  return found_thread;
end;
$$;
