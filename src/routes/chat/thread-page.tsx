import { Search, X } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HeaderBack } from '@/components/back-line';
import { BackLink } from '@/components/back-link';
import { CardsShown } from '@/components/cards-shown';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { FormerMemberAvatar, GroupAvatar, MemberAvatar } from '@/components/member-avatar';
import { motionReduced } from '@/lib/accessibility';
import { useAccount } from '@/lib/account';
import { useMyBlocks } from '@/lib/blocks';
import {
  attachmentFolder,
  deleteAttachments,
  uploadAttachments,
  useAttachmentUrls,
} from '@/lib/chat/attachments';
import { useChatAuthors } from '@/lib/chat/authors';
import { memberDraftKey } from '@/lib/chat/drafts';
import { useThreadRoster } from '@/lib/chat/groups';
import { acknowledgeImportant, markImportant, useThreadImportant } from '@/lib/chat/important';
import { useReactions } from '@/lib/chat/reactions';
import { readReceipt, useThreadReadReceipts } from '@/lib/chat/read-receipts';
import { useRealtimeRows } from '@/lib/chat/realtime';
import { reportMessage, useMyReports } from '@/lib/chat/reports';
import { useSharedPosts } from '@/lib/chat/shared-posts';
import { quoteText, shouldFollowScroll, threadTitle, useThreadMessages } from '@/lib/chat/threads';
import { chatDayHeading, messageDateTime, sameChatDay } from '@/lib/chat/time';
import type { ChatMessage } from '@/lib/chat/types';
import { useTyping } from '@/lib/chat/typing';
import { describeThrown } from '@/lib/describe-error';
import { useHoldScroll } from '@/lib/hold-scroll';
import { announceNotificationsChanged } from '@/lib/notifications';
import { Composer } from '@/routes/chat/composer';
import { DeleteConversation } from '@/routes/chat/delete-conversation';
import { ImportantBanner, ImportantPeopleSheet } from '@/routes/chat/important';
import { MessageBubble, type Quote } from '@/routes/chat/message-bubble';
import { ThreadNotifyButton } from '@/routes/chat/mute-button';
import { NoticeLine } from '@/routes/chat/notice-line';
import { ReactionBar } from '@/routes/chat/reaction-bar';
import { ReportSheet } from '@/routes/chat/report-sheet';
import { SWIPE_MAX, useSwipeDates } from '@/routes/chat/swipe-dates';
import { ThreadSearch } from '@/routes/chat/thread-search';
import { TypingDots, typingSentence } from '@/routes/chat/typing-dots';
import { BlockMemberSheet } from '@/routes/peers/block-sheet';

/** How many of the newest photographs load at once. */
const FIRST_PHOTOS = 6;

/**
 * One conversation: the bubbles, and the box to add to it.
 *
 * Enter sends here (Shift+Enter breaks a line); in a topic only the button sends.
 *
 * Opens at the bottom, and follows new messages down only if the reader was already there or
 * wrote it: a reader who scrolled up is reading. The threshold is `shouldFollowScroll`
 * (threads.test.ts). It stays at the bottom when the keyboard makes the list shorter.
 *
 * A group's "N members" links to the members screen; a pair's subtitle is not a link.
 *
 * A direct thread whose other member was removed stays readable, anonymised (the owner's
 * decision), and loses its composer, saying why.
 *
 * Replies are quotes (2026-09-29), kept in time order, never nested (HANDOFF.md "What Home is",
 * decision 11). Tapping a quote scrolls to it and lights it once, honouring reduced motion. Edit
 * puts the words in the composer (2026-10-22).
 *
 * Reporting is the only way anything here reaches an administrator, who cannot read the thread:
 * it hands over one message, its author and time, nothing else, and the sheet says so first.
 *
 * A group rename or picture change is a notice row (20260930020000), drawn by `NoticeLine`; its
 * reload re-reads the thread, so the header updates for everybody.
 */
export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  // Keyed so a switch between conversations starts clean: no old messages,
  // draft, reply or edit carried into somebody else's.
  return <ThreadScreen key={threadId} threadId={threadId} />;
}

