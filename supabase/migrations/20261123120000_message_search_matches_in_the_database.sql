-- Message search matches in the database, a page at a time (2026-11-23).
--
-- The client used to read the newest 200 messages containing the words and
-- keep those where each word starts a word. 200 newer near misses ("brand"
-- for "ran") could push an older real match out, so a search could come back
-- empty. Here the whole rule runs in the query, which stops at the page size,
-- and a cursor (the last hit's time and id) reads on from there.
--
-- The rule is search.ts's: every word starts a word of the message, case and
-- accents ignored, and an apostrophe may be dropped ("obrien" finds O'Brien).
--
-- Security invoker: chat_messages' own select policy decides what is found,
-- as it did for the plain read this replaces.

create or replace function public.search_my_messages(
  p_words text[],
  p_thread_id uuid default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 51
)
returns table (id uuid, thread_id uuid, author_id uuid, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with typed as (
    -- Each word as a pattern: a start of text or a non-letter, then the word
    -- with everything but letters and digits escaped.
    select array_agg(
             '(^|[^[:alnum:]])'
             || regexp_replace(extensions.unaccent(lower(w)), '([^[:alnum:]])', '\\\1', 'g')
           ) as patterns
      from (select btrim(w) as w from unnest(p_words[1:10]) as w) as words
     where w <> ''
  )
  select m.id, m.thread_id, m.author_id, m.body, m.created_at
    from public.chat_messages m, typed
   where typed.patterns is not null
     and m.removed_at is null
     and m.notice is null
     and (p_thread_id is null or m.thread_id = p_thread_id)
     and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
     and not exists (
       select 1
         from unnest(typed.patterns) as p
        where not (
          extensions.unaccent(m.body) ~* p
          or translate(extensions.unaccent(m.body), '''’', '') ~* p
        )
     )
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 51), 1), 101);
$$;

comment on function public.search_my_messages(text[], uuid, timestamptz, uuid, integer) is
  'Messages the caller can read where every word starts a word, newest first, a page at a time.';

revoke all on function public.search_my_messages(text[], uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_my_messages(text[], uuid, timestamptz, uuid, integer) to authenticated;
