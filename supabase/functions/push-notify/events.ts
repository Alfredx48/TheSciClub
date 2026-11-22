/**
 * The events push_notify_send may call with. Anything else is refused with
 * 400, which is how grant_open and profile_reminder went unsent for a day
 * (061dfb2); events.test.ts holds this to every push_notify_send in the
 * migrations.
 */
export const EVENTS: ReadonlySet<string> = new Set([
  'message',
  'post',
  'like',
  'reaction',
  'mention',
  'group_add',
  'report',
  'member_joined',
  'daily',
  'starting',
  'check_in_reminder',
  'event_followup',
  'calendar_invite',
  'organization_request',
  'day_before',
  'grant_open',
  'invite_request',
  'join_request',
  'profile_reminder',
  'blocks_weekly',
  'introduction',
  'event_notice',
  'family_link',
  // The administrators' own (20261122090000): the app down or failing.
  'admin_alert',
  'checked_in',
  'event_changed',
  'important',
  'waiting',
]);
