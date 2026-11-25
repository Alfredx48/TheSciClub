import type { InjuryBand, InjuryStage } from '@/types/domain';

/**
 * The shapes Chat passes around.
 *
 * Separate from `@/types/domain` deliberately: that file is the vocabulary of
 * the club — members, events, invites — and this one is the vocabulary of one
 * feature. Nothing outside src/lib/chat and src/routes/chat should need these.
 */

/**
 * The groupings a discussion room falls into, in the order they are drawn.
 * `chat_rooms.category` is checked against exactly these, and
 * `chat_create_room` refuses anything else by name.
 *
 * Body, Life and Kit are the mock's and hold the seeded twelve. Mind, Family
 * and Places were added on 2026-09-21 once members could start rooms: three
 * headings sized for twelve rooms the club wrote itself were a short list to
 * pick from for a room about grief, about parenting from a chair, or about
 * which airports have a working lift. What each is for is in
 * 20260918180000's header. General (2026-10-09, 20261010010000) is first: a
 * room about nothing in particular, and where a question asked from Home
 * with no room chosen goes. Other (20261010030000) is last: a heading of its
 * own for what fits no room at all. Classifieds (the owner, 2026-11-12,
 * 20261112100000) holds three rooms the club made: For sale, Giving away and
 * Looking for. Members cannot start rooms in it.
 *
 * A copy of the app from before a category was added draws that category's
 * rooms under Body (toRoom in rooms.ts), so adding one is safe for it.
 */
export const ROOM_CATEGORIES = [
  'General',
  'Body',
  'Mind',
  'Life',
  'Family',
  'Kit',
  'Places',
  'Classifieds',
  'Other',
] as const;
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

/**
 * A category as members read it. Classifieds is called Marketplace (the owner,
 * 2026-11-15); the stored value stays 'Classifieds', which the iPhone app
 * already on phones checks for.
 */
export function categoryName(category: RoomCategory): string {
  return category === 'Classifieds' ? 'Marketplace' : category;
}

/** The categories a member may start a room in: all but Classifieds. */
export const MEMBER_ROOM_CATEGORIES = ROOM_CATEGORIES.filter(
  (category): category is Exclude<RoomCategory, 'Classifieds'> => category !== 'Classifieds',
);

export interface ChatRoom {
  /** A slug — `bowel`, `bladder` — and what is in the URL. */
  id: string;
  name: string;
  description: string;
  category: RoomCategory;
  /**
   * A decorative text glyph, or null for a room a member started.
   *
   * The room's name is always printed beside it, so a null one costs nothing
   * but a letter tile — the same one a null author gets. There is deliberately
   * no icon picker: each seeded glyph had to be checked in a screenshot, and ⛭
   * drew as a tofu box, which is not a problem to hand to somebody who came
   * here to ask about their shoulder.
   */
  icon: string | null;
  sortOrder: number;
  /**
   * When an administrator opened the room, or null while it is closed.
   *
   * A member never sees a closed room at all — the select policy excludes it,
   * so a null here means the reader is an administrator looking at /admin.
   *
   * A room a member started is open from the moment it exists: there is nobody
   * standing by to open it, and it is born with a topic in it.
   */
  openedAt: string | null;
  /** Whether topics and photographs from this room appear in Home. */
  showInHome: boolean;
  /**
   * The member who started it, or null for the seeded twelve.
   *
   * Also null once that member has left the club — the room stays and the name
   * goes, like every other thing they wrote. The card says "Started by a former
   * member" rather than dropping the line, because a room with a starter and a
   * room without one are different kinds of room.
   */
  createdBy: string | null;
}

/**
 * The segments across the top of /chat, in the order they are drawn.
 *
 * The mock's, from `chatPage()`. `all` is first and is the default: it is the
 * one that answers "what is there", and the other three are narrowings of it.
 */
export const CHAT_SEGMENTS = ['all', 'direct', 'groups', 'rooms'] as const;
export type ChatSegment = (typeof CHAT_SEGMENTS)[number];

