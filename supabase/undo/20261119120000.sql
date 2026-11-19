-- Undo for 20261119120000_a_boost_counts_as_a_new_reply.sql: a running boost is
-- a flat 24 hours again (20261118270000's private.chat_topic_rank) and a post
-- is boosted once in 14 days (20261118190000's public.admin_boost_post).
-- Nothing in the website depends on which it is, so this can be run under a
-- live website.

create or replace function private.chat_topic_rank(topic uuid, viewer uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select x.id, x.author_id, x.last_post_at,
      (select case when p.removed_at is null then p.id end
         from public.chat_posts p where p.topic_id = x.id
        order by p.created_at, p.id limit 1) as opening_id
    from public.chat_topics x
    where x.id = topic
  )
  select extract(epoch from t.last_post_at) / 3600
    + 4 * least(greatest(coalesce(
        (select count(*) from public.chat_post_likes l
          where l.post_id = t.opening_id and l.member_id is distinct from t.author_id)
      - (select count(*) from public.chat_post_downvotes d where d.post_id = t.opening_id),
      0), 0), 12)
    + case when t.opening_id is not null
           then 24 * private.chat_post_boost(t.opening_id) / 10 else 0 end
  from t;
$$;

comment on function private.chat_topic_rank(uuid, uuid) is
  'A topic''s place, the same for every member: last activity in hours, plus 4 a vote (at most 48) and 24 for a running boost. viewer is unused (20261118270000).';

create or replace function public.admin_boost_post(post uuid, more boolean default true)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the club''s administrators can boost a post.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.chat_posts p
    join public.chat_topics t on t.id = p.topic_id
    where p.id = post and p.removed_at is null and public.chat_room_is_readable(t.room_id)
  ) then
    raise exception 'That post is not there to boost.' using errcode = 'P0002';
  end if;
  if more then
    -- At the cap already: nothing to add.
    if private.chat_post_boost(post) = 0 then
      insert into public.chat_post_boosts (post_id, admin_id) values (post, auth.uid());
    end if;
  else
    delete from public.chat_post_boosts b
     where b.post_id = post and b.boosted_at > now() - interval '14 days';
  end if;
  return private.chat_post_boost(post);
end;
$$;

comment on function public.admin_boost_post(uuid, boolean) is
  'A club administrator adds 10 to a post''s score for 14 days (never more than 10), or takes it back.';
