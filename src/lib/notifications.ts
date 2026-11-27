import { badgesChanged, NOTIFICATIONS_CHANGED, useBadgeCounts } from '@/lib/badges';
import { flagConsequence, readFlag } from '@/lib/chat/anonymous';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { familyAs } from '@/lib/family';
import { californiaToday, grantDay } from '@/lib/grants';
import { tellOtherTabs } from '@/lib/read-elsewhere';
import { ruleName } from '@/lib/strike-rules';
import { getSupabase } from '@/lib/supabase';
import { cancelledTitle, eventChangePhrase } from '../../supabase/functions/_shared/event-change';

/**
 * The notifications list (20261010000000): what each member was notified
 * about in the last thirty days, as it is now.
 *
 * Rows hold references and the database reads the words, names and
 * addresses when listed (my_notifications), so a post taken back shows no
 * words and a topic moved to another room opens there.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** How many arrived under this one while it was unread: messages, replies, likes. */
  count: number;
  createdAt: string;
  seen: boolean;
  read: boolean;
  actorId: string | null;
  actorName: string | null;
  actorPhoto: string | null;
  /** The conversation, topic, event, organization or member it is about. */
  place: string | null;
  /** The start of the message or post, while it stands. */
  excerpt: string | null;
  /** An event's start time, or how many new events. */
  detail: string | null;
  url: string;
}

export type NotificationKind =
  | 'direct'
  | 'group'
  | 'reply'
  | 'reply_participant'
  | 'like'
  | 'group_add'
  | 'report'
  | 'invite_joined'
  | 'event_reminder'
  | 'event_starting'
  | 'invite_request'
  | 'org_events'
  | 'grant_open'
  | 'profile_reminder'
  | 'blocks_weekly'
  | 'reaction'
  | 'mention'
  | 'join_request'
  | 'check_in_reminder'
  | 'event_followup'
  | 'calendar_invite'
  | 'organization_request'
  | 'introduction'
  | 'event_notice'
  | 'family_link'
  | 'checked_in'
  | 'event_changed'
  | 'important'
  | 'anonymous_flagged'
  | 'strike_given'
  | 'strike_message'
  | 'strike_withdrawn'
  | 'staff_verified'
  | 'event_join_request';

interface Row {
  id: string;
  kind: NotificationKind;
  count: number;
  created_at: string;
  seen: boolean;
  read: boolean;
  actor_id: string | null;
  actor_name: string | null;
  actor_photo: string | null;
  place: string | null;
  excerpt: string | null;
  detail: string | null;
  url: string | null;
}

/** How many a page asks for. */
export const NOTIFICATIONS_PAGE = 40;

function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    count: row.count,
    createdAt: row.created_at,
    seen: row.seen,
    read: row.read,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorPhoto: row.actor_photo,
    place: row.place,
    excerpt: row.excerpt,
    detail: row.detail,
    url: row.url ?? '/home',
  };
}

export async function loadNotifications(
  before: string | null = null,
): Promise<{ ok: true; notifications: AppNotification[] } | { ok: false; error: string }> {
  try {
    const { data, error } = (await getSupabase().rpc('my_notifications', {
      before,
      max_rows: NOTIFICATIONS_PAGE,
    })) as { data: Row[] | null; error: Failure | null };
    if (error) return { ok: false, error: describeError(error, 'Could not load notifications.') };
    return { ok: true, notifications: (data ?? []).map(toNotification) };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'Could not load notifications.') };
  }
}

/**
 * What still waits on the member to do something (20261119100000): a held
 * calendar invitation, somebody asking to join or for an invite, a report.
 * It stays until it is done, by them or anybody else, however often it is
 * read; oldest first.
 */
export interface WaitingNotification extends AppNotification {
  /** When the oldest thing still undone arrived. */
  waitingSince: string;
}

export async function loadWaitingNotifications(): Promise<
  { ok: true; notifications: WaitingNotification[] } | { ok: false; error: string }
> {
  try {
    const { data, error } = (await getSupabase().rpc('my_waiting_notifications')) as {
      data: (Row & { waiting_since: string })[] | null;
      error: Failure | null;
    };
    if (error) return { ok: false, error: describeError(error, 'Could not load notifications.') };
    return {
      ok: true,
      notifications: (data ?? []).map((row) => ({
        ...toNotification(row),
        waitingSince: row.waiting_since,
      })),
    };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'Could not load notifications.') };
  }
}

