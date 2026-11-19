\set ON_ERROR_STOP on
begin;

insert into public.members (id, type, status, display_name, phone, birth_date, level_range, state)
values
  ('fca00000-0000-0000-0000-000000000001', 'peer', 'active', 'Android Ada', '19990230011', '1980-01-01', 'T1–T6', 'CA'),
  ('fca00000-0000-0000-0000-000000000002', 'peer', 'active', 'Android Bo', '19990230012', '1980-01-01', 'T1–T6', 'CA'),
  ('fca00000-0000-0000-0000-000000000003', 'peer', 'suspended', 'Android Pat', '19990230013', '1980-01-01', 'T1–T6', 'CA');

set local role authenticated;

do $$
declare
  ada uuid := 'fca00000-0000-0000-0000-000000000001';
  bo uuid := 'fca00000-0000-0000-0000-000000000002';
  pat uuid := 'fca00000-0000-0000-0000-000000000003';
  installation uuid := 'fca00000-0000-0000-0000-000000000011';
  other_installation uuid := 'fca00000-0000-0000-0000-000000000012';
  removed int;
begin
  assert not has_function_privilege('anon', 'public.push_subscribe_fcm(text,uuid,text)', 'execute');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ada, 'role', 'authenticated')::text, true);
  perform public.push_subscribe_fcm('AbC:First_Token', installation);
  perform public.push_subscribe_app(repeat('ab', 32), 'production');
  perform public.push_subscribe_fcm('AbC:Rotated_Token', installation);
  assert (select count(*) from public.push_subscriptions where fcm_installation = installation) = 1;
  assert (select endpoint from public.push_subscriptions where fcm_installation = installation)
    = 'fcm:AbC:Rotated_Token';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', bo, 'role', 'authenticated')::text, true);
  assert not exists (select from public.push_subscriptions where fcm_installation = installation);
  delete from public.push_subscriptions where fcm_installation = installation;
  get diagnostics removed = row_count;
  assert removed = 0;

  perform public.push_subscribe_fcm('Bo:New_Token', installation);
  assert (select endpoint from public.push_subscriptions where fcm_installation = installation)
    = 'fcm:Bo:New_Token';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', ada, 'role', 'authenticated')::text, true);
  assert (select count(*) from public.push_subscriptions where member_id = ada) = 1;
  assert exists (select from public.push_subscriptions where endpoint = 'apns:production:' || repeat('ab', 32));
  begin
    perform public.push_subscribe_fcm('https://example.com/device', other_installation);
    raise exception 'Accepted a URL as an FCM token';
  exception when raise_exception then
    assert sqlerrm = 'This phone sent a token the club could not use.';
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', pat, 'role', 'authenticated')::text, true);
  begin
    perform public.push_subscribe_fcm('Pat:Paused_Token', other_installation);
    raise exception 'Accepted a paused member';
  exception when raise_exception then
    assert sqlerrm = 'Notifications cannot be turned on while your membership is paused.';
  end;
end;
$$;

rollback;
