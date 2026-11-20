-- ============================================================================
-- Every strike names its rule, the member can answer it, and a flag can be
-- taken back
-- ============================================================================
-- The owner, 2026-11-20: "Can there be a dialogue between the anonymous
-- poster and the admin who flagged the post ... How explicit are we in
-- strikeable offenses?" Then: all administrators see and answer, signed "An
-- administrator"; withdrawing a flag undoes all of it; members can answer
-- every strike, named ones too; and the rulebook in the Terms, approved.
--
--   * member_strikes and private.chat_anonymous_flags gain rule: which of the
--     five strike rules was broken ('other' for anything else; null on rows
--     from before).
--   * private.strike_messages: one conversation per strike or flag, between
--     the member and the administrators. On a flag, administrators see "The
--     writer", never who; the member sees "An administrator", never which.
--   * admin_withdraw_flag: the post comes back as it was, the strike stops
--     counting, and so does what it cost: the anonymous-posting pause, and a
--     30-day pause it brought about. admin_withdraw_strike undoes a pause the
--     same way. A pause that no longer has three strikes under it is undone:
--     it stops resetting the count, and it stops ending anonymous posting.
--   * A flag keeps the post's photographs, so that withdrawing it can put
--     them back.
--   * Notices: strike_given (a named strike, with its reason), strike_message
--     (an answer, either way) and strike_withdrawn.
--
-- Expand-only for the live database: 20261120110000 is not on it yet, so the
-- functions it adds are replaced here rather than kept. admin_add_strike, the
-- name the shipped app calls, stays.

-- ---------------------------------------------------------------- rules

alter table public.member_strikes add column if not exists rule text;
alter table public.member_strikes drop constraint if exists member_strikes_rule_check;
alter table public.member_strikes add constraint member_strikes_rule_check check (
  rule is null or rule in ('harassment', 'medical_claims', 'selling', 'spam', 'careless_sharing', 'other')
);

alter table private.chat_anonymous_flags add column if not exists rule text;
alter table private.chat_anonymous_flags drop constraint if exists chat_anonymous_flags_rule_check;
alter table private.chat_anonymous_flags add constraint chat_anonymous_flags_rule_check check (
  rule is null or rule in ('harassment', 'medical_claims', 'selling', 'spam', 'careless_sharing', 'other')
);
alter table private.chat_anonymous_flags add column if not exists withdrawn_at timestamptz;
alter table private.chat_anonymous_flags add column if not exists withdrawn_reason text;
alter table private.chat_anonymous_flags add column if not exists withdrawn_by uuid
  references public.members (id) on delete set null;

-- A post whose flag was taken back can be flagged again.
alter table private.chat_anonymous_flags drop constraint if exists chat_anonymous_flags_post_id_key;
create unique index if not exists chat_anonymous_flags_one_per_post
  on private.chat_anonymous_flags (post_id) where withdrawn_at is null;

-- A pause undone by a withdrawal: it never happened, as far as counting goes.
alter table public.member_strike_pauses add column if not exists undone_at timestamptz;

create or replace function private.strike_rule_is_known(rule text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select rule in ('harassment', 'medical_claims', 'selling', 'spam', 'careless_sharing', 'other');
$$;

revoke all on function private.strike_rule_is_known(text) from public, anon, authenticated;

-- The administrators' list of strikes says which rule.
create or replace view public.admin_strikes with (security_barrier = true) as
  select s.id, s.member_id, s.reason, s.issued_at, s.withdrawn_at, s.withdrawn_reason,
         issuer.display_name as issued_by_name,
         ((s.withdrawn_at is null) and (s.issued_at > (now() - public.strike_window()))) as counts,
         s.rule
    from public.member_strikes s
    left join public.members issuer on issuer.id = s.issued_by
   where public.is_admin();

-- ---------------------------------------------------------------- counting, without what was undone

create or replace function private.strikes_count_from(who uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(p.paused_at), '-infinity'::timestamptz)
    from public.member_strike_pauses p
   where p.member_id = who and p.undone_at is null;
$$;

create or replace function private.strike_total(who uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*)
       from public.member_strikes s
      where s.member_id = who
        and s.withdrawn_at is null
        and s.issued_at > now() - public.strike_window()
        and s.issued_at > private.strikes_count_from(who))
    + (select count(*)
         from private.chat_anonymous_flags f
        where f.member_id = who
          and f.withdrawn_at is null
          and f.flagged_at > now() - public.strike_window()
          and f.flagged_at > private.strikes_count_from(who))
  )::integer;