/** "Waiting 3 hours", "Waiting 2 days": how long it has waited, not when. */
export function waitingFor(since: string, now: Date = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(since).getTime()) / 3_600_000);
  if (!Number.isFinite(hours) || hours < 1) return 'Waiting under an hour';
  if (hours < 24) return `Waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The bell stops counting what is already listed. */
export async function markNotificationsSeen(): Promise<void> {
  await getSupabase().rpc('notifications_mark_seen');
}

/**
 * A pressed push: its tag came back in the address as `n`
 * (20261028900000), and clears that one thing only.
 */
export async function markNotificationsReadByTag(tag: string): Promise<void> {
  try {
    await getSupabase().rpc('notifications_mark_read_by_tag', { notification_tag: tag });
  } catch {
    // The next open of what it is about, or of the bell, clears it.
  }
}

/** One notification, or every one (no id). */
export async function markNotificationsRead(id?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getSupabase().rpc('notifications_mark_read', {
      notification: id ?? null,
    });
    return error
      ? { ok: false, error: describeError(error, 'Could not mark that read.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'Could not mark that read.') };
  }
}

/**
 * The number on the bell: arrived since the list was last opened. Live, so
 * a reply landing while somebody is on Home shows without a reload, and read
 * again whenever the app comes back to the front. Counted with the other
 * badges in one request (src/lib/badges.ts).
 *
 * `outsideChat` leaves out what the Chat tab's dot already says, for Me's.
 */
export function useUnseenNotifications(outsideChat = false): {
  count: number;
  /** False until the first count is back, so a bell knows a rise is news. */
  loaded: boolean;
  refresh: () => void;
} {
  const counts = useBadgeCounts();
  return {
    count: outsideChat ? counts.unseenOutsideChat : counts.unseen,
    loaded: counts.loaded,
    refresh: badgesChanged,
  };
}

export { NOTIFICATIONS_CHANGED };

/** Said by the list after it marks things seen or read. */
export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  tellOtherTabs();
}

/** In quotes, and short: a topic's title or an event's, inside a sentence. */
function quoted(place: string | null): string {
  if (!place) return 'a post';
  return `“${place.length > 60 ? `${place.slice(0, 59).trimEnd()}…` : place}”`;
}

/**
 * What a notification says, in the words a lock screen uses (compose.ts in
 * push-notify), with the count it gathered while unread.
 */
export function notificationSentence(n: AppNotification): string {
  const given = n.actorName?.trim() ?? '';
  const name = given === '' ? 'A member' : given;
  const more = n.count - 1;
  switch (n.kind) {
    case 'direct':
      return n.count > 1 ? `${n.count} messages from ${name}` : `Message from ${name}`;
    case 'group':
      return n.count > 1
        ? `${n.count} new messages in ${n.place ?? 'a group'}`
        : `${name} wrote in ${n.place ?? 'a group'}`;
    case 'reply':
      return n.count > 1
        ? `${n.count} new replies to your post ${quoted(n.place)}`
        : `${name} replied to your post ${quoted(n.place)}`;
    case 'reply_participant':
      return n.count > 1
        ? `${n.count} new replies in ${quoted(n.place)}`
        : `${name} replied in ${quoted(n.place)}`;
    case 'like':
      return more > 0
        ? `${name} and ${more} ${more === 1 ? 'other' : 'others'} liked what you wrote in ${quoted(n.place)}`
        : `${name} liked what you wrote in ${quoted(n.place)}`;
    // detail is 'message:👍' or 'post:👍' (20261028000000).
    case 'reaction': {
      const [target, ...rest] = (n.detail ?? '').split(':');
      const emoji = rest.join(':').trim();
      const what =
        target === 'message'
          ? `your message${n.place ? ` in ${n.place}` : ''}`
          : // A post or a reply under one (the owner's words, 2026-11-18):
            // the row does not always say which.
            target === 'topic'
            ? `your post ${quoted(n.place)}`
            : `what you wrote in ${quoted(n.place)}`;
      if (more > 0)
        return `${name} and ${more} ${more === 1 ? 'other' : 'others'} reacted to ${what}`;
      return emoji ? `${name} reacted ${emoji} to ${what}` : `${name} reacted to ${what}`;
    }
    // An @username in a post (20261029070000): once a post.
    case 'mention':
      return `${name} mentioned you in ${quoted(n.place)}`;
    // By a professional (20261029100000): detail 'asked', or 'opened' once
    // both said yes, when place is the group.
    case 'introduction':
      return n.detail === 'opened'
        ? `${name} said yes: ${n.place ?? 'your introduction'} is open`
        : `${name} would like to introduce you to ${n.place ?? 'another member'}`;
    // place is what the actor is to the reader (20261107100000).
    case 'family_link':
      return n.detail === 'linked'
        ? `${name} said yes: you are linked as family`
        : `${name} asked to be linked to you as family${familyAs(n.place)}`;
    case 'group_add':
      return `${name} added you to ${n.place ?? 'a group'}`;
    case 'report':
      return n.count > 1 ? `${n.count} new reports to look at` : 'A member reported something';
    case 'invite_joined': {
      // From an administrator's QR code, detail is 'qr:' and the event, if
      // any (20261014020000).
      if (n.detail?.startsWith('qr:')) {
        const event = n.detail.slice('qr:'.length);
        const who = n.place ?? 'Somebody';
        return event
          ? `${who} joined from your QR code at ${event}`
          : `${who} joined from your QR code`;
      }
      return `${n.place ?? 'Somebody you invited'} joined the club on your invite`;
    }
    case 'event_reminder':
      return n.detail
        ? `Tomorrow at ${n.detail}: ${n.place ?? 'an event you are going to'}`
        : `Tomorrow: ${n.place ?? 'an event you are going to'}`;
    // Ten minutes before (20261028980000).
    case 'event_starting':
      return n.detail
        ? `Starting at ${n.detail}: ${n.place ?? 'an event you are going to'}`
        : `Starting soon: ${n.place ?? 'an event you are going to'}`;
    // place is the organization, detail who asked (20261029030000).
    case 'invite_request':
      return n.count > 1
        ? `${n.count} people asked for an invite${n.place ? ` through ${n.place}` : ''}`
        : `${n.detail ?? 'Somebody'} asked you for an invite${n.place ? ` through ${n.place}` : ''}`;
    // An organizer ticked them as there: place is the event, detail the
    // organization it made them a member of (20261113120000).
    case 'checked_in':
      return n.detail
        ? `${name} checked you in to ${n.place ?? 'an event'}. You’re now a member of ${n.detail}`
        : `${name} checked you in to ${n.place ?? 'an event'}`;
    // A group message marked Important (20261113140000): place is the group,
    // detail 'reminder', or 'waiting' to whoever marked it, with how many
    // have not acknowledged as the count.
    case 'important': {
      const group = n.place ?? 'a group';
      if (n.detail === 'waiting')
        return n.count === 1
          ? `1 person hasn’t acknowledged your Important message in ${group}`
          : `${n.count} people haven’t acknowledged your Important message in ${group}`;
      return n.detail === 'reminder'
        ? `Reminder: ${name}’s message in ${group} is Important`
        : `${name}’s message in ${group} is Important`;
    }
    // Thirty minutes after the event (20261031050000).
    case 'check_in_reminder':
      return `Did you make it to ${n.place ?? 'the event'}? Check in`;
    // An org admin told them of it: place is the event, excerpt the
    // organization, detail 'again' on a second go (20261103000000).
    case 'event_notice': {
      const from = n.excerpt ?? 'An organization you belong to';
      const event = n.place ?? 'an event';
      return n.detail === 'again'
        ? `Reminder from ${from}: ${event}. Are you going?`
        : `${from} invited you to ${event}. Are you going?`;
    }
    // The morning after the event (20261031070000).
    // A date, time, place or link changed, or it was cancelled, for whoever
    // said Going or Interested (20261120140000). count is how many dates.
    case 'event_changed': {
      const gone = cancelledTitle(n.detail);
      if (gone !== null)
        return n.count > 1 ? `${n.count} dates of ${gone} were cancelled` : `${gone} was cancelled`;
      const dates = n.count > 1 ? ` (${n.count} dates)` : '';
      return `${n.place ?? 'An event you said you’d go to'}: ${eventChangePhrase(n.detail)}${dates}`;
    }
    case 'event_followup':
      return `How was ${n.place ?? 'the event'}? Leave a review and add your pictures`;
    // place is the invitation's title, detail what became of it (20261101000000).
    case 'calendar_invite': {
      const title = n.place ?? 'Your event';
      switch (n.detail) {
        case 'held':
          return `${title} is waiting for approval`;
        case 'choose':
          return `Choose which organization hosts ${title}`;
        case 'updated':
          return `${title} was updated from your calendar`;
        case 'refused':
          return `${title} could not be added from your calendar`;
        case 'cancelled':
          return `${title} was taken off the calendar`;
        default:
          return `${title} was added from your calendar`;
      }
    }
    // place is the name asked for (20261101010000).
    case 'organization_request': {
      const asked = n.place ?? 'An organization';
      if (n.detail === 'approved') return `${asked} was added to the club`;
      if (n.detail === 'declined') return `${asked} was not added to the club`;
      return `${name} asked to add ${asked}`;
    }
    // place is the organization (20261031030000).
    case 'join_request':
      return n.count > 1
        ? `${n.count} people asked to join ${n.place ?? 'your organization'}`
        : `${name} asked to join ${n.place ?? 'your organization'}`;
    case 'org_events': {
      const added = Number(n.detail);
      const what = Number.isInteger(added) && added > 1 ? `${added} new events` : 'a new event';
      return `${n.place ?? 'An organization you belong to'} added ${what}`;
    }
    // detail is the day applications close, as YYYY-MM-DD.
    case 'grant_open': {
      const grant = n.excerpt ?? 'A grant';
      const who = n.place ? ` from ${n.place}` : '';
      return n.detail
        ? `${grant}${who} is open for applications until ${grantDay(n.detail, californiaToday())}`
        : `${grant}${who} is open for applications`;
    }
    // One series since 2026-11-12 (the owner); older ones carry 'details'.
    case 'profile_reminder':
      return 'Finish your profile: pick up where you left off, so members can find you';
    // An administrator's weekly count (20261022090000): nobody named.
    case 'blocks_weekly': {
      const blocked = Number(n.detail);
      if (!Number.isInteger(blocked) || blocked < 1) return 'Members were blocked this week';
      return blocked === 1
        ? '1 member was blocked this week'
        : `${blocked} members were blocked this week`;
    }
    // Asking to join an invite-only event (20261127120000): actor who asked,
    // place the event, count how many are asking.
    case 'event_join_request': {
      const who = n.actorName ?? 'A member';
      const others = n.count > 1 ? ` and ${String(n.count - 1)} more` : '';
      return `${who}${others} asked to join ${n.place ?? 'your invite-only event'}`;
    }
    // An administrator made them staff (20261125160000); place the organization.
    case 'staff_verified':
      return n.place
        ? `You’re verified as staff of ${n.place}. Add your profession on Me.`
        : 'You’re verified as staff. Add your profession on Me.';
    // An administrator flagged the reader's anonymous post (20261120110000):
    // detail is what it cost them and the reason.
    case 'anonymous_flagged': {
      const { cost, reason } = readFlag(n.detail);
      return `An administrator flagged and hid your anonymous post in ${quoted(n.place)}: “${reason}”. ${flagConsequence(cost)} You can respond to it.`;
    }
    // A strike and its conversation (20261120120000). detail is the kind, the
    // id and the rule. To an administrator, place is who answered.
    case 'strike_given': {
      const rule = ruleName(n.detail?.split(':')[2]);
      return rule
        ? `An administrator gave you a strike for ${rule.toLowerCase()}. You can respond to it.`
        : 'An administrator gave you a strike. You can respond to it.';
    }
    case 'strike_message': {
      const flag = n.detail?.startsWith('flag:') ?? false;
      if (n.place) {
        const who = flag ? 'The writer of a flagged post' : n.place;
        return n.count > 1
          ? `${who} sent ${n.count} messages about ${flag ? 'the flag' : 'their strike'}`
          : `${who} answered about ${flag ? 'the flag' : 'their strike'}`;
      }
      const about = flag ? 'the flag on your anonymous post' : 'your strike';
      return n.count > 1
        ? `${n.count} answers from the administrators about ${about}`
        : `An administrator answered about ${about}`;
    }
    case 'strike_withdrawn':
      return n.detail?.startsWith('flag:')
        ? 'An administrator withdrew the flag on your anonymous post. Your post is back, and the flag no longer counts.'
        : 'An administrator withdrew your strike. It no longer counts.';
    default:
      return 'Something new in the club';
  }
}