/**
 * Somebody who wrote something, as `chat_authors` projects them.
 *
 * Not a profile: no city, no bio, no age. A member who has turned themselves
 * off the directory is still an author here, which is the whole reason the view
 * exists — see src/lib/chat/authors.ts.
 */
export interface ChatAuthor {
  id: string;
  displayName: string;
  /** The @name, without the "@". Null for a member who joined before usernames. */
  username: string | null;
  photoPath: string | null;
  photoAlt: string | null;
  avatarColor: string | null;
  /** Exact level where they gave one, the range otherwise. May be absent. */
  level: string | null;
  /** How long ago, to colour the level (20261117040000). Absent before it. */
  stage?: InjuryStage | null;
  /** The finer band, for the colour (20261118226000). Absent before it. */
  band?: InjuryBand | null;
  injuryType?: string | null;
  isAdmin: boolean;
  /** Whether /peers/:id will show them, and therefore whether to link. */
  hasProfile: boolean;
}

/**
 * What a room counts (the owner, 2026-11-18; 20261118170000): its posts,
 * the questions among them, the replies under them, their views, and when it was last
 * active.
 *
 * In the club's words a post is what a member starts in a room (`chat_topics`,
 * the code's "topic"), a question is a post asked as one, and a reply is what
 * is written under either.
 *
 * The view still returns post_count (every `chat_posts` row) and a member
 * count for an older client; neither is read.
 */
export interface RoomStats {
  /** Questions and other posts together. */
  topicCount: number;
  questionCount: number;
  replyCount: number;
  /** The sum of each post's views: members who saw it, not times opened. */
  viewCount: number;
  /** Null for a room with nothing in it. */
  lastActivityAt: string | null;
}

/** One topic in a room, as `chat_topics_for` returns it. */
export interface ChatTopic {
  id: string;
  roomId: string;
  title: string;
  /** Null when the member who started it has been removed from the club. */
  authorId: string | null;
  createdAt: string;
  lastPostAt: string;
  replyCount: number;
  /** People who have opened it, not times it has been opened. */
  viewCount: number;
  unread: boolean;
  /** The first four people to post, in the order they first did. */
  participantIds: string[];
}

/**
 * The three orders the topic list can be read in, and the mock's labels.
 *
 * `activity` is first and is the default: a forum is a list of what is being
 * talked about now, and the other two are ways of asking a different question
 * of the same list.
 */
/** Top is the database's order (20261118180000): score, last activity, and not yet seen. */
export const ROOM_SORTS = ['top', 'activity', 'replies', 'views'] as const;
export type RoomSort = (typeof ROOM_SORTS)[number];

/**
 * The card under a link (20261006010000): what the club read from the page
 * when the words were written, never fetched by the reader's phone.
 */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** A file in the private `link-previews` bucket, the page's picture. */
  imagePath: string | null;
  /** Set for a YouTube video: the card plays it, on a press. */
  youtubeId: string | null;
  /** When the first link is a video, the next videos in the words (up to three), shown beside it. */
  videos?: LinkVideo[];
}

/** One more YouTube video under the same words (20261125100000). */
export interface LinkVideo {
  url: string;
  title: string | null;
  imagePath: string | null;
  youtubeId: string;
}

