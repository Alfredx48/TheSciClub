-- ============================================================================
-- A member asks, posts or replies anonymously
-- ============================================================================
--
-- The owner, 2026-11-20: "Can we add an option to ask questions and reply
-- anonymously?" Settled with them the same day:
--
--   - other members see "Anonymous"; an administrator can see who wrote it;
--   - in every discussion room except the Classifieds, where a buyer has to
--     know who is selling;
--   - the asker answering under their own anonymous question shows as
--     "Anonymous · Asker", so a thread can tell the asker's follow-ups apart.
--
-- An anonymous topic or post has no author_id at all. That column is what
-- every member reads, the shipped iOS app included; with nothing in it the
-- old app draws "Deleted member" until it is updated, and never the name.
-- The constraints below keep it empty. Who wrote it is kept in two tables in
-- the private schema, which no member can read: only the functions that need
-- the writer read them (your own post to edit or delete, the speed limit,
-- notifications to the writer, blocks), and chat_anonymous_writers() hands a
-- member their own and an administrator everybody's.
--
-- Expand only: three columns with defaults, two tables, new functions, and
-- the functions below rewritten from their latest definitions with the same
-- arguments and the same results.

alter table public.chat_topics
  add column if not exists anonymous boolean not null default false;
alter table public.chat_posts
  add column if not exists anonymous boolean not null default false,
  -- Written by the asker of the anonymous topic it is in, under it; set by
  -- chat_anonymous_post_check, never by the member.
  add column if not exists by_asker boolean not null default false;

alter table public.chat_topics
  add constraint chat_topics_anonymous_has_no_author check (not anonymous or author_id is null);
alter table public.chat_posts
  add constraint chat_posts_anonymous_has_no_author check (not anonymous or author_id is null),
  add constraint chat_posts_by_asker_is_anonymous check (not by_asker or anonymous);

grant select (anonymous), insert (anonymous) on public.chat_topics to authenticated;
grant select (anonymous, by_asker), insert (anonymous) on public.chat_posts to authenticated;

