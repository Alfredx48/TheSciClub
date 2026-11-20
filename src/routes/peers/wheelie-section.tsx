import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WheelIcon } from '@/components/wheel-badge';
import { chatTime } from '@/lib/chat/time';
import {
  pointsInWords,
  postPointsInWords,
  useWheelieBreakdown,
  WHEEL_LEVELS,
  type WheelieBreakdown,
  wheelOf,
} from '@/lib/wheelies';
import { Section } from '@/routes/peers/profile-parts';

/**
 * A member's Wheelie points on their profile, as the 2-pager has it ("On each
 * profile"; the owner, 2026-11-20): the total and the level, the points from
 * each activity, the current streak, then the questions they asked and
 * answered with what each earned. Draws nothing until it is read, and nothing
 * for somebody who does not earn them (an organization, a directory listing).
 */
export function WheelieSection({ memberId, name }: { memberId: string; name: string }) {
  const breakdown = useWheelieBreakdown(memberId);
  if (!breakdown) return null;
  const wheel = wheelOf(breakdown.total);
  const first = name.trim().split(/\s+/)[0] ?? name;

  return (
    <Section title="Wheelie points">
      <div className="rounded-[17px] border border-line bg-paper p-3.5">
        <div className="flex items-center gap-3">
          <WheelIcon wheel={wheel} className="h-12 w-12 flex-none" />
          <div className="min-w-0">
            <p className="font-extrabold font-head text-[1.375rem] leading-none">
              {pointsInWords(breakdown.total)}{' '}
              <span className="font-semibold text-[0.875rem] text-ink2">Wheelie points</span>
            </p>
            <p className="mt-1 text-[0.8125rem] text-grey">
              Level {wheel.level.level} of {WHEEL_LEVELS.length} · {wheel.level.name}
            </p>
          </div>
        </div>
        <dl className="mt-3">
          {rowsOf(breakdown).map((row) => (
            <div
              key={row.label}
              className="flex items-baseline gap-3 border-line border-t py-2.5 first:border-t-0"
            >
              <dt className="min-w-0 flex-1">
                <span className="block font-semibold text-[0.84375rem]">{row.label}</span>
                {row.detail ? (
                  <span className="block text-[0.75rem] text-grey leading-[1.4]">{row.detail}</span>
                ) : null}
              </dt>
              <dd
                className={`flex-none font-semibold text-[0.875rem] tabular-nums ${row.points ? 'text-ink' : 'text-grey'}`}
              >
                {pointsInWords(row.points)}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          to="/wheelie-points"
          className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
        >
          How Wheelie points work
        </Link>
        <Link
          to="/wheelie-points/leaderboard"
          className="mt-1 ml-5 inline-flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
        >
          Leaderboard
        </Link>
      </div>

      <PostList breakdown={breakdown} first={first} />
    </Section>
  );
}

interface Row {
  label: string;
  detail: string | null;
  points: number;
}

/** "2 RSVPs" */
function many(n: number, one: string, more: string): string | null {
  if (!n) return null;
  return `${n} ${n === 1 ? one : more}`;
}

function joined(parts: (string | null)[]): string | null {
  const said = parts.filter((p): p is string => p !== null);
  return said.length ? said.join(' · ') : null;
}

/** The 2-pager's seven rows, in its order. */
function rowsOf(b: WheelieBreakdown): Row[] {
  const n = (kind: string) => b.kinds[kind]?.count ?? 0;
  const p = (...kinds: string[]) =>
    kinds.reduce((sum, kind) => sum + (b.kinds[kind]?.points ?? 0), 0);
  return [
    {
      label: 'Events',
      detail: joined([
        many(n('rsvp'), 'RSVP', 'RSVPs'),
        many(n('check_in'), 'check-in', 'check-ins'),
        many(n('review'), 'review', 'reviews'),
      ]),
      points: p('rsvp', 'check_in', 'review'),
    },
    {
      label: 'Questions asked',
      detail: joined([
        many(n('question'), 'question', 'questions'),
        many(n('post'), 'post', 'posts'),
        n('first_question') ? '50 for a first question' : null,
      ]),
      points: p('question', 'post', 'first_question'),
    },
    {
      label: 'Answers and comments',
      detail: many(n('reply'), 'answer or comment', 'answers and comments'),
      points: p('reply'),
    },
    {
      label: 'Upvotes received',
      detail: many(n('upvote'), 'upvote', 'upvotes'),
      points: p('upvote'),
    },
    {
      label: 'Replies and reactions received',
      detail: many(n('response'), 'reply or reaction', 'replies and reactions'),
      points: p('response'),
    },
    {
      label: 'Profile parts completed',
      detail: many(n('profile'), 'part', 'parts'),
      points: p('profile'),
    },
    {
      label: 'Streaks',
      detail: joined([
        many(n('streak'), 'streak day', 'streak days'),
        `current streak ${b.streak === 1 ? 'one day' : `${b.streak} days`}`,
      ]),
      points: p('streak'),
    },
  ];
}

const SHOWN = 5;

function PostList({ breakdown, first }: { breakdown: WheelieBreakdown; first: string }) {
  const [all, setAll] = useState(false);
  const posts = breakdown.posts;
  if (!posts.length) return null;
  const shown = all ? posts : posts.slice(0, SHOWN);
  return (
    <>
      <h3 className="mt-4 mb-2 font-semibold text-[0.8125rem] text-ink2">
        What {first} asked and answered
      </h3>
      <ul className="space-y-2">
        {shown.map((post) => (
          <li key={post.postId} className="rounded-[14px] border border-line bg-paper p-3">
            <p className="font-semibold text-[0.75rem] text-grey">
              {post.opening
                ? post.isQuestion
                  ? 'Asked'
                  : 'Posted'
                : post.isQuestion
                  ? 'Answered'
                  : 'Commented'}{' '}
              · {chatTime(post.at)}
            </p>
            <div className="mt-0.5 flex items-baseline gap-3">
              <Link
                to={`/chat/rooms/${post.roomId}/topics/${post.topicId}${post.opening ? '' : `?post=${post.postId}`}`}
                className="min-w-0 flex-1 font-extrabold font-head text-[0.9375rem] text-ink leading-[1.3] underline-offset-2 hover:underline"
              >
                {post.title}
              </Link>
              <span className="flex-none font-semibold text-[0.875rem] tabular-nums">
                {pointsInWords(post.points)}
              </span>
            </div>
            <p className="mt-1 text-[0.75rem] text-ink2 leading-[1.4]">{postPointsInWords(post)}</p>
          </li>
        ))}
      </ul>
      {posts.length > SHOWN && !all ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
          }}
          className="mt-2 min-h-[44px] font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
        >
          Show all {posts.length}
        </button>
      ) : null}
    </>
  );
}
