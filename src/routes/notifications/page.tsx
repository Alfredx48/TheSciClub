import {
  AtSign,
  BadgeCheck,
  Ban,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Flag,
  HandCoins,
  Handshake,
  Heart,
  HeartHandshake,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  SmilePlus,
  UserPen,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenBack } from '@/components/back-line';
import { LoadingCards } from '@/components/loading-cards';
import { MemberAvatar } from '@/components/member-avatar';
import {
  acknowledgeImportant,
  fetchMyImportant,
  type WaitingImportant,
} from '@/lib/chat/important';
import { chatTime } from '@/lib/chat/time';
import { useMinute } from '@/lib/chat/use-minute';
import { markdownToPlain } from '@/lib/markdown';
import {
  type AppNotification,
  announceNotificationsChanged,
  loadNotifications,
  loadWaitingNotifications,
  markNotificationsRead,
  markNotificationsSeen,
  NOTIFICATIONS_PAGE,
  type NotificationKind,
  notificationSentence,
  type WaitingNotification,
  waitingFor,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { importantWords } from '@/routes/chat/important';

/**
 * Everything the club notified a member about in the last thirty days
 * (20261010000000), newest first.
 *
 * Opening the list clears the bell: what is here has been seen. Each row stays
 * marked as new until it is pressed, or until the conversation or topic it is
 * about is read some other way. Pressing one opens what it is about: the
 * message, the post, the event.
 *
 * Rows say what happened in the words the lock screen uses, with the start of
 * the message or post under it while that still stands.
 *
 * What still needs the member to do something (a held calendar invitation,
 * somebody asking to join or for an invite, a report) is kept on top under
 * "Waiting on you" until it is done, read or not, and is emailed once it has
 * waited a day (the owner, 2026-11-19; 20261119100000).
 */
const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  direct: MessageCircle,
  group: Users,
  reply: MessageCircle,
  reply_participant: MessageCircle,
  like: Heart,
  group_add: UserPlus,
  report: Flag,
  invite_joined: AtSign,
  event_reminder: CalendarDays,
  event_starting: CalendarDays,
  check_in_reminder: CalendarDays,
  event_followup: CalendarDays,
  calendar_invite: CalendarDays,
  organization_request: UserPlus,
  invite_request: UserPlus,
  join_request: UserPlus,
  org_events: CalendarDays,
  event_notice: CalendarDays,
  checked_in: CalendarDays,
  event_changed: CalendarDays,
  important: Megaphone,
  anonymous_flagged: Flag,
  strike_given: Flag,
  strike_message: MessageCircle,
  strike_withdrawn: Flag,
  staff_verified: BadgeCheck,
  event_join_request: UserPlus,
  grant_open: HandCoins,
  profile_reminder: UserPen,
  blocks_weekly: Ban,
  reaction: SmilePlus,
  mention: AtSign,
  introduction: Handshake,
  family_link: HeartHandshake,
};

