import { Link } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { WheelIcon } from '@/components/wheel-badge';
import { pointsInWords, SPOKES, WHEEL_LEVELS, wheelOf } from '@/lib/wheelies';

/**
 * How Wheelie points work, from the 2-pager (The SCI Club: What We're
 * Building, "Wheelie points"), with the owner's choices of 2026-11-20: only
 * Going earns an RSVP's points, anonymous posts and reviews earn none, and a
 * post that is not a question earns as a question does. Opened from a wheel's
 * sheet and from the Wheelie points on a profile.
 *
 * The numbers here are the ones private.wheelie_ledger counts
 * (20261121030000): change one, change both.
 */

const EARNING: readonly { what: string; points: string }[] = [
  { what: 'RSVP Going to an event', points: '30' },
  { what: 'Check in at an event', points: '100' },
  { what: 'Write a review', points: '100' },
  {
    what: 'Ask a question or start a post',
    points: '10, plus 10 for each upvote and 3 for each reply or reaction it gets',
  },
  { what: 'Ask a first question', points: '50 extra' },
  {
    what: 'Answer a question or post a comment',
    points: '5, plus 10 for each upvote and 3 for each reply or reaction it gets',
  },
  {
    what: 'Complete a part of your profile',
    points:
      '10 for each part: a photo, your injury or condition, when you were injured, your city, your state, and each answer in the profile survey',
  },
  {
    what: 'Keep a streak: use the club days in a row',
    points: '5 for each day, from the second',
  },
];

const RULES: readonly string[] = [
  'A downvote takes nothing away. Nobody loses Wheelie points because others didn’t like a question or an answer.',
  'Your own upvotes, replies and reactions don’t count, and neither does an administrator’s boost.',
  'A post an administrator removes earns nothing.',
  'Anonymous questions, answers and reviews earn nothing, so the points beside your name never point back to them.',
  'An RSVP earns its points once for each event, and checking in earns more on top. Cancel, or don’t check in, and the RSVP’s points go.',
];

export default function WheeliePointsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        <div className="mx-auto w-full max-w-[560px]">
          <BackLink to="/home" label="Home" />
          <h1 className="mt-1 font-display font-extrabold text-[1.5625rem] text-ink tracking-[-0.01em]">
            How Wheelie points work
          </h1>
          <p className="mt-1 text-[0.875rem] text-ink2 leading-[1.5]">
            Members earn Wheelie points for taking part in the club: asking and answering questions,
            coming to events and writing reviews. The wheel beside each name shows how many.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[560px] flex-none px-4 pt-2 pb-10">
        <Heading>How to earn them</Heading>
        <dl className="rounded-[14px] border border-line bg-paper px-3.5">
          {EARNING.map((row) => (
            <div key={row.what} className="flex gap-3 border-line border-b py-3 last:border-b-0">
              <dt className="w-[44%] flex-none font-semibold text-[0.84375rem] leading-[1.4]">
                {row.what}
              </dt>
              <dd className="text-[0.84375rem] text-ink2 leading-[1.4]">{row.points}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[0.8125rem] text-ink2 leading-[1.5]">
          Questions and comments earn more when other members upvote them and respond to them. An
          upvote is worth more than a response, because it says the post was good. Coming to an
          event earns the most up front, because real life is the goal.
        </p>
        <p className="mt-2 text-[0.8125rem] text-ink2 leading-[1.5]">
          A streak is the number of days in a row you use the club. Missing a day starts it over,
          and the points already earned stay.
        </p>

        <Heading>The wheel</Heading>
        <p className="text-[0.8125rem] text-ink2 leading-[1.5]">
          The wheel’s colour is your level. Its {SPOKES} spokes fill one at a time as you earn
          towards the next level; when the seventh would fill, the wheel takes the next colour and
          the spokes start over.
        </p>
        <ul className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3" aria-label="Spokes filling">
          {Array.from({ length: SPOKES }, (_, spokes) => {
            const points = Math.ceil(((WHEEL_LEVELS[1]?.from ?? 100) * spokes) / SPOKES);
            return (
              <li key={points} className="flex flex-col items-center gap-1">
                <WheelIcon wheel={wheelOf(points)} className="h-10 w-10" />
                <span className="text-[0.75rem] text-grey">
                  {spokes} of {SPOKES}
                </span>
              </li>
            );
          })}
          <li className="flex flex-col items-center gap-1">
            <WheelIcon wheel={wheelOf(WHEEL_LEVELS[1]?.from ?? 100)} className="h-10 w-10" />
            <span className="text-[0.75rem] text-grey">Next level</span>
          </li>
        </ul>

        <Heading>Levels</Heading>
        <ul className="rounded-[14px] border border-line bg-paper px-3.5">
          {WHEEL_LEVELS.map((level) => (
            <li
              key={level.level}
              className="flex items-center gap-3 border-line border-b py-2.5 last:border-b-0"
            >
              <WheelIcon wheel={wheelOf(level.from)} className="h-8 w-8 flex-none" />
              <span className="flex-1 text-[0.875rem]">
                <span className="font-semibold">Level {level.level}</span> · {level.name}
              </span>
              <span className="text-[0.8125rem] text-ink2 tabular-nums">
                {pointsInWords(level.from)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[0.75rem] text-grey leading-[1.45]">
          The Wheelie points a level starts at. Every member starts with a green wheel.
        </p>

        <Heading>Monthly leaderboard</Heading>
        <p className="text-[0.8125rem] text-ink2 leading-[1.5]">
          A leaderboard ranks members by the Wheelie points they earned that month. It starts over
          every month, so everybody starts the new month level; the wheel’s level keeps counting.
          The top ten each month might win a prize, such as swag or a gift card, and are enshrined
          in the Hall of Top Wheelies.
        </p>
        <Link
          to="/wheelie-points/leaderboard"
          className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2"
        >
          See this month’s leaderboard
        </Link>

        <Heading>Rules</Heading>
        <ul className="list-disc space-y-1.5 pl-5 text-[0.8125rem] text-ink2 leading-[1.5]">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
      {children}
    </h2>
  );
}
