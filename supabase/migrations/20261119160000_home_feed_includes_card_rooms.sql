-- Include each card room from the existing RLS-scoped join.
create or replace function public.home_feed(
  p_show text default 'all',
  p_sort text default 'ranking',
  max_rows integer default 40
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with picked as materialized (
    -- One of the two, by what was asked for: the other is never run.
    select r.topic_id, (r.ord - 1)::integer as ord, r.previews
    from public.home_topics_ranked(max_rows)
         with ordinality as r(topic_id, rank, previews, ord)
    where coalesce(p_show, 'all') = 'all' and coalesce(p_sort, 'ranking') = 'ranking'
    union all
    select s.topic_id, s.ord, null::jsonb
    from public.home_topics_shown(p_show, p_sort, max_rows) s
    where not (coalesce(p_show, 'all') = 'all' and coalesce(p_sort, 'ranking') = 'ranking')
  )
  select coalesce(jsonb_agg(card.body order by card.ord), '[]'::jsonb)
  from (
    select k.ord,
      jsonb_build_object(
        'id', t.id,
        'room_id', t.room_id,
        'room', jsonb_build_object(
          'id', room.id, 'name', room.name, 'description', room.description,
          'category', room.category, 'icon', room.icon, 'sort_order', room.sort_order,
          'opened_at', room.opened_at, 'show_in_home', room.show_in_home,
          'created_by', room.created_by),
        'title', t.title,
        'author_id', t.author_id,
        'created_at', t.created_at,
        'last_post_at', t.last_post_at,
        'reply_count', t.reply_count,
        'is_question', t.is_question,
        'ord', k.ord,
        'previews', k.previews,
        'author', (select to_jsonb(a) from public.chat_authors a where a.id = t.author_id),
        'opening', case when opening.id is null then '[]'::jsonb
                        else jsonb_build_array(opening.body) end,
        'replies', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id', p.id, 'topic_id', p.topic_id, 'author_id', p.author_id,
                     'body', p.body, 'attachments', p.attachments,
                     'created_at', p.created_at, 'removed_at', p.removed_at,
                     'removed_by_admin', p.removed_by_admin, 'edited_at', p.edited_at,
                     'reply_to', p.reply_to, 'link_preview', p.link_preview,
                     'author', (select to_jsonb(a) from public.chat_authors a
                                 where a.id = p.author_id))
                   order by p.created_at, p.id)
          from public.chat_posts p
          where p.topic_id = t.id
            and p.removed_at is null
            and case
              when k.previews is not null then
                p.id in (select (x ->> 'id')::uuid from jsonb_array_elements(k.previews) x)
              else
                p.id = (
                  select f.id from public.chat_posts f
                   where f.topic_id = t.id and f.removed_at is null
                     and f.id is distinct from opening.id
                     and (f.reply_to is null or f.reply_to = opening.id)
                   order by f.created_at, f.id limit 1)
            end
        ), '[]'::jsonb)
      ) as body
    from picked k
    join public.chat_topics t on t.id = k.topic_id
    join public.chat_rooms room on room.id = t.room_id
      and room.show_in_home and room.opened_at is not null
    left join lateral (
      select f.id,
        jsonb_build_object(
          'id', f.id, 'topic_id', f.topic_id, 'author_id', f.author_id,
          'body', f.body, 'attachments', f.attachments,
          'created_at', f.created_at, 'removed_at', f.removed_at,
          'removed_by_admin', f.removed_by_admin, 'edited_at', f.edited_at,
          'reply_to', f.reply_to, 'link_preview', f.link_preview) as body
      from public.chat_posts f
      where f.topic_id = t.id
      order by f.created_at, f.id
      limit 1
    ) opening on true
  ) card;
$$;