-- Who wrote each anonymous topic and post. Gone with the member, as a named
-- post loses its name: the words stay, still anonymous.
create table if not exists private.chat_anonymous_topics (
  topic_id uuid primary key references public.chat_topics (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade
);
create index if not exists chat_anonymous_topics_member on private.chat_anonymous_topics (member_id);

create table if not exists private.chat_anonymous_posts (
  post_id uuid primary key references public.chat_posts (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade
);
create index if not exists chat_anonymous_posts_member on private.chat_anonymous_posts (member_id);

alter table private.chat_anonymous_topics enable row level security;
alter table private.chat_anonymous_posts enable row level security;
revoke all on private.chat_anonymous_topics, private.chat_anonymous_posts from public, anon, authenticated;

comment on table private.chat_anonymous_topics is
  'Who started each anonymous topic. Read only by functions; see 20261120100000.';
comment on table private.chat_anonymous_posts is
  'Who wrote each anonymous post. Read only by functions; see 20261120100000.';

-- ---------------------------------------------------------------- helpers

-- Whoever wrote the post: its author, or the anonymous writer. Null for a
-- member who has left.
create or replace function private.chat_post_writer(post uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.author_id, a.member_id)
    from public.chat_posts p
    left join private.chat_anonymous_posts a on a.post_id = p.id
   where p.id = post;
$$;

-- Whoever started the topic, as above.
create or replace function private.chat_topic_starter(topic uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(t.author_id, a.member_id)
    from public.chat_topics t
    left join private.chat_anonymous_topics a on a.topic_id = t.id
   where t.id = topic;
$$;

-- The name a notification gives the writer of a post.
create or replace function private.chat_byline(anonymous boolean, by_asker boolean, name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when anonymous and by_asker then 'Anonymous · Asker'
              when anonymous then 'Anonymous'
              else name end;
$$;

-- What a block hides from the reader, both ways, as my_hidden_member_ids:
-- the anonymous topics and posts of the members it hides. Read once per
-- query by the policies and functions below.
create or replace function private.my_hidden_anonymous_topic_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(a.topic_id), '{}'::uuid[])
    from private.chat_anonymous_topics a
   where a.member_id = any (private.my_hidden_member_ids());
$$;

create or replace function private.my_hidden_anonymous_post_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(a.post_id), '{}'::uuid[])
    from private.chat_anonymous_posts a
   where a.member_id = any (private.my_hidden_member_ids());
$$;

revoke all on function private.chat_post_writer(uuid) from public, anon, authenticated;
revoke all on function private.chat_topic_starter(uuid) from public, anon, authenticated;
revoke all on function private.chat_byline(boolean, boolean, text) from public, anon, authenticated;
revoke all on function private.my_hidden_anonymous_topic_ids() from public, anon;
revoke all on function private.my_hidden_anonymous_post_ids() from public, anon;
-- The read policies call these as the member.
grant execute on function private.my_hidden_anonymous_topic_ids() to authenticated;
grant execute on function private.my_hidden_anonymous_post_ids() to authenticated;

-- ---------------------------------------------------------------- writing

-- An anonymous topic or post is a member's, outside the Classifieds; the
-- writer is recorded after the row is in (the private tables point at it).
create or replace function private.chat_anonymous_topic_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.anonymous then
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'Only a member can post anonymously.' using errcode = '42501';
  end if;
  if exists (select 1 from public.chat_rooms r where r.id = new.room_id and r.category = 'Classifieds') then
    raise exception 'A post in the Marketplace carries your name, so people can reach you.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.chat_anonymous_post_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.anonymous then
    new.by_asker := false;
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'Only a member can post anonymously.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.chat_topics t
      join public.chat_rooms r on r.id = t.room_id
     where t.id = new.topic_id and r.category = 'Classifieds'
  ) then
    raise exception 'A post in the Marketplace carries your name, so people can reach you.'
      using errcode = '22023';
  end if;
  -- The asker following up under their own anonymous question: not its
  -- opening post, which is the question.
  new.by_asker := exists (
      select 1 from private.chat_anonymous_topics a
       where a.topic_id = new.topic_id and a.member_id = auth.uid()
    )
    and exists (select 1 from public.chat_posts p where p.topic_id = new.topic_id);
  return new;
end;
$$;

create or replace function private.chat_anonymous_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'chat_topics' then
    insert into private.chat_anonymous_topics (topic_id, member_id) values (new.id, auth.uid());
  else
    insert into private.chat_anonymous_posts (post_id, member_id) values (new.id, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function private.chat_anonymous_topic_check() from public, anon, authenticated;
revoke all on function private.chat_anonymous_post_check() from public, anon, authenticated;
revoke all on function private.chat_anonymous_record() from public, anon, authenticated;

drop trigger if exists chat_topics_anonymous on public.chat_topics;
create trigger chat_topics_anonymous
  before insert on public.chat_topics
  for each row execute function private.chat_anonymous_topic_check();

drop trigger if exists chat_posts_anonymous on public.chat_posts;
create trigger chat_posts_anonymous
  before insert on public.chat_posts
  for each row execute function private.chat_anonymous_post_check();

-- "anonymous_writer" sorts before every other after-insert trigger on these
-- tables, so the mention and notification triggers find the writer.
drop trigger if exists chat_topics_anonymous_writer on public.chat_topics;
create trigger chat_topics_anonymous_writer
  after insert on public.chat_topics
  for each row when (new.anonymous) execute function private.chat_anonymous_record();

drop trigger if exists chat_posts_anonymous_writer on public.chat_posts;
create trigger chat_posts_anonymous_writer
  after insert on public.chat_posts
  for each row when (new.anonymous) execute function private.chat_anonymous_record();

-- ============================================================================
-- The speed limit counts a member's anonymous posts as theirs.
-- As 20261113020000; the writer of an anonymous post is the caller.
-- ============================================================================

create or replace function public.chat_speed_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
  recent integer;
  cap integer;
  what text;
begin
  if auth.uid() is null then
    return new;
  end if;
  who := new.author_id;
  -- Nested, as below: a message has no anonymous field.
  if tg_table_name = 'chat_posts' then
    if new.anonymous then
      who := auth.uid();
    end if;
  end if;
  if who is distinct from auth.uid() then
    return new;
  end if;
  -- Nested, not "and": a post has no notice field, and plpgsql may read both sides.
  if tg_table_name = 'chat_messages' then
    if new.notice is not null then
      return new;
    end if;
  end if;
  -- One at a time per member and table: the count below then sees the rows
  -- of any insert that got here first.
  perform pg_advisory_xact_lock(hashtext('chat_speed_limit ' || tg_table_name), hashtext(who::text));
  if tg_table_name = 'chat_messages' then
    cap := 30;
    what := 'messages';
    select count(*) into recent from public.chat_messages m
     where m.author_id = who and m.created_at > now() - interval '1 minute'
       and m.notice is null;
  else
    cap := 20;
    what := 'posts';
    select (select count(*) from public.chat_posts p
             where p.author_id = who and p.created_at > now() - interval '1 minute')
         + (select count(*) from private.chat_anonymous_posts a
              join public.chat_posts p on p.id = a.post_id
             where a.member_id = who and p.created_at > now() - interval '1 minute')
      into recent;
  end if;
  if recent >= cap then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'P0001',
        'message', 'That is a lot of ' || what || ' in one minute. Wait a minute, then send it again.',
        'details', null, 'hint', null)::text,
      detail = json_build_object('status', 429, 'headers', json_build_object('Retry-After', '60'))::text;
  end if;
  return new;
end;
$$;

-- As 20261018020000: an anonymous post's photographs are its writer's.

create or replace function public.chat_check_post_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  added text[];
  room text;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Only what this write adds: a removal empties the list, and the first
  -- post's photographs are checked by the function that adds them as well.
  added := array(
    select unnest(new.attachments)
    except
    select unnest(case when tg_op = 'UPDATE' then old.attachments else '{}'::text[] end)
  );
  if cardinality(added) = 0 then
    return new;
  end if;

  select t.room_id into room from public.chat_topics t where t.id = new.topic_id;
  if room is null or not public.chat_paths_under(added, 'rooms/' || room || '/') then
    raise exception 'Those photographs are not in this room.' using errcode = '22023';
  end if;

  if (
    select count(*)
      from storage.objects o
     where o.bucket_id = 'chat'
       and o.name = any (added)
       and o.owner_id = coalesce(new.author_id, private.chat_post_writer(new.id),
                                case when new.anonymous then auth.uid() end)::text
  ) <> cardinality(added) then
    raise exception 'Those photographs have not been uploaded.' using errcode = '22023';
  end if;

  return new;
end;
$$;

-- As 20261104203000: an anonymous post names people too, checked against its
-- writer's blocks; the mention says "Anonymous" (push_owed_every).

CREATE OR REPLACE FUNCTION public.chat_post_mention_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who uuid := coalesce(new.author_id, private.chat_post_writer(new.id));
  run_at timestamptz := clock_timestamp();
  names text[];
  recorded integer;
begin
  if new.removed_at is not null or who is null
     or (tg_op = 'UPDATE' and new.body is not distinct from old.body) then
    return null;
  end if;
  names := private.mentioned_usernames(new.body);
  if cardinality(names) = 0 then
    return null;
  end if;

  insert into public.chat_post_mentions (post_id, member_id, created_at)
  select new.id, r.id, run_at
    from public.members r
    join public.chat_topics tp on tp.id = new.topic_id
    join public.chat_rooms rm on rm.id = tp.room_id
   where r.username = any (names::extensions.citext[])
     and r.status = 'active'
     and r.id <> who
     and (rm.opened_at is not null or r.is_admin)
     and not exists (
       select 1 from public.member_blocks b
        where (b.blocker_id = r.id and b.blocked_id in (who, private.chat_topic_starter(tp.id)))
           or (b.blocker_id = who and b.blocked_id = r.id)
           or (b.blocker_id = private.chat_topic_starter(tp.id) and b.blocked_id = r.id and not r.is_admin)
     )
  on conflict do nothing;
  get diagnostics recorded = row_count;

  if recorded > 0 then
    perform public.push_notify_send('mention', jsonb_build_object('id', new.id, 'at', run_at));
  end if;
  return null;
exception when others then
  raise warning 'chat_post_mention_notify: %', sqlerrm;
  return null;
end;
$function$;

-- ============================================================================
-- Your own anonymous post is still yours to edit, delete and not report. Its
-- earlier versions, which members can read, do not say who edited them.
-- ============================================================================

create or replace function public.chat_edit_post(post uuid, new_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  clean text := btrim(coalesce(new_body, ''));
begin
  -- Definer, so RLS is off in here and nothing above has checked anything.
  if not public.is_active_member() then
    raise exception 'Only an active member can edit a post.' using errcode = '42501';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  -- Read gate first, in the same sentence as "not there": a post in a room
  -- the caller cannot read is, to them, not there.
  if not exists (
    select 1 from public.chat_topics t
    where t.id = target.topic_id and public.chat_room_is_readable(t.room_id)
  ) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  -- The author, and nobody else — an administrator included. See the header.
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

  -- The row's own check, said before the write.
  if char_length(clean) > 4000 then
    raise exception 'A post is at most 4,000 characters.' using errcode = '22023';
  end if;
  if clean = '' and cardinality(target.attachments) = 0 then
    raise exception 'A post needs some words or a photograph.' using errcode = '22023';
  end if;

  -- So that "Edited" is never a lie.
  if clean = target.body then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  insert into public.chat_edits (post_id, body, attachments, edited_by)
  values (target.id, target.body, target.attachments,
          case when target.anonymous then null else auth.uid() end);

  update public.chat_posts
     set body = clean,
         edited_at = clock_timestamp()
   where id = target.id;
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
  if cardinality(target.attachments) + cardinality(adding) > 4 then
    raise exception 'Up to 4 photographs on one post.' using errcode = '22023';
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
  values (target.id, target.body, target.attachments,
          case when target.anonymous then null else auth.uid() end);

  update public.chat_posts
     set body = clean,
         attachments = keeping || adding,
         edited_at = clock_timestamp()
   where id = target.id;
end;
$$;

create or replace function public.chat_edit_topic_title(topic uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.chat_topics;
  opening public.chat_posts;
  clean text := btrim(coalesce(new_title, ''));
begin
  if not public.is_active_member() then
    raise exception 'Only an active member can edit a topic.' using errcode = '42501';
  end if;
  select * into t from public.chat_topics x where x.id = topic for update;
  if not found or not public.chat_room_is_readable(t.room_id) then
    raise exception 'There is no such topic.' using errcode = 'P0002';
  end if;
  if private.chat_topic_starter(t.id) is distinct from auth.uid() then
    raise exception 'You can only edit your own topic.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chat_rooms r where r.id = t.room_id and r.opened_at is not null) then
    raise exception 'This room is closed.' using errcode = '42501';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 140 then
    raise exception 'A title is 1 to 140 characters.' using errcode = '22023';
  end if;
  if clean = btrim(t.title) then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  select * into opening from public.chat_posts p
   where p.topic_id = t.id
   order by p.created_at, p.id
   limit 1;
  if not found or opening.removed_at is not null
     or cardinality(opening.attachments) > 0 or btrim(opening.body) <> btrim(t.title) then
    raise exception 'This topic''s words are edited on its post.' using errcode = '22023';
  end if;

  -- The post repeats the title; editing it keeps the old words in chat_edits
  -- and answers to chat_post_keeps_answered_words like any edit.
  insert into public.chat_edits (post_id, body, attachments, edited_by)
  values (opening.id, opening.body, opening.attachments,
          case when opening.anonymous then null else auth.uid() end);
  update public.chat_posts set body = clean, edited_at = clock_timestamp() where id = opening.id;
  update public.chat_topics set title = clean where id = t.id;
end;
$$;

create or replace function public.chat_delete_my_topic(topic uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  files text[];
begin
  if not public.is_active_member() then
    raise exception 'Only an active member can delete a topic.' using errcode = '42501';
  end if;
  perform 1 from public.chat_topics t
   where t.id = topic and private.chat_topic_starter(t.id) = auth.uid() and public.chat_room_is_readable(t.room_id)
     for update;
  if not found then
    raise exception 'Only whoever started a topic can delete it.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.chat_posts p
     where p.topic_id = topic and p.removed_at is null and coalesce(p.author_id, private.chat_post_writer(p.id)) is distinct from auth.uid()
  ) then
    raise exception 'Somebody has answered, so the topic stays for them. You can add to your post.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct f.path), '{}') into files
    from (
      select unnest(private.chat_files_of(coalesce(p.author_id, private.chat_post_writer(p.id)), p.attachments)) as path
        from public.chat_posts p where p.topic_id = topic
      union
      select unnest(private.chat_files_of(coalesce(p.author_id, private.chat_post_writer(p.id)), b.attachments))
        from public.chat_removed_bodies b
        join public.chat_posts p on p.id = b.post_id
       where p.topic_id = topic
    ) f;

  delete from public.chat_topics t where t.id = topic;
  return files;
end;
$$;

create or replace function public.chat_remove_post(post uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
begin
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

  if private.chat_post_writer(target.id) is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the person who wrote a post, or an administrator, can remove it.'
      using errcode = '42501';
  end if;

  if target.removed_at is not null then
    return '{}';
  end if;

  insert into public.chat_removed_bodies (post_id, body, attachments, removed_by)
  values (target.id, target.body, target.attachments, auth.uid())
  on conflict (post_id) do nothing;

  update public.chat_posts
     set body = '',
         attachments = '{}',
         removed_at = now(),
         removed_by_admin = (private.chat_post_writer(target.id) is distinct from auth.uid())
   where id = target.id;

  -- Its replies stand, as posts of their own. Nothing says "reply to a
  -- removed post".
  update public.chat_posts
     set reply_to = null
   where reply_to = target.id;

  update public.chat_topics t
     set reply_count = public.chat_topic_reply_count(target.topic_id)
   where t.id = target.topic_id;

  -- Only the author's own uploads: the row was written by the author and may
  -- name anybody's file (before chat_posts_check_attachments).
  return private.chat_files_of(private.chat_post_writer(target.id), target.attachments);
end;
$$;

create or replace function public.chat_report_post(post uuid, report_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  topic public.chat_topics;
  room public.chat_rooms;
begin
  -- Definer, so RLS is off in here and nothing above has checked anything. The
  -- Phase 2 lesson: every gate this function relies on, it states itself.
  --
  -- is_member() and not is_active_member(): somebody who has been paused should
  -- still be able to say what was done to them. Being unable to write in a room
  -- is not the same as being unable to report what somebody wrote in one.
  if not public.is_member() then
    raise exception 'Only a member can report something.' using errcode = '42501';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  select * into topic from public.chat_topics t where t.id = target.topic_id;
  select * into room from public.chat_rooms r where r.id = topic.room_id;

  -- The caller has to be able to read it. Without this, anybody holding a post
  -- id could push a closed room's contents onto the administrators' screen.
  if not public.chat_room_is_readable(topic.room_id) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;

  if private.chat_post_writer(target.id) = auth.uid() then
    raise exception 'You cannot report your own post. Remove it instead.'
      using errcode = '42501';
  end if;

  -- A blank body is nothing to report, and a report whose snapshot is '' tells
  -- an administrator nothing. Whoever removed it has already acted.
  if target.removed_at is not null then
    raise exception 'That post has already been removed.' using errcode = '42501';
  end if;

  insert into public.chat_reports
    (kind, context_kind, post_id, reporter_id, reported_author_id,
     body_snapshot, attachments, written_at, place, topic_id, room_id, note)
  values
    ('post', 'room', target.id, auth.uid(), private.chat_post_writer(target.id),
     target.body, target.attachments, target.created_at,
     room.name || ' › ' || topic.title, topic.id, room.id,
     nullif(btrim(coalesce(report_note, '')), ''))
  -- Reporting twice is one row and no error. A member who taps it again
  -- because nothing visibly happened has not done anything wrong.
  on conflict (reporter_id, post_id) do nothing;
end;
$$;

create or replace function private.chat_post_is_answered(p public.chat_posts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_posts r
     where r.topic_id = p.topic_id
       and r.id <> p.id
       and r.removed_at is null
       and coalesce(r.author_id, private.chat_post_writer(r.id)) is distinct from coalesce(p.author_id, private.chat_post_writer(p.id))
       and (
         r.reply_to = p.id
         -- The opening post: the earliest in its topic.
         or not exists (
           select 1 from public.chat_posts e
            where e.topic_id = p.topic_id
              and (e.created_at, e.id) < (p.created_at, p.id)
         )
       )
  );
$$;

-- ============================================================================
-- Notifications reach an anonymous writer like any other (a reply to their
-- question, a like), never name them (the actor stays empty, and the bell and
-- the push say "Anonymous"), and still stop at a block.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notifications_record(p_event text, p_key jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  key_id uuid;
  owed boolean;
begin
  if p_event in ('message', 'post', 'report', 'member_joined', 'grant_open') then
    key_id := (p_key ->> 'id')::uuid;
  end if;

  -- A message on its own: planning the whole list below cost more than the
  -- write. Same rows, same bell. pushed_at/pushed_message say who gets a push:
  -- not someone whose read position moved in the last 30 s (in the
  -- conversation now), and at most one per 2 minutes while it stays unread.
  -- Reading makes a new row, so the next message pushes again.
  if p_event = 'message' then
    with up as (
      insert into public.notifications as n (
        member_id, kind, tag, actor_id, thread_id, message_id, pushed_at, pushed_message
      )
      select tm.member_id, t.kind, 'thread:' || t.id::text, m.author_id, t.id, m.id,
             w.at, case when w.at is not null then m.id end
        from public.chat_messages m
        join public.chat_threads t on t.id = m.thread_id
        join public.chat_thread_members tm
          on tm.thread_id = t.id and tm.member_id is distinct from m.author_id
        join public.members r on r.id = tm.member_id and r.status = 'active'
        cross join lateral (
          select case when tm.last_read_at > clock_timestamp() - interval '30 seconds'
                      then null
                      -- Only mentions (20261113150000): a push only when it names them.
                      when exists (
                        select 1 from public.chat_thread_mention_only q
                         where q.thread_id = t.id and q.member_id = tm.member_id
                      ) and not private.message_names(m.body, tm.member_id)
                      then null
                      else clock_timestamp() end as at
        ) w
       where m.id = key_id and m.removed_at is null
         and not exists (
           select 1 from public.chat_thread_mutes x where x.thread_id = t.id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id = m.author_id)
               or (b.blocker_id = m.author_id and b.blocked_id = r.id and not r.is_admin)
         )
      on conflict (member_id, tag) where read_at is null
      do update set
        created_at = clock_timestamp(),
        count = n.count + 1,
        actor_id = excluded.actor_id,
        message_id = excluded.message_id,
        post_id = excluded.post_id,
        detail = excluded.detail,
        grant_id = excluded.grant_id,
        seen_at = null,
        pushed_at = case
          when excluded.pushed_at is not null
           and (n.pushed_at is null or n.pushed_at <= excluded.pushed_at - interval '2 minutes')
          then excluded.pushed_at else n.pushed_at end,
        pushed_message = case
          when excluded.pushed_at is not null
           and (n.pushed_at is null or n.pushed_at <= excluded.pushed_at - interval '2 minutes')
          then excluded.pushed_message else n.pushed_message end
      returning n.member_id, n.pushed_message
    )
    select exists (
      select 1 from up join public.push_subscriptions s on s.member_id = up.member_id
       where up.pushed_message = key_id
    ) into owed;
    -- push_notify_send skips the request when nobody is owed one.
    perform set_config('sciclub.message_push', case when owed then 'yes' else 'no' end, true);
    return;
  end if;

  insert into public.notifications as n (
    member_id, kind, tag, actor_id, thread_id, message_id, topic_id, post_id,
    event_id, organization_id, report_id, joined_id, detail, grant_id
  )
  select owed.member_id, owed.kind, owed.tag, owed.actor_id, owed.thread_id,
         owed.message_id, owed.topic_id, owed.post_id, owed.event_id,
         owed.organization_id, owed.report_id, owed.joined_id, owed.detail, owed.grant_id
    from (
      -- A reply: the topic's starter, and everybody else who has posted in it.
      -- First now, so it names the columns (a message is recorded above).
      select owed.member_id, owed.kind, 'topic:' || p.topic_id::text as tag, p.shown_id as actor_id,
             null::uuid as thread_id, null::uuid as message_id, p.topic_id, p.id as post_id,
             null::uuid as event_id, null::uuid as organization_id, null::uuid as report_id,
             null::uuid as joined_id, null::text as detail, null::uuid as grant_id
        from (
          select p.id, coalesce(p.author_id, private.chat_post_writer(p.id)) as author_id, p.author_id as shown_id,
                 p.topic_id, coalesce(tp.author_id, private.chat_topic_starter(tp.id)) as starter_id, tp.room_id, rm.opened_at
            from public.chat_posts p
            join public.chat_topics tp on tp.id = p.topic_id
            join public.chat_rooms rm on rm.id = tp.room_id
           where p_event = 'post' and p.id = key_id and p.removed_at is null
        ) p
        join lateral (
          select p.starter_id as member_id, 'reply'::text as kind
           where p.starter_id is not null and p.starter_id is distinct from p.author_id
          union
          select distinct o.author_id, 'reply_participant'::text
            from (select coalesce(q.author_id, private.chat_post_writer(q.id)) as author_id, q.topic_id, q.removed_at
                  from public.chat_posts q) o
           where o.topic_id = p.topic_id and o.removed_at is null
             and o.author_id is not null
             and o.author_id is distinct from p.author_id
             and o.author_id is distinct from p.starter_id
        ) owed on true
        join public.members r on r.id = owed.member_id and r.status = 'active'
       where (p.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.chat_topic_mutes x where x.topic_id = p.topic_id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes x where x.room_id = p.room_id and x.member_id = r.id
         )
         -- Named in it: told by the mention instead.
         and not exists (
           select 1 from public.chat_post_mentions x where x.post_id = p.id and x.member_id = r.id
         )

      union all
      -- A like: the author of the post.
      select p.author_id, 'like', 'like:' || p.id::text, lk.member_id,
             null, null, tp.id, p.id, null, null, null, null, null, null
        from public.chat_post_likes lk
        join (select q.id, q.topic_id, coalesce(q.author_id, private.chat_post_writer(q.id)) as author_id from public.chat_posts q
               where q.removed_at is null) p on p.id = lk.post_id
        join public.chat_topics tp on tp.id = p.topic_id
        join public.chat_rooms rm on rm.id = tp.room_id
        join public.members r on r.id = p.author_id and r.status = 'active'
       where p_event = 'like'
         and lk.post_id = (p_key ->> 'post_id')::uuid
         and lk.member_id = (p_key ->> 'member_id')::uuid
         and p.author_id is distinct from lk.member_id
         and (rm.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.chat_topic_mutes x where x.topic_id = tp.id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes x where x.room_id = tp.room_id and x.member_id = r.id
         )

      union all
      -- A reaction to a message: its author, still in the conversation.
      select m.author_id, 'reaction', 'reaction:' || m.id::text, x.member_id,
             t.id, m.id, null, null, null, null, null, null, 'message:' || x.emoji, null
        from public.chat_message_reactions x
        join public.chat_messages m
          on m.id = x.target_id and m.removed_at is null and m.notice is null
        join public.chat_threads t on t.id = m.thread_id
        join public.chat_thread_members tm on tm.thread_id = t.id and tm.member_id = m.author_id
        join public.members r on r.id = m.author_id and r.status = 'active'
       where p_event = 'reaction' and p_key ->> 'target' = 'message'
         and x.target_id = (p_key ->> 'id')::uuid
         and x.member_id = (p_key ->> 'member_id')::uuid
         and x.emoji is not null
         and m.author_id is distinct from x.member_id
         and not exists (
           select 1 from public.member_blocks b
            where b.blocker_id = x.member_id and b.blocked_id = r.id
         )
         and not exists (
           select 1 from public.chat_thread_mutes q where q.thread_id = t.id and q.member_id = r.id
         )

      union all
      -- A reaction to a post: its author, as a like.
      select p.author_id, 'reaction', 'reaction:' || p.id::text, x.member_id,
             null, null, tp.id, p.id, null, null, null, null, 'post:' || x.emoji, null
        from public.chat_post_reactions x
        join (select q.id, q.topic_id, coalesce(q.author_id, private.chat_post_writer(q.id)) as author_id from public.chat_posts q
               where q.removed_at is null) p on p.id = x.target_id
        join public.chat_topics tp on tp.id = p.topic_id
        join public.chat_rooms rm on rm.id = tp.room_id
        join public.members r on r.id = p.author_id and r.status = 'active'
       where p_event = 'reaction' and p_key ->> 'target' = 'post'
         and x.target_id = (p_key ->> 'id')::uuid
         and x.member_id = (p_key ->> 'member_id')::uuid
         and x.emoji is not null
         and p.author_id is distinct from x.member_id
         and (rm.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.member_blocks b
            where b.blocker_id = x.member_id and b.blocked_id = r.id
         )
         and not exists (
           select 1 from public.chat_topic_mutes q where q.topic_id = tp.id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes q where q.room_id = tp.room_id and q.member_id = r.id
         )

      union all
      -- A mention: each member the post named for the first time, as
      -- chat_post_mention_notify checked them.
      select r.id, 'mention', 'mention:' || p.id::text, p.author_id,
             null, null, tp.id, p.id, null, null, null, null, null, null
        from public.chat_post_mentions x
        join public.chat_posts p on p.id = x.post_id and p.removed_at is null
        join public.chat_topics tp on tp.id = p.topic_id
        join public.members r on r.id = x.member_id and r.status = 'active'
       where p_event = 'mention'
         and x.post_id = (p_key ->> 'id')::uuid
         and x.created_at = (p_key ->> 'at')::timestamptz
         and not exists (
           select 1 from public.chat_topic_mutes q where q.topic_id = tp.id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes q where q.room_id = tp.room_id and q.member_id = r.id
         )

      union all
      -- Added to a group by somebody else.
      select tm.member_id, 'group_add', 'group_add:' || t.id::text, (p_key ->> 'by')::uuid,
             t.id, null, null, null, null, null, null, null, null, null
        from public.chat_threads t
        join public.chat_thread_members tm
          on tm.thread_id = t.id and tm.member_id = (p_key ->> 'member_id')::uuid
        join public.members r on r.id = tm.member_id and r.status = 'active'
       where p_event = 'group_add'
         and t.id = (p_key ->> 'thread_id')::uuid
         and t.kind = 'group' and t.event_id is null
         and (p_key ->> 'by') is not null
         and (p_key ->> 'by')::uuid <> tm.member_id

      union all
      -- A report: administrators other than the reporter.
      select r.id, 'report', 'report:' || rep.id::text, null,
             null, null, null, null, null, null, rep.id, null, null, null
        from public.chat_reports rep
        join public.members r
          on r.is_admin and r.status = 'active' and r.id is distinct from rep.reporter_id
       where p_event = 'report' and rep.id = key_id and rep.kind <> 'block'

      union all
      -- Somebody joined on an invite: whoever vouched for them. From an
      -- administrator's QR code, detail says so: 'qr:' and the event, if any.
      select r.id, 'invite_joined', 'joined:' || joined.id::text, joined.id,
             null, null, null, null, null, null, null, joined.id,
             case when i.qr_code_id is not null then 'qr:' || coalesce(q.event_name, '') end, null
        from public.members joined
        join public.invites i on i.id = joined.invite_id
        left join public.qr_codes q on q.id = i.qr_code_id
        join public.members r
          on r.id = i.invited_by_member_id and r.status = 'active' and r.id <> joined.id
       where p_event = 'member_joined' and joined.id = key_id

      union all
      -- Tomorrow's events, to everybody going.
      select r.id, 'event_reminder', 'event:' || e.id::text, null,
             null, null, null, null, e.id, null, null, null,
             lower(to_char(e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'), 'FMHH12:MIam')),
             null
        from public.events e
        left join public.data_feeds f on f.id = e.feed_id
        join public.event_rsvps rv on rv.event_id = e.id and rv.status = 'going'
        join public.members r on r.id = rv.member_id and r.status = 'active'
       where p_event = 'daily'
         -- A timed event's is 24 hours before (push_event_reminders).
         and e.all_day
         and (e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'))::date
             = (now() at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'))::date + 1

      union all
      -- New events from an organization a member follows, counted.
      select r.id, 'org_events', 'org:' || o.id::text, null,
             null, null, null, null, null, o.id, null, null, count(*)::text, null
        from public.organization_follows fo
        join public.organizations o on o.id = fo.organization_id
        join public.events e
          on e.organization_id = o.id
         and e.created_at > now() - interval '24 hours'
         and e.start_time > now()
        join public.members r on r.id = fo.member_id and r.status = 'active'
       where p_event = 'daily'
       group by r.id, o.id

      union all
      -- A grant's applications opening: everybody following its organization.
      -- detail is the day this cycle closes.
      select r.id, 'grant_open', 'grant:' || g.id::text, null,
             null, null, null, null, null, g.organization_id, null, null,
             to_char(c.cycle_closes, 'YYYY-MM-DD'), g.id
        from public.organization_grant_windows gw
        join public.organization_grants g on g.id = gw.grant_id
        join public.organizations o on o.id = g.organization_id and o.removed_at is null
        cross join lateral public.grant_window_cycle(
          gw.opens_on, gw.closes_on, gw.yearly, (now() at time zone 'America/Los_Angeles')::date
        ) c
        join public.organization_follows fo on fo.organization_id = g.organization_id
        join public.members r on r.id = fo.member_id and r.status = 'active'
       where p_event = 'grant_open' and gw.id = key_id

      union all
      -- A reminder to finish Your details or the profile (20261022040000):
      -- whoever profile_reminders_notify picked today. detail is the step.
      select pr.member_id, 'profile_reminder', 'profile:' || pr.step, null,
             null, null, null, null, null, null, null, null, pr.step, null
        from public.profile_reminders pr
        join public.members r on r.id = pr.member_id and r.status = 'active'
       where p_event = 'profile_reminder' and pr.sent_on = (p_key ->> 'day')::date
    ) owed
   -- Nothing across a block, either way, from the member or their topic
   -- (20261022080000, both ways since 20261104203000).
   where not exists (
     select 1 from public.member_blocks b
      where (b.blocker_id = owed.member_id or (b.blocked_id = owed.member_id and not exists (
               select 1 from public.members a where a.id = owed.member_id and a.is_admin)))
        and (case when b.blocker_id = owed.member_id then b.blocked_id else b.blocker_id end) in (
          owed.actor_id,
          private.chat_post_writer(owed.post_id),
          private.chat_topic_starter(owed.topic_id)
        )
   )
  on conflict (member_id, tag) where read_at is null
  do update set
    created_at = clock_timestamp(),
    count = n.count + 1,
    actor_id = excluded.actor_id,
    message_id = excluded.message_id,
    post_id = excluded.post_id,
    detail = excluded.detail,
    grant_id = excluded.grant_id,
    seen_at = null;
end;
$function$;

create or replace function private.push_owed_every(p_secret text, p_event text, p_key jsonb)
 RETURNS TABLE(endpoint text, p256dh text, auth text, kind text, actor_name text, body text, photo_count integer, subject text, detail text, url text, tag text, badge integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  key_id uuid;
begin
  if p_secret is null or p_secret is distinct from (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_notify_secret'
  ) then
    raise exception 'Not the notification trigger.' using errcode = '42501';
  end if;

  if p_event in ('message', 'post', 'report', 'member_joined', 'grant_open', 'invite_request') then
    key_id := (p_key ->> 'id')::uuid;
  end if;

  if p_event = 'message' then
    -- Opens on the message itself (?message=), which the conversation
    -- scrolls to: a later look at the notification should not land on
    -- whatever was said since. Only those notifications_record marked for
    -- this message (20261105160000); detail is how many are unread, if more
    -- than one.
    return query
      select s.endpoint, s.p256dh, s.auth,
             t.kind, a.display_name, m.body, cardinality(m.attachments),
             -- A group's name, or its event's title (as the bell's place).
             case when t.kind = 'group' then
               coalesce(t.name, (select e.title from public.events e where e.id = t.event_id))
             end,
             case when n.count > 1 then n.count::text end,
             '/chat/t/' || t.id::text || '?message=' || m.id::text, 'thread:' || t.id::text,
             public.notification_badge(r.id)
        from public.chat_messages m
        join public.chat_threads t on t.id = m.thread_id
        join public.chat_thread_members tm
          on tm.thread_id = t.id and tm.member_id is distinct from m.author_id
        join public.members r on r.id = tm.member_id and r.status = 'active'
        join public.notifications n
          on n.member_id = r.id and n.tag = 'thread:' || t.id::text
         and n.read_at is null and n.pushed_message = m.id
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = m.author_id
       where m.id = key_id
         and m.removed_at is null
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id = m.author_id)
               or (b.blocker_id = m.author_id and b.blocked_id = r.id and not r.is_admin)
         )
         and not exists (
           select 1 from public.chat_thread_mutes x where x.thread_id = t.id and x.member_id = r.id
         );

  elsif p_event = 'post' then
    -- The starter ('reply'), and everybody else who has posted in the topic
    -- ('reply_participant'). Since 20261003000000 with the reply's words and
    -- its photograph count, as a message has; still no room and no topic.
    return query
      with p as (
        select p.id, coalesce(p.author_id, private.chat_post_writer(p.id)) as author_id, p.anonymous, p.by_asker, p.body, p.attachments,
               tp.id as topic_id, coalesce(tp.author_id, private.chat_topic_starter(tp.id)) as starter_id,
               tp.room_id, rm.opened_at
          from public.chat_posts p
          join public.chat_topics tp on tp.id = p.topic_id
          join public.chat_rooms rm on rm.id = tp.room_id
         where p.id = key_id and p.removed_at is null
      ),
      owed as (
        select p.starter_id as member_id, 'reply'::text as kind from p
         where p.starter_id is not null and p.starter_id is distinct from p.author_id
        union
        select distinct o.author_id, 'reply_participant'::text
          from p
          join (select coalesce(q.author_id, private.chat_post_writer(q.id)) as author_id, q.topic_id, q.removed_at
                  from public.chat_posts q) o on o.topic_id = p.topic_id and o.removed_at is null
         where o.author_id is not null
           and o.author_id is distinct from p.author_id
           and o.author_id is distinct from p.starter_id
      )
      select s.endpoint, s.p256dh, s.auth,
             owed.kind, private.chat_byline(p.anonymous, p.by_asker, a.display_name), p.body, coalesce(cardinality(p.attachments), 0),
             null::text, null::text,
             '/chat/rooms/' || p.room_id || '/topics/' || p.topic_id::text || '?post=' || p.id::text,
             'topic:' || p.topic_id::text,
             public.notification_badge(r.id)
        from p
        join owed on true
        join public.members r on r.id = owed.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = p.author_id
       where (p.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id in (p.author_id, p.starter_id))
               or (b.blocker_id in (p.author_id, p.starter_id) and b.blocked_id = r.id and not r.is_admin)
         )
         and not exists (
           select 1 from public.chat_topic_mutes x where x.topic_id = p.topic_id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes x where x.room_id = p.room_id and x.member_id = r.id
         )
         -- Named in it: the mention says so instead, unless its push is off.
         and not exists (
           select 1 from public.chat_post_mentions x
            where x.post_id = p.id and x.member_id = r.id
              and not exists (
                select 1 from public.push_muted_kinds q where q.member_id = r.id and q.kind = 'mention'
              )
         )
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = owed.kind
         );

  elsif p_event = 'like' then
    -- The author of the liked post, once, with the start of their own post.
    -- Not the liker (the policy refuses liking your own, and this says so
    -- too), not somebody paused, not a post taken back or a like already
    -- undone by the time this runs, not a closed room to a member who can no
    -- longer read it, and not through a topic's or room's mute or the switch
    -- on Me. `detail` says whether it was the topic's opening post.
    return query
      with l as (
        select lk.member_id as liker_id, p.id as post_id, coalesce(p.author_id, private.chat_post_writer(p.id)) as author_id, p.body,
               p.attachments, tp.id as topic_id, tp.room_id, rm.opened_at,
               p.id = (select f.id from public.chat_posts f
                        where f.topic_id = tp.id
                        order by f.created_at, f.id limit 1) as is_opening
          from public.chat_post_likes lk
          join public.chat_posts p on p.id = lk.post_id and p.removed_at is null
          join public.chat_topics tp on tp.id = p.topic_id
          join public.chat_rooms rm on rm.id = tp.room_id
         where lk.post_id = (p_key ->> 'post_id')::uuid
           and lk.member_id = (p_key ->> 'member_id')::uuid
      )
      select s.endpoint, s.p256dh, s.auth,
             'like'::text, a.display_name, l.body, coalesce(cardinality(l.attachments), 0),
             null::text, case when l.is_opening then 'topic' else 'post' end,
             '/chat/rooms/' || l.room_id || '/topics/' || l.topic_id::text || '?post=' || l.post_id::text,
             'like:' || l.post_id::text,
             public.notification_badge(r.id)
        from l
        join public.members r on r.id = l.author_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = l.liker_id
       where l.author_id is distinct from l.liker_id
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id or (b.blocked_id = r.id and not r.is_admin))
              and (case when b.blocker_id = r.id then b.blocked_id else b.blocker_id end) in (
                l.liker_id,
                private.chat_topic_starter(l.topic_id)
              )
         )
         and (l.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.chat_topic_mutes x where x.topic_id = l.topic_id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes x where x.room_id = l.room_id and x.member_id = r.id
         )
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'like'
         )
         -- Only the first like or reaction on it pushes: decided when it
         -- happened, in public.push_owed (20261114100000).
         ;

  elsif p_event = 'reaction' and p_key ->> 'target' = 'message' then
    -- The message's author, with their own words; the emoji is as it is now,
    -- so one cleared before this runs sends nothing.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'reaction'::text, a.display_name, m.body, coalesce(cardinality(m.attachments), 0),
             null::text, 'message:' || x.emoji,
             '/chat/t/' || t.id::text || '?message=' || m.id::text,
             'reaction:' || m.id::text,
             public.notification_badge(r.id)
        from public.chat_message_reactions x
        join public.chat_messages m
          on m.id = x.target_id and m.removed_at is null and m.notice is null
        join public.chat_threads t on t.id = m.thread_id
        join public.chat_thread_members tm on tm.thread_id = t.id and tm.member_id = m.author_id
        join public.members r on r.id = m.author_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = x.member_id
       where x.target_id = (p_key ->> 'id')::uuid
         and x.member_id = (p_key ->> 'member_id')::uuid
         and x.emoji is not null
         and m.author_id is distinct from x.member_id
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id = x.member_id)
               or (b.blocker_id = x.member_id and b.blocked_id = r.id)
         )
         and not exists (
           select 1 from public.chat_thread_mutes q where q.thread_id = t.id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.push_muted_kinds q where q.member_id = r.id and q.kind = 'reaction'
         )
         -- Only the first like or reaction on it pushes: decided when it
         -- happened, in public.push_owed (20261114100000).
         ;

  elsif p_event = 'reaction' and p_key ->> 'target' = 'post' then
    -- The post's author, as a like: 'topic:' for the topic's opening post.
    return query
      with l as (
        select x.member_id as reactor_id, x.emoji, p.id as post_id, coalesce(p.author_id, private.chat_post_writer(p.id)) as author_id, p.body,
               p.attachments, tp.id as topic_id, coalesce(tp.author_id, private.chat_topic_starter(tp.id)) as starter_id, tp.room_id, rm.opened_at,
               p.id = (select f.id from public.chat_posts f
                        where f.topic_id = tp.id
                        order by f.created_at, f.id limit 1) as is_opening
          from public.chat_post_reactions x
          join public.chat_posts p on p.id = x.target_id and p.removed_at is null
          join public.chat_topics tp on tp.id = p.topic_id
          join public.chat_rooms rm on rm.id = tp.room_id
         where x.target_id = (p_key ->> 'id')::uuid
           and x.member_id = (p_key ->> 'member_id')::uuid
           and x.emoji is not null
      )
      select s.endpoint, s.p256dh, s.auth,
             'reaction'::text, a.display_name, l.body, coalesce(cardinality(l.attachments), 0),
             null::text, case when l.is_opening then 'topic:' else 'post:' end || l.emoji,
             '/chat/rooms/' || l.room_id || '/topics/' || l.topic_id::text || '?post=' || l.post_id::text,
             'reaction:' || l.post_id::text,
             public.notification_badge(r.id)
        from l
        join public.members r on r.id = l.author_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = l.reactor_id
       where l.author_id is distinct from l.reactor_id
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id in (l.reactor_id, l.starter_id))
               or (b.blocker_id = l.reactor_id and b.blocked_id = r.id)
               or (b.blocker_id = l.starter_id and b.blocked_id = r.id and not r.is_admin)
         )
         and (l.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.chat_topic_mutes q where q.topic_id = l.topic_id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes q where q.room_id = l.room_id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.push_muted_kinds q where q.member_id = r.id and q.kind = 'reaction'
         )
         -- Only the first like or reaction on it pushes: decided when it
         -- happened, in public.push_owed (20261114100000).
         ;

  elsif p_event = 'mention' then
    -- Each member the post named for the first time, checked again: 'topic'
    -- for a topic's opening post, as a like.
    return query
      with l as (
        select p.id as post_id, coalesce(p.author_id, private.chat_post_writer(p.id)) as author_id, p.anonymous, p.by_asker, p.body, p.attachments,
               tp.id as topic_id, coalesce(tp.author_id, private.chat_topic_starter(tp.id)) as starter_id, tp.room_id, rm.opened_at,
               p.id = (select f.id from public.chat_posts f
                        where f.topic_id = tp.id
                        order by f.created_at, f.id limit 1) as is_opening
          from public.chat_posts p
          join public.chat_topics tp on tp.id = p.topic_id
          join public.chat_rooms rm on rm.id = tp.room_id
         where p.id = (p_key ->> 'id')::uuid and p.removed_at is null
      )
      select s.endpoint, s.p256dh, s.auth,
             'mention'::text, private.chat_byline(l.anonymous, l.by_asker, a.display_name), l.body, coalesce(cardinality(l.attachments), 0),
             null::text, case when l.is_opening then 'topic' else 'post' end,
             '/chat/rooms/' || l.room_id || '/topics/' || l.topic_id::text || '?post=' || l.post_id::text,
             'mention:' || l.post_id::text,
             public.notification_badge(r.id)
        from l
        join public.chat_post_mentions x
          on x.post_id = l.post_id and x.created_at = (p_key ->> 'at')::timestamptz
        join public.members r on r.id = x.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = l.author_id
       where r.id is distinct from l.author_id
         and (l.opened_at is not null or r.is_admin)
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id in (l.author_id, l.starter_id))
               or (b.blocker_id = l.author_id and b.blocked_id = r.id)
               or (b.blocker_id = l.starter_id and b.blocked_id = r.id and not r.is_admin)
         )
         and not exists (
           select 1 from public.chat_topic_mutes q where q.topic_id = l.topic_id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.chat_room_mutes q where q.room_id = l.room_id and q.member_id = r.id
         )
         and not exists (
           select 1 from public.push_muted_kinds q where q.member_id = r.id and q.kind = 'mention'
         );

  elsif p_event = 'group_add' then
    return query
      select s.endpoint, s.p256dh, s.auth,
             'group_add'::text, a.display_name, null::text, 0,
             null::text, null::text,
             '/chat/t/' || t.id::text, 'thread:' || t.id::text,
             public.notification_badge(r.id)
        from public.chat_threads t
        join public.chat_thread_members tm
          on tm.thread_id = t.id and tm.member_id = (p_key ->> 'member_id')::uuid
        join public.members r on r.id = tm.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = (p_key ->> 'by')::uuid
       where t.id = (p_key ->> 'thread_id')::uuid
         and t.kind = 'group'
         and t.event_id is null
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id = (p_key ->> 'by')::uuid)
               or (b.blocker_id = (p_key ->> 'by')::uuid and b.blocked_id = r.id and not r.is_admin)
         )
         and (p_key ->> 'by') is not null
         and (p_key ->> 'by')::uuid <> tm.member_id
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'group_add'
         );

  elsif p_event = 'report' then
    -- Administrators, and not whoever made the report. Nothing about it
    -- reaches the lock screen but that it exists.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'report'::text, null::text, null::text, 0,
             null::text, null::text,
             '/admin?tab=reports', 'report:' || rep.id::text,
             public.notification_badge(r.id)
        from public.chat_reports rep
        join public.members r
          on r.is_admin and r.status = 'active' and r.id is distinct from rep.reporter_id
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where rep.id = key_id
         and rep.kind <> 'block'
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'report'
         );

  elsif p_event = 'member_joined' then
    return query
      select s.endpoint, s.p256dh, s.auth,
             'invite_joined'::text, joined.display_name, null::text, 0,
             null::text, null::text,
             -- From a QR code or link: who joined (20261028970000).
             case when i.qr_code_id is not null then '/peers/' || joined.id::text else '/invites' end,
             'joined:' || joined.id::text,
             public.notification_badge(r.id)
        from public.members joined
        join public.invites i on i.id = joined.invite_id
        join public.members r
          on r.id = i.invited_by_member_id and r.status = 'active' and r.id <> joined.id
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where joined.id = key_id
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'invite_joined'
         );

  -- 20261028980000: 24 hours before (quiet hours kept), and ten minutes before.
  elsif p_event = 'day_before' then
    return query
      select s.endpoint, s.p256dh, s.auth,
             'event_reminder'::text, null::text, null::text, 0,
             e.title,
             lower(to_char(e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'), 'FMHH12:MIam')),
             '/events/' || e.id::text, 'event:' || e.id::text,
             public.notification_badge(r.id)
        from public.event_day_before_sent sent
        join public.events e on e.id = sent.event_id
        left join public.data_feeds f on f.id = e.feed_id
        join public.members r on r.id = sent.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where sent.batch = (p_key ->> 'batch')::timestamptz
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_reminder'
         );

  elsif p_event = 'starting' then
    return query
      select s.endpoint, s.p256dh, s.auth,
             'event_starting'::text, null::text, null::text, 0,
             e.title,
             lower(to_char(e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'), 'FMHH12:MIam')),
             '/events/' || e.id::text, 'starting:' || e.id::text,
             public.notification_badge(r.id)
        from public.event_starting_sent sent
        join public.events e on e.id = sent.event_id
        left join public.data_feeds f on f.id = e.feed_id
        join public.members r on r.id = sent.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where sent.batch = (p_key ->> 'batch')::timestamptz
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_starting'
         );

  elsif p_event = 'invite_request' then
    -- Somebody asked an org admin for an invite (20261029030000).
    return query
      select s.endpoint, s.p256dh, s.auth,
             'invite_request'::text, null::text, null::text, 0,
             o.name,
             q.name,
             '/invites#requests', 'invite_request:' || o.id::text,
             public.notification_badge(r.id)
        from public.invite_requests q
        join public.organizations o on o.id = q.organization_id
        join public.members r on r.status = 'active' and (r.id = q.admin_id or r.id in (
          select d.member_id from private.invite_request_desk d
            join public.organization_representatives dr
              on dr.member_id = d.member_id and dr.organization_id = q.organization_id))
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where q.id = (p_key ->> 'id')::uuid
         and q.status = 'open'
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'invite_request'
         );

  elsif p_event = 'event_followup' then
    -- The morning after the event (20261031070000).
    return query
      select s.endpoint, s.p256dh, s.auth,
             'event_followup'::text, null::text, null::text, 0,
             e.title,
             null::text,
             '/events/' || e.id::text || '/review', 'followup:' || e.id::text,
             public.notification_badge(r.id)
        from public.event_followups_sent sent
        join public.events e on e.id = sent.event_id
        join public.members r on r.id = sent.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where sent.batch = (p_key ->> 'batch')::timestamptz
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_followup'
         );

  elsif p_event = 'check_in_reminder' then
    -- Thirty minutes after the event (20261031050000). Not once they have
    -- checked in after all.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'check_in_reminder'::text, null::text, null::text, 0,
             e.title,
             null::text,
             '/events/' || e.id::text || '/check-in', 'check_in:' || e.id::text,
             public.notification_badge(r.id)
        from public.event_check_in_reminders_sent sent
        join public.events e on e.id = sent.event_id
        join public.members r on r.id = sent.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where sent.batch = (p_key ->> 'batch')::timestamptz
         and not exists (
           select 1 from public.event_check_ins c
            where c.event_id = e.id and c.member_id = r.id
         )
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'check_in_reminder'
         );

  elsif p_event = 'calendar_invite' then
    -- What became of a calendar invitation (20261101000000): the row its
    -- trigger recorded, to whoever sent it. detail says which.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'calendar_invite'::text, null::text, null::text, 0,
             ci.payload ->> 'title',
             n.detail,
             case when n.detail in ('held', 'choose') then '/events/invites'
                  when ci.event_id is not null then '/events/' || ci.event_id::text
                  else '/events' end,
             n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.calendar_invites ci on ci.id = n.calendar_invite_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where n.kind = 'calendar_invite'
         and n.calendar_invite_id = (p_key ->> 'id')::uuid
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'calendar_invite'
         );

  elsif p_event = 'organization_request' then
    -- A member asked to add an organization, or was answered (20261101010000):
    -- the rows the request's functions recorded. detail says which.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'organization_request'::text, a.display_name, null::text, 0,
             q.draft ->> 'name',
             n.detail,
             case when n.detail = 'asked' then '/admin?tab=organizations'
                  when q.organization_id is not null
                    then '/events/organizations/' || q.organization_id::text
                  else '/events?segment=orgs' end,
             n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.organization_requests q on q.id = n.organization_request_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = n.actor_id
       where n.kind = 'organization_request'
         and n.organization_request_id = (p_key ->> 'id')::uuid
         and n.detail = p_key ->> 'step'
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'organization_request'
         );

  elsif p_event = 'join_request' then
    -- Somebody asked to join (20261031030000): the rows the trigger recorded.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'join_request'::text, a.display_name, null::text, 0,
             o.name,
             n.count::text,
             '/events/organizations/' || o.id::text, n.tag,
             public.notification_badge(r.id)
        from public.organization_join_requests q
        join public.organizations o on o.id = q.organization_id
        join public.members a on a.id = q.member_id
        join public.notifications n
          on n.kind = 'join_request'
         and n.organization_id = q.organization_id
         and n.actor_id = q.member_id
         and n.read_at is null
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where q.organization_id = (p_key ->> 'organization_id')::uuid
         and q.member_id = (p_key ->> 'member_id')::uuid
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'join_request'
         );

  elsif p_event = 'introduction' then
    -- A partner introduced them, or both said yes (20261029100000): the rows
    -- make_introduction and answer_introduction recorded.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'introduction'::text, a.display_name, left(ix.note, 160), 0,
             case when n.detail = 'opened' then t.name else ox.display_name end,
             n.detail,
             case when n.detail = 'opened'
                       and not exists (select 1 from public.chat_thread_members x
                                        where x.thread_id = n.thread_id and x.member_id = r.id)
                    then '/partner'
                  when n.detail = 'opened' then '/chat/t/' || n.thread_id::text
                  else '/introductions/' || ix.id::text end,
             n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.introductions ix on ix.id = n.introduction_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = n.actor_id
        left join public.members ox
          on ox.id = case when ix.first_id = r.id then ix.second_id else ix.first_id end
        left join public.chat_threads t on t.id = n.thread_id
       where n.kind = 'introduction'
         and n.introduction_id = (p_key ->> 'id')::uuid
         and n.detail = p_key ->> 'step'
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'introduction'
         )
         and not exists (
           select 1 from public.member_blocks b
            where (b.blocker_id = r.id and b.blocked_id in (n.actor_id, ox.id))
               or (b.blocker_id in (n.actor_id, ox.id) and b.blocked_id = r.id and not r.is_admin)
         );

  elsif p_event = 'family_link' then
    -- Asked to link as family, or the answer was yes (20261107100000).
    -- subject is what the actor is to the recipient.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'family_link'::text, a.display_name, null::text, 0,
             case when fl.asker_id = r.id then fl.relation else private.family_inverse(fl.relation) end,
             n.detail,
             '/peers/' || n.actor_id::text,
             n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.family_links fl on fl.id = n.family_link_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = n.actor_id
       where n.kind = 'family_link'
         and n.family_link_id = (p_key ->> 'id')::uuid
         and n.detail = p_key ->> 'step'
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'family_link'
         )
         and not private.blocked_between(r.id, n.actor_id);

  elsif p_event = 'daily' then
    -- Tomorrow, in each event's own zone.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'event_reminder'::text, null::text, null::text, 0,
             e.title,
             lower(to_char(e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'), 'FMHH12:MIam')),
             '/events/' || e.id::text, 'event:' || e.id::text,
             public.notification_badge(r.id)
        from public.events e
        left join public.data_feeds f on f.id = e.feed_id
        join public.event_rsvps rv on rv.event_id = e.id and rv.status = 'going'
        join public.members r on r.id = rv.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where e.all_day
         and (e.start_time at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'))::date
             = (now() at time zone coalesce(e.timezone, f.timezone, 'America/Los_Angeles'))::date + 1
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_reminder'
         );

    -- New in the last day from organizations a member follows, one per
    -- organization, counted.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'org_events'::text, null::text, null::text, 0,
             o.name,
             count(*)::text,
             '/events/organizations/' || o.id::text, 'org:' || o.id::text,
             public.notification_badge(s.member_id)
        from public.organization_follows fo
        join public.organizations o on o.id = fo.organization_id
        join public.events e
          on e.organization_id = o.id
         and e.created_at > now() - interval '24 hours'
         and e.start_time > now()
        join public.members r on r.id = fo.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'org_events'
         )
       group by s.endpoint, s.p256dh, s.auth, o.id, o.name;

  elsif p_event = 'grant_open' then
    -- A grant's applications opened: everybody following its organization.
    -- body is the grant's name, detail the day this cycle closes.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'grant_open'::text, null::text, g.name, 0,
             o.name,
             to_char(c.cycle_closes, 'FMMon FMDD'),
             '/events/organizations/' || o.id::text, 'grant:' || g.id::text,
             public.notification_badge(r.id)
        from public.organization_grant_windows gw
        join public.organization_grants g on g.id = gw.grant_id
        join public.organizations o on o.id = g.organization_id and o.removed_at is null
        cross join lateral public.grant_window_cycle(
          gw.opens_on, gw.closes_on, gw.yearly, (now() at time zone 'America/Los_Angeles')::date
        ) c
        join public.organization_follows fo on fo.organization_id = g.organization_id
        join public.members r on r.id = fo.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where gw.id = key_id
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'grant_open'
         );

  elsif p_event = 'profile_reminder' then
    -- Today's reminders to finish Your details or the profile. detail is the
    -- step; the address opens it.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'profile_reminder'::text, null::text, null::text, 0,
             null::text, pr.step,
             case pr.step when 'details' then '/profile/details' else '/profile?resume' end,
             'profile:' || pr.step,
             public.notification_badge(r.id)
        from public.profile_reminders pr
        join public.members r on r.id = pr.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where pr.sent_on = (p_key ->> 'day')::date
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'profile_reminder'
         );

  elsif p_event = 'blocks_weekly' then
    -- The week's count of blocks: the rows blocks_weekly_notify recorded, to
    -- administrators who have not switched off New reports. Names nobody.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'blocks_weekly'::text, null::text, null::text, 0,
             null::text, n.detail,
             '/admin?tab=reports#blocks', n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.members r on r.id = n.member_id and r.is_admin and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where n.kind = 'blocks_weekly'
         and n.tag = 'blocks:' || (p_key ->> 'day')
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'report'
         );
  elsif p_event = 'event_notice' then
    -- An org admin told them of an event (20261103000000): the rows that send wrote.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'event_notice'::text, o.name, null::text, 0,
             e.title,
             n.detail,
             '/events/' || e.id::text, n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.events e on e.id = n.event_id
        join public.organizations o on o.id = n.organization_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
       where n.kind = 'event_notice'
         and n.event_id = (p_key ->> 'event_id')::uuid
         and n.created_at = (p_key ->> 'batch')::timestamptz
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'event_notice'
         );
  elsif p_event = 'checked_in' then
    -- An organizer ticked them as there (20261113120000): subject the event,
    -- detail the organization it made them a member of, if any.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'checked_in'::text, a.display_name, null::text, 0,
             e.title,
             n.detail,
             '/events/' || e.id::text, n.tag,
             public.notification_badge(r.id)
        from public.notifications n
        join public.events e on e.id = n.event_id
        join public.members r on r.id = n.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = n.actor_id
       where n.kind = 'checked_in'
         and n.event_id = (p_key ->> 'event_id')::uuid
         and n.member_id = (p_key ->> 'member_id')::uuid
         and n.read_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'checked_in'
         )
         and not private.blocked_between(r.id, n.actor_id);

  elsif p_event = 'important' and p_key ? 'waiting' then
    -- Whoever marked a message Important, told how many have not
    -- acknowledged after their three pushes (20261113140000).
    return query
      select s.endpoint, s.p256dh, s.auth,
             'important'::text, a.display_name, m.body, cardinality(m.attachments),
             coalesce(t.name, (select e.title from public.events e where e.id = t.event_id)),
             'waiting:' || n.count::text,
             '/chat/t/' || t.id::text || '?message=' || m.id::text,
             'important_waiting:' || m.id::text,
             public.notification_badge(r.id)
        from private.important_waiting_told w
        join public.chat_important_messages im on im.message_id = w.message_id
        join public.chat_messages m on m.id = im.message_id
        join public.chat_threads t on t.id = im.thread_id
        join public.members r on r.id = im.marked_by and r.status = 'active'
        join public.notifications n
          on n.member_id = r.id and n.tag = 'important_waiting:' || m.id::text and n.read_at is null
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = m.author_id
       where w.batch = (p_key ->> 'waiting')::timestamptz
         and im.unmarked_at is null
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'important'
         );

  elsif p_event = 'important' then
    -- A message marked Important (20261113140000), first or again: to each
    -- member in that run who has not acknowledged it. Through a muted group,
    -- not past a block. detail 'reminder' after the first.
    return query
      select s.endpoint, s.p256dh, s.auth,
             'important'::text, a.display_name, m.body, cardinality(m.attachments),
             coalesce(t.name, (select e.title from public.events e where e.id = t.event_id)),
             case when (
               select count(*) from private.important_pushes q
                where q.message_id = p.message_id and q.member_id = p.member_id
             ) > 1 then 'reminder' end,
             '/chat/t/' || t.id::text || '?message=' || m.id::text,
             'important:' || m.id::text,
             public.notification_badge(r.id)
        from private.important_pushes p
        join public.chat_important_messages im on im.message_id = p.message_id and im.unmarked_at is null
        join public.chat_messages m on m.id = p.message_id and m.removed_at is null
        join public.chat_threads t on t.id = im.thread_id
        join public.chat_thread_members tm on tm.thread_id = t.id and tm.member_id = p.member_id
        join public.members r on r.id = p.member_id and r.status = 'active'
        join public.push_subscriptions s on s.member_id = r.id and not private.push_paused(s.member_id)
        left join public.members a on a.id = m.author_id
       where p.batch = (p_key ->> 'batch')::timestamptz
         and not exists (
           select 1 from public.chat_important_acks k
            where k.message_id = p.message_id and k.member_id = p.member_id
         )
         and not exists (
           select 1 from public.push_muted_kinds x where x.member_id = r.id and x.kind = 'important'
         )
         and not private.blocked_between(r.id, m.author_id);
  end if;
