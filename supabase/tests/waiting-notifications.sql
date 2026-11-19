-- ============================================================================
-- What waits on a member stays on top, and is emailed after a day
-- (20261119100000)
-- ============================================================================
-- Rep speaks for an organization that Asker asks to join, and holds a
-- calendar invitation. Admin has a report to look at.
--
-- Expect, in the one row it answers:
--   rep_waits:        calendar_invite, join_request (count 1, Asker)
--   rep_after_read:   the same two: reading answers nothing
--   asker_waits: none; admin_waits holds no join request (not theirs)
--   admin_waits:      report; admin_after_resolve: 0
--   rep_after_answer: calendar_invite only, once Asker's request is answered
--   emailed_first:    1 (Rep, listing the calendar invitation); emailed_again: 0
--   forget_kept:      the waiting row; forget_dropped: the old answered one
--
--   docker run --rm -i --network host -e PGPASSWORD=postgres postgres:17-alpine \
--     psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f - < supabase/tests/waiting-notifications.sql
--
-- Rolls back. Do not point it at the hosted project.
-- ============================================================================

begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-1119-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'waiting-rep@probe.example', now());
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values
  ('aaaaaaaa-1119-0000-0000-00000000000a', 'peer', 'active', 'Rep',   '19990011191', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', false),
  ('bbbbbbbb-1119-0000-0000-00000000000b', 'peer', 'active', 'Asker', '19990011192', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', false),
  ('cccccccc-1119-0000-0000-00000000000c', 'peer', 'active', 'Admin', '19990011193', '1980-01-01', 'T1–T6', 'CA', 'Sacramento', true);
insert into public.organizations (id, short_code, name, city) values
  ('dddddddd-1119-0000-0000-00000000000d', 'WAIT', 'Probe Waiting Org', 'Sacramento');
insert into public.organization_representatives (organization_id, member_id) values
  ('dddddddd-1119-0000-0000-00000000000d', 'aaaaaaaa-1119-0000-0000-00000000000a');

-- Asker asks to join: the trigger tells Rep.
insert into public.organization_join_requests (organization_id, member_id, requested_at) values
  ('dddddddd-1119-0000-0000-00000000000d', 'bbbbbbbb-1119-0000-0000-00000000000b', now() - interval '2 hours');

-- A held invitation from Rep's calendar, two days old.
insert into public.calendar_invites (id, uid, sequence, sender_email, sender_member_id, verified, state, payload, received_at)
values ('eeeeeeee-1119-0000-0000-00000000000e', 'probe-waiting@google.com', 0, 'waiting-rep@probe.example',
        'aaaaaaaa-1119-0000-0000-00000000000a', true, 'held', '{"title": "Probe Weekly"}', now() - interval '2 days');
-- Its own trigger may already have told Rep.
delete from public.notifications where calendar_invite_id = 'eeeeeeee-1119-0000-0000-00000000000e';
insert into public.notifications (member_id, kind, tag, calendar_invite_id, detail, created_at)
values ('aaaaaaaa-1119-0000-0000-00000000000a', 'calendar_invite', 'calendar_invite:eeeeeeee-1119-0000-0000-00000000000e',
        'eeeeeeee-1119-0000-0000-00000000000e', 'choose', now() - interval '2 days');

-- A report for Admin.
insert into public.chat_reports (id, kind, reporter_id, reported_author_id, body_snapshot, written_at, place, context_kind)
values ('ffffffff-1119-0000-0000-00000000000f', 'block', 'bbbbbbbb-1119-0000-0000-00000000000b',
        'aaaaaaaa-1119-0000-0000-00000000000a', '', now(), 'Probe', 'member');
insert into public.notifications (member_id, kind, tag, report_id)
select 'cccccccc-1119-0000-0000-00000000000c', 'report', 'report:ffffffff-1119-0000-0000-00000000000f',
       'ffffffff-1119-0000-0000-00000000000f'
 where not exists (
   select 1 from public.notifications n
    where n.member_id = 'cccccccc-1119-0000-0000-00000000000c' and n.report_id = 'ffffffff-1119-0000-0000-00000000000f'
 );

-- An answered request from long ago, and a waiting one as old.
insert into public.notifications (member_id, kind, tag, detail, created_at, read_at)
values ('aaaaaaaa-1119-0000-0000-00000000000a', 'calendar_invite', 'calendar_invite:old', 'added',
        now() - interval '40 days', now() - interval '40 days');

create temporary table pr (step text, r jsonb);
grant insert, select on pr to authenticated, service_role;

create function pg_temp.as_member(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', member::text, true);
$$;

create function pg_temp.waits() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'count', w.count, 'actor', w.actor_name,
                                               'place', w.place, 'url', w.url) order by w.kind), '[]')
    from public.my_waiting_notifications() w;
