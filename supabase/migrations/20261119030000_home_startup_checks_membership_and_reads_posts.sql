create or replace function public.home_startup()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  member_row jsonb;
  feed jsonb;
  rooms jsonb;
begin
  -- Match the fields shared by the membership check and the profile.
  select to_jsonb(member) into member_row
  from (
    select id, status, is_admin, display_name, username, type, photo_path, photo_alt,
           city, state, zip, level_range, exact_level, injury_type, condition_name,
           completeness, injury_date, injury_date_precision, show_injury_date, birth_date,
           created_at, show_in_browse, show_on_map, wants_to_mentor, gender, languages,
           bio, how_injured, topics, marital_status, has_children, children_when,
           independence, employment, education, education_when, field_of_work,
           interests, self_care, detail, declined, other_organizations, sports_equipment, grants
    from public.members
    where id = viewer
  ) member;

  -- The feed migration can arrive separately. All reads still run under RLS.
  if member_row ->> 'status' = 'active'
     and to_regprocedure('public.home_feed(text,text,integer)') is not null then
    feed := public.home_feed();
    select coalesce(jsonb_agg(to_jsonb(room) order by room.sort_order), '[]'::jsonb) into rooms
    from (
      select id, name, description, category, icon, sort_order, opened_at, created_by, show_in_home
      from public.chat_rooms
    ) room;
  end if;

  return jsonb_build_object('viewer', viewer, 'member', member_row, 'feed', feed, 'rooms', rooms);
end;
$$;

revoke all on function public.home_startup() from public, anon;
grant execute on function public.home_startup() to authenticated;