end;
$function$;

create or replace function private.claim_first_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  author uuid;
  target uuid;
  made timestamptz := now();
begin
  if tg_table_name = 'chat_post_likes' then
    target := new.post_id;
    made := new.liked_at;
    select coalesce(p.author_id, private.chat_post_writer(p.id)) into author from public.chat_posts p where p.id = target;
  else
    if new.emoji is null or (tg_op = 'UPDATE' and old.emoji is not null) then
      return null;
    end if;
    target := new.target_id;
    insert into private.reaction_made (target_id, member_id, made_at)
    values (target, new.member_id, made)
    on conflict (target_id, member_id) do update set made_at = excluded.made_at;
    if tg_table_name = 'chat_post_reactions' then
      select coalesce(p.author_id, private.chat_post_writer(p.id)) into author from public.chat_posts p where p.id = target;
    else
      select m.author_id into author from public.chat_messages m where m.id = target;
    end if;
  end if;
  -- Your own like on your own words claims nothing.
  if author is distinct from new.member_id then
    insert into private.first_reaction_push (target_id, member_id, made_at)
    values (target, new.member_id, made)
    on conflict (target_id) do nothing;
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.my_notifications(before timestamp with time zone DEFAULT NULL::timestamp with time zone, max_rows integer DEFAULT 40)
 RETURNS TABLE(id uuid, kind text, count integer, created_at timestamp with time zone, seen boolean, read boolean, actor_id uuid, actor_name text, actor_photo text, place text, excerpt text, detail text, url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.id, n.kind, n.count, n.created_at, n.seen_at is not null, n.read_at is not null,
         n.actor_id,
         case when n.actor_id is null and p.anonymous and n.kind in ('reply', 'reply_participant', 'mention')
              then private.chat_byline(true, p.by_asker, null)
              when n.actor_id is null and n.kind in ('direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'reaction', 'mention', 'introduction', 'join_request', 'organization_request', 'family_link', 'checked_in', 'important')
              then 'Deleted member' else a.display_name end,
         a.photo_path,
         case
           when n.kind in ('direct', 'group', 'group_add', 'important')
                or (n.kind = 'reaction' and n.thread_id is not null) then
             coalesce(t.name, (select e.title from public.events e where e.id = t.event_id))
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention') then tp.title
           when n.kind in ('event_reminder', 'event_starting', 'check_in_reminder', 'event_followup', 'event_notice', 'checked_in') then ev.title
           when n.kind in ('org_events', 'grant_open', 'invite_request', 'join_request') then o.name
           when n.kind = 'invite_joined' then j.display_name
           when n.kind = 'calendar_invite' then ci.payload ->> 'title'
           when n.kind = 'organization_request' then orq.draft ->> 'name'
           -- Who they are being introduced to; to the partner, the group.
           when n.kind = 'introduction' and n.detail = 'opened' and t.id is not null then t.name
           when n.kind = 'introduction' then ox.display_name
           -- What the actor is to the reader (20261107100000).
           when n.kind = 'family_link' then
             case when fl.asker_id = n.member_id then fl.relation else private.family_inverse(fl.relation) end
         end,
         case
           when (n.kind in ('direct', 'group', 'important') or (n.kind = 'reaction' and n.thread_id is not null))
                and m.removed_at is null then
             left(nullif(btrim(m.body), ''), 160)
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention')
                and p.removed_at is null then
             left(nullif(btrim(p.body), ''), 160)
           when n.kind = 'grant_open' then gr.name
           when n.kind = 'event_notice' then o.name
           when n.kind = 'introduction' and n.detail = 'asked' then left(ix.note, 160)
         end,
         n.detail,
         case
           when n.kind in ('direct', 'group', 'important')
                or (n.kind = 'reaction' and n.thread_id is not null) then
             '/chat/t/' || n.thread_id::text || coalesce('?message=' || n.message_id::text, '')
           when n.kind = 'group_add' then '/chat/t/' || n.thread_id::text
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention') then
             '/chat/rooms/' || tp.room_id || '/topics/' || tp.id::text
               || coalesce('?post=' || n.post_id::text, '')
           when n.kind = 'report' then '/admin?tab=reports'
           when n.kind = 'blocks_weekly' then '/admin?tab=reports#blocks'
           -- From a QR code or link: the administrators' tally, or for an
           -- org admin, who joined (20261028970000).
           when n.kind = 'invite_joined' and n.detail like 'qr:%' and public.is_admin() then '/admin?tab=invites'
           when n.kind = 'invite_joined' and n.detail like 'qr:%' then '/peers/' || n.joined_id::text
           when n.kind = 'invite_joined' then '/invites'
           when n.kind in ('event_reminder', 'event_starting', 'event_notice', 'checked_in') then '/events/' || n.event_id::text
           when n.kind = 'check_in_reminder' then '/events/' || n.event_id::text || '/check-in'
           when n.kind = 'event_followup' then '/events/' || n.event_id::text || '/review'
           when n.kind in ('org_events', 'grant_open', 'join_request') then '/events/organizations/' || n.organization_id::text
           when n.kind = 'invite_request' then '/invites#requests'
           when n.kind = 'calendar_invite' and n.detail in ('held', 'choose') then '/events/invites'
           when n.kind = 'calendar_invite' and ci.event_id is not null then '/events/' || ci.event_id::text
           when n.kind = 'calendar_invite' then '/events'
           when n.kind = 'organization_request' and n.detail = 'asked' then '/admin?tab=organizations'
           when n.kind = 'organization_request' and orq.organization_id is not null
             then '/events/organizations/' || orq.organization_id::text
           when n.kind = 'organization_request' then '/events?segment=orgs'
           when n.kind = 'profile_reminder' and n.detail = 'details' then '/profile/details'
           when n.kind = 'profile_reminder' then '/profile?resume'
           -- A partner who is not in it goes to their page.
           when n.kind = 'introduction' and n.detail = 'opened'
                and not exists (select 1 from public.chat_thread_members x
                                 where x.thread_id = n.thread_id and x.member_id = n.member_id)
             then '/partner'
           when n.kind = 'introduction' and n.detail = 'opened' then '/chat/t/' || n.thread_id::text
           when n.kind = 'introduction' then '/introductions/' || n.introduction_id::text
           when n.kind = 'family_link' then '/peers/' || n.actor_id::text
         end
    from public.notifications n
    left join public.members a on a.id = n.actor_id
    left join public.chat_threads t on t.id = n.thread_id
    left join public.chat_messages m on m.id = n.message_id
    left join public.chat_topics tp on tp.id = n.topic_id
    left join public.chat_posts p on p.id = n.post_id
    left join public.events ev on ev.id = n.event_id
    left join public.organizations o on o.id = n.organization_id
    left join public.members j on j.id = n.joined_id
    left join public.organization_grants gr on gr.id = n.grant_id
    left join public.introductions ix on ix.id = n.introduction_id
    left join public.calendar_invites ci on ci.id = n.calendar_invite_id
    left join public.organization_requests orq on orq.id = n.organization_request_id
    left join public.family_links fl on fl.id = n.family_link_id
    left join public.members ox
      on ox.id = case when ix.first_id = n.member_id then ix.second_id else ix.first_id end
   where n.member_id = auth.uid()
     and public.is_member()
     and (before is null or n.created_at < before)
     and n.created_at > now() - interval '30 days'
     and case
       when n.kind in ('direct', 'group', 'group_add', 'important') then exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind in ('reply', 'reply_participant') then public.chat_room_is_readable(tp.room_id)
       -- A like is about the post, so it goes with the post.
       when n.kind = 'like' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind = 'reaction' and n.thread_id is not null then m.removed_at is null and exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind = 'reaction' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind = 'mention' then p.removed_at is null and public.chat_room_is_readable(tp.room_id)
       when n.kind in ('report', 'blocks_weekly') then public.is_admin()
       when n.kind = 'organization_request' and n.detail = 'asked' then public.is_admin()
       -- Only while they still speak for its organization.
       when n.kind = 'invite_request' then public.speaks_for(n.organization_id)
       when n.kind = 'join_request' then public.speaks_for(n.organization_id) or public.is_admin()
       when n.kind = 'introduction' and n.detail = 'opened' then ix.introduced_by = auth.uid() or exists (
         select 1 from public.chat_thread_members x
          where x.thread_id = n.thread_id and x.member_id = auth.uid()
       )
       when n.kind = 'introduction' then ix.id is not null and ox.status = 'active'
       when n.kind = 'family_link' then fl.id is not null
       else true
     end
     and not exists (
       select 1 from public.member_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id in (n.actor_id, tp.author_id, ox.id))
           or (b.blocked_id = auth.uid() and b.blocker_id in (n.actor_id, tp.author_id, ox.id)
               and not public.is_admin())
     )
   order by n.created_at desc, n.id
   limit least(greatest(coalesce(max_rows, 40), 1), 100);
$function$;

-- ============================================================================
-- A block hides anonymous topics too, both ways, as it hides named ones.
-- ============================================================================

create or replace function public.chat_topics_page(room text, max_rows integer default 40, before_at timestamptz default null, before_id uuid default null)
returns table(id uuid, room_id text, title text, author_id uuid, created_at timestamptz, last_post_at timestamptz, reply_count integer, view_count bigint, unread boolean, participant_ids uuid[])
language sql
stable security definer
set search_path = ''
as $$
  with hidden as (select private.my_hidden_member_ids() as ids),
  page as materialized (
    select t.*
    from public.chat_topics t
    cross join hidden
    where t.room_id = room
      -- Definer: the only thing between a member and a closed room.
      and public.chat_room_is_readable(room)
      and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
      and (before_at is null
           or t.last_post_at < before_at
           or (t.last_post_at = before_at and t.id < before_id))
    order by t.last_post_at desc, t.id desc
    limit least(greatest(coalesce(max_rows, 40), 1), 200)
  )
  select
    t.id,
    t.room_id,
    t.title,
    t.author_id,
    t.created_at,
    t.last_post_at,
    t.reply_count,
    (select count(distinct v.member_id) from (
       select tr.member_id from public.chat_topic_reads tr where tr.topic_id = t.id
       union all
       select s.member_id from public.chat_post_views s
         join public.chat_posts p on p.id = s.post_id where p.topic_id = t.id
       union all
       select l.member_id from public.chat_post_likes l
         join public.chat_posts p on p.id = l.post_id where p.topic_id = t.id
       union all
       select x.member_id from public.chat_post_reactions x
         join public.chat_posts p on p.id = x.target_id where p.topic_id = t.id
     ) v
     where v.member_id is distinct from t.author_id) as view_count,
    t.last_post_at > coalesce(
      (select r.last_read_at from public.chat_topic_reads r
        where r.topic_id = t.id and r.member_id = auth.uid()),
      '-infinity'::timestamptz
    ) as unread,
    (
      select coalesce(array_agg(s.author_id order by s.first_at), '{}'::uuid[])
      from (
        select p.author_id, min(p.created_at) as first_at
        from public.chat_posts p
        where p.topic_id = t.id and p.author_id is not null and p.removed_at is null
          and not (p.author_id = any (hidden.ids))
        group by p.author_id
        order by min(p.created_at)
        limit 4
      ) s
    ) as participant_ids
  from page t
  cross join hidden
  order by t.last_post_at desc, t.id desc;
$$;

CREATE OR REPLACE FUNCTION public.chat_topics_for(room text)
 RETURNS TABLE(id uuid, room_id text, title text, author_id uuid, created_at timestamp with time zone, last_post_at timestamp with time zone, reply_count integer, view_count bigint, unread boolean, participant_ids uuid[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with hidden as (select private.my_hidden_member_ids() as ids)
  select
    t.id,
    t.room_id,
    t.title,
    t.author_id,
    t.created_at,
    t.last_post_at,
    t.reply_count,
    (select count(distinct v.member_id) from (
       select tr.member_id from public.chat_topic_reads tr where tr.topic_id = t.id
       union all
       select s.member_id from public.chat_post_views s
         join public.chat_posts p on p.id = s.post_id where p.topic_id = t.id
       union all
       select l.member_id from public.chat_post_likes l
         join public.chat_posts p on p.id = l.post_id where p.topic_id = t.id
       union all
       select x.member_id from public.chat_post_reactions x
         join public.chat_posts p on p.id = x.target_id where p.topic_id = t.id
     ) v
     where v.member_id is distinct from t.author_id) as view_count,
    t.last_post_at > coalesce(
      (select r.last_read_at from public.chat_topic_reads r
        where r.topic_id = t.id and r.member_id = auth.uid()),
      '-infinity'::timestamptz
    ) as unread,
    (
      select coalesce(array_agg(s.author_id order by s.first_at), '{}'::uuid[])
      from (
        select p.author_id, min(p.created_at) as first_at
        from public.chat_posts p
        where p.topic_id = t.id and p.author_id is not null and p.removed_at is null
          and not (p.author_id = any (hidden.ids))
        group by p.author_id
        order by min(p.created_at)
        limit 4
      ) s
    ) as participant_ids
  from public.chat_topics t
  cross join hidden
  where t.room_id = room
    -- Definer: this is the only thing between a member and a closed room.
    and public.chat_room_is_readable(room)
    and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
  order by t.last_post_at desc;
$function$;

create or replace function public.chat_topic_for(topic uuid)
returns table(id uuid, room_id text, title text, author_id uuid, created_at timestamptz, last_post_at timestamptz, reply_count integer, view_count bigint, unread boolean, participant_ids uuid[])
language sql
stable security definer
set search_path = ''
as $$
  with hidden as (select private.my_hidden_member_ids() as ids)
  select
    t.id,
    t.room_id,
    t.title,
    t.author_id,
    t.created_at,
    t.last_post_at,
    t.reply_count,
    (select count(distinct v.member_id) from (
       select tr.member_id from public.chat_topic_reads tr where tr.topic_id = t.id
       union all
       select s.member_id from public.chat_post_views s
         join public.chat_posts p on p.id = s.post_id where p.topic_id = t.id
       union all
       select l.member_id from public.chat_post_likes l
         join public.chat_posts p on p.id = l.post_id where p.topic_id = t.id
       union all
       select x.member_id from public.chat_post_reactions x
         join public.chat_posts p on p.id = x.target_id where p.topic_id = t.id
     ) v
     where v.member_id is distinct from t.author_id) as view_count,
    t.last_post_at > coalesce(
      (select r.last_read_at from public.chat_topic_reads r
        where r.topic_id = t.id and r.member_id = auth.uid()),
      '-infinity'::timestamptz
    ) as unread,
    (
      select coalesce(array_agg(s.author_id order by s.first_at), '{}'::uuid[])
      from (
        select p.author_id, min(p.created_at) as first_at
        from public.chat_posts p
        where p.topic_id = t.id and p.author_id is not null and p.removed_at is null
          and not (p.author_id = any (hidden.ids))
        group by p.author_id
        order by min(p.created_at)
        limit 4
      ) s
    ) as participant_ids
  from public.chat_topics t
  cross join hidden
  where t.id = topic
    -- Definer: the only thing between a member and a closed room.
    and public.chat_room_is_readable(t.room_id)
    and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]));