export default function NotificationsPage() {
  useMinute();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Important messages still to acknowledge, pinned above the rest (the owner,
  // 2026-11-13: "up to the top"; 20261113140000).
  const [waiting, setWaiting] = useState<WaitingImportant[]>([]);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [needs, setNeeds] = useState<WaitingNotification[]>([]);

  const load = useCallback(async () => {
    void fetchMyImportant().then(setWaiting);
    // Without it, they are still in the list below, so a failure says nothing.
    void loadWaitingNotifications().then((result) => {
      if (result.ok) setNeeds(result.notifications);
    });
    const result = await loadNotifications();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setItems(result.notifications);
    setMore(result.notifications.length === NOTIFICATIONS_PAGE);
    setError(null);
    setLoading(false);
    // After they are on screen, so "seen" means seen.
    if (result.notifications.some((n) => !n.seen)) {
      await markNotificationsSeen().catch(() => undefined);
      announceNotificationsChanged();
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadEarlier() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    const result = await loadNotifications(last.createdAt);
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems((current) => [...current, ...result.notifications]);
    setMore(result.notifications.length === NOTIFICATIONS_PAGE);
  }

  function open(item: AppNotification) {
    if (!item.read) {
      setItems((current) => current.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setNeeds((current) => current.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      void markNotificationsRead(item.id).then(announceNotificationsChanged);
    }
    void navigate(item.url);
  }

  async function readAll() {
    const result = await markNotificationsRead();
    if (!result.ok) {
      setError(result.error ?? 'Could not mark them read.');
      return;
    }
    setItems((current) => current.map((n) => ({ ...n, read: true, seen: true })));
    announceNotificationsChanged();
  }

  async function acknowledge(messageId: string) {
    setAcknowledging(messageId);
    const result = await acknowledgeImportant(messageId);
    setAcknowledging(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setWaiting((current) => current.filter((w) => w.messageId !== messageId));
    setItems((current) =>
      current.map((n) =>
        n.kind === 'important' && n.url.includes(`message=${messageId}`) ? { ...n, read: true } : n,
      ),
    );
    announceNotificationsChanged();
  }

  // A pinned one is not listed twice.
  const pinned = new Set(waiting.map((w) => w.messageId));
  const needed = new Set(needs.map((n) => n.id));
  const listed = items.filter(
    (n) =>
      !needed.has(n.id) &&
      !(
        n.kind === 'important' &&
        n.detail !== 'waiting' &&
        [...pinned].some((id) => n.url.includes(`message=${id}`))
      ),
  );
  const onTop = waiting.length > 0 || needs.length > 0;

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-2 pb-3">
        <div className="mx-auto flex w-full max-w-[var(--events-measure)] flex-col">
          <ScreenBack />
        </div>
        <div className="mx-auto flex w-full max-w-[var(--events-measure)] flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
              Notifications
            </h1>
            {needs.length > 0 ? null : (
              <p className="mt-0.5 text-[0.78125rem] text-grey">The last 30 days.</p>
            )}
          </div>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => {
                void readAll();
              }}
              className="min-h-[44px] rounded-full bg-tint px-4 font-semibold text-[0.84375rem] text-emphasis hover:bg-line"
            >
              Mark all as read
            </button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 py-4">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
          >
            {error}
          </p>
        ) : null}
        {waiting.length > 0 ? (
          <section aria-labelledby="important-heading" className="mb-4">
            <h2
              id="important-heading"
              className="mb-2 flex items-center gap-1.5 font-bold text-[0.78125rem] text-gold-ink uppercase tracking-[0.06em]"
            >
              <Megaphone aria-hidden="true" className="h-4 w-4" />
              Important: please acknowledge
            </h2>
            <ul className="flex flex-col gap-2">
              {waiting.map((w) => (
                <li
                  key={w.messageId}
                  className="rounded-[14px] border-2 border-gold bg-gold-lt px-3.5 py-3"
                >
                  <p className="font-bold font-head text-[0.875rem] text-ink">{w.group}</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[0.84375rem] text-ink leading-[1.5]">
                    <span className="font-bold">{w.authorName ?? 'Deleted member'}: </span>
                    {importantWords(w.body, w.photoCount)}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-grey">Marked {chatTime(w.markedAt)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={acknowledging === w.messageId}
                      onClick={() => {
                        void acknowledge(w.messageId);
                      }}
                      className="min-h-[44px] rounded-full bg-action px-5 font-bold font-head text-[0.875rem] text-white hover:bg-action-hi disabled:opacity-60"
                    >
                      {acknowledging === w.messageId ? 'Acknowledging…' : 'Acknowledge'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void navigate(`/chat/t/${w.threadId}?message=${w.messageId}`);
                      }}
                      className="min-h-[44px] rounded-full border border-gold-dp bg-paper px-4 font-bold text-[0.84375rem] text-gold-ink hover:bg-gold-lt"
                    >
                      Open the conversation
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {needs.length > 0 ? (
          <section aria-labelledby="needs-heading" className="mb-4">
            <h2
              id="needs-heading"
              className="mb-2 flex items-center gap-1.5 font-bold text-[0.78125rem] text-gold-ink uppercase tracking-[0.06em]"
            >
              <CircleAlert aria-hidden="true" className="h-4 w-4" />
              Waiting on you ({needs.length})
            </h2>
            <ul className="overflow-hidden rounded-[14px] border-2 border-gold bg-paper">
              {needs.map((item) => (
                <li key={item.id} className="border-line border-b last:border-b-0">
                  <NotificationRow
                    item={item}
                    waitingSince={item.waitingSince}
                    onOpen={() => {
                      open(item);
                    }}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[0.8125rem] text-ink2 leading-[1.45]">
              These stay until they’re done. After a day, we email you.
            </p>
          </section>
        ) : null}
        {onTop && !loading && listed.length > 0 ? (
          <h2 className="mb-2 font-bold text-[0.78125rem] text-grey uppercase tracking-[0.06em]">
            Everything else, the last 30 days
          </h2>
        ) : null}
        {loading ? (
          <LoadingCards label="Loading…" count={5} height={64} rows />
        ) : listed.length === 0 && !onTop && !error ? (
          <div className="rounded-[14px] border border-line bg-paper px-4 py-6 text-center">
            <p className="font-bold font-head text-[0.9375rem] text-ink">Nothing yet</p>
            <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.5]">
              Messages, replies, likes and event reminders show here for 30 days.
            </p>
          </div>
        ) : listed.length > 0 ? (
          <ul className="arrive overflow-hidden rounded-[14px] border border-line bg-paper">
            {listed.map((item) => (
              <li key={item.id} className="border-line border-b last:border-b-0">
                <NotificationRow
                  item={item}
                  onOpen={() => {
                    open(item);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {more ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              void loadEarlier();
            }}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] border border-line bg-paper font-bold font-head text-[0.875rem] text-emphasis disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Show earlier'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NotificationRow({
  item,
  onOpen,
  waitingSince,
}: {
  item: AppNotification;
  onOpen: () => void;
  /** On top under Waiting on you: how long it has waited, in place of when it came. */
  waitingSince?: string;
}) {
  useMinute();
  // A kind added after this build gets the bell, not a crash.
  const Icon = Object.hasOwn(KIND_ICON, item.kind) ? KIND_ICON[item.kind] : Bell;
  const sentence = notificationSentence(item);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-tint',
        !item.read && !waitingSince && 'bg-tint/60',
      )}
    >
      <span aria-hidden="true" className="relative flex-none">
        {item.actorId && item.actorName ? (
          <MemberAvatar
            id={item.actorId}
            displayName={item.actorName}
            photoPath={item.actorPhoto}
            className="h-[2.75em] w-[2.75em] rounded-[12px] text-[0.8125rem]"
          />
        ) : (
          <span className="grid h-[2.75em] w-[2.75em] place-items-center rounded-[12px] bg-tint text-[0.8125rem] text-emphasis">
            <Icon className="h-[1.4em] w-[1.4em]" />
          </span>
        )}
        {item.actorId && item.actorName ? (
          <span className="-right-1 -bottom-1 absolute grid h-[1.6em] w-[1.6em] place-items-center rounded-full bg-paper text-[0.75rem] text-emphasis ring-1 ring-line">
            <Icon className="h-[0.95em] w-[0.95em]" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[0.9375rem] text-ink leading-[1.4]',
            item.read && !waitingSince ? 'font-medium' : 'font-bold',
          )}
        >
          {item.read || waitingSince ? null : <span className="sr-only">New: </span>}
          {sentence}
        </span>
        {item.excerpt ? (
          <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[0.84375rem] text-ink2 leading-[1.45]">
            {markdownToPlain(item.excerpt)}
          </span>
        ) : null}
        {waitingSince ? (
          <span
            className={cn(
              'mt-1 block text-[0.75rem]',
              Date.now() - new Date(waitingSince).getTime() >= 86_400_000
                ? 'font-semibold text-destructive'
                : 'text-grey',
            )}
          >
            {waitingFor(waitingSince)}
          </span>
        ) : (
          <span className="mt-1 block text-[0.75rem] text-grey">{chatTime(item.createdAt)}</span>
        )}
      </span>
      {waitingSince ? (
        <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 flex-none self-center text-grey" />
      ) : item.read ? null : (
        <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 flex-none rounded-full bg-emphasis" />
      )}
    </button>
  );
}