function ThreadScreen({ threadId }: { threadId: string | undefined }) {
  const account = useAccount();
  const {
    thread,
    messages,
    loading,
    error,
    stale,
    hasEarlier,
    loadingEarlier,
    earlierError,
    loadEarlier,
    reveal,
    reload,
    changed,
    send,
    edit,
    remove,
  } = useThreadMessages(threadId);
  const reactions = useReactions(
    'message',
    messages.filter((m) => !m.pending && !m.notice && m.removedAt === null).map((m) => m.id),
    account.userId,
    { within: threadId },
  );
  const reads = useThreadReadReceipts(threadId);
  // Important messages (20261113140000): the gold ones, the banner, who acknowledged.
  const important = useThreadImportant(threadId, thread?.kind === 'group');
  const importantById = new Map(important.items.map((item) => [item.messageId, item]));
  const waiting = account.userId
    ? important.items.filter(
        (item) =>
          item.asked.includes(account.userId ?? '') &&
          !item.acknowledged.includes(account.userId ?? ''),
      )
    : [];
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  /** The Important message whose "who acknowledged" is open, or null. */
  const [whoFor, setWhoFor] = useState<string | null>(null);
  // Read again with every reload: a block or a removal changes what a card may show.
  const shared = useSharedPosts(
    messages.filter((m) => m.sharedPostId && !m.pending && m.removedAt === null).map((m) => m.id),
    messages,
  );

  // Live: a changed row fetches just that message (a removal arrives as an
  // UPDATE); a reconnect reads the newest page again. Either marks it read.
  useRealtimeRows({
    table: 'chat_messages',
    filter: threadId ? `thread_id=eq.${threadId}` : undefined,
    onChange: reload,
    onRow: changed,
    enabled: Boolean(threadId),
  });

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removalFailure, setRemovalFailure] = useState<string | null>(null);
  const [behind, setBehind] = useState(false);
  /** The message whose words are in the composer, or null. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The message the next one answers, or null. */
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  /** The message lit up after a quote was tapped, or null. */
  const [flashId, setFlashId] = useState<string | null>(null);
  const reports = useMyReports();
  /** Which message the sheet is open over, or null. One at a time. */
  const [reportingId, setReportingId] = useState<string | null>(null);
  // Block from a message's •••: hidden here at once, and by the database on
  // the next read. Focus then goes to the heading, as the bubble is gone.
  const blocks = useMyBlocks();
  const navigate = useNavigate();
  const [blockedHere, setBlockedHere] = useState<ReadonlySet<string>>(new Set());
  const [blocking, setBlocking] = useState<{ id: string; name: string } | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const swipe = useSwipeDates();
  const shown = useMemo(
    () =>
      messages.filter(
        (m) => !m.authorId || !(blocks.ids.has(m.authorId) || blockedHere.has(m.authorId)),
      ),
    [messages, blocks.ids, blockedHere],
  );
  // The newest photographs load at once; older ones as they are scrolled
  // near (the owner, 2026-11-22).
  const photosFirst = useMemo(
    () =>
      new Set(
        shown
          .filter((m) => m.attachments.length > 0)
          .slice(-FIRST_PHOTOS)
          .map((m) => m.id),
      ),
    [shown],
  );
  useEffect(() => {
    if (blockedCount > 0) heading.current?.focus();
  }, [blockedCount]);
  // Only while it stands: a removal over the wire ends the edit.
  const edited = shown.find(
    (m) => m.id === editingId && m.removedAt === null && !m.pending && !m.notice,
  );

  // Who an "@" can suggest here: the conversation's own members (the owner,
  // 2026-10-29).
  const roster = useThreadRoster(threadId);
  const mentionScope = useMemo(() => ({ among: roster.memberIds }), [roster.memberIds]);

  // Who else is writing now (lib/chat/typing.ts). Nobody to write to in a pair
  // whose other half has left. Only the roster, and nobody this member blocked:
  // their messages are hidden here too.
  const typing = useTyping(
    thread?.kind === 'direct' && thread.otherMemberId === null ? undefined : threadId,
    account.userId,
  );
  const typers = typing.typing.filter(
    (id) => roster.memberIds.includes(id) && !blocks.ids.has(id) && !blockedHere.has(id),
  );

  const authors = useChatAuthors([
    thread?.otherMemberId ?? null,
    ...messages.map((message) => message.authorId),
    ...typers,
  ]);
  const typingWho = typers.map((id) => authors.get(id) ?? null);
  const other = thread?.otherMemberId ? (authors.get(thread.otherMemberId) ?? null) : null;
  // Signed under the reader's token: a group's picture is as private as its
  // words. Empty for a pair, and for a group with none.
  const picture = useAttachmentUrls(thread?.photoPath ? [thread.photoPath] : []);
  const title = thread ? threadTitle(thread, other?.displayName ?? null) : '';
  // A direct thread keeps its composer; one whose other half has gone does not.
  const gone = thread?.kind === 'direct' && thread.otherMemberId === null;

  const scroller = useRef<HTMLDivElement | null>(null);
  const log = useRef<HTMLDivElement | null>(null);
  const opened = useRef(false);
  // The newest message seen, so earlier ones put in front are not "new".
  const seen = useRef<string | undefined>(undefined);
  const newestId = messages.at(-1)?.id;
  // Held at the bottom while photographs load, until the reader scrolls; see
  // lib/hold-scroll.ts. Taken up again whenever they come back down.
  const pin = useHoldScroll(scroller, log, !loading && thread !== null);

  /** Straight to the bottom, with no animation: what a hold re-applies. */
  const snapToBottom = useCallback(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const toBottom = useCallback(
    (behaviour: ScrollBehavior) => {
      const element = scroller.current;
      if (!element) return;
      // Two ways down, because `scrollTo` on an element is not everywhere — jsdom
      // has no implementation of it at all, and a screen whose tests cannot render
      // it is a screen with no tests. Setting scrollTop is what both understand;
      // scrollTo is only there for the smooth one.
      if (behaviour === 'smooth' && typeof element.scrollTo === 'function') {
        element.scrollTo({ top: element.scrollHeight, behavior: behaviour });
        // Held without a jump, so the smooth scroll is what the reader sees; a
        // photograph that lands later snaps to the bottom from wherever it is.
        pin.hold(snapToBottom, { now: false });
      } else {
        pin.hold(snapToBottom);
      }
      setBehind(false);
    },
    [pin, snapToBottom],
  );

  // Open at the bottom, once, on the first load with anything in it; or on the message a
  // notification was about (?message=), centred and lit once. Again on each new ?message=.
  const [searchParams] = useSearchParams();
  // Finding words said here (the owner, 2026-11-19): a hit sets ?message=.
  const [searchOpen, setSearchOpen] = useState(false);
  const wantedMessage = searchParams.get('message');
  const { key: navigationKey } = useLocation();
  const wantedNavigation = wantedMessage ? `${wantedMessage}:${navigationKey}` : null;
  const shownFor = useRef<string | null>(null);
  // A linked message older than the newest page is read back to, once.
  const [seeking, setSeeking] = useState<string | null>(null);
  const sought = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !thread || seeking) return;
    if (opened.current && wantedNavigation === shownFor.current) return;
    if (
      wantedMessage &&
      wantedNavigation &&
      sought.current !== wantedNavigation &&
      hasEarlier &&
      !messages.some((m) => m.id === wantedMessage)
    ) {
      sought.current = wantedNavigation;
      setSeeking(wantedNavigation);
      void reveal(wantedMessage).finally(() => {
        setSeeking(null);
      });
      return;
    }
    const first = !opened.current;
    opened.current = true;
    shownFor.current = wantedNavigation;
    seen.current = newestId;
    const target = wantedMessage ? document.getElementById(`message-${wantedMessage}`) : null;
    if (target) {
      pin.hold(() => {
        target.scrollIntoView({ block: 'center' });
      });
      setFlashId(null);
      requestAnimationFrame(() => {
        setFlashId(wantedMessage);
      });
      return;
    }
    if (first) toBottom('auto');
  }, [
    loading,
    thread,
    messages,
    newestId,
    hasEarlier,
    seeking,
    reveal,
    toBottom,
    wantedMessage,
    wantedNavigation,
    pin,
  ]);

  // Afterwards, follow a new newest message only if the reader was already
  // there, or wrote it: what somebody just sent is what they want to see (the
  // owner, 2026-11-20: "every time I type a message I have to scroll to the
  // bottom"; theirs was announced by New messages ↓ like anybody's).
  const newestMine = account.userId !== null && messages.at(-1)?.authorId === account.userId;
  useEffect(() => {
    if (!opened.current || newestId === seen.current) return;
    seen.current = newestId;
    if (!newestId) return;
    const element = scroller.current;
    if (!element) return;
    // Held means the reader is at the bottom, whatever the arithmetic says now
    // that the new message has already made the list taller.
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (newestMine || pin.holding() || shouldFollowScroll(distance)) toBottom('smooth');
    else setBehind(true);
  }, [newestId, newestMine, toBottom, pin]);

  // A reader at the bottom stays there when the list itself gets shorter: the
  // keyboard coming up, or the box growing a line, covered the newest messages
  // and left them a keyboard's height from the bottom, which nothing followed.
  const listReady = !loading && thread !== null;
  useEffect(() => {
    const element = scroller.current;
    if (!listReady || !element || typeof ResizeObserver === 'undefined') return;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const before = height;
      height = element.clientHeight;
      if (height === before) return;
      // Where they were before the height changed, as the top has not moved.
      const distance = element.scrollHeight - element.scrollTop - before;
      if (pin.holding() || shouldFollowScroll(distance)) snapToBottom();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [listReady, pin, snapToBottom]);

  // The dots come into view for a reader at the bottom, as a message would;
  // one reading further up is left where they are.
  const someoneTyping = typers.length > 0;
  useEffect(() => {
    if (!someoneTyping || !opened.current) return;
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (pin.holding() || shouldFollowScroll(distance)) toBottom('smooth');
  }, [someoneTyping, toBottom, pin]);

  // Show earlier keeps what the reader was looking at where it was: the
  // distance from the bottom is put back once the earlier messages are drawn.
  const keepFromBottom = useRef<number | null>(null);
  const oldestId = messages[0]?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new oldest message is why it runs.
  useLayoutEffect(() => {
    const element = scroller.current;
    const kept = keepFromBottom.current;
    if (!element || kept === null) return;
    keepFromBottom.current = null;
    element.scrollTop = element.scrollHeight - kept;
  }, [oldestId]);
  function showEarlier() {
    const element = scroller.current;
    if (element) keepFromBottom.current = element.scrollHeight - element.scrollTop;
    pin.release();
    void loadEarlier();
  }

  /**
   * Coming back down to the newest message takes the hold up again, without a jump. Only on the
   * way down: doing it on a small scroll up pulled the reader back (the owner, 2026-10-26).
   */
  const lastTop = useRef(0);
  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    const goingDown = element.scrollTop > lastTop.current;
    lastTop.current = element.scrollTop;
    if (pin.holding() || !goingDown) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (shouldFollowScroll(distance)) {
      pin.hold(snapToBottom, { now: false });
      setBehind(false);
    }
  }

  const nameOf = (message: ChatMessage): string => {
    if (message.authorId === account.userId) return 'you';
    return (
      (message.authorId ? authors.get(message.authorId)?.displayName : null) ?? 'a deleted member'
    );
  };

  /** The quote over a reply: the message it answers, found in the list. */
  const quoteOf = (message: ChatMessage): Quote | null => {
    if (!message.replyTo) return null;
    const target = messages.find((candidate) => candidate.id === message.replyTo);
    // "You" as a heading over the quote, where the reply bar says "you".
    const name = target ? nameOf(target) : 'Earlier message';
    return {
      id: message.replyTo,
      name: name === 'you' ? 'You' : name,
      text: quoteText(target),
    };
  };

  /** Block, on somebody else's message while they are still a member. */
  const blockOffer = (message: ChatMessage) => {
    const author = message.authorId ? authors.get(message.authorId) : undefined;
    if (!author || author.id === account.userId || message.pending) return undefined;
    return () => {
      setBlocking({ id: author.id, name: author.displayName });
    };
  };

  /** Scroll the quoted message into view and light it up once. */
  function showQuoted(messageId: string) {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: motionReduced() ? 'auto' : 'smooth' });
    // Off and on again, so a second tap on the same quote lights it again.
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(messageId);
    });
  }

  function acknowledge(messageId: string) {
    setAcknowledging(true);
    setAcknowledgeError(null);
    void acknowledgeImportant(messageId).then((result) => {
      setAcknowledging(false);
      if (!result.ok) {
        setAcknowledgeError(result.error);
        return;
      }
      important.reload();
      // Its notification is read now, so the bell and the icon drop by it.
      announceNotificationsChanged();
    });
  }

  /** The banner's "Show in the conversation": loads back to it if need be. */
  function showImportant(messageId: string) {
    void reveal(messageId).then((found) => {
      if (found)
        requestAnimationFrame(() => {
          showQuoted(messageId);
        });
    });
  }

  function toggleImportant(messageId: string, mark: boolean) {
    if (
      mark &&
      !window.confirm(
        'Mark this message Important? Everyone in the group is notified, reminded twice, and asked to acknowledge it.',
      )
    )
      return;
    setRemovalFailure(null);
    void markImportant(messageId, mark).then((result) => {
      if (result.ok) important.reload();
      else setRemovalFailure(result.error);
    });
  }

  function removeMessage(messageId: string) {
    setRemovingId(messageId);
    setRemovalFailure(null);
    void remove(messageId)
      .then((problem) => {
        if (problem) setRemovalFailure(problem);
      })
      .catch((e: unknown) => {
        setRemovalFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setRemovingId(null);
      });
  }

  if (loading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }

  // Only when there is nothing to show: a later failed read keeps the
  // conversation and the message box, and says so below the header.
  if (!thread) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <BackLink to="/chat" label="Chat" />
          <p className="mt-6 text-[0.875rem] text-ink2 leading-relaxed">
            This conversation cannot be shown.
          </p>
          {error ? (
            <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // The photograph and name are the way to the other person's profile (the owner,
  // 2026-11-21: the Profile button beside the bell went, for room).
  const identity = (
    <>
      {/* Decorative: the name is beside it. */}
      <span aria-hidden="true" className="flex-none">
        {thread.kind === 'group' ? (
          <GroupAvatar url={thread.photoPath ? picture.get(thread.photoPath) : null} />
        ) : other ? (
          <MemberAvatar
            id={other.id}
            displayName={other.displayName}
            photoPath={other.photoPath}
            photoAlt={other.photoAlt}
          />
        ) : (
          <FormerMemberAvatar />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h1
          ref={heading}
          tabIndex={-1}
          className="truncate font-extrabold font-head text-[1rem] text-ink outline-none"
        >
          {title}
        </h1>
        {thread.kind === 'group' ? (
          <Link
            to={`/chat/t/${thread.id}/members`}
            data-target="small"
            className="block truncate text-[0.78125rem] text-emphasis underline"
          >
            {thread.memberCount} {thread.memberCount === 1 ? 'member' : 'members'}
          </Link>
        ) : (
          <p className="truncate text-[0.78125rem] text-grey">
            {other?.level ? (
              <LevelHighlight
                level={other.level}
                stage={other.stage}
                band={other.band}
                injuryType={other.injuryType}
              />
            ) : null}
          </p>
        )}
      </div>
    </>
  );
  const profileHref = thread.kind !== 'group' && other?.hasProfile ? `/peers/${other.id}` : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* The conversation is on screen with its messages: page speed times it. */}
      <CardsShown />
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-3 pb-3">
        <div className="mx-auto w-full max-w-[720px]">
          {/* Back sits beside the name, with no line of its own (the owner, 2026-11-21). */}
          <div className="flex items-center gap-2.5">
            <HeaderBack to="/chat" label="Chat" />
            {profileHref ? (
              <Link
                to={profileHref}
                aria-label={`${title}, profile`}
                className="-my-1 -ml-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pl-1 hover:bg-tint"
              >
                {identity}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
            )}
            <button
              type="button"
              aria-label={searchOpen ? 'Close search' : 'Search this conversation'}
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((was) => !was);
              }}
              className="flex h-[44px] w-[44px] flex-none items-center justify-center rounded-full text-ink transition-colors hover:bg-tint"
            >
              {searchOpen ? (
                <X aria-hidden="true" className="h-[18px] w-[18px]" />
              ) : (
                <Search aria-hidden="true" className="h-[18px] w-[18px]" />
              )}
            </button>
            {/* Every member of a conversation is notified of it, so every
                member chooses how much: All, Only mentions (a group), or Off
                (20261113150000). Draws nothing while notifications are off. */}
            <ThreadNotifyButton
              threadId={thread.id}
              group={thread.kind === 'group'}
              className="flex-none"
            />
          </div>
        </div>
      </header>

      {searchOpen ? (
        <ThreadSearch
          threadId={thread.id}
          viewerId={account.userId}
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      ) : null}

      {stale ? (
        <p
          role="status"
          className="flex-none border-line border-b bg-tint px-4 py-1.5 text-center text-[0.78125rem] text-ink2 leading-[1.45]"
        >
          Could not refresh this conversation.{' '}
          <button
            type="button"
            onClick={reload}
            data-target="small"
            className="font-semibold text-emphasis underline"
          >
            Try again
          </button>
        </p>
      ) : null}

      <ImportantBanner
        waiting={waiting}
        busy={acknowledging}
        error={acknowledgeError}
        onAcknowledge={acknowledge}
        onShow={showImportant}
      />

      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-2 md:px-6"
      >
        <div
          ref={log}
          {...swipe.handlers}
          // Sideways drags are the date swipe's (swipe-dates.ts); scrolling stays the browser's.
          style={{
            touchAction: 'pan-y',
            transform: swipe.offset ? `translateX(-${swipe.offset}px)` : undefined,
          }}
          // Pushed to the bottom rather than stacked from the top: a
          // conversation with three messages in it belongs above the composer
          // where the next one will appear, not floating under the header with
          // a screen of nothing below it.
          className={`mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end ${swipe.offset ? '' : 'transition-transform duration-200'}`}
          // The list of what has been said, announced as it grows. Polite, not
          // assertive: a message is not an alert and must not cut across
          // whatever the reader is in the middle of.
          role="log"
          aria-live="polite"
          aria-label={`Messages with ${title}`}
        >
          {hasEarlier ? (
            <div className="mb-2.5 flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={showEarlier}
                disabled={loadingEarlier}
                className="min-h-11 rounded-full border border-line px-4 font-bold text-[0.78125rem] text-emphasis disabled:opacity-50"
              >
                {loadingEarlier ? 'Loading…' : 'Show earlier messages'}
              </button>
              {earlierError ? (
                <p role="alert" className="text-[0.78125rem] text-destructive">
                  {earlierError}
                </p>
              ) : null}
            </div>
          ) : null}

          {removalFailure ? (
            <p
              role="alert"
              className="mb-2.5 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
            >
              {removalFailure}
            </p>
          ) : null}

          {shown.length === 0 ? (
            <p className="py-10 text-center text-[0.875rem] text-grey leading-relaxed">
              Nothing has been said yet.
              <br />
              {thread.kind === 'group'
                ? 'Whatever you write here, everyone in the group sees.'
                : 'Whatever you write here is between the two of you.'}
            </p>
          ) : (
            shown.map((message, index) => (
              <Fragment key={message.id}>
                {index === 0 ||
                !sameChatDay(shown[index - 1]?.createdAt ?? '', message.createdAt) ? (
                  <p className="mt-1 mb-3 text-center font-semibold text-[0.6875rem] text-grey">
                    {chatDayHeading(message.createdAt)}
                  </p>
                ) : null}
                <div className="relative">
                  {message.notice ? (
                    <NoticeLine
                      key={message.id}
                      message={message}
                      notice={message.notice}
                      who={
                        message.authorId === account.userId
                          ? 'You'
                          : ((message.authorId
                              ? authors.get(message.authorId)?.displayName
                              : null) ?? 'A deleted member')
                      }
                      addedYou={message.subjectId === account.userId}
                      // As on a bubble: somebody else's, and not a former member's.
                      canReport={message.authorId !== null && message.authorId !== account.userId}
                      reported={reports.messageIds.has(message.id)}
                      onReport={() => {
                        setReportingId(message.id);
                      }}
                    />
                  ) : (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      photosFirst={photosFirst.has(message.id)}
                      reactions={
                        <ReactionBar
                          target={message.id}
                          what={
                            message.body ||
                            (message.sharedPostId ? 'this shared post' : 'this photograph')
                          }
                          quoted={Boolean(message.body)}
                          state={reactions}
                          readerId={account.userId}
                        />
                      }
                      author={message.authorId ? (authors.get(message.authorId) ?? null) : null}
                      mine={message.authorId === account.userId}
                      sharedPost={
                        shared.cards.get(message.id) ??
                        (shared.answered.has(message.id) ? null : undefined)
                      }
                      receipt={readReceipt(message, thread.kind, reads)}
                      quote={quoteOf(message)}
                      onQuoteTap={showQuoted}
                      flash={flashId === message.id}
                      // The author's own, standing, while there is a conversation
                      // to edit in. chat_edit_message decides; this only asks.
                      canEdit={!gone && message.authorId === account.userId && !message.pending}
                      editing={edited?.id === message.id}
                      onEdit={() => {
                        setEditingId(message.id);
                      }}
                      canReply={!gone && !message.pending}
                      onReply={() => {
                        setEditingId(null);
                        setReplyingTo(message);
                      }}
                      // Own messages only, even for an administrator: a thread they could reach as
                      // one would not be private. See 20260918100000.
                      canRemove={message.authorId === account.userId}
                      onRemove={() => {
                        removeMessage(message.id);
                      }}
                      removing={removingId === message.id}
                      // Somebody else's, and not a former member's: a report names
                      // who wrote it, and they have already left the club.
                      canReport={
                        message.authorId !== null &&
                        message.authorId !== account.userId &&
                        !message.pending
                      }
                      reported={reports.messageIds.has(message.id)}
                      onReport={() => {
                        setReportingId(message.id);
                      }}
                      onBlock={blockOffer(message)}
                      important={
                        importantById.has(message.id)
                          ? {
                              acknowledged: importantById.get(message.id)?.acknowledged.length ?? 0,
                              asked: importantById.get(message.id)?.asked.length ?? 0,
                              onShowWho: () => {
                                setWhoFor(message.id);
                              },
                            }
                          : null
                      }
                      onToggleImportant={
                        important.canMark &&
                        thread.kind === 'group' &&
                        !message.pending &&
                        message.removedAt === null
                          ? () => {
                              toggleImportant(message.id, !importantById.has(message.id));
                            }
                          : undefined
                      }
                    />
                  )}
                  {message.pending ? null : (
                    // Slides in at the right as the list slides left; on a wide
                    // screen it is always there, in the margin (the owner,
                    // 2026-11-11). The same as the time's tooltip and the day
                    // heading, so hidden from screen readers.
                    <SwipedDate
                      iso={message.createdAt}
                      opacity={swipe.offset / SWIPE_MAX}
                      // Level with the bubble: under the name on somebody else's.
                      below={
                        !message.notice && message.authorId !== account.userId ? 'name' : 'top'
                      }
                    />
                  )}
                </div>
              </Fragment>
            ))
          )}
          <TypingDots who={typingWho} group={thread.kind === 'group'} />
        </div>
      </div>
      {/* The dots in words, outside the log, so they are not read as a message. */}
      <p aria-live="polite" className="sr-only">
        {typingSentence(typingWho.map((author) => author?.displayName ?? 'Someone'))}
      </p>

      {behind ? (
        <div className="pointer-events-none relative z-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              toBottom('smooth');
            }}
            className="-translate-y-2 pointer-events-auto min-h-[36px] rounded-full bg-action px-4 font-bold text-[0.78125rem] text-white shadow-[0_6px_16px_rgba(10,20,35,.22)]"
            data-target="small"
          >
            New messages ↓
          </button>
        </div>
      ) : null}

      {gone ? (
        <div className="flex-none border-line border-t bg-paper px-3.5 py-3">
          <p className="mx-auto w-full max-w-[720px] text-center text-[0.78125rem] text-grey leading-[1.45]">
            This member has left the club. What they wrote stays; there is nobody to reply to.
          </p>
          <DeleteConversation threadId={thread.id} />
        </div>
      ) : (
        <Composer
          key={account.userId}
          draftKey={threadId ? memberDraftKey(account.userId, `thread:${threadId}`) : undefined}
          placeholder={title ? `Message ${title}` : 'Message'}
          sendLabel="Send this message"
          // Enter sends here — see the header.
          sendOnEnter
          mentions
          mentionScope={mentionScope}
          onTyping={typing.typed}
          editing={
            edited
              ? {
                  id: edited.id,
                  initial: edited.body,
                  noun: 'message',
                  photos: edited.attachments.length,
                  shared: edited.sharedPostId !== null,
                  anchor: `message-${edited.id}`,
                  onSave: (body) => edit(edited.id, body),
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
          onSend={async (body, files, replyTo) => {
            // Files first, under this thread's folder, which is what the read
            // policy checks; then the row that names them. A refused row takes
            // its files back out — see attachments.ts.
            let paths: string[] = [];
            if (files.length > 0) {
              const up = await uploadAttachments(files, attachmentFolder('thread', thread.id));
              if (!up.ok) return up.error;
              paths = up.value;
            }
            const problem = await send(body, paths, replyTo ?? null);
            if (problem) {
              void deleteAttachments(paths);
              return problem;
            }
            setReplyingTo(null);
            return null;
          }}
        />
      )}

      {blocking ? (
        <BlockMemberSheet
          memberId={blocking.id}
          name={blocking.name}
          onCancel={() => {
            setBlocking(null);
          }}
          onBlocked={() => {
            // A direct conversation with them is hidden whole (20261022060000).
            if (thread.kind === 'direct' && thread.otherMemberId === blocking.id) {
              void navigate('/chat', { replace: true });
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

      {whoFor ? (
        <ImportantPeopleSheet
          messageId={whoFor}
          canRemind={important.canMark}
          onClose={() => {
            setWhoFor(null);
          }}
        />
      ) : null}

      {reportingId ? (
        <ReportSheet
          kind="message"
          onCancel={() => {
            setReportingId(null);
          }}
          onSend={async (note) => {
            const result = await reportMessage(reportingId, note);
            if (!result.ok) return result.error;
            // Read back what the database holds rather than assuming it took.
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
 * A message's date at the right edge: with its time while the list is swiped
 * left, and alone, always, on a wide screen, where the margin has room.
 */
function SwipedDate({
  iso,
  opacity,
  below,
}: {
  iso: string;
  opacity: number;
  below: 'name' | 'top';
}) {
  const { date, time } = messageDateTime(iso);
  const swiped = opacity > 0;
  return (
    <span
      aria-hidden="true"
      data-testid={swiped ? 'swiped-date' : 'side-date'}
      style={{ opacity: swiped ? opacity : undefined, width: SWIPE_MAX - 8 }}
      className={`absolute left-full ml-2 text-right text-[0.625rem] text-grey leading-tight ${swiped ? '' : 'hidden lg:block'} ${below === 'name' ? 'top-6' : 'top-2'}`}
    >
      <span className="block whitespace-nowrap">{date}</span>
      {/* The bubble already has the time; the swipe moves it out of sight. */}
      {swiped ? <span className="block whitespace-nowrap">{time}</span> : null}
    </span>
  );
}
