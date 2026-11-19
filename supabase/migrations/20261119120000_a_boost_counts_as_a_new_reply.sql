-- ============================================================================
-- A boost counts as a new reply would
-- ============================================================================
-- The owner, 2026-11-19: "Can you just make the admin boost be the equivalent
-- of adding a comment to it?"
--
-- private.chat_topic_rank (20261118270000's): the flat 24 hours for a running
-- boost is gone. A boost on the opening post is activity at the moment it was
-- made, as a reply would be. In hours, larger first:
--   the later of the topic's last activity and its boost
--   + 4 hours a vote on its opening post, at most 48, as before.
-- So a boosted post goes where a post just replied to goes, and sinks as the
-- others get replies. chat_topics.last_post_at is not touched: members are
-- shown no new activity and nothing becomes unread.
--
-- public.admin_boost_post: boosting a post already boosted moves the boost to
-- now ("boost again"), where it added nothing before; taking it back removes
-- every boost of the post. A post has one boost row at most from here on.
-- It still answers 10 or 0, which the shipped app reads as boosted or not;
-- private.chat_post_boost is unchanged (10 while the boost is under 14 days
-- old), and is now only that label for administrators.
--
-- Probe: supabase/tests/a-ranking-for-home-and-rooms.sql.
-- Undo: supabase/undo/20261119120000.sql.
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
  select extract(epoch from greatest(
        t.last_post_at,
        (select max(b.boosted_at) from public.chat_post_boosts b where b.post_id = t.opening_id)
      )) / 3600
    + 4 * least(greatest(coalesce(
        (select count(*) from public.chat_post_likes l
          where l.post_id = t.opening_id and l.member_id is distinct from t.author_id)
      - (select count(*) from public.chat_post_downvotes d where d.post_id = t.opening_id),
      0), 0), 12)
  from t;
$$;

comment on function private.chat_topic_rank(uuid, uuid) is
  'A topic''s place, the same for every member: the later of its last activity and an administrator''s boost of its opening post, in hours, plus 4 a vote (at most 48). viewer is unused (20261119120000).';

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
  -- One boost a post: again moves it to now, taking it back leaves none.
  delete from public.chat_post_boosts b where b.post_id = post;
  if more then
    insert into public.chat_post_boosts (post_id, admin_id) values (post, auth.uid());
  end if;
  return private.chat_post_boost(post);
end;
$$;

comment on function public.admin_boost_post(uuid, boolean) is
  'A club administrator moves a post up as a new reply would (again moves it to now), or takes that back. Answers 10 when boosted, 0 when not.';
