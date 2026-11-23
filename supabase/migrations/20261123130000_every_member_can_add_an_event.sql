-- ============================================================================
-- Every member can add an event
-- ============================================================================
-- The owner, 2026-11-23: "Let's allow all users to create events."
--
-- Until now an event was added by an administrator, or by a member who speaks
-- for its organization (20261005010000). Now any member may add one hosted by
-- no organization, under a name they type ("Hosted by"), and change or delete
-- the ones they added, with everything an organizer has on them: the cover and
-- more pictures, the video call link, the ZIP code, the short link, repeating,
-- who sees it, the guest list and check-ins (each asks may_change_event). An
-- event for an organization is still only for those who speak for it.
--
-- "Who added it" is events.added_by, kept since 20261005020000. It counts only
-- while the event has no organization, so leaving an organization still
-- takes its events with it, and only while the member is in the club and not
-- suspended. Co-hosts stay with organizations' organizers (set_event_cohosts),
-- and a calendar invitation joins only an organization's event
-- (calendar_same_event), as before.
--
-- Each function below is restated whole from its last version, with its check
-- of "speaks for the event's organization" become may_change_event: the event
-- itself, and on later dates of a series each date.

create or replace function public.may_change_event(event uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
     where e.id = event
       and (
         (e.feed_id is null and public.may_post_events_for(e.organization_id))
         or (e.feed_id is not null and public.is_admin())
         -- One a member added in their own name, while they are in the club.
         or (
           e.feed_id is null
           and e.organization_id is null
           and e.added_by = auth.uid()
           and public.is_active_member()
         )
       )
  );
$$;
comment on function public.may_change_event(uuid) is
  'An event the caller may change: one added in the club, by an administrator or a member who speaks for its organization, or one with no organization by the member who added it (20261123130000); or, for an administrator, one from a calendar.';