$$;

create or replace function public.chat_topics_ranked(room text, max_rows integer default 40, skip integer default 0)
returns table(id uuid, room_id text, title text, author_id uuid, created_at timestamptz, last_post_at timestamptz, reply_count integer, view_count bigint, unread boolean, participant_ids uuid[], score integer)
language sql
stable security definer
set search_path = ''
as $$
  with hidden as (select private.my_hidden_member_ids() as ids),
  topics as materialized (
    select t.*,
      (select case when p.removed_at is null then p.id end
         from public.chat_posts p where p.topic_id = t.id
        order by p.created_at, p.id limit 1) as opening_id,
      private.chat_topic_rank(t.id, auth.uid()) as rank
    from public.chat_topics t
    cross join hidden
    where t.room_id = room
      -- Definer: the only thing between a member and a closed room.
      and public.chat_room_is_readable(room)
      and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
  ),
  page as materialized (
    select s.*, private.chat_post_score(s.opening_id) as score
    from topics s
    order by s.rank desc, s.last_post_at desc, s.id desc
    offset greatest(coalesce(skip, 0), 0)
    limit least(greatest(coalesce(max_rows, 40), 1), 200)
  )
  select
    t.id,
    t.room_id,
    t.title,
    t.author_id,
    t.created_at,
    t.last_post_at,
    t.reply_count,
    (select count(distinct v.member_id) from (
       select tr.member_id from public.chat_topic_reads tr where tr.topic_id = t.id
       union all
       select s.member_id from public.chat_post_views s
         join public.chat_posts p on p.id = s.post_id where p.topic_id = t.id
       union all
       select l.member_id from public.chat_post_likes l
         join public.chat_posts p on p.id = l.post_id where p.topic_id = t.id
       union all
       select x.member_id from public.chat_post_reactions x
         join public.chat_posts p on p.id = x.target_id where p.topic_id = t.id
     ) v
     where v.member_id is distinct from t.author_id) as view_count,
    t.last_post_at > coalesce(
      (select r.last_read_at from public.chat_topic_reads r
        where r.topic_id = t.id and r.member_id = auth.uid()),
      '-infinity'::timestamptz
    ) as unread,
    (
      select coalesce(array_agg(s.author_id order by s.first_at), '{}'::uuid[])
      from (
        select p.author_id, min(p.created_at) as first_at
        from public.chat_posts p
        where p.topic_id = t.id and p.author_id is not null and p.removed_at is null
          and not (p.author_id = any (hidden.ids))
        group by p.author_id
        order by min(p.created_at)
        limit 4
      ) s
    ) as participant_ids,
    t.score
  from page t
  cross join hidden
  order by t.rank desc, t.last_post_at desc, t.id desc;
