-- Undo for 20261118270000_a_vote_counts_twice_as_much_in_the_order.sql: a vote
-- is 2 hours again, at most 24 (20261118220000's private.chat_topic_rank).
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
    + 2 * least(greatest(coalesce(
        (select count(*) from public.chat_post_likes l
          where l.post_id = t.opening_id and l.member_id is distinct from t.author_id)
      - (select count(*) from public.chat_post_downvotes d where d.post_id = t.opening_id),
      0), 0), 12)
    + case when t.opening_id is not null
           then 24 * private.chat_post_boost(t.opening_id) / 10 else 0 end
  from t;
$$;

comment on function private.chat_topic_rank(uuid, uuid) is
  'A topic''s place, the same for every member: last activity in hours, plus 2 a vote (at most 24) and 24 for a running boost. viewer is unused (20261118220000).';
