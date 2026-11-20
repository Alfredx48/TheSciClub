-- About us blurs last names (the owner, 2026-11-20: "Can you blur out the last names at the
-- about page?"). As with the city, age and injury day (20261115150000), the page is for anybody,
-- so the last name is not sent at all and what is blurred is a stand-in. Usernames go too: they
-- are mostly "first.last". Same shape as before, so an older app still reads it.

create or replace function public.about_us_team()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select jsonb_build_object(
    'id', m.id,
    'type', m.type,
    -- The first name only, and no username: those are "first.last" (the owner, 2026-11-20:
    -- "blur out the last names at the about page"). The page blurs a stand-in.
    'display_name', split_part(btrim(m.display_name), ' ', 1),
    'last_name_hidden', btrim(m.display_name) ~ '\s',
    'username', null,
    'photo_path', m.photo_path,
    'photo_alt', m.photo_alt,
    'avatar_color', m.avatar_color,
    'city', null,
    'state', '',
    'age', null,
    'injury_date', null,
    'injury_date_precision', case when m.show_injury_date then m.injury_date_precision end,
    'injury_year', case when m.show_injury_date then extract(year from m.injury_date)::int end,
    'injury_stage', public.injury_stage(m.injury_date),
    'injury_band', public.injury_band(m.injury_date),
    'level_range', m.level_range,
    'exact_level', m.exact_level,
    'injury_type', m.injury_type,
    'condition_name', m.condition_name,
    'completeness', m.completeness,
    'region', m.region,
    'how_injured', m.how_injured,
    'bio', m.bio,
    'detail', m.detail,
    'languages', m.languages,
    'independence', m.independence,
    'employment', m.employment,
    'field_of_work', m.field_of_work,
    'education', m.education,
    'has_children', m.has_children,
    'children_when', m.children_when,
    'interests', m.interests,
    'topics', m.topics,
    'self_care', m.self_care,
    'sports_equipment', m.sports_equipment,
    'grants', m.grants,
    'affiliations', m.affiliations,
    'is_seed', m.is_seed,
    'is_admin', m.is_admin,
    'created_at', m.created_at,
    -- As browse_members (20261028950000).
    'represented_organizations', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', o.id, 'name', o.name, 'short_code', o.short_code, 'logo_path', o.logo_path)
               order by o.name, o.id)
        from public.organization_representatives r
        join public.organizations o on o.id = r.organization_id
       where r.member_id = m.id and o.removed_at is null
    ), '[]'::jsonb),
    'mentor_organizations', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', o.id, 'name', o.name, 'short_code', o.short_code, 'logo_path', o.logo_path)
               order by o.is_the_club, o.name, o.id)
        from public.organization_mentors g
        join public.organizations o on o.id = g.organization_id
       where g.member_id = m.id and o.removed_at is null
    ), '[]'::jsonb)
  )
    from private.about_us_team t
    join public.members m on m.id = t.member_id
   where m.status = 'active'
   order by t.position, m.display_name;
$$;
