insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values ('aaaaaaaa-7f7f-0000-0000-00000000000a', 'peer', 'active', 'Probe admin', '19990007f01', '1980-01-01', 'T1–T6', 'CA', 'Oakland', true);

\echo '1. a list with phones: expect 3 added'
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-7f7f-0000-0000-00000000000a","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select jsonb_array_length(public.admin_invite_list(
  '[{"email":"probe-phone-1@example.com","name":"Ana","phone":"(555) 010-1234"},
    {"email":"probe-phone-2@example.com","name":"Bo"},
    {"email":"probe-phone-3@example.com","name":"Cy","phone":"123456789012345678901234567890123"}]'::jsonb,
  null, null)) as reported;
reset role;

\echo '2. kept: expect (555) 010-1234, null, null (too long left off)'
select email::text, invitee_name, invitee_phone from public.invites
 where email::text like 'probe-phone-%' order by email::text;

\echo '3. the old call shape (no phone key) still works: expect added'
set local role authenticated;
select public.admin_invite_list('[{"email":"probe-phone-4@example.com","name":"Dee"}]'::jsonb) ->0->>'outcome' as outcome;
reset role;

\echo '4. the link answers the phone: expect probe-phone-1, Ana, (555) 010-1234'
update public.invites set token_hash = encode(extensions.digest('probe-phone-token', 'sha256'), 'hex')
 where email::text = 'probe-phone-1@example.com';
set local role anon;
select * from public.invite_details_for_token('probe-phone-token');
reset role;

\echo '5. a member cannot read the column: expect ERROR or 0 rows'
insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state, city, is_admin)
values ('aaaaaaaa-7f7f-0000-0000-00000000000b', 'peer', 'active', 'Probe member', '19990007f02', '1980-01-01', 'T1–T6', 'CA', 'Oakland', false);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-7f7f-0000-0000-00000000000b","role":"authenticated"}', true) is not null as ok;
set local role authenticated;
select count(*) as seen from public.invites where email::text = 'probe-phone-1@example.com';
reset role;
