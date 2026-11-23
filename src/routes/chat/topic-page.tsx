import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { CardsShown } from '@/components/cards-shown';
import { LinkedText } from '@/components/linked-text';
import {
  ANONYMOUS_PAGE,
  AnonymousAvatarLink,
  AvatarLink,
  FormerMemberAvatar,
  MemberAvatar,
} from '@/components/member-avatar';
import { useAccount } from '@/lib/account';
import { useMyBlocks } from '@/lib/blocks';
import {
  anonymousName,
  anonymousNote,
  flagAnonymousPost,
  useAnonymousWriters,
} from '@/lib/chat/anonymous';
import { attachmentFolder, deleteAttachments } from '@/lib/chat/attachments';
import { useAuthorPlaces } from '@/lib/chat/author-places';
import { useChatAuthors } from '@/lib/chat/authors';
import { handedPhotos, memberDraftKey, readKeptDraft } from '@/lib/chat/drafts';
import { useEdits } from '@/lib/chat/edits';
import { usePostLikes, voteFor } from '@/lib/chat/likes';
import { PRICED_ROOM } from '@/lib/chat/listing-prices';
import { POST_MAX } from '@/lib/chat/post-length';
import { useReactions } from '@/lib/chat/reactions';
import { reportPost, useMyReports } from '@/lib/chat/reports';
import { useChatRooms } from '@/lib/chat/rooms';
import { chatTimeLong, chatTimeOn } from '@/lib/chat/time';
import {
  deleteMyTopic,
  deleteTopic,
  editPost,
  editTopicTitle,
  firstUnreadThread,
  type PostThread,
  removePost,
  replyCount,
  sendPost,
  threadPosts,
  useTopicIsQuestion,
  useTopicPosts,
  useTopicRealtime,
} from '@/lib/chat/topics';
import type { ChatPost } from '@/lib/chat/types';
import { useMinute } from '@/lib/chat/use-minute';
import { usePostViews } from '@/lib/chat/views';
import { describeThrown } from '@/lib/describe-error';
import { useHoldScroll } from '@/lib/hold-scroll';
import { photoPaths } from '@/lib/markdown';
import { backFromTopic } from '@/routes/chat/back';
import { ChatBreadcrumb } from '@/routes/chat/breadcrumb';
import { FlagSheet } from '@/routes/chat/flag-sheet';
import { ListingPrice } from '@/routes/chat/listing-price';
import { MoveTopic } from '@/routes/chat/move-topic';
import { MuteButton } from '@/routes/chat/mute-button';
import { Post } from '@/routes/chat/post';
import { ReactionBar } from '@/routes/chat/reaction-bar';
import { ReportSheet } from '@/routes/chat/report-sheet';
import { SharePostButton } from '@/routes/chat/share-post';
import { BlockMemberSheet } from '@/routes/peers/block-sheet';

/** How many of the first photographs load at once. */
const FIRST_PHOTOS = 6;

// The writing box (TipTap and ProseMirror, the largest part of a topic's code)
// is not needed to read one (2026-11-23). It is fetched once the topic is on
// the screen and the phone is idle, and drawn on the first tap of the reply
// box, so a reader who only reads never builds it. A draft, an edit or a reply
// opens it at once. Kept here once fetched, so it is drawn on the tap itself
// rather than after a wait, and Reply's focus is not delayed.
const loadComposer = () => import('@/routes/chat/post-composer');
type ComposerModule = Awaited<ReturnType<typeof loadComposer>>;
let composerModule: ComposerModule | null = null;
let composerLoading: Promise<void> | null = null;

function startComposer(): Promise<void> {
  composerLoading ??= loadComposer().then(
    (module) => {
      composerModule = module;
    },
    () => {
      composerLoading = null;
    },
  );
  return composerLoading;
}

