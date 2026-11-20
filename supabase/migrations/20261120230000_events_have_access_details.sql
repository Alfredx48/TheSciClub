-- Venue and online access notes follow the event's existing visibility.
alter table public.events add column access_details text
  check (char_length(access_details) <= 1000);

grant select (access_details) on public.events to anon, authenticated, service_role;

-- The original signature remains available to installed builds.
create function public.save_event(
  event uuid, organization uuid, host text, title text,
  description text, starts timestamptz, ends timestamptz, format text, place text,
  city text, link text, registration text, state text,
  access_details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
  details text := nullif(btrim(access_details), '');
begin
  if char_length(details) > 1000 then
    raise exception 'Access details can be 1,000 characters at most.' using errcode = '22023';
  end if;
  saved := public.save_event(event, organization, host, title, description, starts, ends, format, place, city, link, registration, state);
  update public.events e set access_details = details where e.id = saved;
  return saved;
end;
$$;
revoke all on function public.save_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text) to authenticated;

-- The original signature remains available to installed builds.
create function public.save_event_series(
  organization uuid, host text, title text, description text,
  starts timestamptz, ends timestamptz, format text, place text, city text,
  link text, registration text, repeat_unit text, repeat_every integer, ends_on date, ends_after integer, state text,
  access_details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
  saved_series uuid;
  details text := nullif(btrim(access_details), '');
begin
  if char_length(details) > 1000 then
    raise exception 'Access details can be 1,000 characters at most.' using errcode = '22023';
  end if;
  saved := public.save_event_series(organization, host, title, description, starts, ends, format, place, city, link, registration, repeat_unit, repeat_every, ends_on, ends_after, state);
  select e.series_id into saved_series from public.events e where e.id = saved;
  update public.events e set access_details = details where e.series_id = saved_series;
  update public.event_series s
     set template = s.template || jsonb_build_object('access_details', details)
   where s.id = saved_series;
  return saved;
end;
$$;
revoke all on function public.save_event_series(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, integer, date, integer, text, text) from public, anon;
grant execute on function public.save_event_series(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, integer, date, integer, text, text) to authenticated;

-- The original signature remains available to installed builds.
create function public.admin_change_imported_event(
  event uuid, organization uuid, host text, title text,
  description text, starts timestamptz, ends timestamptz, format text, place text,
  city text, link text, registration text,
  access_details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
  details text := nullif(btrim(access_details), '');
begin
  if char_length(details) > 1000 then
    raise exception 'Access details can be 1,000 characters at most.' using errcode = '22023';
  end if;
  saved := public.admin_change_imported_event(event, organization, host, title, description, starts, ends, format, place, city, link, registration);
  update public.events e set access_details = details where e.id = saved;
  return saved;
end;
$$;
revoke all on function public.admin_change_imported_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_change_imported_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text) to authenticated;

create or replace function public.extend_event_series(series uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.event_series%rowtype;
  zone constant text := 'America/Los_Angeles';
  horizon timestamptz := now() + interval '92 days';
  k integer;
  starts timestamptz;
  made_now integer := 0;
  finished boolean := false;
  guard integer := 0;
begin
  select * into s from public.event_series e where e.id = series for update;
  if not found or s.feed_id is not null or s.stopped then
    return 0;
  end if;

  k := s.next_index;
  loop
    guard := guard + 1;
    exit when guard > 500;

    if s.ends_after is not null and s.made + made_now >= s.ends_after then
      finished := true;
      exit;
    end if;

    starts := public.event_series_step(s.repeat_unit, s.repeat_every, s.first_start, k);
    if starts is null then
      k := k + 1;
      continue;
    end if;
    if s.ends_on is not null and (starts at time zone zone)::date > s.ends_on then
      finished := true;
      exit;
    end if;
    exit when starts > horizon;

    insert into public.events (
      title, description, description_html, start_time, end_time, location, city,
      url, registration_url, organization_id, host_name, event_format, added_by, series_id,
      photo_path, photo_alt, more_photos, access_details
    )
    values (
      s.template ->> 'title',
      coalesce(s.template ->> 'description', ''),
      '',
      starts,
      case when s.duration is null then null else starts + s.duration end,
      coalesce(s.template ->> 'location', ''),
      s.template ->> 'city',
      s.template ->> 'url',
      s.template ->> 'registration_url',
      (s.template ->> 'organization_id')::uuid,
      s.template ->> 'host_name',
      s.template ->> 'event_format',
      s.added_by,
      s.id,
      s.template ->> 'photo_path',
      s.template ->> 'photo_alt',
      coalesce(s.template -> 'more_photos', '[]'::jsonb),
      s.template ->> 'access_details'
    );
    made_now := made_now + 1;
    k := k + 1;
  end loop;

  update public.event_series e
     set next_index = k,
         made = s.made + made_now,
         stopped = finished,
         updated_at = now()
   where e.id = s.id;

  return made_now;
end;
$$;

create or replace function public.make_event_repeat(
  event uuid,
  repeat_unit text,
  repeat_every integer,
  ends_on date default null,
  ends_after integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  opener public.events%rowtype;
  new_series uuid;
  zone constant text := 'America/Los_Angeles';
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  select * into opener from public.events e where e.id = event for update;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if not public.may_change_event(event) then
    raise exception 'You cannot change this event.' using errcode = '42501';
  end if;
  if opener.feed_id is not null then
    raise exception 'An event from an organization''s calendar repeats as that calendar says.'
      using errcode = '22023';
  end if;
  if opener.series_id is not null then
    raise exception 'This event already repeats.' using errcode = '22023';
  end if;
  if opener.start_time <= now() then
    raise exception 'Only an event that has not started yet can be made to repeat.'
      using errcode = '22023';
  end if;
  if repeat_unit is null or repeat_unit not in ('day', 'week', 'month') then
    raise exception 'Say how often it repeats.' using errcode = '22023';
  end if;
  if repeat_every is null or repeat_every < 1 or repeat_every > 30 then
    raise exception 'It can repeat every 1 to 30 days, weeks or months.' using errcode = '22023';
  end if;
  if ends_on is not null and ends_after is not null then
    raise exception 'Say when it ends one way, not both.' using errcode = '22023';
  end if;
  if ends_after is not null and (ends_after < 2 or ends_after > 100) then
    raise exception 'It can repeat 2 to 100 times.' using errcode = '22023';
  end if;
  if ends_on is not null and ends_on <= (opener.start_time at time zone zone)::date then
    raise exception 'It has to end after the first date.' using errcode = '22023';
  end if;

  insert into public.event_series (
    feed_id, series_key, title, repeat_unit, repeat_every, ends_on, ends_after,
    first_start, duration, next_index, made, template, added_by
  )
  values (
    null,
    'hand:' || opener.id::text,
    opener.title,
    make_event_repeat.repeat_unit,
    make_event_repeat.repeat_every,
    make_event_repeat.ends_on,
    make_event_repeat.ends_after,
    opener.start_time,
    case when opener.end_time is null then null else opener.end_time - opener.start_time end,
    1,
    1,
    jsonb_build_object(
      'title', opener.title,
      'description', opener.description,
      'location', opener.location,
      'city', opener.city,
      'url', opener.url,
      'registration_url', opener.registration_url,
      'organization_id', opener.organization_id,
      'host_name', opener.host_name,
      'event_format', opener.event_format,
      'photo_path', opener.photo_path,
      'photo_alt', opener.photo_alt,
      'more_photos', opener.more_photos,
      'meeting_url', opener.meeting_url,
      'access_details', opener.access_details
    ),
    coalesce(opener.added_by, auth.uid())
  )
  returning id into new_series;

  update public.events e set series_id = new_series, updated_at = now() where e.id = opener.id;
  return public.extend_event_series(new_series);
end;
$$;

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
  access_details text
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
         e.feed_id is null or coalesce(o.collects_rsvps, false), e.access_details
    from public.events e
    left join public.organizations o on o.id = e.organization_id and o.removed_at is null
   where e.id = event
     and (not private.event_link_is_closed(e.audience) or public.can_see_event(e.id));
$$;
revoke all on function public.public_event(uuid) from public;
grant execute on function public.public_event(uuid) to anon, authenticated;

drop function public.event_invite_page(text);
create function public.event_invite_page(p_token text)
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
  guest_email text,
  guest_name text,
  guest_phone text,
  inviter_name text,
  accepted boolean,
  access_details text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv public.invites := private.event_invite_for_token(p_token);
begin
  if inv.id is null then
    return;
  end if;
  update public.invites set link_opened_at = now() where invites.id = inv.id and link_opened_at is null;
  return query
  select e.id, e.title, e.description, e.description_html, e.start_time, e.end_time,
         e.all_day, e.timezone, e.location, e.city, e.state, e.event_format, e.url,
         e.registration_url, e.photo_path, e.photo_alt, e.more_photos,
         o.id, o.name, o.short_code, o.logo_path,
         true,
         lower(inv.email::text), coalesce(r.name, inv.invitee_name), r.phone,
         im.display_name,
         r.id is not null, e.access_details
    from public.events e
    left join public.organizations o on o.id = e.organization_id and o.removed_at is null
    left join public.members im on im.id = inv.invited_by_member_id
    left join public.event_registrations r
      on r.id = inv.event_registration_id and lower(r.email::text) = lower(inv.email::text)
   where e.id = inv.event_id;
end;
$$;
revoke all on function public.event_invite_page(text) from public;
grant execute on function public.event_invite_page(text) to anon, authenticated;
