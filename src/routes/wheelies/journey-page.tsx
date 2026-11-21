import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { WheelIcon } from '@/components/wheel-icon';
import { useAccount } from '@/lib/account';
import { useChatAuthors } from '@/lib/chat/authors';
import { chatTime } from '@/lib/chat/time';
import {
  pointsInWords,
  SPOKES,
  useWheelieBreakdown,
  WHEEL_LEVELS,
  type WheelieBreakdown,
  type WheeliePost,
  wheelOf,
} from '@/lib/wheelies';
import { shortDate } from '@/routes/events/format';

/**
 * A member's journey in the club (the owner, 2026-11-20): their wheel and
 * Wheelie points, what earns them, and every one they earned, by activity. A
 * row opened shows its history: Questions asked lists the questions, Events
 * the events, and so on. The member's own at /me/journey; anybody's from their
 * profile at /peers/:id/journey, where only what the reader may see is listed
 * (public.member_wheelie_points).
 */
export default function JourneyPage() {
  const { id } = useParams();
  const account = useAccount();
  const me = account.status === 'member' ? account.userId : null;
  const memberId = id ?? me;
  const own = memberId !== null && memberId === me;
  const breakdown = useWheelieBreakdown(memberId);
  const author = useChatAuthors(own || !memberId ? [] : [memberId]).get(memberId ?? '');
  const first = author?.displayName.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        <div className="mx-auto w-full max-w-[560px]">
          <BackLink
            to={own ? '/me' : `/peers/${memberId ?? ''}`}
            label={own ? 'Me' : (author?.displayName ?? 'Profile')}
          />
          <h1 className="mt-1 font-display font-extrabold text-[1.5625rem] text-ink tracking-[-0.01em]">
            {own ? 'Your journey in the club' : `${first ?? 'Their'}’s journey in the club`}
          </h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[560px] flex-none px-4 pt-4 pb-10">
        {breakdown === undefined ? (
          <p role="status" className="py-6 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : breakdown === null ? (
          <p className="py-6 text-[0.875rem] text-ink2 leading-[1.5]">
            There are no Wheelie points to show here.
          </p>
        ) : (
          <Journey
            breakdown={breakdown}
            own={own}
            first={first}
            admin={account.status === 'member' && account.isAdmin}
          />
        )}
      </div>
    </div>
  );
}

function Journey({
  breakdown,
  own,
  first,
  admin,
}: {
  breakdown: WheelieBreakdown;
  own: boolean;
  first: string | undefined;
  /** The leaderboard is for admins to see for now (the owner, 2026-11-20). */
  admin: boolean;
}) {
  const wheel = wheelOf(breakdown.total);
  return (
    <>
      <div className="flex items-center gap-4 rounded-[17px] border border-line bg-paper p-4">
        <WheelIcon wheel={wheel} className="h-16 w-16 flex-none" />
        <div className="min-w-0">
          <p className="font-extrabold font-head text-[1.625rem] leading-none">
            {pointsInWords(breakdown.total)}{' '}
            <span className="font-semibold text-[0.9375rem] text-ink2">Wheelie points</span>
          </p>
          <p className="mt-1 text-[0.8125rem] text-grey">
            Level {wheel.level.level} of {WHEEL_LEVELS.length} · {wheel.level.name}
          </p>
          <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.4]">
            {wheel.next
              ? `${wheel.spokes} of ${SPOKES} spokes filled. ${pointsInWords(wheel.next.from - wheel.points)} more to level ${wheel.next.level}, ${wheel.next.name}.`
              : `All ${SPOKES} spokes filled: the top level.`}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[0.8125rem] text-ink2 leading-[1.5]">
        Members earn Wheelie points for taking part in the club. Tap a row to see where{' '}
        {own ? 'yours' : `${first ?? 'their'}’s`} came from.
      </p>
      <p className="mt-1 flex flex-wrap gap-x-5">
        <Link
          to="/wheelie-points"
          className="inline-flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
        >
          How Wheelie points work
        </Link>
        {admin ? (
          <Link
            to="/wheelie-points/leaderboard"
            className="inline-flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
          >
            Leaderboard (admins only)
          </Link>
        ) : null}
      </p>

      <div className="mt-2 overflow-hidden rounded-[17px] border border-line bg-paper">
        {rowsOf(breakdown, own, first).map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </div>
    </>
  );
}

interface RowData {
  label: string;
  detail: string | null;
  points: number;
  /** What earns these, said when the row is opened. */
  how: string;
  items: Item[];
  /** Said when there is nothing to list. */
  none: string;
}

interface Item {
  key: string;
  title: string;
  to: string | null;
  /** Said under the title, a piece at a time, each piece kept on one line. */
  meta: string[];
  points: number;
}

function many(n: number, one: string, more: string): string | null {
  if (!n) return null;
  return `${n} ${n === 1 ? one : more}`;
}