$$;

create or replace function public.home_topics_shown(
  p_show text default 'all',
  p_sort text default 'ranking',
  max_rows integer default 40
)
returns table(topic_id uuid, ord integer)
language sql
stable security definer
set search_path = ''
as $$
  with hidden as (select private.my_hidden_member_ids() as ids),
  candidates as materialized (
    select t.id, t.last_post_at, t.created_at, t.author_id, t.reply_count
    from public.chat_topics t
    join public.chat_rooms room on room.id = t.room_id
    cross join hidden
    where room.show_in_home and room.opened_at is not null
      -- Definer: the only thing between a member and a closed room.
      and public.chat_room_is_readable(t.room_id)
      and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
      and case p_show
        when 'mine' then t.author_id = auth.uid()
        when 'replied' then exists (
          select 1 from public.chat_posts p
           where p.topic_id = t.id and p.author_id = auth.uid() and p.removed_at is null
             and p.id <> (select f.id from public.chat_posts f where f.topic_id = t.id
                           order by f.created_at, f.id limit 1)
        )
        when 'orgs' then t.author_id is distinct from auth.uid() and exists (
          select 1 from public.organization_follows mine
            join public.organization_follows theirs
              on theirs.organization_id = mine.organization_id
           where mine.member_id = auth.uid() and theirs.member_id = t.author_id
        )
        else true
      end
    -- The newest three hundred by the order asked for; the default order is
    -- worked out among the three hundred last active, as the ranking does.
    order by case when p_sort = 'newest' then t.created_at else t.last_post_at end desc, t.id desc
    limit 300
  ),
  keyed as (
    select c.id,
      case p_sort
        when 'newest' then extract(epoch from c.created_at)
        when 'replies' then extract(epoch from c.last_post_at)
        when 'most_replies' then c.reply_count
        -- As a room's list counts a post's views (20261019000000): the
        -- members who read it, saw it, liked it or reacted, but its author.
        when 'views' then (
          select count(distinct v.member_id) from (
            select tr.member_id from public.chat_topic_reads tr where tr.topic_id = c.id
            union all
            select s.member_id from public.chat_post_views s
              join public.chat_posts p on p.id = s.post_id where p.topic_id = c.id
            union all
            select l.member_id from public.chat_post_likes l
              join public.chat_posts p on p.id = l.post_id where p.topic_id = c.id
            union all
            select x.member_id from public.chat_post_reactions x
              join public.chat_posts p on p.id = x.target_id where p.topic_id = c.id
          ) v
          where v.member_id is distinct from c.author_id
        )
        -- Upvotes on the post itself, not on the replies under it.
        when 'upvotes' then (
          select count(*) from public.chat_post_likes l
           where l.post_id = (select f.id from public.chat_posts f where f.topic_id = c.id
                               order by f.created_at, f.id limit 1)
        )
        -- The members who did something under it, each once: replied, voted
        -- either way or reacted, on the post or a reply. Not its author.
        when 'engaged' then (
          select count(distinct e.member_id) from (
            select p.author_id as member_id from public.chat_posts p
             where p.topic_id = c.id and p.removed_at is null
            union all
            select l.member_id from public.chat_post_likes l
              join public.chat_posts p on p.id = l.post_id where p.topic_id = c.id
            union all
            select d.member_id from public.chat_post_downvotes d
              join public.chat_posts p on p.id = d.post_id where p.topic_id = c.id
            union all
            select x.member_id from public.chat_post_reactions x
              join public.chat_posts p on p.id = x.target_id where p.topic_id = c.id
          ) e
          where e.member_id is not null and e.member_id is distinct from c.author_id
        )
        else private.chat_topic_rank(c.id, auth.uid())
      end::double precision as sort_key,
      c.last_post_at
    from candidates c
  )
  select k.id,
    (row_number() over (order by k.sort_key desc, k.last_post_at desc, k.id desc))::integer
  from keyed k
  order by k.sort_key desc, k.last_post_at desc, k.id desc
  limit least(greatest(coalesce(max_rows, 40), 1), 100);
