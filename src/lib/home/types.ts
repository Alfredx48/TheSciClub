import type { ChatPost, ChatRoom } from '@/lib/chat/types';
import type { BrowseMember, ClubEvent } from '@/types/domain';

/**
 * The shapes Home passes around.
 *
 * Home adds no new kind of content (the owner's decision, 2026-09-29). A
 * question asked from Home is a topic in a room, a photograph is a topic
 * whose first post has one, and the rest are
 * events and members that already exist. So everything here is a view of a
 * type Chat, Events or Peers already owns, and nothing here is stored.
 */

/**
 * The pills across the top of Home, in the order they are drawn.
 *
 * Not the mock's "Posts": "post" already means a reply in a topic. Questions
 * are the topics asked as one (the owner, 2026-10-27); Topics still lists
 * them too. `everything` is first and is the default, so it carries no
 * parameter in the URL.
 */
export const HOME_SEGMENTS = [
  'everything',
  'questions',
  'topics',
  'photos',
  'events',
  'people',
] as const;
export type HomeSegment = (typeof HOME_SEGMENTS)[number];

/**
 * Whose posts Home shows, and in what order (the owner, 2026-11-18: "under
 * show, I think we should have everything, my posts, my replies, from my
 * orgs", and "sort by default ranking, most recent replies, most recent
 * post"). `home_topics_shown` (20261118230000) reads each.
 */
export const HOME_SHOWS = ['all', 'mine', 'replied', 'orgs'] as const;
export type HomeShow = (typeof HOME_SHOWS)[number];
export const HOME_SORTS = [
  'ranking',
  'replies',
  'newest',
  // 20261118240000: the most of each first.
  'views',
  'most_replies',
  'upvotes',
  'engaged',
] as const;
export type HomeSort = (typeof HOME_SORTS)[number];

export interface HomeView {
  show: HomeShow;
  sort: HomeSort;
}

export const DEFAULT_HOME_VIEW: HomeView = { show: 'all', sort: 'ranking' };

/** The cold Home response, in the same shapes as its independent reads. */
export interface HomeStartup {
  feed: unknown[];
  rooms: unknown[];
}

/**
 * A topic as Home reads it, straight from `chat_topics`.
 *
 * No unread flag or view count on this row. Home reads each opening post's
 * views separately through `usePostViews`, also used on the topic page.
 */
export interface HomeTopicSummary {
  id: string;
  roomId: string;
  title: string;
  /** Null when the member who started it has been removed from the club. */
  authorId: string | null;
  createdAt: string;
  lastPostAt: string;
  /** Standing replies only. A removed one stops counting (20260927030000). */
  replyCount: number;
  /** Asked as a question (20261010010000), and drawn larger on Home. */
  isQuestion: boolean;
  /** Its place in `home_topics_ranked`'s order (20261118190000); absent on the older read. */
  order?: number | undefined;
  /** The replies `home_topics_ranked` picked for the card, by id. */
  previewIds?: readonly HomeReplyRef[] | undefined;
}

/**
 * Which reply a card quotes, and why (20261118190000):
 * `top` the highest score, 1 or more; `unread` the first the reader has not read;
 * `latest` the newest; `reply` another newest one, so a card still shows two;
 * `first` the earliest, on a database without the ranking.
 */
export type HomeReplyKind = 'top' | 'unread' | 'latest' | 'reply' | 'first';

export interface HomeReplyRef {
  id: string;
  kind: HomeReplyKind;
}

export interface HomeReply {
  post: ChatPost;
  kind: HomeReplyKind;
}

/** One topic, with what a card needs to draw it. */
export interface HomeTopic extends HomeTopicSummary {
  /** Always an open room. A topic in a closed room never becomes one of these. */
  room: ChatRoom;
  /**
   * The topic's first post, or null when that post has been removed.
   *
   * Null is not "load the next one instead". The first standing post after a
   * removed opening is somebody's reply, and drawing it as the question would
   * put words in the asker's mouth. The card draws the title alone.
   */
  opening: ChatPost | null;
  /** The earliest standing post after the opening one, if anybody has replied. */
  firstReply: ChatPost | null;
  /**
   * What the card quotes: up to two replies, the top one first, or else oldest first. On a
   * database without the ranking, `firstReply` alone.
   */
  replies: HomeReply[];
  /** The opening post carries at least one photograph. */
  photo: boolean;
}

/**
 * One entry in the list, keyed so that no item is drawn twice.
 *
 * A plain topic and a photo topic share `topic:<id>`: they are one topic
 * drawn two ways, and the key is the topic's.
 */
export type FeedItem =
  | { kind: 'topic'; key: string; topic: HomeTopic }
  | { kind: 'photo'; key: string; topic: HomeTopic }
  | { kind: 'event'; key: string; event: ClubEvent }
  | { kind: 'person'; key: string; member: BrowseMember };
