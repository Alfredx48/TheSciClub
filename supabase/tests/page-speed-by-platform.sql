-- Run after 20261123093000. All samples are rolled back.
begin;

select public.log_page_speed('[
  {"visit":"platform-probe-01","kind":"load","screen":"/home","metric":"first-paint","ms":100,"platform":"ios-app","release":"2099-01-01T00:00"},
  {"visit":"platform-probe-02","kind":"load","screen":"/home","metric":"first-paint","ms":120,"platform":"ios-app","release":"2099-01-01T00:00"},
  {"visit":"platform-probe-03","kind":"load","screen":"/home","metric":"first-paint","ms":200,"platform":"home-screen","release":"2099-01-01T00:00"},
  {"visit":"platform-probe-04","kind":"load","screen":"/home","metric":"first-paint","ms":300,"release":"2099-01-01T00:00"},
  {"visit":"platform-probe-05","kind":"load","screen":"/home","metric":"cards-after-tap","ms":250,"platform":"ios-app","release":"2099-01-01T00:00"},
  {"visit":"platform-probe-06","kind":"load","screen":"/home","metric":"first-paint","ms":400,"platform":"invalid","release":"2099-01-01T00:00"},
  {"visit":"platform-probe-07","kind":"load","screen":"/home","metric":"first-paint","ms":980,"ok":false,"platform":"ios-app","release":"2099-01-01T00:00"}
]'::jsonb);

do $$
declare
  administrator uuid;
begin
  if has_function_privilege('anon', 'public.admin_page_speed_by_platform(integer)', 'execute') then
    raise exception 'Anonymous clients can read the comparison';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.admin_page_speed_by_platform(30);
    raise exception 'A non-admin read the comparison';
  exception when insufficient_privilege then null;
  end;

  select id into strict administrator from public.members where is_admin and status = 'active' limit 1;
  perform set_config('request.jwt.claim.sub', administrator::text, true);
  if (select count(*) from public.admin_page_speed_by_platform(30)
      where release = '2099-01-01T00:00') <> 4 then
    raise exception 'The comparison did not group timing and platform separately';
  end if;
  if not exists (select from public.admin_page_speed_by_platform(30)
      where release = '2099-01-01T00:00' and platform = 'ios-app' and metric = 'first-paint'
        and samples = 2 and p50_ms = 110 and p90_ms = 118) then
    raise exception 'Native percentiles included another platform, failed samples or another metric';
  end if;
  if not exists (select from public.admin_page_speed_by_platform(30)
      where release = '2099-01-01T00:00' and platform = 'unknown' and samples = 2) then
    raise exception 'Old and invalid platform values were not kept unknown';
  end if;
end;
$$;

rollback;