$$;

select pg_temp.as_member('aaaaaaaa-1119-0000-0000-00000000000a');
set local role authenticated;
insert into pr select 'rep_waits', pg_temp.waits();
reset role;

update public.notifications set read_at = now()
 where member_id = 'aaaaaaaa-1119-0000-0000-00000000000a' and read_at is null;

select pg_temp.as_member('aaaaaaaa-1119-0000-0000-00000000000a');
set local role authenticated;
insert into pr select 'rep_after_read', pg_temp.waits();
reset role;

select pg_temp.as_member('bbbbbbbb-1119-0000-0000-00000000000b');
set local role authenticated;
insert into pr select 'asker_waits', pg_temp.waits();
reset role;

select pg_temp.as_member('cccccccc-1119-0000-0000-00000000000c');
set local role authenticated;
insert into pr select 'admin_waits', pg_temp.waits();
reset role;

update public.chat_reports set resolved_at = now() where id = 'ffffffff-1119-0000-0000-00000000000f';
select pg_temp.as_member('cccccccc-1119-0000-0000-00000000000c');
set local role authenticated;
insert into pr select 'admin_after_resolve', pg_temp.waits();
reset role;

-- Asker is let in (or turned away): the request goes.
delete from public.organization_join_requests where member_id = 'bbbbbbbb-1119-0000-0000-00000000000b';
select pg_temp.as_member('aaaaaaaa-1119-0000-0000-00000000000a');
set local role authenticated;
insert into pr select 'rep_after_answer', pg_temp.waits();
reset role;

-- The email: only this probe's members, so the test project's own waiting
-- members are recorded as already emailed first.
insert into private.waiting_emailed (notification_id, member_id)
select n.id, n.member_id from public.notifications n
 where n.member_id not in ('aaaaaaaa-1119-0000-0000-00000000000a', 'cccccccc-1119-0000-0000-00000000000c')
   and private.notification_waiting_since(n) is not null
on conflict do nothing;

set local role service_role;
insert into pr select 'emailed_first', coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'items', e.items)), '[]')
  from public.waiting_emails((select decrypted_secret from vault.decrypted_secrets where name = 'push_notify_secret'), '{}') e;
insert into pr select 'emailed_again', coalesce(jsonb_agg(e.name), '[]')
  from public.waiting_emails((select decrypted_secret from vault.decrypted_secrets where name = 'push_notify_secret'), '{}') e;
reset role;

update public.notifications set created_at = now() - interval '40 days'
 where calendar_invite_id = 'eeeeeeee-1119-0000-0000-00000000000e';
select public.notifications_forget();

select jsonb_build_object(
  'steps', (select jsonb_object_agg(step, r) from pr),
  'forget_kept', exists (select 1 from public.notifications where calendar_invite_id = 'eeeeeeee-1119-0000-0000-00000000000e'),
  'forget_dropped', not exists (select 1 from public.notifications where tag = 'calendar_invite:old')
) as result;

rollback;
