-- ============================================================================
-- A vote counts twice as much in the order
-- ============================================================================
-- The owner, 2026-11-18: "I think we should increase the impact of upvotes on
-- ranking, can we double the impact?"
--
-- private.chat_topic_rank is 20261118220000's with the vote term doubled, and
-- nothing else changed. In hours, larger first:
--   the topic's last activity
--   + 4 hours a vote on its opening post (was 2), at most 48 (was 24): upvotes
--     not the author's own, less downvotes; below 0 counts as 0. Still the
--     first 12 votes that count.
--   + 24 hours while an administrator's boost is under 14 days old, as before.
--     Twelve votes now lift a post further than a boost does.
--
-- It orders Home (home_topics_ranked, home_topics_shown's 'ranking', and so
-- home_feed) and a room's Top (chat_topics_ranked), which call it as they did.
--
-- Probe: supabase/tests/a-ranking-for-home-and-rooms.sql.
-- Undo: supabase/undo/20261118270000.sql.
-- ============================================================================

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