function pieces(parts: (string | null)[]): string[] {
  return parts.filter((p): p is string => p !== null);
}

function joined(parts: (string | null)[]): string | null {
  const said = pieces(parts);
  return said.length ? said.join(' · ') : null;
}

function postTo(post: WheeliePost): string {
  return `/chat/rooms/${post.roomId}/topics/${post.topicId}${post.opening ? '' : `?post=${post.postId}`}`;
}

/** Short names for the parts of a profile, as private.wheelie_parts_filled names them. */
const PARTS: Readonly<Record<string, string>> = {
  photo: 'Photo',
  injury: 'Injury or condition',
  injury_date: 'When injured',
  city: 'City',
  state: 'State',
  'q:gender': 'Gender',
  'q:languages': 'Languages',
  'q:how_injured': 'How it happened',
  'q:detail': 'More about the injury',
  'q:marital_status': 'Relationship',
  'q:has_children': 'Children',
  'q:children_when': 'When children came',
  'q:independence': 'Independence',
  'q:self_care': 'Self care',
  'q:employment': 'Work',
  'q:field_of_work': 'Field of work',
  'q:education': 'Education',
  'q:education_when': 'When educated',
  'q:interests': 'Interests',
  'q:topics': 'Happy to talk about',
  'q:wants_to_mentor': 'Mentoring',
  'q:sports_equipment': 'Adaptive sports equipment',
  'q:grants': 'Grants',
  'q:bio': 'Bio',
};

function partInWords(part: string): string {
  return PARTS[part] ?? part.replace(/^q:/, '').replaceAll('_', ' ');
}

/** The 2-pager's seven rows in its order, with what the member gave (2026-11-21), each with its history. */
function rowsOf(b: WheelieBreakdown, own: boolean, first: string | undefined): RowData[] {
  const n = (kind: string) => b.kinds[kind]?.count ?? 0;
  const p = (...kinds: string[]) =>
    kinds.reduce((sum, kind) => sum + (b.kinds[kind]?.points ?? 0), 0);
  const whose = own ? 'your' : `${first ?? 'their'}’s`;
  const asked = b.posts.filter((post) => post.opening);
  const answered = b.posts.filter((post) => !post.opening);
  const days = (count: number) => (count === 1 ? 'one day' : `${count} days`);

  return [
    {
      label: 'Events',
      detail: joined([
        many(n('rsvp'), 'RSVP', 'RSVPs'),
        many(n('check_in'), 'check-in', 'check-ins'),
        many(n('review'), 'review', 'reviews'),
      ]),
      points: p('rsvp', 'check_in', 'review'),
      how: '30 for saying Going, 100 for checking in and 100 for a review.',
      none: 'No events yet.',
      items: b.events.map((event) => ({
        key: event.eventId,
        title: event.title,
        to: `/events/${event.eventId}`,
        meta: pieces([
          shortDate(event.startTime, event.timezone),
          event.rsvp ? `Going ${event.rsvp}` : null,
          event.checkIn ? `Checked in ${event.checkIn}` : null,
          event.review ? `Review ${event.review}` : null,
        ]),
        points: event.points,
      })),
    },
    {
      label: 'Questions and posts',
      detail: joined([
        many(n('question'), 'question', 'questions'),
        many(n('post'), 'post', 'posts'),
        n('first_question') ? '50 for a first question' : null,
      ]),
      points: p('question', 'post', 'first_question'),
      how: '10 for each question or post, and 50 more for a first question.',
      none: 'No questions or posts yet.',
      items: asked.map((post) => ({
        key: post.postId,
        title: post.title,
        to: postTo(post),
        meta: pieces([
          post.isQuestion ? 'Asked' : 'Posted',
          chatTime(post.at),
          post.first ? '50 for a first question' : null,
        ]),
        points: post.own,
      })),
    },
    {
      label: 'Answers and comments',
      detail: many(n('reply'), 'answer or comment', 'answers and comments'),
      points: p('reply'),
      how: '5 for each answer or comment.',
      none: 'No answers or comments yet.',
      items: answered.map((post) => ({
        key: post.postId,
        title: post.title,
        to: postTo(post),
        meta: [post.isQuestion ? 'Answered' : 'Commented', chatTime(post.at)],
        points: post.own,
      })),
    },
    {
      label: 'Upvotes received',
      detail: many(n('upvote'), 'upvote', 'upvotes'),
      points: p('upvote'),
      how: '10 for each upvote another member gives a question, post, answer or comment.',
      none: 'No upvotes yet.',
      items: b.posts
        .filter((post) => post.upvotes > 0)
        .map((post) => ({
          key: post.postId,
          title: post.title,
          to: postTo(post),
          meta: pieces([many(post.upvotes, 'upvote', 'upvotes')]),
          points: post.upvotes * 10,
        })),
    },
    {
      label: 'Replies and reactions received',
      detail: many(n('response'), 'reply or reaction', 'replies and reactions'),
      points: p('response'),
      how: '3 for each reply or reaction from another member.',
      none: 'No replies or reactions yet.',
      items: b.posts
        .filter((post) => post.responses > 0)
        .map((post) => ({
          key: post.postId,
          title: post.title,
          to: postTo(post),
          meta: pieces([many(post.responses, 'reply or reaction', 'replies and reactions')]),
          points: post.responses * 3,
        })),
    },
    {
      // Given, not received (the owner, 2026-11-21: "your full history"). Which
      // post and which way only to the member: a downvote is never shown.
      label: 'Votes and reactions given',
      detail: joined([
        many(n('voted'), 'vote', 'votes'),
        many(n('reacted'), 'reaction', 'reactions'),
      ]),
      points: p('voted', 'reacted'),
      how: `1 for each upvote, downvote or reaction given to another member\u2019s question, post, answer or comment.${own ? ' Only you can see this list.' : ''}`,
      none: own
        ? 'No votes or reactions yet.'
        : `${n('voted') + n('reacted')} votes and reactions. Only ${first ?? 'they'} can see which.`,
      items: (b.given ?? []).map((given) => ({
        key: `${given.kind}-${given.postId}`,
        title: given.title,
        to: `/chat/rooms/${given.roomId}/topics/${given.topicId}?post=${given.postId}`,
        meta: [
          given.kind === 'upvote'
            ? 'Upvoted'
            : given.kind === 'downvote'
              ? 'Downvoted'
              : `Reacted ${given.emoji ?? ''}`.trim(),
          chatTime(given.at),
        ],
        points: given.points,
      })),
    },
    {
      label: 'Profile parts completed',
      detail: many(n('profile'), 'part', 'parts'),
      points: p('profile'),
      how: `10 for each part of ${whose} profile: a photo, the injury or condition, when injured, city, state, and each answer in the profile survey.`,
      none: own ? 'Nothing filled in yet.' : `${n('profile')} parts of ${whose} profile.`,
      items: (b.parts ?? []).map((part) => ({
        key: part,
        title: partInWords(part),
        to: null,
        meta: [],
        points: 10,
      })),
    },
    {
      label: 'Streaks',
      detail: joined([`current streak ${days(b.streak)}`, `longest ${days(b.bestStreak)}`]),
      points: p('streak'),
      how: '5 for each day in a row using the club, from the second day. Missing a day starts it over; the points stay.',
      none: '',
      items: [
        { key: 'now', title: 'Current streak', to: null, meta: [days(b.streak)], points: 0 },
        { key: 'best', title: 'Longest streak', to: null, meta: [days(b.bestStreak)], points: 0 },
        {
          key: 'earned',
          title: 'Days that earned points',
          to: null,
          meta: [days(n('streak'))],
          points: p('streak'),
        },
      ],
    },
  ];
}

