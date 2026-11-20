/**
 * What a notification says, from what `push_owed` returned for one device.
 *
 * Pure: no Deno, no network, so Vitest runs it (compose.test.ts). The owner's
 * wording, 2026-09-27 — every notification says what kind it is:
 *
 *   Direct message   "Bo"                       + the words, cut short
 *   Group message    "Crew" ("Group chat" unnamed) + "Bo: the words"
 *   Several unread   "Bo · 3 new" / "Crew · 3 new" + the latest words
 *                    (messages titled as iMessage's are: the owner, 2026-11-13)
 *                    (one push per 2 minutes, 20261105160000)
 *   Topic reply      "Bo replied to your topic" + the words, cut short
 *
 * And the six added the same day (20260927020000):
 *
 *   Added to group   "Added to a group"          + "Bo added you to a group."
 *   Reply elsewhere  "Bo replied in a topic you posted in" + the words, cut short
 *   Report           "New report"                + nothing about it
 *   Invite joined    "Somebody you invited joined" + "Ana joined the club."
 *   Event reminder   "Tomorrow: <event title>"   + "You're going. It starts at 10:00am."
 *   Org digest       "New from <organization>"   + "3 new events."
 *
 * And for administrators, weekly, 2026-10-22 (20261022090000):
 *
 *   Blocks           "Blocks this week"          + "3 members were blocked this week. …"
 *
 * And grants, 2026-10-20 (20261021010000):
 *
 *   Grant opened     "<organization>: applications open" + "<grant> is open until Nov 15."
 *
 * And one more, 2026-10-01 (20261003010000):
 *
 *   Like             "Bo liked your post"         + the start of that post, quoted
 *                    ("your topic" for a topic's opening post)
 *
 * And reactions, 2026-10-27 (20261028000000):
 *
 *   Reaction         "Bo 👍 your message"       + the start of it, quoted
 *                    ("Bo reacted to your message" with no emoji; 2026-11-13)
 *                    ("your post", or "your topic" for a topic's opening post)
 *
 * And mentions, 2026-10-28 (20261029070000):
 *
 *   Mention          "Bo mentioned you in a post" + the words, cut short
 *                    ("in a topic" for a topic's opening post)
 *
 * And introductions by a club partner, 2026-10-29 (20261029100000):
 *
 *   Asked            "Bo would like to introduce you to Ana" + the note, cut short
 *   Opened           "Ana & Sam is open"          + "Ana said yes." (to the partner)
 *
 * And family links, 2026-11-07 (20261107100000):
 *
 *   Asked            "Family link" + "Bo asked to be linked to you as family, as your parent."
 *   Linked           "Family link" + "Ana said yes. You are linked as family."
 *
 * A reply carries its words since 2026-10-01 (the owner; 20261003000000 has
 * `push_owed` return them), cut as a message's are. Until then it said only
 * who replied. Nothing here names a room or a topic — those are named for
 * what they are about, and a lock screen is read by whoever is next to it.
 * Event titles and organization names are public (CONTEXT.md), which is why
 * those two may. A group message names its group (the owner, 2026-11-05).
 */

import { cancelledTitle, eventChangePhrase } from '../_shared/event-change.ts';

/** How much of a message a lock screen gets. iOS shows about four lines. */
export const PREVIEW_LENGTH = 120;

/**
 * How much of a liked post is quoted back to its author: enough to say which
 * one, as they wrote it. Shorter than a message, which is news; this is a
 * reminder.
 */
export const LIKED_LENGTH = 80;

/** One row of `push_owed`. */
export interface Owed {
  /** A browser's push service URL, or the store app's `apns:<environment>:<token>`. */
  endpoint: string;
  /** A browser's keys; null for the app. */
  p256dh: string | null;
  auth: string | null;
  kind: string;
  /** Who did it: the author, the adder, the member who joined. */
  actor_name: string | null;
  body: string | null;
  photo_count: number;
  /** An event's title or an organization's name, for the two daily kinds. */
  subject: string | null;
  /** A start time ("10:00am") or a count ("3"); a message's unread count. */
  detail: string | null;
  url: string;
  tag: string;
  /** Kinds of notification the recipient's bell has not shown (20261028010000). */
  badge: number | null;
}

/** The payload the service worker reads (src/lib/push/payload.ts). */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** Set on the app icon when present. */
  badge?: number;
}

/**
 * At most `max` characters, whitespace collapsed, cut at a word where one is
 * near, with an ellipsis when anything was cut. Counts code points, so an
 * emoji is never split into half a character.
 */
export function shorten(text: string, max: number = PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  // A word boundary in the last fifth is worth backing up to; further back
  // loses more than a split word costs.
  const kept = space > cut.length * 0.8 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
}

