-- Undo for 20261122090000_admin_site_watches_the_club.sql. Safe under a live
-- website: an app that still sends its crashes gets "no such function", which
-- it ignores, and push-notify logs a failed delivery note and carries on.
--
-- Note: on the test project, after applying the migration, the watched app is
-- the test site: update private.watch_settings set app_origin = 'https://tests.thesciclub.com';

select cron.unschedule('watch-the-app');
select cron.unschedule('tidy-admin-watch');
drop function public.admin_deliveries(integer, text);
drop function public.log_push_deliveries(text, jsonb);
drop table public.delivery_log;
drop function public.admin_app_errors(integer);
drop function public.log_app_errors(jsonb);
drop table public.app_errors;
drop function public.push_admin_alert_owed(text, jsonb);
drop function public.admin_uptime(integer);
drop function private.watch_the_app();
drop function private.alert_admins(text, text);
drop table private.admin_alerts;
drop table private.uptime_checks;
drop table private.watch_settings;
drop function public.admin_plan_usage();
notify pgrst, 'reload schema';
