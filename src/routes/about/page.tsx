import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { LoadingCards } from '@/components/loading-cards';
import { useTeam } from '@/routes/about/team';
import { MemberCard } from '@/routes/peers/member-card';

/**
 * About us, at /about: the members building the club, for anybody (the
 * owner, 2026-11-15), linked from the welcome screen's "by people with SCI".
 * Drawn as Peers is, and each card opens the member's profile (the owner: "I
 * want the about page to look just like the peers tab"), with the city, age
 * and the injury's month and day blurred (blurred.tsx).
 */
export default function AboutPage() {
  const { team, failed } = useTeam();
  const navigate = useNavigate();

  return (
    <main id="main" tabIndex={-1} className="min-h-dvh bg-canvas outline-none">
      <header className="border-line border-b bg-paper px-[18px] pt-3 pb-4">
        <div className="mx-auto w-full max-w-[1100px]">
          <Link
            to="/"
            data-target="small"
            className="-ml-1.5 inline-flex min-h-[36px] items-center gap-0.5 py-1.5 font-semibold text-[0.875rem] text-emphasis"
          >
            <ChevronLeft className="h-4 w-4" />
            The SCI Club
          </Link>
          <h1 className="mt-2 font-extrabold font-display text-[1.75rem] text-ink leading-tight tracking-[-0.01em]">
            The people building the club
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-ink2 leading-[1.55]">
            The SCI Club is built by people with spinal cord injuries, for people with spinal cord
            injuries. These are the members working on the app.
          </p>
          <p className="mt-1.5 text-[0.8125rem] text-grey leading-[1.5]">
            Last names, ages, cities and the month and day of each injury are blurred here. Members
            see them inside the club.
          </p>
        </div>
      </header>

      <div className="px-4 pt-3.5 pb-[max(24px,env(safe-area-inset-bottom))] md:px-6">
        <div className="mx-auto w-full max-w-[1100px]">
          {failed ? (
            <p className="px-6 py-10 text-center text-[0.875rem] text-ink2 leading-relaxed">
              The team could not be loaded. Try again in a moment.
            </p>
          ) : team ? (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
              {team.map(({ member, lastNameHidden }, index) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  publicView
                  lastNameHidden={lastNameHidden}
                  priority={index < 2}
                  onOpen={() => {
                    void navigate(`/about/${member.id}`);
                  }}
                />
              ))}
            </div>
          ) : (
            <LoadingCards label="Loading the team…" height={400} />
          )}

          <JoinTheClub />
        </div>
      </div>
    </main>
  );
}

/** "Join the club", to meet them and the rest (the owner, 2026-11-15). */
export function JoinTheClub({ who }: { who?: string | undefined }) {
  return (
    <div className="mx-auto mt-6 max-w-[480px] rounded-[18px] border border-line bg-paper p-4 text-center">
      <p className="font-bold text-[0.9375rem] text-emphasis leading-[1.45]">
        Meet {who ?? 'them'} and other people with SCI.
      </p>
      <Link
        to="/join"
        state={{ door: 'join' }}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-action font-bold font-head text-[0.9375rem] text-white"
      >
        Join the club
      </Link>
    </div>
  );
}