$$;

create or replace function public.home_topics_ranked(max_rows integer default 40)
returns table(topic_id uuid, rank double precision, previews jsonb)
language sql
stable security definer
set search_path = ''
as $$
  with hidden as (select private.my_hidden_member_ids() as ids),
  candidates as materialized (
    select t.id, t.last_post_at
    from public.chat_topics t
    join public.chat_rooms room on room.id = t.room_id
    cross join hidden
    where room.show_in_home and room.opened_at is not null
      -- Definer: the only thing between a member and a closed room.
      and public.chat_room_is_readable(t.room_id)
      and not coalesce(t.author_id = any (hidden.ids), false) and not (t.anonymous and t.id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
    order by t.last_post_at desc, t.id desc
    limit 300
  ),
  ranked as materialized (
    select c.id, c.last_post_at, private.chat_topic_rank(c.id, auth.uid()) as rank
    from candidates c
    order by rank desc, c.last_post_at desc, c.id desc
    limit least(greatest(coalesce(max_rows, 40), 1), 100)
  ),
  replies as materialized (
    -- What a card may quote: standing answers to the topic, made in the open
    -- or with Reply on the opening post itself (20261118210000); not a reply
    -- to a reply, not from somebody the reader has hidden, and not voted
    -- below 0.
    select r.id as topic_id, p.id, p.created_at, p.author_id,
      private.chat_post_score(p.id) as score,
      -- No "first unread" any more (20261118220000): every member is shown
      -- the same replies, the top one and the latest.
      false as unread
    from ranked r
    cross join hidden
    join public.chat_posts p on p.topic_id = r.id
    cross join lateral (
      select f.id from public.chat_posts f where f.topic_id = r.id
       order by f.created_at, f.id limit 1
    ) opening
    where p.removed_at is null
      and (p.reply_to is null or p.reply_to = opening.id)
      and p.id <> opening.id
      and not coalesce(p.author_id = any (hidden.ids), false)
      and not (p.anonymous and p.id = any ((select private.my_hidden_anonymous_post_ids())::uuid[]))
  ),
  scored as (
    select r.*
    from replies r
    where r.score >= 0
  ),
  picks as (
    select r.id as topic_id, r.rank, r.last_post_at,
      (select s.id from scored s where s.topic_id = r.id and s.score >= 1
        order by s.score desc, s.created_at desc, s.id desc limit 1) as top_id,
      (select s.id from scored s where s.topic_id = r.id and s.unread
        order by s.created_at, s.id limit 1) as unread_id,
      (select s.id from scored s where s.topic_id = r.id
        order by s.created_at desc, s.id desc limit 1) as newest_id
    from ranked r
  ),
  picks2 as (
    select p.*,
      coalesce(
        case when p.unread_id is distinct from p.top_id then p.unread_id end,
        (select s.id from scored s where s.topic_id = p.topic_id
           and s.id is distinct from p.top_id
         order by s.created_at desc, s.id desc limit 1)
      ) as second_id
    from picks p
  ),
  picks3 as (
    select p.*,
      case
        when p.top_id is not null then null
        else (select s.id from scored s where s.topic_id = p.topic_id
                and s.id is distinct from p.second_id
              order by s.created_at desc, s.id desc limit 1)
      end as third_id
    from picks2 p
  )
  select p.topic_id, p.rank,
    coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind) order by x.ord)
               filter (where x.id is not null), '[]'::jsonb)
  from picks3 p
  cross join lateral (values
    (1, p.top_id, 'top'),
    (2, p.second_id, case when p.second_id = p.unread_id then 'unread'
                          when p.second_id = p.newest_id then 'latest' else 'reply' end),
    (3, p.third_id, 'reply')
  ) as x(ord, id, kind)
  group by p.topic_id, p.rank, p.last_post_at
  order by p.rank desc, p.last_post_at desc, p.topic_id desc;
