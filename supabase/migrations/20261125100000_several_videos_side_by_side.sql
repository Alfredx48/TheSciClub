-- ============================================================================
-- Several YouTube videos show side by side, like photographs
-- ============================================================================
-- The owner, 2026-11-25: a post with two YouTube links showed only the first
-- video. When the first link is a video, link-preview now also sends the next
-- videos in the words, up to three more, as `videos`: [{url, title,
-- imagePath, youtubeId}]. Each picture is the club's own copy, as before.
--
-- link_preview_save checks them as strictly as the first, and a video's
-- picture is readable where its words are, the same rule as 20261018050000.
-- ============================================================================

create or replace function public.link_preview_save(
  p_secret text,
  p_table text,
  p_id uuid,
  p_body text,
  p_preview jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean jsonb;
  more jsonb := null;
  saved boolean := false;
begin
  if not public.link_preview_secret_is(p_secret) then
    raise exception 'Not the link preview trigger.' using errcode = '42501';
  end if;
  -- coalesce(…, true): the picture and the video id may be absent, and a
  -- regex against null is null rather than false.
  if not (
    jsonb_typeof(p_preview) = 'object'
    and coalesce(p_preview ->> 'url' ~* '^https?://\S+$', false)
    and length(p_preview ->> 'url') <= 2000
    and length(coalesce(p_preview ->> 'title', '')) <= 200
    and length(coalesce(p_preview ->> 'description', '')) <= 300
    and length(coalesce(p_preview ->> 'siteName', '')) <= 120
    and coalesce((p_preview ->> 'imagePath') ~ '^[0-9a-f]{64}\.(jpg|png|webp|gif)$', true)
    and coalesce((p_preview ->> 'youtubeId') ~ '^[A-Za-z0-9_-]{11}$', true)
  ) then
    raise exception 'Not a preview.' using errcode = '22023';
  end if;

  -- The other videos: only after a first video, three at most, each checked.
  if p_preview ? 'videos' and jsonb_typeof(p_preview -> 'videos') <> 'null' then
    if not (
      p_preview ->> 'youtubeId' is not null
      and jsonb_typeof(p_preview -> 'videos') = 'array'
      and jsonb_array_length(p_preview -> 'videos') between 1 and 3
      and not exists (
        select 1 from jsonb_array_elements(p_preview -> 'videos') v
         where not (
           jsonb_typeof(v) = 'object'
           and coalesce(v ->> 'url' ~* '^https?://\S+$', false)
           and length(v ->> 'url') <= 2000
           and length(coalesce(v ->> 'title', '')) <= 200
           and coalesce((v ->> 'imagePath') ~ '^[0-9a-f]{64}\.(jpg|png|webp|gif)$', true)
           and coalesce((v ->> 'youtubeId') ~ '^[A-Za-z0-9_-]{11}$', false)
         )
      )
    ) then
      raise exception 'Not a preview.' using errcode = '22023';
    end if;
    -- Only the known keys, as below.
    select jsonb_agg(
             jsonb_build_object(
               'url', v ->> 'url',
               'title', v ->> 'title',
               'imagePath', v ->> 'imagePath',
               'youtubeId', v ->> 'youtubeId'
             ) order by n)
      into more
      from jsonb_array_elements(p_preview -> 'videos') with ordinality as e(v, n);
  end if;

  -- Only the known keys, so nothing else rides along to the reader.
  clean := jsonb_build_object(
    'url', p_preview ->> 'url',
    'title', p_preview ->> 'title',
    'description', p_preview ->> 'description',
    'siteName', p_preview ->> 'siteName',
    'imagePath', p_preview ->> 'imagePath',
    'youtubeId', p_preview ->> 'youtubeId'
  );
  if more is not null then
    clean := clean || jsonb_build_object('videos', more);
  end if;

  if p_table = 'chat_messages' then
    update public.chat_messages m set link_preview = clean
     where m.id = p_id and m.removed_at is null and m.body = p_body;
    saved := found;
  elsif p_table = 'chat_posts' then
    update public.chat_posts p set link_preview = clean
     where p.id = p_id and p.removed_at is null and p.body = p_body;
    saved := found;
  else
    raise exception 'Unknown table: %', p_table using errcode = '22023';
  end if;
  return saved;
end;
$$;

revoke all on function public.link_preview_save(text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.link_preview_save(text, text, uuid, text, jsonb) to service_role;

-- The rows that name a picture among their other videos, found by containment.
create index if not exists chat_messages_link_videos_idx
  on public.chat_messages using gin ((link_preview -> 'videos') jsonb_path_ops)
  where link_preview ? 'videos';
create index if not exists chat_posts_link_videos_idx
  on public.chat_posts using gin ((link_preview -> 'videos') jsonb_path_ops)
  where link_preview ? 'videos';

create or replace function public.link_picture_is_readable(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member()
     and (
       exists (
         select 1 from public.chat_messages m
          where m.link_preview ? 'imagePath'
            and m.link_preview ->> 'imagePath' = object_name
            and public.is_thread_member(m.thread_id)
       )
       or exists (
         select 1 from public.chat_messages m
          where m.link_preview ? 'videos'
            and (m.link_preview -> 'videos') @> jsonb_build_array(jsonb_build_object('imagePath', object_name))
            and public.is_thread_member(m.thread_id)
       )
       or exists (
         select 1
           from public.chat_posts p
           join public.chat_topics t on t.id = p.topic_id
          where p.link_preview ? 'imagePath'
            and p.link_preview ->> 'imagePath' = object_name
            and public.chat_room_is_readable(t.room_id)
       )
       or exists (
         select 1
           from public.chat_posts p
           join public.chat_topics t on t.id = p.topic_id
          where p.link_preview ? 'videos'
            and (p.link_preview -> 'videos') @> jsonb_build_array(jsonb_build_object('imagePath', object_name))
            and public.chat_room_is_readable(t.room_id)
       )
     );
$$;

comment on function public.link_picture_is_readable(text) is
  'True when the caller is an active member and a conversation they are in, or a room they can read, has a message or post whose link preview names this picture, as its own or one of its other videos''. The link-previews bucket''s read policy. See 20261018050000 and 20261125100000.';

revoke all on function public.link_picture_is_readable(text) from public, anon;
grant execute on function public.link_picture_is_readable(text) to authenticated;

comment on column public.chat_messages.link_preview is
  'The first link''s page: {url, title, description, siteName, imagePath, youtubeId}, and when that is a video, up to three more as videos: [{url, title, imagePath, youtubeId}]. Written only by link_preview_save.';
comment on column public.chat_posts.link_preview is
  'The first link''s page: {url, title, description, siteName, imagePath, youtubeId}, and when that is a video, up to three more as videos: [{url, title, imagePath, youtubeId}]. Written only by link_preview_save.';