const SHOWN = 10;

function Row({ row }: { row: RowData }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const panelId = useId();
  const items = all ? row.items : row.items.slice(0, SHOWN);
  const streaks = row.label === 'Streaks';

  return (
    <div className="border-line border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((was) => !was);
        }}
        className="flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-tint"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[0.90625rem]">{row.label}</span>
          {row.detail ? (
            <span className="block text-[0.75rem] text-grey leading-[1.4]">{row.detail}</span>
          ) : null}
        </span>
        <span
          className={`flex-none font-semibold text-[0.9375rem] tabular-nums ${row.points ? 'text-ink' : 'text-grey'}`}
        >
          {pointsInWords(row.points)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 flex-none text-grey transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div id={panelId} className="bg-canvas/40 px-3.5 pt-1 pb-3">
          <p className="text-[0.78125rem] text-ink2 leading-[1.45]">{row.how}</p>
          {row.items.length === 0 ? (
            row.none ? (
              <p className="mt-2 text-[0.8125rem] text-grey">{row.none}</p>
            ) : null
          ) : (
            <ul className="mt-2 space-y-1.5">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex items-baseline gap-3 rounded-[11px] border border-line bg-paper px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="block font-semibold text-[0.84375rem] text-ink leading-[1.35] underline decoration-line underline-offset-2 hover:decoration-emphasis"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span className="block font-semibold text-[0.84375rem] leading-[1.35]">
                        {item.title}
                      </span>
                    )}
                    {item.meta.length && (!streaks || item.points) ? (
                      <span className="block text-[0.75rem] text-grey">
                        {item.meta.map((piece, i) => (
                          <span key={piece} className="whitespace-nowrap">
                            {i ? ' · ' : ''}
                            {piece}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex-none text-[0.84375rem] text-ink2 tabular-nums">
                    {streaks && !item.points ? item.meta[0] : `+${pointsInWords(item.points)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {row.items.length > SHOWN && !all ? (
            <button
              type="button"
              onClick={() => {
                setAll(true);
              }}
              className="mt-1 min-h-[44px] font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
            >
              Show all {row.items.length}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
