-- Undo for 20261122050000_admins_read_request_logs.sql: Admin's Server view
-- stops reading the request logs (it says it could not load). The logs
-- themselves stay. Can be run under a live website.

drop function public.admin_query_window(timestamptz, timestamptz);
drop function public.admin_request_visit(text, timestamptz);
drop function public.admin_request_window(timestamptz, timestamptz);
drop function public.admin_request_timeline(integer);
drop index public.request_log_visit_idx;