/** One post in a topic. */
export interface ChatPost {
  id: string;
  topicId: string;
  /** Null when the member who wrote it has been removed from the club. */
  authorId: string | null;
  /** Empty once the post is removed — the database blanks the column. */
  body: string;
  /** Paths in the private `chat` bucket, at most four. Empty once removed. */
  attachments: string[];
  createdAt: string;
  removedAt: string | null;
  /** Which sentence the reader gets: by its author, or by an administrator. */
  removedByAdmin: boolean;
  /** When the author last edited it, or null. "Edited · 9:30am" under the body. */
  editedAt: string | null;
  /**
   * The post this one answers, in the same topic, or null for a post at the
   * top level. Replies can answer specific replies at any depth (2026-10-09).
   * The trigger requires a standing parent in the same topic. Nulled by
   * the database when the parent is removed, so the reply stands on its own.
   */
  replyTo: string | null;
  /** The first link's page, filled in by the club a moment after posting. */
  linkPreview: LinkPreview | null;
  /**
   * Written anonymously (20261120100000): no author, and "Anonymous" where the
   * name goes. Absent where a screen did not read it (Home's feed).
   */
  anonymous?: boolean;
  /** Anonymous, by whoever asked the anonymous question it is under. */
  byAsker?: boolean;
}

/**
 * The two kinds of thread, which share a table and a screen.
 *
 * A direct thread is a pair and is named by whoever you are talking to; a group
 * has a name somebody chose. `chat_threads.kind` is checked against exactly
 * these. Groups are written in Phase 5 — nothing in this build creates one —
 * and are carried here because the list and the thread screen draw both.
 */