$$;

-- ============================================================================
-- Asking, and replying, anonymously
-- ============================================================================

-- As chat_create_topic (20261010010000), with neither the topic nor its
-- opening post naming anybody. Its own name, so the old function's calls
-- stay exactly what they were.
create or replace function public.chat_create_topic_anonymously(
  room text,
  title text,
  body text,
  attachments text[] default '{}',
  question boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_topic uuid;
begin
  insert into public.chat_topics (room_id, title, author_id, is_question, anonymous)
  values (room, btrim(title), null, coalesce(question, false), true)
  returning id into new_topic;

  insert into public.chat_posts (topic_id, author_id, body, attachments, anonymous)
  values (new_topic, null, btrim(body), coalesce(attachments, '{}'), true);

  return new_topic;
end;
$$;

comment on function public.chat_create_topic_anonymously(text, text, text, text[], boolean) is
  'Start a topic, a question or not, that names nobody: as chat_create_topic, under the policies below. See 20261120100000.';

revoke all on function public.chat_create_topic_anonymously(text, text, text, text[], boolean) from public, anon;
grant execute on function public.chat_create_topic_anonymously(text, text, text, text[], boolean) to authenticated;

-- A reply is an insert into chat_posts, as a named one: author_id empty and
-- anonymous set. Everything else the named policy asks is asked here too.
drop policy if exists "an active member starts a topic anonymously where they may post" on public.chat_topics;
create policy "an active member starts a topic anonymously where they may post"
  on public.chat_topics for insert to authenticated
  with check (
    author_id is null and anonymous
    and (select auth.uid()) is not null
    and public.chat_can_post_in(room_id)
  );

drop policy if exists "an active member posts anonymously where they may post" on public.chat_posts;
create policy "an active member posts anonymously where they may post"
  on public.chat_posts for insert to authenticated
  with check (
    author_id is null and anonymous
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.chat_topics t
       where t.id = chat_posts.topic_id and public.chat_can_post_in(t.room_id)
    )
  );

