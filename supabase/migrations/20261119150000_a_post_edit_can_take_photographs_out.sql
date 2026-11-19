-- ============================================================================
-- An edit can take a post's photographs out
-- ============================================================================
-- The owner, 2026-11-19: "can you make it possible to delete images when
-- someone edits a post.. or reply".
--
-- chat_edit_post_photographs (20261029000000) could only add photographs.
-- This takes the ones the post keeps as well: `kept` must be photographs it
-- has now, in their order, and `added` new ones, as before. The post then
-- carries kept || added, still four at most.
--
-- Everything else is as 20261029000000: the author only, while the post
-- stands and the room is open; the earlier version, with its photographs,
-- goes to chat_edits, where whoever can read the post can still see it
-- (20261029240000), as with words changed; nothing changed is refused.
--
-- Once somebody else has replied, the post is only added to: the trigger
-- chat_posts_keep_answered_words (20261029260000) refuses an edit that takes
-- a photograph out, in a sentence, as it refuses changed words. A new
-- photograph is still checked by chat_posts_check_attachments
-- (20261018020000); one kept was checked when it was added.
--
-- The files stay in storage: the earlier version still shows them.
--
-- Expand only: a new function. chat_edit_post and chat_edit_post_photographs
-- stay as they are for the iPhone app already shipped.
-- ============================================================================

create or replace function public.chat_edit_post_photographs_kept(
  post uuid,
  new_body text,
  kept text[],
  added text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  clean text := btrim(coalesce(new_body, ''));
  keeping text[] := coalesce(kept, '{}');
  adding text[] := coalesce(added, '{}');
begin
  if not public.is_active_member() then
    raise exception 'Only an active member can edit a post.' using errcode = '42501';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_topics t
    where t.id = target.topic_id and public.chat_room_is_readable(t.room_id)
  ) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  if target.author_id is distinct from auth.uid() then
    raise exception 'You can only edit your own post.' using errcode = '42501';
  end if;

  if target.removed_at is not null then
    raise exception 'That post has been removed.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.chat_topics t
    join public.chat_rooms r on r.id = t.room_id
    where t.id = target.topic_id and r.opened_at is not null
  ) then
    raise exception 'This room is closed.' using errcode = '42501';
  end if;

  -- Only photographs it has, each once, in the order it has them.
  if keeping is distinct from array(
       select a.path
         from unnest(target.attachments) with ordinality as a(path, n)
        where a.path = any (keeping)
        order by a.n
     ) then
    raise exception 'Those photographs are not on this post.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(adding) a(path) where a.path = any (target.attachments)) then
    raise exception 'That photograph is already on this post.' using errcode = '22023';
  end if;

  if char_length(clean) > 4000 then
    raise exception 'A post is at most 4,000 characters.' using errcode = '22023';
  end if;
  if cardinality(keeping) + cardinality(adding) > 4 then
    raise exception 'Up to 4 photographs on one post.' using errcode = '22023';
  end if;
  if clean = '' and cardinality(keeping) + cardinality(adding) = 0 then
    raise exception 'A post needs some words or a photograph.' using errcode = '22023';
  end if;

  if clean = target.body and keeping = target.attachments and cardinality(adding) = 0 then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  insert into public.chat_edits (post_id, body, attachments, edited_by)
  values (target.id, target.body, target.attachments, auth.uid());

  update public.chat_posts
     set body = clean,
         attachments = keeping || adding,
         edited_at = clock_timestamp()
   where id = target.id;
end;
$$;

comment on function public.chat_edit_post_photographs_kept(uuid, text, text[], text[]) is
  'Edit one''s own post, keeping some of its photographs and adding others. See 20261119150000.';

revoke all on function public.chat_edit_post_photographs_kept(uuid, text, text[], text[]) from public, anon;
grant execute on function public.chat_edit_post_photographs_kept(uuid, text, text[], text[]) to authenticated;
