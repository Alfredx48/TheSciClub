\set ON_ERROR_STOP on
do $$
begin
  if exists (
    select from unnest(array['👍', '👍🏽', '❤️', '🇺🇸', '👨‍👩‍👧‍👦', '1️⃣']) e
     where not public.is_reaction_emoji(e)
  ) then
    raise exception 'A supported emoji sequence was refused';
  end if;
  if exists (
    select from unnest(array['', '①', 'ⓐ', '日', '👍👍', '👍 👍', U&'\200B', U&'\202E']) e
     where public.is_reaction_emoji(e)
  ) then
    raise exception 'An invalid reaction was accepted';
  end if;
end;
$$;