export const THREAD_KINDS = ['direct', 'group'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

/**
 * One conversation as the list sees it, from `chat_my_threads`.
 *
 * It carries its last message rather than the client fetching one per row: the
 * list is a phone screen on hospital wifi, and four queries a row is how a
 * conversation list becomes a loading screen.
 */
export interface ChatThread {
  id: string;
  kind: ThreadKind;
  /** Groups only. A direct thread is named by the other member. */
  name: string | null;
  /** The event a group chat belongs to, where it has one. */
  eventId: string | null;
  createdAt: string;
  lastMessageAt: string;
  memberCount: number;
  /**
   * The other member of a direct thread.
   *
   * Null for a group, and null for a direct thread whose other half has left
   * the club — the roster row goes with the member, so the absence is the fact
   * and the screen draws "Deleted member".
   */
  otherMemberId: string | null;
  /** Null when nothing has been said yet; blank when the last one was removed. */
  lastBody: string | null;
  lastAuthorId: string | null;
  lastAt: string | null;
  lastRemoved: boolean;
  /** Somebody else's words, newer than you last looked. Not "last_at moved". */
  unread: boolean;
  /**
   * A group's picture: a path in the private `chat` bucket, under the
   * group's own folder, so only its members can sign it. Null for a pair, and
   * for a group nobody has given one.
   */
  photoPath: string | null;
  /** Set when the last thing in the conversation was a change to the group. */
  lastNotice: ChatNotice | null;
}

/**
 * A line that records a change to a group rather than something said.
 *
 * Written only by `chat_rename_group` and `chat_set_group_picture`
 * (20260930020000); a member cannot insert one. `renamed` carries the new
 * name as its body, `pictured` the new picture as its one attachment, and
 * `unpictured` neither. `added` (chat_add_to_group, 20261106010000) has
 * "Added Sam to the group" as its body and Sam as its subject.
 */
export const CHAT_NOTICES = ['renamed', 'pictured', 'unpictured', 'introduced', 'added'] as const;
export type ChatNotice = (typeof CHAT_NOTICES)[number];

/** One message in a thread. */
export interface ChatMessage {
  id: string;
  threadId: string;
  /** Null when the member who wrote it has been removed from the club. */
  authorId: string | null;
  /** Empty once the message is removed — the database blanks the column. */
  body: string;
  /** Paths in the private `chat` bucket, at most four. Empty once removed. */
  attachments: string[];
  createdAt: string;
  removedAt: string | null;
  removedByAdmin: boolean;
  /** When the author last edited it, or null. */
  editedAt: string | null;
  /**
   * The message this one answers, in the same thread, drawn as a quote above
   * it rather than as a nest — a conversation stays in time order. Kept when
   * the quoted message is removed, so the quote can say so.
   */
  replyTo: string | null;
  /** Set on a line about a change to the group; null on anything said. */
  notice: ChatNotice | null;
  /** The first link's page, filled in by the club a moment after sending. */
  linkPreview: LinkPreview | null;
  /** A post from a room this message shares, drawn as a card, or null. */
  sharedPostId: string | null;
  /** On an `added` line, the member who was added. */
  subjectId?: string | null;
  /**
   * True while this is a bubble the reader has sent and the database has not
   * confirmed. Never set on a row that came back from a read.
   */
  pending?: boolean;
}

/**
 * What a post or message said before an edit replaced it, from `chat_edits`.
 *
 * Only an administrator ever holds one of these: the table's one select
 * policy is `is_admin()`, and a member cannot read their own earlier versions
 * back. Exactly one of `postId` and `messageId` is set.
 */
export interface ChatEdit {
  id: string;
  postId: string | null;
  messageId: string | null;
  /** The words as they were. */
  body: string;
  /** The photograph paths as they were — the same as now, since an edit does not change them. */
  attachments: string[];
  /** Null once that member has left the club. */
  editedBy: string | null;
  /** When this version stopped being the current one. */
  replacedAt: string;
}

/**
 * One report, as `admin_chat_reports` returns it.
 *
 * Only an administrator ever holds one of these. A member's own reports are
 * three ids and nothing else — see `useMyReports` — because the snapshot is
 * somebody else's words held outside the conversation they were said in, and
 * one copy of those on the reporter's screen is enough.
 *
 * There is no thread id here and there must never be one. A post carries
 * `topicId` and `roomId` because a room is readable by every member including
 * an administrator; a message carries no way back at all, which is what makes
 * "private even from administrators" still true after somebody reports one.
 */
/** What a profile said when it was reported (20261022130000). Absent answers are absent. */
export interface ReportedProfile {
  displayName: string;
  username: string | null;
  photoAlt: string | null;
  bio: string | null;
  howInjured: string | null;
  detail: string | null;
  sportsEquipment: string | null;
  grants: string | null;
  fieldOfWork: string | null;
  interests: string[];
  topics: string[];
  selfCare: string[];
}

export interface ChatReport {
  id: string;
  /** A block (20261022050000) has no post, message or words, and waits for no decision. */
  kind: 'post' | 'message' | 'block' | 'profile';
  /**
   * Where it was said. Recorded when the report was filed, so it is still
   * known once the original is gone. The panel offers Remove for a room or a
   * group and not for a direct conversation — see reports-section.tsx.
   */
  contextKind: 'room' | 'group' | 'direct' | 'member' | 'profile';
  /** Null once the reported row itself is gone. The snapshot outlives it. */
  postId: string | null;
  messageId: string | null;
  /** What the reporter saw, copied when they reported it. */
  bodySnapshot: string;
  /**
   * The reported message's photographs, by path. An administrator can read
   * exactly these because they are named on a report — 20260918200000. Not a
   * copy: if the sender deletes the file afterwards the path is all that is
   * left, and the panel says so.
   */
  attachments: string[];
  /** A profile report's copy of the profile, taken when it was reported. */
  profile: ReportedProfile | null;
  /** Its photograph in the photos bucket; kept, since a named file cannot be deleted. */
  profilePhotoPath: string | null;
  /** When it was written, which is rarely when it was reported. */
  writtenAt: string;
  /** "Bowel management › …", a group's name, or "A direct conversation". */
  place: string;
  topicId: string | null;
  roomId: string | null;
  note: string | null;
  createdAt: string;
  /** Null for somebody who has since been removed from the club. */
  reporterId: string | null;
  reporterName: string | null;
  /** Made when members voted the post down to -3, with no reporter (20261118190000). */
  raisedByVotes: boolean;
  reportedAuthorId: string | null;
  reportedAuthorName: string | null;
  /** How many members reported this same post or message. Never fewer than 1. */
  reportCount: number;
  /** Whether the post or message has since been taken down, or deleted. */
  alreadyRemoved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolution: string | null;
}