function photographs(count: number): string {
  return count === 1 ? 'Sent a photograph.' : `Sent ${count} photographs.`;
}

/**
 * A room post's words without their formatting marks (2026-10-11): the first
 * post's toolbar writes a small Markdown, and a notification is plain text,
 * so "**Bring water**" arrives as "Bring water". The same rules as
 * src/lib/markdown.ts `markdownToPlain` — restated, since this function is
 * deployed on its own and cannot import the app — and only for posts:
 * conversations are not formatted, so a typed asterisk there stays.
 */
export function plainPost(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)#{1,3}\s+/, '$1')
        .replace(/^(\s*)[-*•]\s+/, '$1')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
        .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1')
        .replace(/(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/g, '$1'),
    )
    .join('\n');
}

/** What the message said, or what it carried when it said nothing. */
function words(owed: Owed, post = false): string {
  const said = owed.body ?? '';
  const text = shorten(post ? plainPost(said) : said);
  if (text !== '') return text;
  return owed.photo_count > 0 ? photographs(owed.photo_count) : '';
}

/**
 * The address with the notification's tag as `n`, before any `#`: the app
 * hands it back when the push is pressed, so that one clears from the icon
 * (20261028900000).
 */
export function withTag(url: string, tag: string): string {
  if (tag === '') return url;
  const cut = url.indexOf('#');
  const base = cut < 0 ? url : url.slice(0, cut);
  const hash = cut < 0 ? '' : url.slice(cut);
  return `${base}${base.includes('?') ? '&' : '?'}n=${encodeURIComponent(tag)}${hash}`;
}

/** A message's unread count from `detail`, if more than one. */
function unread(owed: Owed): number | null {
  const n = /^\d+$/.test(owed.detail ?? '') ? Number(owed.detail) : 0;
  return n > 1 ? n : null;
}

/** ", as your child", or nothing for plain family (src/lib/family.ts). */
export function familyAs(relation: string | null): string {
  switch (relation) {
    case 'spouse':
      return ', as your spouse or partner';
    case 'parent':
      return ', as your parent';
    case 'child':
      return ', as your child';
    case 'sibling':
      return ', as your brother or sister';
    default:
      return '';
  }
}

