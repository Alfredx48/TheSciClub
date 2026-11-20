import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { InjuryStageNote } from '@/components/injury-stage-pill';
import { LinkedText } from '@/components/linked-text';
import { PhotoViewer } from '@/components/photo-viewer';
import { usePhoto } from '@/lib/use-photo';
import { Blurred, InjuredIn, STAND_IN_AGE, STAND_IN_PLACE, TeamName } from '@/routes/about/blurred';
import { JoinTheClub } from '@/routes/about/page';
import { useTeam } from '@/routes/about/team';
import { gradientFor, initialsOf, levelPart } from '@/routes/peers/member-card';
import { Chips, childrenLabel, DetailRow, Section } from '@/routes/peers/profile-parts';
import { isAdminOfAny, isMentor, RolePill } from '@/routes/peers/role-pill';

/**
 * A team member's profile on About us, at /about/:id, for anybody (the owner,
 * 2026-11-15: "be able to see their profile"). The profile members see
 * (peers/member-detail.tsx), drawn the same way, with the city, age and the
 * injury's month and day blurred, and nothing a member does from it: no
 * message, family, report or block.
 */
export default function AboutProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { team, failed } = useTeam();
  const found = team?.find(({ member }) => member.id === id) ?? null;
  const { url: photo, onError: photoFailed } = usePhoto(found?.member.photoPath);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoButton = useRef<HTMLButtonElement | null>(null);
  // Opened from the list scrolled down: start at the top, at the photograph.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (failed || (team && !found)) {
    return (
      <main id="main" tabIndex={-1} className="min-h-dvh bg-canvas px-6 py-10 outline-none">
        <p className="text-center text-[0.9375rem] text-ink2">
          {failed ? 'This profile could not be loaded.' : 'That person is not on the team.'}{' '}
          <Link to="/about" className="font-semibold text-emphasis underline">
            Back to About us
          </Link>
        </p>
      </main>
    );
  }
  if (!found) {
    return (
      <main id="main" tabIndex={-1} className="min-h-dvh bg-canvas outline-none">
        <p role="status" className="px-6 py-10 text-center text-[0.9375rem] text-grey">
          Loading…
        </p>
      </main>
    );
  }

  const { member, injuryYear } = found;
  const [from, to] = gradientFor(member.id);

  return (
    <main id="main" tabIndex={-1} className="min-h-dvh bg-canvas outline-none">
      <div className="relative mx-auto w-full max-w-[62rem] lg:px-4 lg:pt-3">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-3 lg:static lg:px-0 lg:pt-0 lg:pb-2.5">
          <Link
            to="/about"
            replace
            data-target="small"
            className="-ml-1.5 inline-flex min-h-[36px] items-center gap-0.5 py-1.5 font-semibold text-[0.875rem] text-white drop-shadow-[0_1px_2px_rgba(10,29,54,0.6)] lg:text-emphasis lg:drop-shadow-none"
          >
            <ChevronLeft className="h-4 w-4" />
            About us
          </Link>
          {isMentor(member) || isAdminOfAny(member) ? (
            <span className="flex flex-wrap justify-end gap-1.5">
              {isMentor(member) ? (
                <RolePill kind="mentor" organizations={member.mentorOrganizations} />
              ) : null}
              {isAdminOfAny(member) ? (
                <RolePill
                  kind="admin"
                  organizations={member.representedOrganizations}
                  className="lg:bg-action lg:text-white"
                />
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="lg:block">
          <div className="lg:float-left lg:mr-8 lg:mb-3 lg:w-[20rem] lg:overflow-hidden lg:rounded-[26px] lg:shadow-[0_10px_26px_rgba(10,20,35,.18)]">
            <div
              className="relative h-[350px] overflow-hidden lg:aspect-[4/5] lg:h-auto"
              style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center font-extrabold font-display text-[6.5rem] text-white opacity-[0.13]"
              >
                {initialsOf(member.displayName)}
              </span>
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-[50%_26%]"
                  onError={photoFailed}
                />
              ) : null}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[90px] bg-gradient-to-b from-black/50 to-transparent lg:hidden"
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[190px] bg-gradient-to-b from-transparent via-black/55 via-60% to-black/75"
              />
              {photo ? (
                <button
                  ref={photoButton}
                  type="button"
                  aria-label={`Open ${member.displayName}’s photograph`}
                  onClick={() => {
                    setPhotoOpen(true);
                  }}
                  className="absolute inset-0 cursor-zoom-in"
                />
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 px-[18px] pb-3.5">
                <h1 className="font-extrabold font-display text-[1.875rem] text-white leading-tight tracking-[-0.01em]">
                  <TeamName first={member.displayName} lastNameHidden={found.lastNameHidden} />
                </h1>
                {member.username ? (
                  <p className="mt-0.5 font-semibold text-[0.9375rem] text-white">
                    @{member.username}
                  </p>
                ) : null}
                <p className="mt-1 text-[0.875rem] text-white">
                  {levelPart(member)}{' '}
                  <span className="whitespace-nowrap">
                    · <Blurred>{STAND_IN_AGE}</Blurred> · <Blurred>{STAND_IN_PLACE}</Blurred>
                  </span>
                </p>
                <InjuryStageNote member={member} className="mt-1.5" />
                {injuryYear ? (
                  <p className="mt-1 text-[0.78125rem] text-white/90">
                    <InjuredIn year={injuryYear} precision={member.injuryDatePrecision} />
                  </p>
                ) : null}
              </div>
            </div>

            {photoOpen && photo ? (
              <PhotoViewer
                url={photo}
                label={
                  member.photoAlt?.trim()
                    ? member.photoAlt.trim()
                    : `Photograph of ${member.displayName}`
                }
                title={`${member.displayName}’s photograph`}
                index={0}
                count={1}
                onStep={() => undefined}
                onClose={() => {
                  setPhotoOpen(false);
                  photoButton.current?.focus();
                }}
              />
            ) : null}
          </div>

          <div className="min-w-0 px-4 lg:contents">
            {member.bio ? (
              <Section title="Bio">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.bio} />
                </p>
              </Section>
            ) : null}

            {member.howInjured ? (
              <Section title="How it happened">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">{member.howInjured}</p>
              </Section>
            ) : null}

            {member.topics.length ? (
              <Section title="Happy to talk about">
                <p className="-mt-1 mb-2.5 text-[0.78125rem] text-grey leading-[1.45]">
                  What {member.displayName} offered to be asked about.
                </p>
                <Chips items={member.topics} tone="solid" />
              </Section>
            ) : null}

            {member.interests.length ? (
              <Section title="Interests">
                <Chips items={member.interests} tone="outline" />
              </Section>
            ) : null}

            {member.selfCare.length || member.detail ? (
              <Section title="Uses day to day">
                {member.selfCare.length ? <Chips items={member.selfCare} tone="gold" /> : null}
                {member.detail ? (
                  <p
                    className={`${member.selfCare.length ? 'mt-2.5 ' : ''}text-[0.8875rem] text-ink2 leading-[1.52]`}
                  >
                    <LinkedText text={member.detail} />
                  </p>
                ) : null}
              </Section>
            ) : null}

            {member.affiliations.length ? (
              <Section title="Member of">
                <Chips items={member.affiliations} tone="outline" />
              </Section>
            ) : null}

            {member.sportsEquipment ? (
              <Section title="Adaptive sports equipment">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.sportsEquipment} />
                </p>
              </Section>
            ) : null}

            {member.grants ? (
              <Section title="Grants">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.grants} />
                </p>
              </Section>
            ) : null}

            <Section title="Details">
              <div className="flow-root rounded-[17px] border border-line bg-paper px-3.5 py-1">
                <DetailRow label="Independence" value={member.independence} />
                <DetailRow label="Work" value={member.employment} />
                <DetailRow label="Field" value={member.fieldOfWork} />
                <DetailRow label="Education" value={member.education} />
                <DetailRow
                  label="Children"
                  value={childrenLabel(member.hasChildren, member.childrenWhen)}
                />
                <DetailRow
                  label="Languages"
                  value={member.languages.length ? member.languages.join(', ') : null}
                />
                <DetailRow label="Where" value={<Blurred>{STAND_IN_PLACE}</Blurred>} />
              </div>
            </Section>

            <div className="clear-both pb-2">
              <JoinTheClub who={member.displayName.split(/\s+/)[0]} />
            </div>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </main>
  );
}
