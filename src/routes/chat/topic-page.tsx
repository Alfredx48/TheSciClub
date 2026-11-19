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
import { LinkedText } from '@/components/linked-text';
import { AvatarLink, FormerMemberAvatar, MemberAvatar } from '@/components/member-avatar';
import { useAccount } from '@/lib/account';
import { useMyBlocks } from '@/lib/blocks';
import { attachmentFolder, deleteAttachments } from '@/lib/chat/attachments';
import { useAuthorPlaces } from '@/lib/chat/author-places';
import { useChatAuthors } from '@/lib/chat/authors';
import { useEdits } from '@/lib/chat/edits';
import { usePostLikes, voteFor } from '@/lib/chat/likes';
import { PRICED_ROOM } from '@/lib/chat/listing-prices';
import { POST_MAX } from '@/lib/chat/post-length';
import { useReactions } from '@/lib/chat/reactions';
import { reportPost, useMyReports } from '@/lib/chat/reports';
import { useChatRooms } from '@/lib/chat/rooms';
import { saveKey, useTopicSaves } from '@/lib/chat/saves';
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
import { ListingPrice } from '@/routes/chat/listing-price';
import { MoveTopic } from '@/routes/chat/move-topic';
import { MuteButton } from '@/routes/chat/mute-button';
import { Post } from '@/routes/chat/post';
import { PostComposer } from '@/routes/chat/post-composer';
import { ReactionBar } from '@/routes/chat/reaction-bar';
import { ReportSheet } from '@/routes/chat/report-sheet';
import { SaveTopicButton } from '@/routes/chat/save-button';
import { SharePostButton } from '@/routes/chat/share-post';
import { BlockMemberSheet } from '@/routes/peers/block-sheet';

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
  const reports = useMyReports();
  // Which post the sheet is open over, or null. One at a time, and the id
  // rather than a boolean so that the sheet cannot outlive the post it is
  // about when a removal arrives over the wire mid-decision.
  const [reportingId, setReportingId] = useState<string | null>(null);

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
  const saves = useTopicSaves(topicId);

  useTopicRealtime(topicId, topicPosts, edits, likes);

  const authors = useChatAuthors([topic?.authorId ?? null, ...posts.map((post) => post.authorId)]);
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
  const topicTitle = topic.title.trim();
  const counts = topicCounts(topic.replyCount);
  const nameOf = (post: ChatPost) =>
    (post.authorId ? authors.get(post.authorId)?.displayName : null) ?? 'a deleted member';

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
        p.authorId !== post.authorId &&
        (p.replyTo === post.id || post.id === openingId),
    );
  // A topic posted with only its title: editing it edits the title.
  const titleOnly = (post: ChatPost) =>
    post.id === openingId && post.attachments.length === 0 && post.body.trim() === topicTitle;

  const wholeTopic = (post: ChatPost) =>
    post.id === openingId &&
    topic.authorId !== null &&
    topic.authorId === account.userId &&
    post.authorId === account.userId &&
    !posts.some((p) => p.removedAt === null && p.authorId !== account.userId);

  /** Controls act on this specific post, including replies to replies. */
  const postProps = (post: ChatPost) => ({
    post,
    author: post.authorId ? (authors.get(post.authorId) ?? null) : null,
    place: post.authorId ? places.get(post.authorId) : undefined,
    // The author's own, and nobody else's — not an administrator's either.
    // chat_edit_post decides; this only asks.
    canEdit: canPost && post.authorId === account.userId,
    editing: edited?.id === post.id,
    onEdit: () => {
      setEditingId(post.id);
    },
    canReply: canPost,
    onReply: () => {
      setEditingId(null);
      setReplyingTo(post);
    },
    // An administrator can remove anybody's; everybody else only their own.
    // chat_remove_post decides — this only asks.
    canRemove: account.isAdmin || (post.authorId === account.userId && !answered(post)),
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
    canReport: !account.isAdmin && post.authorId !== null && post.authorId !== account.userId,
    reported: reports.postIds.has(post.id),
    onReport: () => {
      setReportingId(post.id);
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
    // The first post is the topic, which the header's Save covers.
    save:
      post.id === threads[0]?.post.id || saves.error
        ? undefined
        : {
            saved: saves.saved.has(saveKey(topic.id, post.id)),
            onToggle: () => {
              saves.toggle(topic.id, post.id);
            },
            failure:
              saves.failure?.key === saveKey(topic.id, post.id) ? saves.failure.message : null,
          },
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

  function renderThread(thread: PostThread, depth: number, index?: number): ReactNode {
    const first = openingStands && depth === 0 && index === 0;
    const onlyTitle = questionOnly && first;
    return (
      <Post
        key={thread.post.id}
        {...postProps(thread.post)}
        {...(index === undefined || first
          ? {}
          : { number: index + 1 - skip, total: threads.length - skip })}
        nested={depth > 0}
        depth={depth}
        replies={replyCount(thread)}
        flash={flashId === thread.post.id}
        hideBody={onlyTitle}
        opening={first}
        repeatsTitle={first && thread.post.body.trim() === topicTitle}
      >
        {thread.replies.map((reply) => renderThread(reply, depth + 1))}
      </Post>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scroller} className="relative flex-1 overflow-y-auto pb-[18px]">
        <header className="border-line border-b bg-paper px-[18px] pt-3 pb-3">
          <div className="mx-auto w-full max-w-[720px]">
            <ChatBreadcrumb state={location.state as unknown} room={room} />
            <h1
              ref={heading}
              tabIndex={-1}
              className="mt-1 font-extrabold font-head text-[1.125rem] text-ink leading-[1.3] outline-none [overflow-wrap:anywhere]"
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
              <span className="min-w-0">
                {counts ? `${counts} · started by ` : 'Started by '}
                {starter ? (
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
            {/* One row, evenly spaced and the same height: Save, Mute, Move, Delete.
              Each used to carry its own margin, so they sat at different
              heights and two of them touched. */}
            <div className="flex flex-wrap items-start gap-2 empty:hidden [&:not(:empty)]:mt-2.5">
              {/* Private to the reader (20261020030000). */}
              {account.userId && !saves.error ? (
                <SaveTopicButton
                  saved={saves.saved.has(saveKey(topic.id, null))}
                  disabled={saves.loading}
                  onToggle={() => {
                    saves.toggle(topic.id, null);
                  }}
                  failure={
                    saves.failure?.key === saveKey(topic.id, null) ? saves.failure.message : null
                  }
                />
              ) : null}
              {/* Only the member who started a topic is notified of its
                replies, so only they are offered a way to stop that. */}
              {topic.authorId !== null && topic.authorId === account.userId ? (
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
          <div className="mx-auto w-full max-w-[720px]">
            {canPost ? (
              <PostComposer
                // A new topic is a new box, with that topic's draft.
                key={topicId}
                draftKey={topicId ? `topic:${topicId}` : undefined}
                placeholder="Reply to this post"
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
                replyingTo={
                  replyingTo
                    ? {
                        id: replyingTo.id,
                        name: nameOf(replyingTo),
                        onCancel: () => {
                          setReplyingTo(null);
                        },
                      }
                    : null
                }
                onSend={async (body, paths) => {
                  if (!account.userId) return 'You are signed out.';
                  // The photographs are up already, under the room's folder,
                  // which is what the read policy checks; a refused row takes
                  // them back out (post-composer.tsx).
                  const result = await sendPost(
                    topic.id,
                    account.userId,
                    body,
                    paths,
                    replyingTo?.id ?? null,
                  );
                  if (!result.ok) return result.error;
                  setReplyingTo(null);
                  reload();
                  return null;
                }}
              />
            ) : (
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
