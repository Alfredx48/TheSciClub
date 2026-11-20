import { Link } from 'react-router-dom';
import { TERMS_UPDATED } from '@/lib/terms';
import { ContactEmail, LegalPage, List, P, Section } from '@/routes/legal/legal-page';

/**
 * The Terms of Service, at /terms.
 *
 * The four ways to lose a membership are CONTEXT.md's, word for word. What is
 * not allowed, the 24-hour promise and how to report and block are what
 * Apple (1.2) and Google Play (UGC) ask a club like this to say.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={TERMS_UPDATED}>
      <Section title="The club">
        <P>
          The SCI Club is a private community for adults living with spinal cord injury and their
          family members, operated by Alfred Shaheen (“we”, “us”). By joining or using it you agree
          to these terms and to the{' '}
          <Link to="/privacy" className="font-semibold text-emphasis underline">
            Privacy Policy
          </Link>
          .
        </P>
      </Section>

      <Section title="Membership">
        <List>
          <li>
            <b>Invite only.</b> A member organization or a mentor puts your email address on the
            club’s list, and the club emails you a link, before you can join. An organization’s org
            admin can also make a QR code or link that lets people in until it expires. If you have
            no invite, you can ask an organization for one. The app cannot let you in by itself.
          </li>
          <li>
            <b>Adults only.</b> You must be 18 or over.
          </li>
          <li>
            <b>One account, and it is yours.</b> Give true details about yourself, and keep them up
            to date in Your details. Keep your password to yourself: what happens on your account is
            your responsibility. Do not share, sell or hand over your account.
          </li>
          <li>
            <b>Usernames.</b> We may change a username that is offensive, misleading, or someone
            else’s name, and tell you why.
          </li>
          <li>
            <b>Staff.</b> We may make a member who works with people with spinal cord injuries at an
            organization staff of that organization, shown with a verified mark, the organization
            and the profession they write. Staff can invite without a limit, make QR codes and links
            that let people in until they expire, and connect members, as an org admin can.
            Connecting adds them to a group conversation without asking them first, and anyone can
            leave it at any time. Staff’s word is not medical advice either, and we may end the role
            at any time.
          </li>
        </List>
      </Section>

      <Section title="Not medical advice">
        <P>
          Members share their own experience, and that is what makes the club worth having. But
          nothing here is medical advice, from members, mentors or organizations. Every body is
          different. Before you change your care, your medications or your equipment, check with
          your own doctor or care team.
        </P>
        <P>
          <b>In an emergency, call 911.</b>
        </P>
      </Section>

      <Section title="What is not allowed">
        <P>Objectionable content is anything that:</P>
        <List>
          <li>threatens, harasses, bullies or humiliates anyone;</li>
          <li>
            attacks people for their race, ethnicity, religion, disability, sex, sexual orientation,
            gender identity, age or where they come from;
          </li>
          <li>is pornographic, or is sexual and sent to someone who did not ask for it;</li>
          <li>shows or encourages violence, self-harm or anything illegal;</li>
          <li>shares somebody else’s private details or photographs without their permission;</li>
          <li>pretends to be somebody else;</li>
          <li>sells, advertises or spams.</li>
        </List>
        <P>Nor may you use the club against itself or its members:</P>
        <List>
          <li>
            collecting members’ details, by copying them out or with a script, bot or scraper;
          </li>
          <li>sending messages or making accounts in bulk, or by automated means;</li>
          <li>getting around a block, a removal, the invite list or the club’s security;</li>
          <li>making a report you know is false;</li>
          <li>sending anything that harms the app or the devices of the people using it.</li>
        </List>
        <P>
          Talking frankly about bodies, bladder and bowel care, and sex after injury is part of the
          club, and welcome.
        </P>
        <P>
          <b>The club has zero tolerance for objectionable content and for abusive members.</b>
        </P>
      </Section>

      <Section title="Losing your membership">
        <P>Membership can be taken away. Any of these will end it:</P>
        <List>
          <li>Selling to members.</li>
          <li>Harassing anyone.</li>
          <li>Giving medical advice as fact.</li>
          <li>Repeating outside a room what was said in it.</li>
        </List>
        <P>
          Posting objectionable content can end it too. We may remove anything that breaks these
          terms, give a strike (it shows on your Standing card, on Me), pause a membership, or end
          it.
        </P>
        <P>
          <b>Strikes.</b> A strike counts for 12 months, unless it is withdrawn. Three strikes
          within 12 months pause your membership for 30 days. It comes back on its own, and the
          strikes from before the pause stop counting. Three more strikes after a pause close your
          account for good, and the email address and phone number it used are blocked from joining
          again.
        </P>
        <P>
          <b>Anonymous posts.</b> An administrator can flag an anonymous post that breaks these
          terms. It is hidden, you are told why, and it counts as a strike. It also stops you
          posting anonymously: for a month after one flag, and for three months after a second
          within 12 months. Once your membership has been paused for strikes, you can no longer post
          anonymously. Nobody in the app, administrators included, can see who wrote an anonymous
          post, but the club’s database records it, so that replies and flags reach you.
        </P>
        <P>If your membership is ended, do not join again under another name or email address.</P>
      </Section>

      <Section title="Reporting and blocking">
        <P>
          <b>We review every report within 24 hours and act on it.</b>
        </P>
        <List>
          <li>
            <b>To report</b> a message, a post or a reply, press the <b>•••</b> beside it and choose{' '}
            <b>Report</b>. Administrators see only that one message, with who wrote it (unless it
            was posted anonymously) and when. The person reported is not told. To report a member’s
            profile, press the <b>•••</b> on it and choose <b>Report</b>: administrators see a copy
            of it as it was then, photograph included, and the member is not told. To report
            anything else, email <ContactEmail />.
          </li>
          <li>
            <b>To block</b> a member, press the <b>•••</b> on their profile, or beside anything they
            wrote, and choose <b>Block</b>. You stop seeing what they write, and they stop seeing
            what you write. Administrators can still see what you post. Neither of you can message
            the other, and nothing they do notifies you. They are not told; administrators are.
            Unblock them at any time from <b>Me → Settings → Blocked members</b>.
          </li>
        </List>
      </Section>

      <Section title="What you write">
        <P>
          What you write is yours. By posting it, you let the club keep it and show it to the
          members who can read where you posted it. Post only what is yours to share.
        </P>
        <P>
          Members cannot rename or delete a room once it is started; administrators can close a
          room, and can remove a post or a topic that should not be there. If you delete your
          account, what you wrote in Chat stays and says “Deleted member” instead of your name,
          until the other person in a one-to-one conversation deletes it.
        </P>
        <P>
          <b>Ideas and feedback</b> you send, in the App Feedback room or by email, may be used to
          improve the club, without anything owed for them.
        </P>
        <P>
          <b>If something posted is yours</b>, such as your photograph or your writing, and was
          shared without your permission, email <ContactEmail />. We will take it down if it should
          not be there, and tell the member who posted it.
        </P>
      </Section>

      <Section title="Events and other sites">
        <P>
          Events in the club are run by the organizations and people who host them, not by us. A
          link to another site opens that site, under its own terms.
        </P>
        <P>
          Meeting anybody from the club in person, at an event or one to one, is your own choice and
          at your own risk.
        </P>
      </Section>

      <Section title="Email">
        <P>
          <b>What the club emails you.</b> The club emails you to run your account: the code and
          link that confirm your address, a link to reset or change your password, a notice when
          your password changes, an invitation link when somebody invites you, and, if you add an
          event by calendar invitation, what became of it. It also emails you the day before an
          event you are going to, unless you switch that off on Me. It does not send newsletters or
          promotions. Questions or trouble getting an email: <ContactEmail />.
        </P>
        <P>
          <b>A phone number is optional.</b> If you add one, it is only so the host of an event you
          RSVP to can reach you about that event. It is never used to sign you in. How we handle it
          is in the{' '}
          <Link to="/privacy" className="font-semibold text-emphasis underline">
            Privacy Policy
          </Link>
          .
        </P>
      </Section>

      <Section title="The club as it is">
        <P>
          The club is free to use. It is offered as it is: we work to keep it running and safe, but
          cannot promise it will always be available, free of mistakes, or unchanged. Features may
          change, pause or stop.
        </P>
        <P>
          What members, mentors and organizations write and do is their own, not ours, and so are
          the events they host. As far as the law allows, we are not responsible for loss or harm
          that comes from using the club, or from what others say or do in it.
        </P>
      </Section>

      <Section title="Leaving">
        <P>
          You can delete your account at any time from <b>Me → Account → Delete my account</b>.{' '}
          <Link to="/delete-account" className="font-semibold text-emphasis underline">
            Deleting your account
          </Link>{' '}
          says what that erases and what stays.
        </P>
      </Section>

      <Section title="Changes">
        <P>
          If these terms change, the date at the top changes with them. Using the club after that
          means you accept the new terms.
        </P>
        <P>
          Notices from the club come by email or in the app, and count as notice in writing. If a
          part of these terms cannot be enforced, the rest still applies.
        </P>
      </Section>

      <Section title="Contact">
        <P>
          The SCI Club, operated by Alfred Shaheen: <ContactEmail />.
        </P>
      </Section>
    </LegalPage>
  );
}