-- A block hides the anonymous ones too (20261104203000 for the named).
alter policy "a member reads a readable topic's posts" on public.chat_posts
  using (
    exists (
      select 1 from public.chat_topics t
       where t.id = chat_posts.topic_id
         and t.room_id = any ((select public.my_readable_room_ids())::text[])
    )
    and not coalesce(author_id = any ((select private.my_hidden_member_ids())::uuid[]), false)
    and not (anonymous and id = any ((select private.my_hidden_anonymous_post_ids())::uuid[]))
  );

alter policy "a member reads a readable room's topics" on public.chat_topics
  using (
    room_id = any ((select public.my_readable_room_ids())::text[])
    and not coalesce(author_id = any ((select private.my_hidden_member_ids())::uuid[]), false)
    and not (anonymous and id = any ((select private.my_hidden_anonymous_topic_ids())::uuid[]))
  );

-- ============================================================================
-- Which anonymous posts in a topic are the reader's own, so the page offers
-- to edit and delete them and says "you"; an administrator gets every one,
-- with the name.
-- ============================================================================
create or replace function public.chat_anonymous_writers(topic uuid)
returns table (post_id uuid, member_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.post_id, a.member_id, m.display_name
    from public.chat_topics t
    join public.chat_posts p on p.topic_id = t.id
    join private.chat_anonymous_posts a on a.post_id = p.id
    left join public.members m on m.id = a.member_id
   where t.id = topic
     and public.is_member()
     and public.chat_room_is_readable(t.room_id)
     and (a.member_id = auth.uid() or public.is_admin());
$$;

comment on function public.chat_anonymous_writers(uuid) is
  'The anonymous posts in a topic that the reader wrote, or, to an administrator, all of them, each with its writer. See 20261120100000.';

revoke all on function public.chat_anonymous_writers(uuid) from public, anon;
grant execute on function public.chat_anonymous_writers(uuid) to authenticated;

-- Me → My posts lists the topics a member started; an anonymous one has no
-- author, so the member asks for their own here. Only ever their own.
create or replace function public.my_anonymous_topic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.topic_id
    from private.chat_anonymous_topics a
   where a.member_id = auth.uid()
     and public.is_member();
$$;

comment on function public.my_anonymous_topic_ids() is
  'The topics the calling member started anonymously, for Me → My posts. See 20261120100000.';

revoke all on function public.my_anonymous_topic_ids() from public, anon;
grant execute on function public.my_anonymous_topic_ids() to authenticated;

notify pgrst, 'reload schema';
