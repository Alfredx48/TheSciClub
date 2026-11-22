-- Undo for 20261122040000_request_logs.sql: the club stops keeping request
-- logs and query timings, and everything kept so far goes. Nothing in the
-- app reads them, so this can be run under a live website. Then remove the
-- vault's request_logs_url and request_logs_secret, and the
-- copy-request-logs function (supabase functions delete copy-request-logs).

do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('copy-request-logs', 'snapshot-query-stats', 'tidy-request-logs');
end;
$$;

drop function private.tidy_request_logs();
drop function private.snapshot_query_stats();
drop function private.copy_request_logs();
drop function public.store_request_logs(text, jsonb);
drop table private.query_stats_last;
drop table private.request_log_keys;
drop table public.query_stats;
drop table public.request_log_5min;
drop table public.request_log;
