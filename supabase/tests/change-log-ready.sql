-- Run after 20261125140000. Everything is rolled back.
-- The change log's ready ticks are for administrators: nobody else reads or sets them, and
-- nobody reaches the table itself.
begin;

do $$
declare
  administrator uuid;
  member uuid;
  listed integer;
  by_name text;
begin
  if has_function_privilege('anon', 'public.admin_change_log_ready()', 'execute')
     or has_function_privilege('anon', 'public.admin_mark_change_ready(text, boolean)', 'execute') then
    raise exception 'Anonymous clients can reach the ticks';
  end if;
  if has_table_privilege('authenticated', 'public.change_log_ready', 'select')
     or has_table_privilege('authenticated', 'public.change_log_ready', 'insert')
     or has_table_privilege('anon', 'public.change_log_ready', 'select') then
    raise exception 'The table can be reached without the functions';
  end if;

  select id into strict administrator from public.members where is_admin and status = 'active' limit 1;
  select id into strict member from public.members where not is_admin and status = 'active' limit 1;

  -- A member who is not an administrator: neither reads nor ticks.
  perform set_config('request.jwt.claim.sub', member::text, true);
  begin
    perform public.admin_change_log_ready();
    raise exception 'A member read the ticks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_mark_change_ready('0123456789ab', true);
    raise exception 'A member ticked a change';
  exception when insufficient_privilege then null;
  end;

  -- An administrator ticks, and it is listed under their name.
  perform set_config('request.jwt.claim.sub', administrator::text, true);
  perform public.admin_mark_change_ready('0123456789ab', true);
  perform public.admin_mark_change_ready('0123456789ab', true);
  select count(*), max(r.marked_by) into listed, by_name
    from public.admin_change_log_ready() r where r.change_key = '0123456789ab';
  if listed <> 1 then
    raise exception 'A change ticked twice is listed % times', listed;
  end if;
  if by_name is distinct from (select display_name from public.members where id = administrator) then
    raise exception 'The tick does not say who made it: %', by_name;
  end if;

  -- Only a change's key is taken.
  begin
    perform public.admin_mark_change_ready('not a key', true);
    raise exception 'Something that is not a key was ticked';
  exception when invalid_parameter_value then null;
  end;

  -- And the tick comes off.
  perform public.admin_mark_change_ready('0123456789ab', false);
  if exists (select 1 from public.admin_change_log_ready() r where r.change_key = '0123456789ab') then
    raise exception 'An unticked change is still listed';
  end if;

  raise exception 'RESULT ok: members refused, administrator ticked once under their name, bad key refused, tick removed';
end;
$$;

rollback;
