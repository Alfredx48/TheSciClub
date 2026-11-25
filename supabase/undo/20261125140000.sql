-- Undo 20261125140000: the change log's ready ticks. The admin site's On tests then says the
-- ticks are not available, and shows no column for them.
drop function if exists public.admin_mark_change_ready(text, boolean);
drop function if exists public.admin_change_log_ready();
drop table if exists public.change_log_ready;
