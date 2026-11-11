-- Undo for 20261110120000_in_now_when_invited_or_open.sql. Accounts already
-- made this way stay; invite-signup must be redeployed without mayJoin first.
drop function if exists public.email_may_join_now(text);