create or replace function public.save_event(
  event uuid,
  organization uuid,
  host text,
  title text,
  description text,
  starts timestamptz,
  ends timestamptz,
  format text,
  place text,
  city text,
  link text,
  registration text,
  state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.events%rowtype;
  saved uuid;
  clean_title text := trim(coalesce(title, ''));
  clean_description text := trim(coalesce(description, ''));
  clean_host text := nullif(trim(coalesce(host, '')), '');
  clean_place text := trim(coalesce(place, ''));
  clean_city text := nullif(trim(coalesce(city, '')), '');
  clean_link text := nullif(trim(coalesce(link, '')), '');
  clean_registration text := nullif(trim(coalesce(registration, '')), '');
  clean_state text := nullif(upper(trim(coalesce(save_event.state, ''))), '');
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;

  if event is not null then
    select * into existing from public.events e where e.id = event for update;
    if not found then
      raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
    end if;
    if existing.feed_id is not null then
      raise exception 'This event comes from the organization''s own calendar, so it is changed there.'
        using errcode = '42501';
    end if;
    if not public.may_change_event(existing.id) then
      raise exception 'You cannot change this event.' using errcode = '42501';
    end if;
  end if;

  -- Any member may host one in their own name (the owner, 2026-11-23: "Let's
  -- allow all users to create events"); for an organization, only those who
  -- speak for it.
  if organization is null then
    if not (public.is_admin() or public.is_active_member()) then
      raise exception 'Only a member can add an event.' using errcode = '42501';
    end if;
  elsif not public.may_post_events_for(organization) then
    raise exception 'You cannot add events for that organization.' using errcode = '42501';
  end if;
  if organization is not null then
    if not exists (select 1 from public.organizations o where o.id = organization) then
      raise exception 'That organization is not in the directory.' using errcode = 'P0002';
    end if;
    -- The organization is the host; a second name beside it would disagree.
    clean_host := null;
  elsif clean_host is null then
    raise exception 'Say who is hosting it.' using errcode = '22023';
  end if;

  if length(clean_title) = 0 then
    raise exception 'Give the event a name.' using errcode = '22023';
  end if;
  if length(clean_title) > 140 then
    raise exception 'The name can be 140 characters at most.' using errcode = '22023';
  end if;
  if length(clean_description) > 4000 then
    raise exception 'The description can be 4,000 characters at most.' using errcode = '22023';
  end if;
  if length(coalesce(clean_host, '')) > 120 then
    raise exception 'The host''s name can be 120 characters at most.' using errcode = '22023';
  end if;
  if clean_state is not null and clean_state !~ '^[A-Z]{2}$' then
    raise exception 'A state is its two letters.' using errcode = '22023';
  end if;
  if length(clean_place) > 300 or length(coalesce(clean_city, '')) > 100 then
    raise exception 'The place is too long.' using errcode = '22023';
  end if;
  if starts is null then
    raise exception 'Say when it starts.' using errcode = '22023';
  end if;
  if ends is not null and ends <= starts then
    raise exception 'It has to end after it starts.' using errcode = '22023';
  end if;
  if format is null or format not in ('in_person', 'online', 'hybrid') then
    raise exception 'Say whether it is in person, online or hybrid.' using errcode = '22023';
  end if;
  if format <> 'online' and length(clean_place) = 0 then
    raise exception 'Say where it is.' using errcode = '22023';
  end if;
  -- A web address, and nothing a browser would run. The page draws both
  -- through safeHref anyway; this keeps anything else out of the table.
  if (clean_link is not null and clean_link !~* '^https?://[^\s]+$')
     or (clean_registration is not null and clean_registration !~* '^https?://[^\s]+$') then
    raise exception 'A link has to be a web address starting https://.' using errcode = '22023';
  end if;
  if length(coalesce(clean_link, '')) > 2000 or length(coalesce(clean_registration, '')) > 2000 then
    raise exception 'A link can be 2,000 characters at most.' using errcode = '22023';
  end if;

  if event is null then
    insert into public.events (
      title, description, description_html, start_time, end_time, location, city,
      url, registration_url, organization_id, host_name, event_format, added_by, state
    )
    values (
      clean_title, clean_description, '', starts, ends, clean_place, clean_city,
      clean_link, clean_registration, organization, clean_host, format, me, clean_state
    )
    returning id into saved;
  else
    update public.events e
       set title = clean_title,
           description = clean_description,
           start_time = starts,
           end_time = ends,
           location = clean_place,
           city = clean_city,
           url = clean_link,
           registration_url = clean_registration,
           organization_id = organization,
           host_name = clean_host,
           event_format = format,
           state = coalesce(clean_state, e.state),
           updated_at = now()
     where e.id = event
    returning e.id into saved;
  end if;

  return saved;
end;
$$;

create or replace function public.delete_event(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
begin
  if auth.uid() is null then
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
    raise exception 'You cannot delete this event.' using errcode = '42501';
  end if;

  delete from public.events e where e.id = event;
end;
$$;

create or replace function public.set_event_short_link(p_event uuid, p_link text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  link text := nullif(lower(btrim(coalesce(p_link, ''))), '');
  existing public.events%rowtype;
begin
  select * into existing from public.events e where e.id = p_event;
  if not found then
    raise exception 'That event is not on the calendar any more.' using errcode = 'P0002';
  end if;
  if not (
    public.is_admin()
    or (existing.feed_id is null and public.may_change_event(existing.id))
  ) then
    raise exception 'You cannot change this event.' using errcode = '42501';
  end if;
  if link is not null and link !~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$' then
    raise exception 'Use 2 to 32 letters, numbers or hyphens, starting and ending with a letter or number.'
      using errcode = '22023';
  end if;

  begin
    update public.events e set short_link = link where e.id = p_event;
  exception when unique_violation then
    raise exception 'That short link is taken. Try another.' using errcode = '23505';
  end;
  return link;
end;
$$;

create or replace function public.delete_event_and_later(event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  gone integer;
begin
  if auth.uid() is null then
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
    raise exception 'You cannot delete this event.' using errcode = '42501';
  end if;

  if existing.series_id is null then
    delete from public.events e where e.id = event;
    return 1;
  end if;

  update public.event_series s
     set stopped = true, updated_at = now()
   where s.id = existing.series_id and s.feed_id is null;

  delete from public.events e
   where e.series_id = existing.series_id
     and e.feed_id is null
     and e.start_time >= existing.start_time
     and public.may_change_event(e.id);
  get diagnostics gone = row_count;
  return gone;
end;
$$;

create or replace function public.set_event_photo(event uuid, photo_path text, photo_alt text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  previous text;
  clean_alt text := nullif(trim(coalesce(photo_alt, '')), '');
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
  if length(coalesce(clean_alt, '')) > 200 then
    raise exception 'The description of the picture can be 200 characters at most.' using errcode = '22023';
  end if;
  -- The picture it already has is always allowed, so its description can be
  -- changed on a later date of a series, whose file is in the first date's
  -- folder.
  if set_event_photo.photo_path is not null
     and set_event_photo.photo_path is distinct from existing.photo_path then
    if set_event_photo.photo_path !~ ('^events/' || event::text || '/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,5}$') then
      raise exception 'That picture is not in this event''s folder.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'photos' and o.name = set_event_photo.photo_path
    ) then
      raise exception 'That picture was not uploaded.' using errcode = 'P0002';
    end if;
  end if;

  previous := existing.photo_path;

  update public.events e
     set photo_path = set_event_photo.photo_path,
         photo_alt = case when set_event_photo.photo_path is null then null else clean_alt end,
         updated_at = now()
   where e.id = event
      or (
        existing.series_id is not null
        and e.series_id = existing.series_id
        and e.feed_id is null
        and e.start_time > existing.start_time
        and public.may_change_event(e.id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template
             || jsonb_build_object(
                  'photo_path', set_event_photo.photo_path,
                  'photo_alt', case when set_event_photo.photo_path is null then null else clean_alt end
                ),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;

  if previous is null
     or previous = set_event_photo.photo_path
     or exists (select 1 from public.events e where e.photo_path = previous)
     or exists (select 1 from public.event_series s where s.template ->> 'photo_path' = previous) then
    return null;
  end if;
  return previous;
end;
$$;

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
        and public.may_change_event(e.id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template || jsonb_build_object('postal_code', clean),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;
end;
$$;

create or replace function public.set_event_meeting_link(event uuid, link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  clean text := nullif(btrim(coalesce(link, '')), '');
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
  if clean is not null and (clean !~ '^https://[^\s]+$' or char_length(clean) > 2000) then
    raise exception 'The video call link has to start with https://.' using errcode = '22023';
  end if;

  update public.events e
     set meeting_url = clean,
         updated_at = now()
   where e.id = event
      or (
        existing.series_id is not null
        and e.series_id = existing.series_id
        and e.feed_id is null
        and e.start_time > existing.start_time
        and public.may_change_event(e.id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template || jsonb_build_object('meeting_url', clean),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;
end;
$$;

create or replace function public.set_event_more_photos(event uuid, photos jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.events%rowtype;
  wanted jsonb := '[]'::jsonb;
  item jsonb;
  item_path text;
  item_alt text;
  gone text[];
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
  if photos is null or jsonb_typeof(photos) <> 'array' then
    raise exception 'That is not a list of pictures.' using errcode = '22023';
  end if;
  if jsonb_array_length(photos) > 6 then
    raise exception 'An event can have up to 6 more pictures.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(photos) loop
    item_path := item ->> 'path';
    item_alt := nullif(btrim(coalesce(item ->> 'alt', '')), '');
    if item_path is null then
      raise exception 'That is not a list of pictures.' using errcode = '22023';
    end if;
    if char_length(coalesce(item_alt, '')) > 200 then
      raise exception 'The description of a picture can be 200 characters at most.' using errcode = '22023';
    end if;
    -- One it already has is always allowed: on a later date of a series the
    -- file is in the first date's folder.
    if not existing.more_photos @> jsonb_build_array(jsonb_build_object('path', item_path)) then
      if item_path !~ ('^events/' || event::text || '/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,5}$') then
        raise exception 'That picture is not in this event''s folder.' using errcode = '22023';
      end if;
      if not exists (
        select 1 from storage.objects o
         where o.bucket_id = 'photos' and o.name = item_path
      ) then
        raise exception 'That picture was not uploaded.' using errcode = 'P0002';
      end if;
    end if;
    if not wanted @> jsonb_build_array(jsonb_build_object('path', item_path)) then
      wanted := wanted || jsonb_build_array(
        jsonb_build_object('path', item_path, 'alt', coalesce(item_alt, ''))
      );
    end if;
  end loop;

  update public.events e
     set more_photos = wanted,
         updated_at = now()
   where e.id = event
      or (
        existing.series_id is not null
        and e.series_id = existing.series_id
        and e.feed_id is null
        and e.start_time > existing.start_time
        and public.may_change_event(e.id)
      );

  if existing.series_id is not null then
    update public.event_series s
       set template = s.template || jsonb_build_object('more_photos', wanted),
           updated_at = now()
     where s.id = existing.series_id and s.feed_id is null;
  end if;

  select coalesce(array_agg(was.path), '{}') into gone
    from (
      select distinct old_item ->> 'path' as path
        from jsonb_array_elements(existing.more_photos) as old_item
    ) was
   where not exists (
           select 1 from public.events e
            where e.photo_path = was.path
               or e.more_photos @> jsonb_build_array(jsonb_build_object('path', was.path))
         )
     and not exists (
           select 1 from public.event_series s
            where s.template ->> 'photo_path' = was.path
               or s.template -> 'more_photos' @> jsonb_build_array(jsonb_build_object('path', was.path))
         );
  return gone;
end;
$$;
