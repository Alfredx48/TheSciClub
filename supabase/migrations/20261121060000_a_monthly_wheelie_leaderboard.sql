-- ============================================================================
-- The monthly Wheelie points leaderboard, and the Hall of Top Wheelies
-- ============================================================================
-- The owner, 2026-11-20: "go ahead with the leaderboard, I assume it is
-- monthly", as the 2-pager has it: a leaderboard ranks members by the
-- Wheelie points they earned that month, and resets every month (the wheel's
-- level does not). At the end of each month the top ten are enshrined in the
-- Hall of Top Wheelies.
--
-- The months are Pacific, as public.member_wheelies' month is.
--
-- Who is ranked: members who earn points (not organizations or directory
-- listings, as private.wheelie_ledger has it) and are active, so a paused or
-- removed member drops off. Ranks are the same for everybody; a member the
-- reader has blocked is left out of what they are shown, without moving
-- anybody else's rank. Ties share a rank, so a month can have more than ten
-- top wheelers when the tenth place is shared.
--
-- The hall starts with November 2026, the month Wheelie points began: the
-- months before it had no streaks and nobody was playing.
--
-- Expand only: a new table, functions and a cron job.
-- ============================================================================

create table public.wheelie_month_winners (
  month date not null,
  member_id uuid not null references public.members (id) on delete cascade,
  rank integer not null,
  points integer not null,
  recorded_at timestamptz not null default now(),
  primary key (month, member_id)
);
alter table public.wheelie_month_winners enable row level security;
revoke all on public.wheelie_month_winners from anon, authenticated;
grant select on public.wheelie_month_winners to authenticated;
create policy "Members read the Hall of Top Wheelies" on public.wheelie_month_winners
  for select to authenticated using (true);

-- Each member's points earned in one Pacific month.
create function private.wheelie_month_points(p_month date)
returns table (member_id uuid, points integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.member_id, sum(l.points)::integer
    from private.wheelie_ledger() l
   where (l.at at time zone 'America/Los_Angeles')::date >= p_month
     and (l.at at time zone 'America/Los_Angeles')::date < (p_month + interval '1 month')::date
   group by l.member_id
  having sum(l.points) > 0;
$$;
revoke all on function private.wheelie_month_points(date) from public, anon, authenticated;

-- Last month's top ten, once. Run every hour, so a month is recorded within
-- an hour of its end, and a run that fails is made up by the next. p_now is
-- for supabase/tests/wheelie-leaderboard.sql to say when it is.
create function private.record_wheelie_winners(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_month date := (date_trunc('month', p_now at time zone 'America/Los_Angeles')
                      - interval '1 month')::date;
  recorded integer;
begin
  if last_month < date '2026-11-01'
     or exists (select 1 from public.wheelie_month_winners w where w.month = last_month) then
    return 0;
  end if;
  insert into public.wheelie_month_winners (month, member_id, rank, points)
  select last_month, r.member_id, r.rank, r.points
    from (
      select p.member_id, p.points, (rank() over (order by p.points desc))::integer as rank
        from private.wheelie_month_points(last_month) p
        join public.members m on m.id = p.member_id and m.status = 'active'
    ) r
   where r.rank <= 10;
  get diagnostics recorded = row_count;
  return recorded;
end;
$$;
revoke all on function private.record_wheelie_winners(timestamptz) from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'record-wheelie-winners';
  perform cron.schedule('record-wheelie-winners', '7 * * * *', 'select private.record_wheelie_winners()');
end; $$;

-- This month's leaderboard: the top fifty, and where the reader stands.
create function public.wheelie_leaderboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  this_month date := date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
  blocked uuid[];
  result jsonb;
begin
  if not public.is_member() then
    raise exception 'Only a member can see the leaderboard.' using errcode = '42501';
  end if;
  blocked := public.my_blocked_member_ids();

  with board as (
    select w.member_id, w.month_points as points,
           (rank() over (order by w.month_points desc))::integer as rank
      from public.member_wheelies w
      join public.members m on m.id = w.member_id and m.status = 'active'
     where w.month = this_month and w.month_points > 0
  ),
  shown as (
    select b.* from board b where not (b.member_id = any (blocked))
     order by b.rank, b.member_id
     limit 50
  )
  select jsonb_build_object(
           'month', this_month,
           'top', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'member_id', s.member_id, 'rank', s.rank, 'points', s.points
                    ) order by s.rank, s.member_id)
               from shown s
           ), '[]'),
           'me', (
             select jsonb_build_object('rank', b.rank, 'points', b.points)
               from board b where b.member_id = me
           )
         )
    into result;
  return result;
end;
$$;
revoke all on function public.wheelie_leaderboard() from public, anon;
grant execute on function public.wheelie_leaderboard() to authenticated;

-- The Hall of Top Wheelies, newest month first: without members since
-- removed, or ones the reader has blocked.
create function public.wheelie_hall()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'Only a member can see the Hall of Top Wheelies.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'month', w.month, 'member_id', w.member_id, 'rank', w.rank, 'points', w.points
           ) order by w.month desc, w.rank, w.member_id)
      from public.wheelie_month_winners w
      join public.members m on m.id = w.member_id and m.status <> 'removed'
     where not (w.member_id = any (public.my_blocked_member_ids()))
  ), '[]');
end;
$$;
revoke all on function public.wheelie_hall() from public, anon;
grant execute on function public.wheelie_hall() to authenticated;