/** Null for a kind this file does not know, which is then not sent at all. */
export function compose(owed: Owed): PushMessage | null {
  // The author can be gone by the time this runs; the name is not.
  // A blank name falls back as well as a missing one.
  const given = (owed.actor_name ?? '').trim();
  const name = given === '' ? 'A member' : given;
  const where = {
    url: withTag(owed.url, owed.tag),
    tag: owed.tag,
    ...(typeof owed.badge === 'number' ? { badge: owed.badge } : {}),
  };
  const subject = shorten(owed.subject ?? '', 60);

  const many = unread(owed);

  switch (owed.kind) {
    // A message with neither words nor photographs is a shared post
    // (20261025010000), which is never quoted.
    // The owner, 2026-11-13: the sender's name alone, as iMessage and
    // WhatsApp do. "Direct message from Alfred S…" was cut off on every
    // Home Screen notification, under which iOS adds "from The Sci Club".
    case 'direct':
      return {
        title: many ? `${name} · ${many} new` : name,
        body: words(owed) || 'Shared a post.',
        ...where,
      };
    // subject is the group's name, since 20261105020000. The group first, so
    // it is never what gets cut; the sender opens the words (the owner,
    // 2026-11-13). A group with no name is a "Group chat".
    case 'group': {
      const group = subject === '' ? 'Group chat' : subject;
      return {
        title: many ? `${group} · ${many} new` : group,
        body: `${name}: ${words(owed) || 'Shared a post.'}`,
        ...where,
      };
    }
    // A reply with neither words nor photographs cannot be posted, but an
    // older `push_owed` sends no body at all: then it says what it used to.
    case 'reply':
      return {
        title: `${name} replied to your post`,
        body: words(owed, true) || `${name} replied to your post.`,
        ...where,
      };
    case 'reply_participant':
      return {
        title: `${name} replied to a post you replied to`,
        body: words(owed, true) || `${name} replied to a post you replied to.`,
        ...where,
      };
    case 'like': {
      // The member's own words, quoted so they read as theirs and not Bo's.
      const own = shorten(plainPost(owed.body ?? ''), LIKED_LENGTH);
      const what = owed.detail === 'topic' ? 'post' : 'reply';
      return {
        title: `${name} liked your ${what}`,
        body:
          own !== ''
            ? `“${own}”`
            : owed.photo_count > 0
              ? 'Your photograph.'
              : `${name} liked your ${what}.`,
        ...where,
      };
    }
    // detail is 'message:👍', 'post:👍' or 'topic:👍' (20261028000000).
    case 'reaction': {
      const [target, ...rest] = (owed.detail ?? '').split(':');
      const what = target === 'message' ? 'message' : target === 'topic' ? 'post' : 'reply';
      const emoji = rest.join(':').trim();
      const reacted =
        emoji === '' ? `${name} reacted to your ${what}` : `${name} ${emoji} your ${what}`;
      // A message is not formatted; a post is.
      const own = shorten(
        what === 'message' ? (owed.body ?? '') : plainPost(owed.body ?? ''),
        LIKED_LENGTH,
      );
      return {
        title: reacted,
        body: own !== '' ? `“${own}”` : owed.photo_count > 0 ? 'Your photograph.' : `${reacted}.`,
        ...where,
      };
    }
    // detail is 'topic' for a topic's opening post, as a like's.
    case 'mention': {
      const what = owed.detail === 'topic' ? 'post' : 'reply';
      return {
        title: `${name} mentioned you in a ${what}`,
        body: words(owed, true) || `${name} mentioned you in a ${what}.`,
        ...where,
      };
    }
    // detail is 'asked' (to the two) or 'opened' (both said yes). subject is
    // the other member, or the group: their first names.
    case 'introduction':
      if (owed.detail === 'opened') {
        return {
          title: subject === '' ? 'Your introduction is open' : `${subject} is open`,
          body: `${name} said yes.`,
          ...where,
        };
      }
      return {
        title:
          subject === ''
            ? `${name} would like to introduce you`
            : `${name} would like to introduce you to ${subject}`,
        body: words(owed) || `${name} would like to introduce you to another member.`,
        ...where,
      };
    // detail 'asked' or 'linked'; subject what the actor is to the reader
    // (20261107100000).
    case 'family_link': {
      const as = familyAs(owed.subject);
      if (owed.detail === 'linked') {
        return {
          title: 'Family link',
          body: `${name} said yes. You are linked as family.`,
          ...where,
        };
      }
      return {
        title: 'Family link',
        body: `${name} asked to be linked to you as family${as}.`,
        ...where,
      };
    }
    case 'group_add':
      return { title: 'Added to a group', body: `${name} added you to a group.`, ...where };
    case 'report':
      // Nothing about who, what or where: that is for /admin, behind sign-in.
      return {
        title: 'New report',
        body: 'A member reported something. Open Admin to see it.',
        ...where,
      };
    case 'invite_joined':
      return { title: 'Somebody you invited joined', body: `${name} joined the club.`, ...where };
    // Somebody asked for an invite (20261029030000): subject is the
    // organization, detail their name. Only the org admin's own devices.
    case 'invite_request': {
      const who = shorten(owed.detail ?? '', 60) || 'Somebody';
      return {
        title: 'Invite request',
        body:
          subject === ''
            ? `${who} asked you for an invite.`
            : `${who} asked you for an invite through ${subject}.`,
        ...where,
      };
    }
    // Somebody asked to join (20261031030000): subject is the organization,
    // detail how many are unread. Only its org admins' devices.
    // Asked to add an organization, or the answer (20261101010000).
    case 'organization_request':
      if (subject === '') return null;
      if (owed.detail === 'approved') {
        return { title: 'Organization added', body: `${subject} is in the club.`, ...where };
      }
      if (owed.detail === 'declined') {
        return { title: 'Organization not added', body: `${subject} was not added.`, ...where };
      }
      return {
        title: 'Organization to approve',
        body: `${name} asked to add ${subject}.`,
        ...where,
      };
    case 'join_request':
      return {
        title: 'Request to join',
        body:
          Number(owed.detail) > 1
            ? `${owed.detail} people asked to join ${subject || 'your organization'}.`
            : `${name} asked to join ${subject || 'your organization'}.`,
        ...where,
      };
    case 'event_reminder':
      if (subject === '') return null;
      return {
        title: `Tomorrow: ${subject}`,
        body: owed.detail ? `You're going. It starts at ${owed.detail}.` : "You're going.",
        ...where,
      };
    // Ten minutes before (20261028980000).
    case 'event_starting':
      if (subject === '') return null;
      return {
        title: `Starting soon: ${subject}`,
        body: owed.detail
          ? `You're going. It starts at ${owed.detail}.`
          : "You're going. It starts soon.",
        ...where,
      };
    // The morning after the event (20261031070000).
    case 'event_followup':
      if (subject === '') return null;
      return {
        title: `How was ${subject}?`,
        body: 'Leave a review and add your pictures.',
        ...where,
      };
    // What became of a calendar invitation (20261101000000).
    case 'calendar_invite': {
      if (subject === '') return null;
      const told: Record<string, { title: string; body: string }> = {
        added: { title: 'Added to the club', body: `${subject} is on the calendar.` },
        updated: {
          title: 'Updated in the club',
          body: `${subject} was updated from your calendar.`,
        },
        held: {
          title: 'Waiting for approval',
          body: `Approve ${subject} to put it on the calendar.`,
        },
        choose: { title: 'Choose a host', body: `Choose which organization hosts ${subject}.` },
        refused: { title: 'Not added', body: `${subject} could not be added from your calendar.` },
        cancelled: { title: 'Taken off the club', body: `${subject} was taken off the calendar.` },
      };
      const words = told[owed.detail ?? ''];
      return words ? { ...words, ...where } : null;
    }
    // An organizer ticked them as there (20261113120000): subject the event,
    // detail the organization it made them a member of.
    case 'checked_in':
      if (subject === '') return null;
      return {
        title: 'You’re checked in',
        body: owed.detail
          ? `${name} checked you in to ${subject}. You’re now a member of ${owed.detail}.`
          : `${name} checked you in to ${subject}.`,
        ...where,
      };
    // A group message marked Important (20261113140000), titled as a group
    // message is. detail 'reminder' on the second and third push; 'waiting:3'
    // to whoever marked it, when 3 have not acknowledged after those.
    case 'important': {
      const group = subject === '' ? 'Group chat' : subject;
      const said = `${name}: ${words(owed) || 'Shared a post.'}`;
      if (owed.detail?.startsWith('waiting:')) {
        const left = Number(owed.detail.slice('waiting:'.length));
        const who = left === 1 ? '1 person hasn’t' : `${String(left)} people haven’t`;
        return {
          title: `${group} · Not yet acknowledged`,
          body: `${who} acknowledged your Important message. Remind them, or let it be. ${said}`,
          ...where,
        };
      }
      return {
        title:
          owed.detail === 'reminder' ? `${group} · Important, reminder` : `${group} · Important`,
        body: said,
        ...where,
      };
    }
    // A change for whoever said Going or Interested (20261120140000):
    // detail what changed, photo_count how many dates.
    case 'event_changed': {
      if (subject === '') return null;
      const dates = owed.photo_count > 1 ? owed.photo_count : 1;
      if (cancelledTitle(owed.detail) !== null)
        return {
          title: `Cancelled: ${subject}`,
          body: dates > 1 ? `${dates} dates were cancelled.` : 'It’s off the calendar.',
          ...where,
        };
      const said = eventChangePhrase(owed.detail);
      return {
        title: `Changed: ${subject}`,
        body: `${said.charAt(0).toUpperCase()}${said.slice(1)}${dates > 1 ? `, for ${dates} dates` : ''}.`,
        ...where,
      };
    }
    // Thirty minutes after the event (20261031050000).
    case 'check_in_reminder':
      if (subject === '') return null;
      return {
        title: `Did you make it to ${subject}?`,
        body: 'Check in while it is still open.',
        ...where,
      };
    // An org admin told them of an event (20261103000000): actor_name is the
    // organization, detail 'again' on a second go.
    case 'event_notice':
      if (subject === '') return null;
      return {
        title: owed.detail === 'again' ? `Reminder: ${subject}` : subject,
        body: `From ${given === '' ? 'an organization you belong to' : given}. Are you going?`,
        ...where,
      };
    case 'org_events': {
      const count = Number(owed.detail);
      if (subject === '' || !Number.isInteger(count) || count < 1) return null;
      return {
        title: `New from ${subject}`,
        body: count === 1 ? '1 new event.' : `${count} new events.`,
        ...where,
      };
    }
    // A grant from a followed organization opened (20261021010000): body is
    // the grant's name, detail the day it closes ("Nov 15").
    case 'grant_open': {
      const grant = shorten(owed.body ?? '', 80);
      if (subject === '' || grant === '') return null;
      return {
        title: `${subject}: applications open`,
        body: owed.detail ? `${grant} is open until ${owed.detail}.` : `${grant} is open.`,
        ...where,
      };
    }
    // A reminder to finish the profile (20261022040000): one series since
    // 2026-11-12 (the owner), details and answers alike; the app opens where
    // it was left. The app's list words it the same (src/lib/notifications.ts).
    case 'profile_reminder':
      return {
        title: 'Finish your profile',
        body: 'Pick up where you left off. A few more details help members find you.',
        ...where,
      };
    // Administrators' weekly count (20261022090000); detail is the count.
    // Nobody is named: who blocked whom is on Admin, behind sign-in.
    case 'blocks_weekly': {
      const count = Number(owed.detail);
      if (!Number.isInteger(count) || count < 1) return null;
      return {
        title: 'Blocks this week',
        body:
          count === 1
            ? '1 member was blocked this week. Open Admin to see the list.'
            : `${count} members were blocked this week. Open Admin to see the list.`,
        ...where,
      };
    }
    default:
      return null;
  }
}
