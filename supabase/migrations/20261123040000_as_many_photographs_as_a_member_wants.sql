-- As many photographs on a message or a post as a member wants (the owner, 2026-11-22:
-- "Why do we even have the limit. Let people post as many pictures as they want.").
--
-- Four was the most since 20260918200000, held on each row and again by the three functions
-- that add photographs to a post. Fifty now, in all five places: no member posts that many,
-- and a client gone wrong, or a script, cannot hang hundreds on one row. Only a ceiling raised,
-- so the app already installed, which stops at four, keeps working (expand, never narrow).
--
-- Each check keeps its other half, the folder every path must be under (20260918200000).
-- The functions are their latest definitions (20260923000000, 20261120100000) with only the
-- number and its sentence changed.

alter table public.chat_messages drop constraint chat_messages_attachments_check;
alter table public.chat_messages add constraint chat_messages_attachments_check check (
  cardinality(attachments) <= 50
  and public.chat_paths_under(attachments, 'threads/' || thread_id::text || '/')
);

alter table public.chat_posts drop constraint chat_posts_attachments_check;
alter table public.chat_posts add constraint chat_posts_attachments_check check (
  cardinality(attachments) <= 50
  and public.chat_paths_under(attachments, 'rooms/')
);

create or replace function public.chat_add_first_post_photographs(room text, paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_post uuid;
  topic uuid;
begin
  if not public.is_active_member() then
    raise exception 'Only an active member can add photographs.';
  end if;

  select t.id, p.id
    into topic, first_post
  from public.chat_rooms r
  join public.chat_topics t on t.room_id = r.id
  join public.chat_posts p on p.topic_id = t.id
  where r.id = room
    and r.created_by = caller
    and t.author_id = caller
    and p.author_id = caller
  order by t.created_at, p.created_at
  limit 1;

  if first_post is null then
    raise exception 'Only the member who started the room can add photographs to its first post.'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.chat_posts p where p.id = first_post and cardinality(p.attachments) > 0) then
    raise exception 'The first post already has its photographs.';
  end if;

  if exists (select 1 from public.chat_posts p where p.topic_id = topic and p.id <> first_post) then
    raise exception 'Somebody has already replied, so the first post stays as it is.';
  end if;

  if cardinality(paths) < 1 or cardinality(paths) > 50 then
    raise exception 'Up to 50 photographs on one post.' using errcode = '22023';
  end if;

  if not public.chat_paths_under(paths, 'rooms/' || room || '/') then
    raise exception 'Those photographs are not in this room.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from storage.objects o
    where o.bucket_id = 'chat'
      and o.name = any (paths)
      and o.owner_id = caller::text
  ) <> cardinality(paths) then
    raise exception 'Those photographs have not been uploaded.';
  end if;

  update public.chat_posts p set attachments = paths where p.id = first_post;
end;
$$;

create or replace function public.chat_edit_post_photographs(post uuid, new_body text, added text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  clean text := btrim(coalesce(new_body, ''));
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

  if private.chat_post_writer(target.id) is distinct from auth.uid() then
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

  if char_length(clean) > 4000 then
    raise exception 'A post is at most 4,000 characters.' using errcode = '22023';
  end if;
  if cardinality(target.attachments) + cardinality(adding) > 50 then
    raise exception 'Up to 50 photographs on one post.' using errcode = '22023';
  end if;
  if clean = '' and cardinality(target.attachments) + cardinality(adding) = 0 then
    raise exception 'A post needs some words or a photograph.' using errcode = '22023';
  end if;

  if clean = target.body and cardinality(adding) = 0 then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  insert into public.chat_edits (post_id, body, attachments, edited_by)
  values (target.id, target.body, target.attachments,
          case when target.anonymous then null else auth.uid() end);

  update public.chat_posts
     set body = clean,
         attachments = target.attachments || adding,
         edited_at = clock_timestamp()
   where id = target.id;
end;
$$;

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

  if private.chat_post_writer(target.id) is distinct from auth.uid() then
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
  if cardinality(keeping) + cardinality(adding) > 50 then
    raise exception 'Up to 50 photographs on one post.' using errcode = '22023';
  end if;
  if clean = '' and cardinality(keeping) + cardinality(adding) = 0 then
    raise exception 'A post needs some words or a photograph.' using errcode = '22023';
  end if;

  if clean = target.body and keeping = target.attachments and cardinality(adding) = 0 then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  insert into public.chat_edits (post_id, body, attachments, edited_by)
  values (target.id, target.body, target.attachments,
          case when target.anonymous then null else auth.uid() end);

  update public.chat_posts
     set body = clean,
         attachments = keeping || adding,
         edited_at = clock_timestamp()
   where id = target.id;
end;
$$;
