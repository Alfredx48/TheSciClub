import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { FormerMemberAvatar, MemberAvatar } from '@/components/member-avatar';
import { WheelBadge } from '@/components/wheel-badge';
import { useAccount } from '@/lib/account';
import { useChatAuthors } from '@/lib/chat/authors';
import { describeThrown } from '@/lib/describe-error';
import {
  type HallMonth,
  type Leaderboard,
  loadLeaderboard,
  monthAfterStarts,
  monthInWords,
  type Placing,
  pointsInWords,
} from '@/lib/wheelies';

/**
 * The monthly Wheelie points leaderboard and the Hall of Top Wheelies, from
 * the 2-pager ("Monthly leaderboard and reward"; the owner, 2026-11-20): the
 * members who earned the most Wheelie points this month, starting over each
 * month while the wheel's level keeps counting, and each past month's top ten.
 */
export default function LeaderboardPage() {
  const account = useAccount();
  const me = account.status === 'member' ? account.userId : null;
  const [found, setFound] = useState<
    | { state: 'loading' }
    | { state: 'failed'; message: string }
    | { state: 'ready'; board: Leaderboard; hall: HallMonth[] }
  >({ state: 'loading' });
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is Try again, to read it again.
  useEffect(() => {
    let live = true;
    loadLeaderboard().then(
      ({ board, hall }) => {
        if (live) setFound({ state: 'ready', board, hall });
      },
      (thrown: unknown) => {
        if (live) setFound({ state: 'failed', message: describeThrown(thrown) });
      },
    );
    return () => {
      live = false;
    };
  }, [round]);

  const placings =
    found.state === 'ready'
      ? [...found.board.top, ...found.hall.flatMap((month) => month.winners)]
      : [];
  const authors = useChatAuthors(placings.map((p) => p.memberId));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        <div className="mx-auto w-full max-w-[560px]">
          <BackLink to="/wheelie-points" label="How Wheelie points work" />
          <h1 className="mt-1 font-display font-extrabold text-[1.5625rem] text-ink tracking-[-0.01em]">
            Leaderboard
          </h1>
          <p className="mt-1 text-[0.875rem] text-ink2 leading-[1.5]">
            {found.state === 'ready'
              ? `Wheelie points earned in ${monthInWords(found.board.month)}. Everybody starts from zero again on ${monthAfterStarts(found.board.month)}; the wheel’s level keeps counting.`
              : 'Wheelie points earned this month. Everybody starts from zero again next month; the wheel’s level keeps counting.'}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[560px] flex-none px-4 pt-4 pb-10">
        {found.state === 'loading' ? (
          <p role="status" className="py-6 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : found.state === 'failed' ? (
          <div>
            <p role="alert" className="text-[0.875rem] text-destructive leading-[1.5]">
              {found.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setFound({ state: 'loading' });
                setRound((n) => n + 1);
              }}
              className="mt-2 min-h-[44px] font-semibold text-emphasis underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <p className="rounded-[14px] border border-line bg-paper px-3.5 py-3 text-[0.875rem] leading-[1.45]">
              {found.board.me ? (
                <>
                  You’re <span className="font-bold">#{found.board.me.rank}</span> this month, with{' '}
                  {pointsInWords(found.board.me.points)} Wheelie points.
                </>
              ) : (
                'You haven’t earned Wheelie points this month yet.'
              )}
            </p>
            <p className="mt-2 text-[0.75rem] text-grey leading-[1.45]">
              The top ten each month are enshrined in the Hall of Top Wheelies, and might win a
              prize such as swag or a gift card.
            </p>

            {found.board.top.length === 0 ? (
              <p className="mt-5 text-[0.875rem] text-ink2 leading-[1.5]">
                Nobody has earned Wheelie points this month yet.
              </p>
            ) : (
              <>
                <Heading>Top ten</Heading>
                <Placings
                  placings={found.board.top.filter((p) => p.rank <= 10)}
                  authors={authors}
                  me={me}
                />
                {found.board.top.some((p) => p.rank > 10) ? (
                  <>
                    <Heading>Everyone else</Heading>
                    <Placings
                      placings={found.board.top.filter((p) => p.rank > 10)}
                      authors={authors}
                      me={me}
                    />
                  </>
                ) : null}
              </>
            )}

            <Heading>Hall of Top Wheelies</Heading>
            {found.hall.length === 0 ? (
              <p className="text-[0.875rem] text-ink2 leading-[1.5]">
                The first top ten will be enshrined here when{' '}
                {monthInWords(found.board.month).split(' ')[0]} ends.
              </p>
            ) : (
              <div className="space-y-4">
                {found.hall.map((month) => (
                  <section key={month.month} aria-label={monthInWords(month.month)}>
                    <h3 className="mb-2 font-extrabold font-head text-[0.9375rem]">
                      {monthInWords(month.month)}
                    </h3>
                    <Placings placings={month.winners} authors={authors} me={me} />
                  </section>
                ))}
              </div>
            )}
          </>
        )}
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

function Placings({
  placings,
  authors,
  me,
}: {
  placings: Placing[];
  authors: ReturnType<typeof useChatAuthors>;
  me: string | null;
}) {
  return (
    <ol className="overflow-hidden rounded-[14px] border border-line bg-paper px-3">
      {placings.map((placing) => {
        const author = authors.get(placing.memberId);
        const mine = placing.memberId === me;
        return (
          <li
            key={placing.memberId}
            className={`-mx-3 flex items-center gap-3 border-line border-b px-3 py-2.5 last:border-b-0 ${mine ? 'bg-tint' : ''}`}
          >
            <span className="w-7 flex-none text-right font-extrabold font-head text-[0.9375rem] text-ink2 tabular-nums">
              {placing.rank}
            </span>
            <span aria-hidden="true" className="flex-none">
              {author ? (
                <MemberAvatar
                  id={author.id}
                  displayName={author.displayName}
                  photoPath={author.photoPath}
                  photoAlt={author.photoAlt}
                />
              ) : (
                <FormerMemberAvatar />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold font-head text-[0.90625rem] text-ink leading-tight">
                {author?.hasProfile ? (
                  <Link
                    to={`/peers/${author.id}`}
                    className="underline decoration-line underline-offset-2 hover:decoration-emphasis"
                  >
                    {author.displayName}
                  </Link>
                ) : (
                  (author?.displayName ?? 'A member')
                )}
                {mine ? <span className="font-normal text-grey"> — you</span> : null}
              </span>
              <span className="block text-[0.71875rem] text-grey">
                {author?.level ? (
                  <LevelHighlight
                    level={author.level}
                    stage={author.stage}
                    band={author.band}
                    injuryType={author.injuryType}
                  />
                ) : null}
                <WheelBadge
                  memberId={placing.memberId}
                  name={author?.displayName}
                  className={author?.level ? 'ml-1.5' : undefined}
                />
              </span>
            </span>
            <span className="flex-none text-right">
              <span className="block font-bold text-[0.9375rem] tabular-nums">
                {pointsInWords(placing.points)}
              </span>
              <span className="block text-[0.6875rem] text-grey">points</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
