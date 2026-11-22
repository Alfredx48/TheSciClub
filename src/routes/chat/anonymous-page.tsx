import { Link } from 'react-router-dom';
import { ScreenBack } from '@/components/back-line';
import { AnonymousAvatar } from '@/components/member-avatar';
import { pauseEnds, useAnonymousStanding } from '@/lib/chat/anonymous';
import { LOSING_MEMBERSHIP_ID } from '@/routes/legal/legal-page';

/**
 * What "Anonymous" is, where a member's name would open their profile (the owner, 2026-11-20:
 * "if somebody taps on an anonymous response, avatar, etc., as if it would've been a person, it
 * takes them to a profile that explains what anonymous is"). Drawn like a profile's top, then
 * what it means, who knows, the rules (20261120110000), and the reader's own standing if they
 * have been flagged.
 */
export default function AnonymousPage() {
  const standing = useAnonymousStanding();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto flex w-full max-w-[640px] flex-col px-[18px] pt-2 pb-16">
        <ScreenBack />
        <div className="mt-4 flex flex-col items-center text-center">
          <AnonymousAvatar className="h-[5.5rem] w-[5.5rem] rounded-[26px]" />
          <h1 className="mt-3 font-display font-extrabold text-[1.5625rem] text-ink tracking-[-0.01em]">
            Anonymous
          </h1>
          <p className="mt-1 text-[0.9375rem] text-ink2 leading-[1.5]">
            A member of the club who chose not to show their name on this post.
          </p>
        </div>

        {standing && standing.state !== 'ok' ? (
          <section
            aria-label="Your anonymous posting"
            className="mt-6 rounded-[14px] border border-destructive/40 bg-destructive/5 p-4"
          >
            <h2 className="font-extrabold font-head text-[0.9375rem] text-ink">
              Your anonymous posting
            </h2>
            <p className="mt-1 text-[0.875rem] text-ink2 leading-[1.5]">
              {standing.state === 'paused' && standing.pausedUntil
                ? `Paused until ${pauseEnds(standing.pausedUntil)}, after an administrator flagged your anonymous ${standing.flags === 1 ? 'post' : 'posts'}. Until then, what you post shows your name.`
                : 'Ended: your membership was paused for strikes, so what you post shows your name.'}
            </p>
            <Link
              to="/me"
              className="mt-2 inline-block font-semibold text-[0.875rem] text-emphasis underline"
            >
              See your strikes on Me
            </Link>
          </section>
        ) : null}

        <Section title="Who can see who wrote it">
          Nobody in the app. Not other members, and not the club’s administrators. Only the person
          who wrote it sees “You” beside it. The club’s database records who wrote it, so that
          replies and flags reach them.
        </Section>

        <Section title="Anonymous · Asker">
          The person who asked the question, answering under it. It is still anonymous: it only
          tells you the follow-up comes from whoever asked.
        </Section>

        <Section title="Posting anonymously yourself">
          Tick “Anonymous” when you ask, share, answer or reply. It is offered in every discussion
          room except the Marketplace, where buyers need to reach the seller. It is not offered in
          direct messages or groups.
        </Section>

        <Section title="The club’s rules still apply">
          An administrator can flag an anonymous post that breaks them. It is hidden, the writer is
          told why and can respond, and it counts as a strike. After one flag the writer can’t post
          anonymously for a month, and after two within 12 months, for three months. Three strikes
          of any kind within 12 months pause a membership for 30 days, and after that the member can
          never post anonymously again.
        </Section>

        <p className="mt-6 text-[0.875rem] text-ink2 leading-[1.5]">
          <Link
            to={`/terms#${LOSING_MEMBERSHIP_ID}`}
            className="font-semibold text-emphasis underline"
          >
            How strikes work
          </Link>
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
        {title}
      </h2>
      <p className="mt-1.5 text-[0.9375rem] text-ink leading-[1.55]">{children}</p>
    </section>
  );
}