$$;

create or replace function private.apply_strikes(who uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_admin boolean;
  address text;
  phone_number text;
begin
  select m.is_admin into target_is_admin from public.members m where m.id = who;
  if not found or target_is_admin then
    return 'none';
  end if;
  if private.strike_total(who) < public.strike_limit() then
    return 'none';
  end if;

  if exists (select 1 from public.member_strike_pauses p where p.member_id = who and p.undone_at is null) then
    -- Closed for good: blocked, then removed, as removeAndBlock does.
    address := private.confirmed_email(who);
    select nullif(btrim(coalesce(u.phone, '')), '') into phone_number from auth.users u where u.id = who;
    if address is not null then
      insert into public.blocked_emails (email, blocked_by, note)
      values (address::extensions.citext, auth.uid(), 'Three strikes after a pause for strikes.')
      on conflict do nothing;
    end if;
    if phone_number is not null then
      insert into public.blocked_numbers (phone_raw, reason, blocked_by)
      values (phone_number, 'Three strikes after a pause for strikes.', auth.uid())
      on conflict do nothing;
    end if;
    perform public.admin_delete_member(who);
    return 'closed';
  end if;

  insert into public.member_strike_pauses (member_id, ends_at)
  values (who, clock_timestamp() + interval '30 days');
  update public.members set status = 'suspended' where id = who and status = 'active';
  return 'paused';
end;
$$;

revoke all on function private.apply_strikes(uuid) from public, anon, authenticated;

-- After a withdrawal: a pause with fewer than three strikes under it is
-- undone, and if it is still running the membership comes back. Strikes under
-- a pause are the ones in the year before it, since the pause before it that
-- still stands.
create or replace function private.recheck_strike_pauses(who uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pause record;
  since timestamptz := '-infinity';
  under integer;
begin
  for pause in
    select p.id, p.paused_at, p.lifted_at
      from public.member_strike_pauses p
     where p.member_id = who and p.undone_at is null
     order by p.paused_at
  loop
    select (
      (select count(*) from public.member_strikes s
        where s.member_id = who and s.withdrawn_at is null
          and s.issued_at <= pause.paused_at
          and s.issued_at > greatest(since, pause.paused_at - public.strike_window()))
      + (select count(*) from private.chat_anonymous_flags f
          where f.member_id = who and f.withdrawn_at is null
            and f.flagged_at <= pause.paused_at
            and f.flagged_at > greatest(since, pause.paused_at - public.strike_window()))
    )::integer into under;

    if under >= public.strike_limit() then
      since := pause.paused_at;
    else
      update public.member_strike_pauses
         set undone_at = clock_timestamp(), lifted_at = coalesce(lifted_at, clock_timestamp())
       where id = pause.id;
      if pause.lifted_at is null then
        update public.members set status = 'active' where id = who and status = 'suspended';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.recheck_strike_pauses(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- anonymous standing, without what was undone

create or replace function private.anonymous_standing(who uuid)
returns table (state text, paused_until timestamptz, flags integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  latest timestamptz;
  pause_ends timestamptz;
begin
  select count(*)::integer, max(f.flagged_at) into flags, latest
    from private.chat_anonymous_flags f
   where f.member_id = who and f.withdrawn_at is null
     and f.flagged_at > now() - public.strike_window();

  if exists (select 1 from public.member_strike_pauses p where p.member_id = who and p.undone_at is null) then
    state := 'ended';
    return next;
    return;
  end if;
  if flags > 0 then
    pause_ends := latest + case when flags = 1 then interval '1 month' else interval '3 months' end;
    if now() < pause_ends then
      state := 'paused';
      paused_until := pause_ends;
      return next;
      return;
    end if;
  end if;
  state := 'ok';
  return next;
end;
$$;

revoke all on function private.anonymous_standing(uuid) from public, anon, authenticated;

-- The member's own flags, withdrawn ones included, so that the card can tell
-- them apart.
drop function if exists public.my_anonymous_strikes();
create function public.my_anonymous_strikes()
returns table (id uuid, rule text, reason text, flagged_at timestamptz, withdrawn_at timestamptz, withdrawn_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.rule, f.reason, f.flagged_at, f.withdrawn_at, f.withdrawn_reason
    from private.chat_anonymous_flags f
   where f.member_id = auth.uid()
   order by f.flagged_at desc;
$$;

comment on function public.my_anonymous_strikes() is
  'The calling member''s strikes for anonymous posts, newest first, with their rule. See 20261120120000.';

revoke all on function public.my_anonymous_strikes() from public, anon;
grant execute on function public.my_anonymous_strikes() to authenticated;

-- ---------------------------------------------------------------- notices

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'direct', 'group', 'reply', 'reply_participant', 'like', 'group_add', 'report',
  'invite_joined', 'event_reminder', 'org_events', 'grant_open', 'profile_reminder',
  'blocks_weekly', 'reaction', 'event_starting', 'invite_request', 'mention', 'introduction',
  'join_request', 'check_in_reminder', 'event_followup', 'calendar_invite',
  'organization_request', 'event_notice', 'family_link', 'checked_in', 'important',
  'anonymous_flagged', 'strike_given', 'strike_message', 'strike_withdrawn'
));

-- A flag's notice carries its reason, up to 500 characters (20261120110000),
-- and a strike's its kind, id and rule: 40 was too short for either, and a
-- flag with a longer reason failed outright.
alter table public.notifications drop constraint if exists notifications_detail_check;
alter table public.notifications add constraint notifications_detail_check
  check (char_length(detail) <= 600);

-- A notice about a strike: detail is 'strike' or 'flag', its id, and its
-- rule, colon-separated. One unread per strike and kind; another adds to it.
create or replace function private.notify_strike(who uuid, notice text, strike_kind text, strike uuid, strike_rule text, actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (member_id, kind, tag, actor_id, detail)
  values (who, notice, notice || ':' || strike_kind || ':' || strike::text, actor,
          strike_kind || ':' || strike::text || ':' || coalesce(strike_rule, ''))
  on conflict (member_id, tag) where read_at is null
  do update set count = public.notifications.count + 1, created_at = clock_timestamp(), seen_at = null;
$$;

revoke all on function private.notify_strike(uuid, text, text, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- giving one

drop function if exists public.admin_strike_member(uuid, text);
create function public.admin_strike_member(target uuid, strike_reason text, strike_rule text default null)
returns table (strikes integer, outcome text, paused_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_admin boolean;
  target_status text;
  given uuid;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator';
  end if;
  if length(btrim(coalesce(strike_reason, ''))) = 0 then
    raise exception 'A strike needs a reason';
  end if;
  if strike_rule is not null and not private.strike_rule_is_known(strike_rule) then
    raise exception 'Unknown rule: %', strike_rule using errcode = '22023';
  end if;

  -- One strike at a time per member (20260917000000).
  select m.is_admin, m.status into target_is_admin, target_status
    from public.members m where m.id = target for update;
  if not found then
    raise exception 'No such member';
  end if;
  if target_is_admin then
    raise exception 'An administrator cannot be given a strike';
  end if;
  if target_status = 'removed' then
    raise exception 'Their membership has already ended.';
  end if;

  insert into public.member_strikes (member_id, reason, issued_by, rule)
  values (target, btrim(strike_reason), auth.uid(), strike_rule)
  returning id into given;

  strikes := public.active_strike_count(target);
  outcome := private.apply_strikes(target);
  if outcome = 'paused' then
    select p.ends_at into paused_until from public.member_strike_pauses p
     where p.member_id = target and p.undone_at is null order by p.paused_at desc limit 1;
  end if;
  if outcome <> 'closed' then
    perform private.notify_strike(target, 'strike_given', 'strike', given, strike_rule, null);
  end if;
  return next;
end;
$$;

comment on function public.admin_strike_member(uuid, text, text) is
  'An administrator gives a strike under a rule, and the member is told. Returns the named strikes that count, and what happened: none, paused (30 days) or closed (for good). See 20261120120000.';

revoke all on function public.admin_strike_member(uuid, text, text) from public, anon;
grant execute on function public.admin_strike_member(uuid, text, text) to authenticated;

create or replace function public.admin_add_strike(target uuid, strike_reason text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select s.strikes from public.admin_strike_member(target, strike_reason, null) s;
$$;

revoke all on function public.admin_add_strike(uuid, text) from public, anon;
grant execute on function public.admin_add_strike(uuid, text) to authenticated;

-- ---------------------------------------------------------------- flagging, keeping what can come back

drop function if exists public.chat_flag_anonymous_post(uuid, text);
create function public.chat_flag_anonymous_post(post uuid, reason text, flag_rule text default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_posts;
  writer uuid;
  why text := nullif(btrim(coalesce(reason, '')), '');
  outcome text;
  standing text;
  counted integer;
  cost text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can flag a post.' using errcode = '42501';
  end if;
  if why is null then
    raise exception 'Say why it is flagged: the person who wrote it is told.' using errcode = '22023';
  end if;
  if char_length(why) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = '22023';
  end if;
  if flag_rule is not null and not private.strike_rule_is_known(flag_rule) then
    raise exception 'Unknown rule: %', flag_rule using errcode = '22023';
  end if;

  select * into target from public.chat_posts p where p.id = post;
  if not found or not exists (
    select 1 from public.chat_topics t
     where t.id = target.topic_id and public.chat_room_is_readable(t.room_id)
  ) then
    raise exception 'There is no such post.' using errcode = 'P0002';
  end if;
  if not target.anonymous then
    raise exception 'Only an anonymous post can be flagged.' using errcode = '22023';
  end if;
  if target.removed_at is not null then
    raise exception 'That post has already been removed.' using errcode = '42501';
  end if;

  writer := private.chat_post_writer(target.id);
  if writer = auth.uid() then
    raise exception 'You cannot flag your own post. Remove it instead.' using errcode = '42501';
  end if;

  -- Hidden as a removal is, but its photographs stay, for a withdrawal to
  -- put back: nothing is returned for the app to delete.
  perform public.chat_remove_post(target.id);
  if writer is null then
    return '{}';
  end if;

  -- One strike at a time per member, as admin_strike_member.
  perform 1 from public.members m where m.id = writer for update;
  insert into private.chat_anonymous_flags (post_id, member_id, flagged_by, reason, rule)
  values (target.id, writer, auth.uid(), why, flag_rule);

  outcome := private.apply_strikes(writer);
  if outcome = 'closed' then
    return '{}';
  end if;
  if outcome = 'paused' then
    cost := 'paused';
  else
    select s.state, s.flags into standing, counted from private.anonymous_standing(writer) s;
    cost := case
      when standing = 'ended' then 'ended'
      when counted <= 1 then 'month'
      else 'three_months'
    end;
  end if;

  insert into public.notifications (member_id, kind, tag, topic_id, post_id, detail)
  values (writer, 'anonymous_flagged', 'anonymous_flagged:' || target.id::text,
          target.topic_id, target.id, cost || ':' || why)
  on conflict do nothing;
  return '{}';
end;
$$;

comment on function public.chat_flag_anonymous_post(uuid, text, text) is
  'An administrator flags an anonymous post under a rule: it is hidden, it is a strike against its writer, and the writer is told the reason. See 20261120120000.';

revoke all on function public.chat_flag_anonymous_post(uuid, text, text) from public, anon;
grant execute on function public.chat_flag_anonymous_post(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- the conversation

create table if not exists private.strike_messages (
  id uuid primary key default gen_random_uuid(),
  strike_id uuid references public.member_strikes (id) on delete cascade,
  flag_id uuid references private.chat_anonymous_flags (id) on delete cascade,
  -- From the member the strike is against, or from an administrator.
  from_member boolean not null,
  author_id uuid references public.members (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  constraint strike_messages_about_one check (num_nonnulls(strike_id, flag_id) = 1)
);
create index if not exists strike_messages_strike on private.strike_messages (strike_id, created_at);
create index if not exists strike_messages_flag on private.strike_messages (flag_id, created_at);

alter table private.strike_messages enable row level security;
revoke all on private.strike_messages from public, anon, authenticated;

-- Whose strike it is, or null for none.
create or replace function private.strike_owner(kind text, strike uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case kind
    when 'strike' then (select s.member_id from public.member_strikes s where s.id = strike)
    when 'flag' then (select f.member_id from private.chat_anonymous_flags f where f.id = strike)
  end;
$$;

revoke all on function private.strike_owner(text, uuid) from public, anon, authenticated;

-- The member it is against (whatever their status: a paused member can still
-- answer), or an administrator. Anybody else is told there is no such strike.
create or replace function private.strike_reader(kind text, strike uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := private.strike_owner(kind, strike);
begin
  if owner is null then
    raise exception 'There is no such strike.' using errcode = 'P0002';
  end if;
  if owner = auth.uid() then
    return 'member';
  end if;
  if public.is_admin() then
    return 'admin';
  end if;
  raise exception 'There is no such strike.' using errcode = 'P0002';
end;
$$;

revoke all on function private.strike_reader(text, uuid) from public, anon, authenticated;

-- One strike or flag, as its reader may see it. On a flag, member_id and
-- member_name are null for everybody: an administrator never learns who.
create or replace function public.strike_summary(kind text, strike uuid)
returns table (
  rule text, reason text, given_at timestamptz, withdrawn_at timestamptz, withdrawn_reason text,
  mine boolean, member_id uuid, member_name text, words text, place text, url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reader text := private.strike_reader(kind, strike);
begin
  mine := reader = 'member';
  if kind = 'strike' then
    select s.rule, s.reason, s.issued_at, s.withdrawn_at, s.withdrawn_reason, s.member_id, m.display_name
      into rule, reason, given_at, withdrawn_at, withdrawn_reason, member_id, member_name
      from public.member_strikes s
      left join public.members m on m.id = s.member_id
     where s.id = strike;
  else
    select f.rule, f.reason, f.flagged_at, f.withdrawn_at, f.withdrawn_reason,
           left(coalesce(rb.body, p.body), 2000), t.title,
           case when t.id is not null then '/chat/rooms/' || t.room_id || '/topics/' || t.id::text
                  || coalesce('?post=' || p.id::text, '') end
      into rule, reason, given_at, withdrawn_at, withdrawn_reason, words, place, url
      from private.chat_anonymous_flags f
      left join public.chat_posts p on p.id = f.post_id
      left join public.chat_removed_bodies rb on rb.post_id = f.post_id
      left join public.chat_topics t on t.id = p.topic_id
     where f.id = strike;
  end if;
  return next;
end;
$$;

comment on function public.strike_summary(text, uuid) is
  'A strike (kind ''strike'') or a flag (kind ''flag''), for the member it is against or an administrator. A flag never says whose it is. See 20261120120000.';

revoke all on function public.strike_summary(text, uuid) from public, anon;
grant execute on function public.strike_summary(text, uuid) to authenticated;

-- The conversation about it, oldest first. The member reads "You" and "An
-- administrator"; an administrator reads "You", the other administrators'
-- names, and the member's name, or "The writer" on a flag.
create or replace function public.strike_thread(kind text, strike uuid)
returns table (id uuid, mine boolean, from_member boolean, author text, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reader text := private.strike_reader(kind, strike);
begin
  return query
    select sm.id,
           coalesce(sm.author_id = auth.uid(), false),
           sm.from_member,
           case
             when sm.author_id = auth.uid() then 'You'
             when reader = 'member' then 'An administrator'
             when sm.from_member and kind = 'flag' then 'The writer'
             else coalesce(a.display_name, case when sm.from_member then 'The member' else 'An administrator' end)
           end,
           sm.body, sm.created_at
      from private.strike_messages sm
      left join public.members a on a.id = sm.author_id
     where (kind = 'strike' and sm.strike_id = strike)
        or (kind = 'flag' and sm.flag_id = strike)
     order by sm.created_at, sm.id;
end;
$$;

comment on function public.strike_thread(text, uuid) is
  'The conversation about a strike or flag, oldest first. A flag''s writer is "The writer" to administrators. See 20261120120000.';

revoke all on function public.strike_thread(text, uuid) from public, anon;
grant execute on function public.strike_thread(text, uuid) to authenticated;

-- Answer, as the member or as an administrator. The other side is told: the
-- member, or every administrator but the one answering.
create or replace function public.strike_reply(kind text, strike uuid, message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reader text := private.strike_reader(kind, strike);
  owner uuid := private.strike_owner(kind, strike);
  said text := nullif(btrim(coalesce(message, '')), '');
  strike_rule text;
  sent uuid;
begin
  if said is null then
    raise exception 'Write something first.' using errcode = '22023';
  end if;
  if char_length(said) > 2000 then
    raise exception 'Keep it under 2,000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from private.strike_messages sm
       where sm.author_id = auth.uid() and sm.created_at > now() - interval '1 day'
         and ((kind = 'strike' and sm.strike_id = strike) or (kind = 'flag' and sm.flag_id = strike))) >= 20 then
    raise exception 'That is a lot for one day. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into private.strike_messages (strike_id, flag_id, from_member, author_id, body)
  values (case when kind = 'strike' then strike end, case when kind = 'flag' then strike end,
          reader = 'member', auth.uid(), said)
  returning id into sent;

  if kind = 'strike' then
    select s.rule into strike_rule from public.member_strikes s where s.id = strike;
  else
    select f.rule into strike_rule from private.chat_anonymous_flags f where f.id = strike;
  end if;

  if reader = 'member' then
    perform private.notify_strike(a.id, 'strike_message', kind, strike, strike_rule, null)
       from public.members a
      where a.is_admin and a.status = 'active' and a.id <> owner;
  else
    perform private.notify_strike(owner, 'strike_message', kind, strike, strike_rule, null);
  end if;
  return sent;
end;
$$;

comment on function public.strike_reply(text, uuid, text) is
  'The member, or an administrator, answers about a strike or flag; the other side is told. See 20261120120000.';

revoke all on function public.strike_reply(text, uuid, text) from public, anon;
grant execute on function public.strike_reply(text, uuid, text) to authenticated;

-- Administrators' list: every strike and flag of the last year, and any older
-- one somebody has written about, latest activity first. member_name is null
-- on a flag.
create or replace function public.admin_strike_threads()
returns table (
  kind text, id uuid, rule text, reason text, given_at timestamptz, withdrawn_at timestamptz,
  member_name text, messages integer, last_at timestamptz, waiting boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;
  return query
    with said as (
      select coalesce(sm.strike_id, sm.flag_id) as about, count(*)::integer as n, max(sm.created_at) as last_at,
             (array_agg(sm.from_member order by sm.created_at desc))[1] as last_from_member
        from private.strike_messages sm
       group by 1
    ), given_ones as (
      select 'strike'::text as kind, s.id, s.rule, s.reason, s.issued_at as given_at, s.withdrawn_at,
             m.display_name as member_name
        from public.member_strikes s
        left join public.members m on m.id = s.member_id
      union all
      select 'flag', f.id, f.rule, f.reason, f.flagged_at, f.withdrawn_at, null
        from private.chat_anonymous_flags f
    )
    select e.kind, e.id, e.rule, e.reason, e.given_at, e.withdrawn_at, e.member_name,
           coalesce(said.n, 0), said.last_at, coalesce(said.last_from_member, false)
      from given_ones e
      left join said on said.about = e.id
     where e.given_at > now() - public.strike_window() or said.n is not null
     order by greatest(e.given_at, said.last_at) desc nulls last
     limit 200;
end;
$$;

comment on function public.admin_strike_threads() is
  'Every strike and flag of the last year for administrators, with its conversation''s size and whether the member spoke last. See 20261120120000.';

revoke all on function public.admin_strike_threads() from public, anon;
grant execute on function public.admin_strike_threads() to authenticated;

-- ---------------------------------------------------------------- taking it back

-- Withdrawing a named strike also undoes a pause it was needed for, and tells
-- the member.
create or replace function public.admin_withdraw_strike(strike uuid, withdraw_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  strike_rule text;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator';
  end if;
  if length(btrim(coalesce(withdraw_reason, ''))) = 0 then
    raise exception 'Withdrawing a strike needs a reason';
  end if;

  update public.member_strikes
     set withdrawn_at = now(), withdrawn_reason = btrim(withdraw_reason)
   where id = strike and withdrawn_at is null
  returning member_id, rule into owner, strike_rule;

  if not found then
    raise exception 'No such strike, or it is already withdrawn';
  end if;

  perform 1 from public.members m where m.id = owner for update;
  perform private.recheck_strike_pauses(owner);
  perform private.notify_strike(owner, 'strike_withdrawn', 'strike', strike, strike_rule, null);
end;
$$;

-- Withdrawing a flag undoes it all: the post comes back as it was (its
-- photographs too, if they are still there), the strike stops counting, and
-- so do the anonymous-posting pause and any 30-day pause it brought about.
create or replace function public.admin_withdraw_flag(flag uuid, withdraw_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.chat_anonymous_flags;
  why text := nullif(btrim(coalesce(withdraw_reason, '')), '');
  kept public.chat_removed_bodies;
  topic uuid;
begin
  if not public.is_admin() then
    raise exception 'Not an administrator' using errcode = '42501';
  end if;
  if why is null then
    raise exception 'Say why it is withdrawn: the person who wrote it is told.' using errcode = '22023';
  end if;
  if char_length(why) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = '22023';
  end if;

  select * into target from private.chat_anonymous_flags f where f.id = flag for update;
  if not found or target.withdrawn_at is not null then
    raise exception 'No such flag, or it is already withdrawn' using errcode = 'P0002';
  end if;
  perform 1 from public.members m where m.id = target.member_id for update;

  update private.chat_anonymous_flags
     set withdrawn_at = clock_timestamp(), withdrawn_reason = why, withdrawn_by = auth.uid()
   where id = flag;

  if target.post_id is not null then
    select * into kept from public.chat_removed_bodies rb where rb.post_id = target.post_id;
    if found then
      update public.chat_posts p
         set body = kept.body,
             attachments = array(
               select a from unnest(coalesce(kept.attachments, '{}')) with ordinality as k(a, n)
                where exists (select 1 from storage.objects o where o.bucket_id = 'chat' and o.name = k.a)
                order by k.n
             ),
             removed_at = null,
             removed_by_admin = false
       where p.id = target.post_id and p.removed_at is not null
      returning p.topic_id into topic;
      if topic is not null then
        delete from public.chat_removed_bodies rb where rb.post_id = target.post_id;
        update public.chat_topics t
           set reply_count = public.chat_topic_reply_count(topic)
         where t.id = topic;
      end if;
    end if;
  end if;

  perform private.recheck_strike_pauses(target.member_id);

  -- The flag's notice has had its say; the withdrawal is the news now.
  update public.notifications n
     set read_at = now()
   where n.member_id = target.member_id and n.kind = 'anonymous_flagged'
     and n.post_id = target.post_id and n.read_at is null;
  perform private.notify_strike(target.member_id, 'strike_withdrawn', 'flag', flag, target.rule, null);
end;
$$;

comment on function public.admin_withdraw_flag(uuid, text) is
  'An administrator takes a flag back: the post returns, and the strike and what it cost stop counting. The writer is told why. See 20261120120000.';

revoke all on function public.admin_withdraw_flag(uuid, text) from public, anon;
grant execute on function public.admin_withdraw_flag(uuid, text) to authenticated;

-- ---------------------------------------------------------------- reading the notices

-- The strike notices: their rule's reason or the latest answer, and the way to
-- the conversation. A flag's notice leads there too.
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
           when n.kind in ('reply', 'reply_participant', 'like', 'reaction', 'mention', 'anonymous_flagged') then tp.title
           when n.kind in ('event_reminder', 'event_starting', 'check_in_reminder', 'event_followup', 'event_notice', 'checked_in') then ev.title
           when n.kind in ('org_events', 'grant_open', 'invite_request', 'join_request') then o.name
           when n.kind = 'invite_joined' then j.display_name
           when n.kind = 'calendar_invite' then ci.payload ->> 'title'
           when n.kind = 'organization_request' then orq.draft ->> 'name'
           -- Who they are being introduced to; to the partner, the group.
           when n.kind = 'introduction' and n.detail = 'opened' and t.id is not null then t.name
           when n.kind = 'introduction' then ox.display_name
           -- What the actor is to the reader (20261107100000).
           -- To an administrator, who answered: the member, or on a flag the writer.
           when n.kind = 'strike_message' and public.is_admin()
                and private.strike_owner(split_part(n.detail, ':', 1), split_part(n.detail, ':', 2)::uuid)
                    is distinct from n.member_id then
             coalesce((select sm.display_name from public.member_strikes s
                         join public.members sm on sm.id = s.member_id
                        where split_part(n.detail, ':', 1) = 'strike'
                          and s.id = split_part(n.detail, ':', 2)::uuid), 'The writer')
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
           -- The writer's own words, kept when the post was hidden.
           when n.kind = 'anonymous_flagged' then left(nullif(btrim(rb.body), ''), 160)
           when n.kind = 'strike_message' then
             (select left(sm.body, 160) from private.strike_messages sm
               where coalesce(sm.strike_id, sm.flag_id) = split_part(n.detail, ':', 2)::uuid
                 and sm.author_id is distinct from n.member_id
               order by sm.created_at desc limit 1)
           when n.kind = 'strike_given' then
             (select left(s.reason, 160) from public.member_strikes s where s.id = split_part(n.detail, ':', 2)::uuid)
           when n.kind = 'strike_withdrawn' and split_part(n.detail, ':', 1) = 'strike' then
             (select left(s.withdrawn_reason, 160) from public.member_strikes s where s.id = split_part(n.detail, ':', 2)::uuid)
           when n.kind = 'strike_withdrawn' then
             (select left(fl2.withdrawn_reason, 160) from private.chat_anonymous_flags fl2 where fl2.id = split_part(n.detail, ':', 2)::uuid)
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
           when n.kind = 'anonymous_flagged' then coalesce(
             '/strikes/flag/' || (select fl2.id::text from private.chat_anonymous_flags fl2
                                   where fl2.post_id = n.post_id order by fl2.flagged_at desc limit 1),
             '/chat/rooms/' || tp.room_id || '/topics/' || tp.id::text)
           when n.kind in ('strike_message', 'strike_given', 'strike_withdrawn') then
             '/strikes/' || split_part(n.detail, ':', 1) || '/' || split_part(n.detail, ':', 2)
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
    left join public.chat_removed_bodies rb on rb.post_id = n.post_id and n.kind = 'anonymous_flagged'
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
       when n.kind = 'strike_message' then public.is_admin()
         or private.strike_owner(split_part(n.detail, ':', 1), split_part(n.detail, ':', 2)::uuid) = auth.uid()
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
