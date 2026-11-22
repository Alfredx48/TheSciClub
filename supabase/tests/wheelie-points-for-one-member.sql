-- ============================================================================
-- Wheelie points for one member (20261121090000)
-- ============================================================================
-- private.wheelie_ledger(member) is everybody's ledger cut down to that
-- member: the same points of each kind, for every member. Reads only, so it
-- can be run against the test project as well as a local one.
--
--   psql "<database url>" -f supabase/tests/wheelie-points-for-one-member.sql
--
-- Rolls back.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

\echo ''
\echo '== 1. every member, the same points of each kind either way (expect 0 | 0) =='
with
everybody as (
  select l.member_id, l.kind, l.points, l.at, l.topic_id, l.post_id, l.event_id
    from private.wheelie_ledger() l
),
each_one as (
  select l.member_id, l.kind, l.points, l.at, l.topic_id, l.post_id, l.event_id
    from public.members m
    cross join lateral private.wheelie_ledger(m.id) l
)
select (select count(*) from (select * from everybody except all select * from each_one) d) as only_everybody,
       (select count(*) from (select * from each_one except all select * from everybody) d) as only_one;

\echo ''
\echo '== 2. no member at all is everybody (expect true) =='
select (select count(*) from private.wheelie_ledger(null::uuid))
     = (select count(*) from private.wheelie_ledger()) as same;

\echo ''
\echo '== 3. a member cannot call it (expect: permission denied) =='
set local role authenticated;
select count(*) from private.wheelie_ledger(null::uuid);

rollback;