/** The composer once fetched; asked for when `wanted`. */
function useComposer(wanted: boolean) {
  const [module, setModule] = useState(composerModule);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks again after a failure.
  useEffect(() => {
    if (module || !wanted) return;
    let live = true;
    setFailed(false);
    void startComposer().then(() => {
      if (!live) return;
      if (composerModule) setModule(composerModule);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [module, wanted, attempt]);
  return {
    PostComposer: module?.PostComposer ?? null,
    failed,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}

/** Fetches the composer while the phone is idle, unless the reader saves data. */
function useComposerWhenIdle(ready: boolean) {
  useEffect(() => {
    if (!ready || composerModule) return;
    const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    if (typeof (window.requestIdleCallback as unknown) === 'function') {
      const handle = window.requestIdleCallback(() => void startComposer(), { timeout: 4000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(() => void startComposer(), 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready]);
}

/** Whether this box has something kept: words, a choice, or a photograph handed to it. */
function hasKeptWriting(key: string | undefined): boolean {
  const kept = readKeptDraft(key);
  return !!kept?.text.trim() || kept?.anonymous !== undefined || handedPhotos(key).length > 0;
}

const loadingReplyEditor = (
  <p className="py-4 text-center text-[0.8125rem] text-grey" role="status">
    Loading reply editor…
  </p>
);

function ReplyEditorFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="py-4 text-center text-[0.8125rem] text-grey" role="alert">
      The reply editor did not load.{' '}
      <button type="button" onClick={onRetry} className="font-semibold text-ink underline">
        Try again
      </button>
    </p>
  );
}

/** The reply box before its first tap: looks like it, costs nothing. */
function ReplyBoxClosed({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <section
      aria-label="Your reply"
      className="mt-4 rounded-[14px] border-[1.6px] border-line bg-paper focus-within:border-emphasis"
    >
      <button
        type="button"
        onPointerDown={() => void startComposer()}
        onFocus={() => void startComposer()}
        onClick={onOpen}
        className="block min-h-[7.5rem] w-full rounded-[12px] px-3.5 py-2.5 text-left text-[0.875rem] text-grey leading-[1.5] outline-none"
      >
        {label}
      </button>
    </section>
  );
}

/**
 * One topic: the question, every reply, and the box to add to it.
 *
 * Enter breaks a line and does not send: a member dictating pauses, and Enter would publish half
 * an answer.
 *
 * Opens at the first unread post (the top if never opened). The read row is fetched before this
 * visit overwrites it (useTopicPosts), and the scroll happens once, so later replies don't move
 * the reader.
 *
 * "3/11" counts standing posts: removed ones are not drawn (the owner, 2026-09-27), though the
 * row stays for reports (20260927030000).
 *
 * Deleting a topic: administrators only, behind a confirm; reports keep their copy
 * (20260927040000); photographs go through the storage API afterwards.
 *
 * Edit (2026-09-29) puts the reader's own post in the reply box (post-composer.tsx). One at a
 * time, by id, so a removal over the wire ends it.
 *
 * The question, its details and the reply box scroll with the replies, the box at the very end
 * (the owner, 2026-11-19: the title and details "take up a lot of real estate and are fixed on
 * the screen"). Reply and Edit bring the box into view.
 *
 * Likes (likes.ts) are not live; read again whenever the posts are.
 *
 * Report is drawn only on posts the reader neither wrote nor can remove, and never on a former
 * member's: they have already left, the furthest a report could go.
 */
export default function TopicPage() {
  useMinute();
  const { roomId, topicId } = useParams<{ roomId: string; topicId: string }>();
  const account = useAccount();
  const { rooms, loading: roomsLoading } = useChatRooms();
  const topicPosts = useTopicPosts(roomId, topicId);
  const { topic, posts, lastReadAt, loading, error, reload, movedTo } = topicPosts;
  // Block from a post's •••: hidden here at once, and by the database on the
  // next read. Focus then goes to the heading, as the post is gone.
  const blocks = useMyBlocks();
  const [blockedHere, setBlockedHere] = useState<ReadonlySet<string>>(new Set());
  const [blocking, setBlocking] = useState<{ id: string; name: string } | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const heading = useRef<HTMLHeadingElement | null>(null);
  // What the reader sees and counts: removed posts are left out, and the
  // rest are filed under the post they answer. See the header.
  const threads = useMemo(
    () =>
      threadPosts(
        posts.filter(
          (post) =>
            post.removedAt === null &&
            !(post.authorId && (blocks.ids.has(post.authorId) || blockedHere.has(post.authorId))),
        ),
      ),
    [posts, blocks.ids, blockedHere],
  );
  // The first photographs, top to bottom, load at once; the rest as they are
  // scrolled near (the owner, 2026-11-22).
  const photosFirst = useMemo(() => {
    const first = new Set<string>();
    const walk = (list: readonly PostThread[]) => {
      for (const thread of list) {
        if (first.size >= FIRST_PHOTOS) return;
        if (thread.post.attachments.length > 0) first.add(thread.post.id);
        walk(thread.replies);
      }
    };
    walk(threads);
    return first;
  }, [threads]);

  useEffect(() => {
    if (blockedCount > 0) heading.current?.focus();
  }, [blockedCount]);
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removalFailure, setRemovalFailure] = useState<string | null>(null);
  /** The post whose words are in the composer, or null. See the header. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The specific post the next reply goes under, or null. */
  const [replyingTo, setReplyingTo] = useState<ChatPost | null>(null);
  // A question's page says so: "Answer question" on it, "Reply to this
  // question" in the box at the bottom (the owner, 2026-11-19).
  const isQuestion = useTopicIsQuestion(topicId);
  // Scrolled: a line under the way back. See the page's top.
  const [scrolledDown, setScrolledDown] = useState(false);
  const reports = useMyReports();
  // Which post the sheet is open over, or null. One at a time, and the id
  // rather than a boolean so that the sheet cannot outlive the post it is
  // about when a removal arrives over the wire mid-decision.
  const [reportingId, setReportingId] = useState<string | null>(null);
  // The anonymous post an administrator is flagging (20261120110000).
  const [flaggingId, setFlaggingId] = useState<string | null>(null);

  // Live: replies and removals arrive without reloading; the scroll is only on the first load.
  // Anybody who can read the post sees what it said before (20261029240000).
  const editedIds = useMemo(
    () => posts.filter((post) => post.editedAt !== null).map((post) => post.id),
    [posts],
  );
  const edits = useEdits(editedIds, []);
  const standingIds = useMemo(
    () => posts.filter((post) => post.removedAt === null).map((post) => post.id),
    [posts],
  );
  const reactions = useReactions('post', standingIds, account.userId, { within: topicId });
  const likes = usePostLikes(standingIds);
  // Counted after this visit's read-through write lands, not before it too.
  const views = usePostViews(standingIds, { afterVisit: true });

  useTopicRealtime(topicId, topicPosts, edits, likes);

  const authors = useChatAuthors([topic?.authorId ?? null, ...posts.map((post) => post.authorId)]);
  // Which anonymous posts are the reader's, or, to an administrator, whose
  // (20261120100000).
  const writers = useAnonymousWriters(topicId, posts);
  // "Reply anonymously", for this topic; null until the reader chooses.
  const [anonymousChoice, setAnonymousChoice] = useState<{
    topicId: string | undefined;
    on: boolean;
  } | null>(null);
  // An "@" suggests the people already in the topic first, then everybody else
  // (the owner, 2026-10-29).
  const mentionScope = useMemo(
    () => ({
      first: [topic?.authorId, ...posts.map((post) => post.authorId)].filter(
        (id): id is string => !!id,
      ),
    }),
    [topic?.authorId, posts],
  );
  const room = rooms.find((r) => r.id === roomId) ?? null;
  // In Classifieds, each post says where its author is (the owner, 2026-11-12).
  const places = useAuthorPlaces(
    posts.map((post) => post.authorId),
    room?.category === 'Classifieds',
  );
  // Home, when the topic was opened from a card there; the room otherwise.
  const location = useLocation();
  const back = backFromTopic(location.state, room);
  const closed = room?.openedAt === null;
  // Any member, in an open room; an administrator in a closed one too, to
  // seed it. No membership since 20260930000000.
  const canPost = room !== null && (!closed || account.isAdmin);
  // The box at the bottom, closed until tapped (loadComposer, above).
  const bottomDraftKey = topicId ? memberDraftKey(account.userId, `topic:${topicId}`) : undefined;
  const [writingIn, setWritingIn] = useState<string | null>(null);
  const bottomKept = useMemo(() => hasKeptWriting(bottomDraftKey), [bottomDraftKey]);
  const bottomOpen = writingIn === bottomDraftKey || editingId !== null || bottomKept;
  const composer = useComposer(canPost && (bottomOpen || replyingTo !== null));
  useComposerWhenIdle(canPost && !loading);

  // Where the reader had got to, captured on the first load and never recomputed. Or the post a
  // notification links to (?post=<id>, 20261006000000), centred and lit once; a removed one falls
  // back. The place is held while photographs above load, until the reader scrolls
  // (lib/hold-scroll.ts).
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get('post');
  const wantedNavigation = wanted ? `${wanted}:${location.key}` : null;
  const [flashId, setFlashId] = useState<string | null>(null);
  // Which ?post= the page last opened on; undefined before the first. A
  // second notification pressed while the topic is open names another post.
  const scrolledFor = useRef<string | null | undefined>(undefined);
  const scroller = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const drawn = !loading && !roomsLoading && topic !== null;
  const place = useHoldScroll(scroller, list, drawn);
  useEffect(() => {
    const frame = scroller.current;
    // The store app and the Home Screen app both mark the keyboard
    // (native-shell.ts, keyboard-room.ts).
    if (!drawn || !frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const field = document.activeElement;
      if (
        document.documentElement.hasAttribute('data-keyboard') &&
        field?.matches('textarea, [contenteditable="true"]') &&
        frame.contains(field)
      ) {
        place.release();
        // Reply focused the box before the keyboard shortened the scroll area.
        field.scrollIntoView({ block: 'nearest' });
      }
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [drawn, place]);
  useEffect(() => {
    if (!drawn || threads.length === 0 || scrolledFor.current === wantedNavigation) return;
    const first = scrolledFor.current === undefined;
    scrolledFor.current = wantedNavigation;
    const target = wanted ? document.getElementById(`post-${wanted}`) : null;
    if (target) {
      place.hold(() => {
        target.scrollIntoView({ block: 'center' });
      });
      target.focus({ preventScroll: true });
      setFlashId(null);
      requestAnimationFrame(() => {
        setFlashId(wanted);
      });
      return;
    }
    if (!first) return;
    const index = firstUnreadThread(threads, lastReadAt);
    if (index === 0) return;
    const element = list.current?.children.item(index);
    if (element) {
      place.hold(() => {
        element.scrollIntoView({ block: 'start' });
      });
    }
  }, [drawn, threads, lastReadAt, wanted, wantedNavigation, place]);

  // `mine`: the starter's own, while nobody else has posted (20261029250000).
  function removeTopic(mine = false) {
    if (!topicId) return;
    // A confirm, like closing a room: this cannot be undone and takes every
    // reply with it.
    if (
      !window.confirm(
        mine
          ? 'Delete your post? Nobody has replied yet, so the whole post goes. This cannot be undone.'
          : 'Delete this post and every reply under it? This cannot be undone. Reports keep their own copy.',
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteFailure(null);
    void (mine ? deleteMyTopic(topicId) : deleteTopic(topicId))
      .then((result) => {
        if (!result.ok) {
          setDeleteFailure(result.error);
          setDeleting(false);
          return;
        }
        if (result.value.length > 0) void deleteAttachments(result.value);
        void navigate(room ? `/chat/rooms/${room.id}` : '/chat', { replace: true });
      })
      .catch((e: unknown) => {
        setDeleteFailure(describeThrown(e, 'The post was not deleted.'));
        setDeleting(false);
      });
  }

  // The title is the words; photographs added go on its post, after them.
  async function saveTitleEdit(
    postId: string,
    body: string,
    added: string[],
  ): Promise<string | null> {
    if (!topicId) return 'This topic is not there any more.';
    const photos = new Set(photoPaths(body));
    const title = body
      .split('\n')
      .filter((line) => !photoPaths(line).some((path) => photos.has(path)))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return 'A question needs its words.';
    if (title !== topicTitle) {
      const result = await editTopicTitle(topicId, title);
      if (!result.ok) return result.error;
    }
    if (added.length > 0) {
      const words = [title, ...[...photos].map((path) => `![Photo](${path})`)].join('\n\n');
      return saveEdit(postId, words, added, null);
    }
    reload();
    edits.reload();
    return null;
  }

  // Photographs added are already up, under the room (post-composer.tsx).
  async function saveEdit(
    postId: string,
    body: string,
    added: string[],
    kept: string[] | null,
  ): Promise<string | null> {
    const result = await editPost(postId, body, added, kept);
    if (!result.ok) return result.error;
    reload();
    edits.reload();
    return null;
  }

  function remove(postId: string) {
    setRemovingId(postId);
    setRemovalFailure(null);
    void removePost(postId)
      .then((result) => {
        if (!result.ok) {
          setRemovalFailure(result.error);
          return;
        }
        // The files go through the storage API afterwards (20260918200000).
        // Only those the function returns, which are the author's own: the
        // row's list could name anybody's photograph (20261018020000).
        if (result.value.length > 0) void deleteAttachments(result.value);
        reload();
      })
      .catch((e: unknown) => {
        setRemovalFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setRemovingId(null);
      });
  }

  if (loading || roomsLoading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }

  // Moved to another room since this address was made: follow it there,
  // keeping ?post= and the way back.
  if (movedTo && topicId && movedTo !== roomId) {
    return (
      <Navigate
        replace
        to={`/chat/rooms/${movedTo}/topics/${topicId}${location.search}`}
        state={location.state as unknown}
      />
    );
  }

  if (error || !topic) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <BackLink to={back.to} label={back.label} />
          <p className="mt-6 text-[0.875rem] text-ink2 leading-relaxed">
            This post cannot be shown.
          </p>
          {error ? (
            <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const starter = topic.authorId ? authors.get(topic.authorId) : null;
  /** Whoever wrote it: its author, or an anonymous writer the reader may know. */
  const writerOf = (post: ChatPost) => post.authorId ?? writers.get(post.id)?.memberId ?? null;
  // An anonymous topic's opening post is anonymous too.
  const openingPost = posts[0];
  const anonymousTopic = topic.authorId === null && openingPost?.anonymous === true;
  const startedByMe =
    account.userId !== null &&
    (topic.authorId !== null
      ? topic.authorId === account.userId
      : anonymousTopic && writerOf(openingPost) === account.userId);
  const openingWriter = anonymousTopic ? writers.get(openingPost.id) : undefined;
  const openingNote = openingWriter
    ? anonymousNote({ you: openingWriter.memberId === account.userId })
    : null;
  // Not in the Marketplace, where a buyer has to reach the seller.
  const canGoAnonymous = room?.category !== 'Classifieds';
  // The asker of an anonymous question answers anonymously unless they say
  // otherwise, so a follow-up never gives them away by accident.
  const chosen = anonymousChoice && anonymousChoice.topicId === topicId ? anonymousChoice : null;
  const replyAnonymously = canGoAnonymous && (chosen ? chosen.on : anonymousTopic && startedByMe);
  const chooseAnonymous = (on: boolean) => {
    setAnonymousChoice({ topicId, on });
  };
  const topicTitle = topic.title.trim();
  const counts = topicCounts(topic.replyCount);
  const nameOf = (post: ChatPost) =>
    post.anonymous
      ? anonymousName(post.byAsker)
      : ((post.authorId ? authors.get(post.authorId)?.displayName : null) ?? 'a deleted member');

  /** Block, on somebody else's post while they are still a member. */
  const blockOffer = (post: ChatPost) => {
    const author = post.authorId ? authors.get(post.authorId) : undefined;
    if (!author || author.id === account.userId) return undefined;
    return () => {
      setBlocking({ id: author.id, name: author.displayName });
    };
  };

  // Only while it is drawn: a removal over the wire ends the edit.
  const edited = editingId
    ? posts.find((p) => p.id === editingId && p.removedAt === null)
    : undefined;

  // Once somebody else has replied, a post is only added to and stays
  // (20261029260000): a reply to it, or for the opening post, anybody else's
  // post. The database decides; this only chooses what to offer.
  const openingId = posts[0]?.id ?? null;
  const answered = (post: ChatPost) =>
    posts.some(
      (p) =>
        p.id !== post.id &&
        p.removedAt === null &&
        writerOf(p) !== writerOf(post) &&
        (p.replyTo === post.id || post.id === openingId),
    );
  // A topic posted with only its title: editing it edits the title.
  const titleOnly = (post: ChatPost) =>
    post.id === openingId && post.attachments.length === 0 && post.body.trim() === topicTitle;

  const wholeTopic = (post: ChatPost) =>
    post.id === openingId &&
    startedByMe &&
    writerOf(post) === account.userId &&
    !posts.some((p) => p.removedAt === null && writerOf(p) !== account.userId);

  /** An anonymous post's writer, as far as the reader knows: only ever themselves. */
  const writerShown = (post: ChatPost) => {
    const known = writers.get(post.id);
    return known ? { you: known.memberId === account.userId } : undefined;
  };

  /** Controls act on this specific post, including replies to replies. */
  const postProps = (post: ChatPost) => ({
    post,
    author: post.authorId ? (authors.get(post.authorId) ?? null) : null,
    place: post.authorId ? places.get(post.authorId) : undefined,
    writer: post.anonymous ? writerShown(post) : undefined,
    // The author's own, and nobody else's — not an administrator's either.
    // chat_edit_post decides; this only asks.
    canEdit: canPost && writerOf(post) === account.userId,
    editing: edited?.id === post.id,
    onEdit: () => {
      setReplyingTo(null);
      setEditingId(post.id);
    },
    canReply: canPost,
    onReply: () => {
      setEditingId(null);
      setReplyingTo(post);
    },
    // An administrator can remove anybody's; everybody else only their own.
    // chat_remove_post decides — this only asks.
    canRemove: account.isAdmin || (writerOf(post) === account.userId && !answered(post)),
    // The opening post of the reader's own topic nobody else has posted in:
    // removing it would leave a title with nothing under it, so the topic goes.
    removeLabel: wholeTopic(post) ? 'Delete post' : undefined,
    onRemove: () => {
      if (wholeTopic(post)) removeTopic(true);
      else remove(post.id);
    },
    removing: removingId === post.id,
    // Exactly the posts the reader can neither remove nor wrote, and not a
    // former member's — see the header.
    canReport:
      !account.isAdmin &&
      (post.authorId !== null || post.anonymous === true) &&
      writerOf(post) !== account.userId,
    reported: reports.postIds.has(post.id),
    onReport: () => {
      setReportingId(post.id);
    },
    // An administrator flags an anonymous post rather than seeing whose it is.
    canFlag: account.isAdmin && post.anonymous === true && post.removedAt === null,
    onFlag: () => {
      setFlaggingId(post.id);
    },
    onBlock: blockOffer(post),
    // Not from a closed room: no member could read what arrived.
    // The opening post's shares the topic itself, from the top, under its
    // title; it is the only Share for the topic (the owner, 2026-10-29).
    share: closed ? null : (
      <SharePostButton
        postId={post.id}
        words={post.id === openingId ? topic.title : post.body || topic.title}
        link={
          post.id === openingId
            ? `/chat/rooms/${topic.roomId}/topics/${topic.id}`
            : `/chat/rooms/${topic.roomId}/topics/${topic.id}?${new URLSearchParams({ post: post.id }).toString()}`
        }
        topicId={post.id === openingId ? topic.id : undefined}
      />
    ),
    edits: edits.byPost.get(post.id) ?? [],
    viewCount: views.loading ? undefined : (views.byPost.get(post.id) ?? null),
    // Keep Like visible while counts load, without inventing a zero count.
    reactions: (
      <ReactionBar
        target={post.id}
        what={post.body || topic.title}
        state={reactions}
        readerId={account.userId}
      />
    ),
    likes: voteFor(likes, post.id, account.userId),
  });

  // A question asked with no details: its first post only repeats the title,
  // so it is drawn as the question's row of actions rather than as post 1,
  // and the answers are counted from 1.
  const opening = threads[0]?.post;
  // The opening post is the topic's own, drawn with it; answers count from 1.
  // Not once it is removed: then the first thread is an answer.
  const openingStands = opening?.id === openingId;
  const questionOnly =
    openingStands && opening.attachments.length === 0 && opening.body.trim() === topicTitle;
  const skip = openingStands ? 1 : 0;

  // A reply is written right under the post it answers (the owner,
  // 2026-11-19: "the reply box should be right under the comment to which
  // they said reply to"), in a box of its own with its own draft. The box at
  // the bottom stays, hidden, with whatever was being written there. Only
  // while that post is drawn: one gone from the page leaves nothing to write
  // under, and the bottom box comes back.
  const onPage = (list: PostThread[], id: string): boolean =>
    list.some((t) => t.post.id === id || onPage(t.replies, id));
  const replyingUnder =
    canPost && replyingTo && !edited && onPage(threads, replyingTo.id) ? replyingTo : null;

  // Drawn only when the reader can post, which needs the room.
  const replyFolder = room ? attachmentFolder('room', room.id) : '';
  const replyTopic = topic.id;
  function replyBox(to: ChatPost): ReactNode {
    return composer.failed ? (
      <ReplyEditorFailed onRetry={composer.retry} />
    ) : !composer.PostComposer ? (
      loadingReplyEditor
    ) : (
      <composer.PostComposer
        key={`${account.userId}:reply-${to.id}`}
        anonymousOption={
          canGoAnonymous ? { checked: replyAnonymously, onChange: chooseAnonymous } : undefined
        }
        draftKey={
          topicId ? memberDraftKey(account.userId, `topic:${topicId}:reply:${to.id}`) : undefined
        }
        // Plain: the bar over it already names who is answered.
        placeholder="Write your reply"
        maxLength={POST_MAX}
        sendLabel="Post this reply"
        folder={replyFolder}
        mentionScope={mentionScope}
        replyingTo={{
          id: to.id,
          name: nameOf(to),
          onCancel: () => {
            setReplyingTo(null);
          },
        }}
        onSend={async (body, paths, anonymous) => {
          if (!account.userId) return 'You are signed out.';
          const result = await sendPost(replyTopic, account.userId, body, paths, to.id, anonymous);
          if (!result.ok) return result.error;
          setReplyingTo(null);
          reload();
          return null;
        }}
      />
    );
  }

  function renderThread(thread: PostThread, depth: number, index?: number): ReactNode {
    const first = openingStands && depth === 0 && index === 0;
    const onlyTitle = questionOnly && first;
    return (
      <Post
        key={thread.post.id}
        {...postProps(thread.post)}
        photosFirst={photosFirst.has(thread.post.id)}
        composer={replyingUnder?.id === thread.post.id ? replyBox(replyingUnder) : undefined}
        {...(index === undefined || first
          ? {}
          : { number: index + 1 - skip, total: threads.length - skip })}
        nested={depth > 0}
        depth={depth}
        replies={replyCount(thread)}
        flash={flashId === thread.post.id}
        hideBody={onlyTitle}
        opening={first}
        answers={first && isQuestion}
        repeatsTitle={first && thread.post.body.trim() === topicTitle}
      >
        {thread.replies.map((reply) => renderThread(reply, depth + 1))}
      </Post>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* The post and its replies are on screen: page speed times them. */}
      <CardsShown />
      {/* Only the way back stays at the top; the title and everything under
          it scroll (the owner, 2026-11-19: "Only the top back link should be
          pinned to the top"). A line under it once scrolled, as in a room. */}
      <div
        className={`flex-none border-b bg-paper px-[18px] pt-3 pb-1.5 ${scrolledDown ? 'border-line' : 'border-transparent'}`}
      >
        <div className="mx-auto w-full max-w-[720px]">
          <ChatBreadcrumb state={location.state as unknown} room={room} />
        </div>
      </div>
      <div
        ref={scroller}
        className="relative flex-1 overflow-y-auto pb-[18px]"
        onScroll={(event) => {
          setScrolledDown(event.currentTarget.scrollTop > 0);
        }}
      >
        <header className="border-line border-b bg-paper px-[18px] pt-1.5 pb-3">
          <div className="mx-auto w-full max-w-[720px]">
            <h1
              ref={heading}
              tabIndex={-1}
              className="font-extrabold font-head text-[1.125rem] text-ink leading-[1.3] outline-none [overflow-wrap:anywhere]"
            >
              {/* A question's @people and @Organizations open their pages (the owner, 2026-11-17). */}
              <LinkedText text={topic.title} />
            </h1>
            {room?.id === PRICED_ROOM ? (
              <ListingPrice
                topicId={topic.id}
                isSeller={topic.authorId !== null && topic.authorId === account.userId}
              />
            ) : null}
            {/* Who started it, with their picture and a link to their profile
              (owner, 2026-10-10). A question hides its opening post — the
              title is the question — and with it the post's own picture and
              linked name, so this line was the only trace of the asker. The
              name links as a post's does: only to a profile Peers will show. */}
            <p className="mt-1.5 flex items-center gap-2 text-[0.78125rem] text-grey leading-[1.45]">
              {anonymousTopic ? (
                <AnonymousAvatarLink className="h-[1.75rem] w-[1.75rem] rounded-[9px]" />
              ) : (
                <AvatarLink memberId={starter?.id} hasProfile={starter?.hasProfile}>
                  {starter ? (
                    <MemberAvatar
                      id={starter.id}
                      displayName={starter.displayName}
                      photoPath={starter.photoPath}
                      photoAlt={starter.photoAlt}
                      className="h-[1.75rem] w-[1.75rem] rounded-[9px] text-[0.6875rem]"
                    />
                  ) : (
                    <FormerMemberAvatar className="h-[1.75rem] w-[1.75rem] rounded-[9px] text-[0.6875rem]" />
                  )}
                </AvatarLink>
              )}
              <span className="min-w-0">
                {counts ? `${counts} · started by ` : 'Started by '}
                {anonymousTopic ? (
                  <Link
                    to={ANONYMOUS_PAGE}
                    className="font-semibold text-ink2 underline-offset-2 hover:underline"
                  >
                    Anonymous
                  </Link>
                ) : starter ? (
                  starter.hasProfile ? (
                    <Link
                      to={`/peers/${starter.id}`}
                      className="font-semibold text-ink2 underline-offset-2 hover:underline"
                    >
                      {starter.displayName}
                    </Link>
                  ) : (
                    starter.displayName
                  )
                ) : topic.authorId ? (
                  '…'
                ) : (
                  'a deleted member'
                )}{' '}
                {/* How long ago for a week, then the date (the owner,
                  2026-11-18); the whole of it on a hover. */}
                <time dateTime={topic.createdAt} title={chatTimeLong(topic.createdAt)}>
                  {chatTimeOn(topic.createdAt)}
                </time>
                {openingNote ? <span className="block text-[0.75rem]">{openingNote}</span> : null}
              </span>
            </p>
            {/* An administrator seeding a room reaches this screen with a
              working composer and no other sign that nobody can read what
              they are writing. The room page says the same thing; forgetting
              it one screen deeper is how somebody wonders why there is no
              answer. */}
            {closed ? (
              <p className="mt-2 rounded-[11px] bg-tint px-3 py-2 text-[0.78125rem] text-ink2 leading-[1.45]">
                This room is closed. No member can see this post yet.
              </p>
            ) : null}
            {/* One row, evenly spaced and the same height: Mute, Move, Delete (Save
              went, the owner, 2026-11-21: hardly used; saves stay stored).
              Each used to carry its own margin, so they sat at different
              heights and two of them touched. */}
            <div className="flex flex-wrap items-start gap-2 empty:hidden [&:not(:empty)]:mt-2.5">
              {/* Only the member who started a topic is notified of its
                replies, so only they are offered a way to stop that. */}
              {startedByMe ? (
                <MuteButton target={{ kind: 'topic', id: topic.id }} what="replies to this topic" />
              ) : null}
              {/* Filing it where it belongs, after it was asked: an
                administrator, or whoever started it (20261010010000). */}
              {roomId &&
              (account.isAdmin ||
                (topic.authorId !== null && topic.authorId === account.userId)) ? (
                <MoveTopic
                  topicId={topic.id}
                  roomId={roomId}
                  rooms={rooms}
                  isAdmin={account.isAdmin}
                  onMoved={(to) => {
                    void navigate(`/chat/rooms/${to}/topics/${topic.id}`, {
                      replace: true,
                      state: location.state as unknown,
                    });
                  }}
                />
              ) : null}
              {account.isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    removeTopic();
                  }}
                  disabled={deleting}
                  data-target="small"
                  // A transparent border, so it is exactly Mute's height.
                  className="rounded-full border border-transparent bg-destructive/10 px-[0.85em] py-[0.45em] font-bold font-head text-[0.75rem] text-destructive leading-[1.3] transition-colors hover:bg-destructive/20 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete post'}
                </button>
              ) : null}
            </div>
            {deleteFailure ? (
              <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
                {deleteFailure}
              </p>
            ) : null}
          </div>
        </header>

        <div className="px-4 pt-3 md:px-6">
          <div className="mx-auto w-full max-w-[720px]" ref={list}>
            {removalFailure ? (
              <p
                role="alert"
                className="mb-2.5 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
              >
                {removalFailure}
              </p>
            ) : null}
            {threads.map((thread, index) => renderThread(thread, 0, index))}
            {/* The question's row alone reads as unfinished; say what it is
              waiting for. */}
            {openingStands && threads.length === 1 && (threads[0]?.replies.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-[0.875rem] text-grey">
                No answers yet. Yours can be the first.
              </p>
            ) : null}
          </div>
          <div className="mx-auto w-full max-w-[720px]" hidden={replyingUnder !== null}>
            {!canPost ? null : !bottomOpen ? (
              <ReplyBoxClosed
                label={isQuestion ? 'Reply to this question' : 'Reply to this post'}
                onOpen={() => {
                  setWritingIn(bottomDraftKey ?? null);
                }}
              />
            ) : composer.failed ? (
              <ReplyEditorFailed onRetry={composer.retry} />
            ) : !composer.PostComposer ? (
              loadingReplyEditor
            ) : (
              <composer.PostComposer
                // A new topic is a new box, with that topic's draft.
                key={`${account.userId}:${topicId}`}
                // Tapped open: the writing starts there.
                autoFocus={writingIn === bottomDraftKey}
                anonymousOption={
                  canGoAnonymous
                    ? { checked: replyAnonymously, onChange: chooseAnonymous }
                    : undefined
                }
                draftKey={bottomDraftKey}
                placeholder={isQuestion ? 'Reply to this question' : 'Reply to this post'}
                maxLength={POST_MAX}
                sendLabel="Post this reply"
                folder={attachmentFolder('room', room.id)}
                mentionScope={mentionScope}
                editing={
                  edited
                    ? {
                        id: edited.id,
                        initial: edited.body,
                        noun: 'post',
                        photos: edited.attachments.length,
                        attachments: edited.attachments,
                        plain: titleOnly(edited),
                        appendOnly: answered(edited),
                        anchor: `post-${edited.id}`,
                        onSave: (body, added, kept) =>
                          titleOnly(edited)
                            ? saveTitleEdit(edited.id, body, added)
                            : saveEdit(edited.id, body, added, kept),
                        onClose: () => {
                          setEditingId(null);
                        },
                      }
                    : null
                }
                onSend={async (body, paths, anonymous) => {
                  if (!account.userId) return 'You are signed out.';
                  // The photographs are up already, under the room's folder,
                  // which is what the read policy checks; a refused row takes
                  // them back out (post-composer.tsx). A reply to a post is
                  // written under it (replyBox); this box answers the topic.
                  const result = await sendPost(
                    topic.id,
                    account.userId,
                    body,
                    paths,
                    null,
                    anonymous,
                  );
                  if (!result.ok) return result.error;
                  reload();
                  return null;
                }}
              />
            )}
            {canPost ? null : (
              <p className="mt-4 rounded-[14px] border border-line bg-paper px-3.5 py-3 text-center text-[0.78125rem] text-grey leading-[1.45]">
                This room is closed. No member can see it yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {blocking ? (
        <BlockMemberSheet
          memberId={blocking.id}
          name={blocking.name}
          onCancel={() => {
            setBlocking(null);
          }}
          onBlocked={() => {
            // Their topic is hidden whole (20261022060000): leave it.
            if (topic.authorId === blocking.id) {
              void navigate(back.to, { replace: true });
              return;
            }
            setBlockedHere((ids) => new Set(ids).add(blocking.id));
            if (replyingTo?.authorId === blocking.id) setReplyingTo(null);
            setBlocking(null);
            setBlockedCount((n) => n + 1);
            blocks.reload();
            reload();
          }}
        />
      ) : null}

      {flaggingId ? (
        <FlagSheet
          onCancel={() => {
            setFlaggingId(null);
          }}
          onSend={async (reason, rule) => {
            const result = await flagAnonymousPost(flaggingId, reason, rule);
            if (!result.ok) return result.error;
            if (result.value.length > 0) void deleteAttachments(result.value);
            setFlaggingId(null);
            reload();
            return null;
          }}
        />
      ) : null}

      {reportingId ? (
        <ReportSheet
          kind="post"
          onCancel={() => {
            setReportingId(null);
          }}
          onSend={async (note) => {
            const result = await reportPost(reportingId, note);
            if (!result.ok) return result.error;
            // Read back what the database actually holds rather than assuming
            // it took: the control that says "Reported" should be reporting a
            // row, not an optimistic guess.
            reports.reload();
            setReportingId(null);
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * "3 replies", or nothing for none. Views are counted on the topic's post,
 * beside its •••, not here as well (the owner, 2026-10-29).
 */
function topicCounts(replies: number): string {
  return replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '';
}
