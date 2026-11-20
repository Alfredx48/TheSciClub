-- ============================================================================
-- An administrator sees whether a member's profile is complete, not what it says
-- ============================================================================
-- The owner, 2026-11-20, of Create email on a member's page (20261121010000):
-- "If a user has completed their profile, then remove that button."
--
-- Complete is what the member's own Me tab calls "Profile complete": every
-- profile question that applies to them answered or declined (progressOf in
-- src/routes/profile/questions.ts). Which questions apply depends on the
-- answers, so the page works it out with that same code rather than a second
-- copy here that could drift.
--
-- The answers are the member's alone (own-row RLS on members), and some are as
-- personal as the club gets: how they were injured, self-care, independence.
-- So this does not hand them over. For each profile column it says only
-- whether there is something in it: words become 'x', each item of a list
-- 'x', an empty one ''. Kept as they are, because which questions apply turns
-- on them: injury_type (already on the member's public page), has_children
-- (yes or no) and declined (the keys of questions they chose not to answer).
--
-- Only the club's administrators. Expand only: a new function.
-- ============================================================================

create function public.admin_member_answered(p_member uuid)
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

  select jsonb_object_agg(
           e.key,
           case
             when e.key in ('injury_type', 'declined') then e.value
             when jsonb_typeof(e.value) = 'string' then
               case when btrim(e.value #>> '{}') = '' then '""'::jsonb else '"x"'::jsonb end
             when jsonb_typeof(e.value) = 'array' then
               (select coalesce(jsonb_agg('x'::text), '[]'::jsonb) from jsonb_array_elements(e.value))
             when jsonb_typeof(e.value) = 'boolean' then e.value
             else 'null'::jsonb
           end
         )
    into result
    from public.members m, jsonb_each(to_jsonb(m)) e
   where m.id = p_member
     and e.key = any (array[
       'gender', 'languages', 'how_injured', 'detail', 'marital_status',
       'has_children', 'children_when', 'independence', 'self_care',
       'employment', 'field_of_work', 'education', 'education_when',
       'interests', 'topics', 'wants_to_mentor', 'sports_equipment',
       'grants', 'other_organizations', 'bio',
       'injury_type', 'declined'
     ]);
  return result;
end;
$$;

revoke all on function public.admin_member_answered(uuid) from public, anon;
grant execute on function public.admin_member_answered(uuid) to authenticated;
