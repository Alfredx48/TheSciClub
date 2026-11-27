import { Link } from 'react-router-dom';
import { PRIVACY_UPDATED } from '@/lib/terms';
import {
  ContactEmail,
  LegalPage,
  List,
  Note,
  OutsideLink,
  P,
  Section,
} from '@/routes/legal/legal-page';

/**
 * The Privacy Policy, at /privacy.
 *
 * Says what the code does, and nothing it does not: change one and change the
 * other. Stats naming members goes here in the same change (the owner).
 * Event hosts must stay in step with GOING_SHARES_CONTACT.
 *
 * Text-message sign-in was taken out 2026-10-21; its section, with the
 * carriers' wording, is at d4f26ef:src/routes/legal/privacy.tsx.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={PRIVACY_UPDATED}>
      <Note title="What changed on November 27, 2026">
        <List>
          <li>
            <b>Added:</b> a member can ask to join an invite-only event they open. Its organizers
            see their name and photograph, and approve or decline; only an approval is told to them
            (see Event hosts).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 16, 2026">
        <List>
          <li>
            <b>Changed:</b> verified professionals are now called staff, and each is staff of an
            organization an administrator chose, shown beside their name (see Who can see what).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 14, 2026">
        <List>
          <li>
            <b>Changed:</b> an event for the members of chosen organizations can again be opened by
            anyone with its link, as other events can. Who is going stays in the club. An
            invite-only event has no link to share: its organizers invite people by email, and each
            email carries that person’s own link (see Event hosts).
          </li>
          <li>
            <b>Added:</b> administrators and event organizers can invite a list of people at once,
            from a Google Sheet or pasted addresses. The email comes from them by name, greets each
            person by the name given, and can quote their message (see Emails).
          </li>
          <li>
            <b>Added:</b> an invite email carries a tiny picture. When your mail app loads it, we
            note that the email was opened. We also note when its link is first used, and whether
            you accept, say you are going and join. Whoever sent it sees this for each invite (see
            Emails).
          </li>
          <li>
            <b>Added:</b> an invite to an event by email shows the event, with Going, Maybe and
            Can’t go: one tap saves your answer, and its organizers see it. A member invited by name
            to an invite-only event is now emailed it too, as well as told in the app (see Emails).
          </li>
          <li>
            <b>Added:</b> an event’s page has Can’t go beside Going and Interested. It takes back
            your Going or Interested, and only you and the event’s organizers see it, on its guest
            list. Going or Interested again clears it.
          </li>
        </List>
      </Note>
      <Note title="What changed on November 7, 2026">
        <List>
          <li>
            <b>Added:</b> a member who joined as a relative or spouse and another member can link
            each other as family, such as a spouse, parent or child. It shows on both of your
            profiles only once the other says yes (see Who can see what).
          </li>
          <li>
            <b>Changed:</b> Cloudflare now counts visits to every page of the website, signed in or
            not, but only the kind of page, such as an event page, never which one, and never who
            you are. It runs apart from the club’s pages, where it cannot see your account (see
            Service providers).
          </li>
          <li>
            <b>Added:</b> everyone invited to an invite-only event sees who else is invited and who
            organized it: who added it, and anyone who changed it or invited people. A co-host’s org
            admins see a private event as its host’s do (see Event hosts).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 6, 2026">
        <List>
          <li>
            <b>Changed:</b> an org admin or a verified professional can connect two or more members
            at once, in a new group conversation or one that already exists (see Who can see what).
          </li>
          <li>
            <b>Added:</b> an event can be private, for the members of chosen organizations or for
            people its organizer invites. Nobody else can see it, in the app or from its link, and
            each person invited is told (see Event hosts).
          </li>
          <li>
            <b>Added:</b> Cloudflare counts visits to the website’s public pages by people who are
            not signed in, with no cookies (see Service providers).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 5, 2026">
        <List>
          <li>
            <b>Changed:</b> a notification of a group message now names the group, so the group’s
            name can show on your lock screen (see Notifications).
          </li>
          <li>
            <b>Changed:</b> a busy conversation notifies you at most once every two minutes while it
            stays unread, saying how many messages are new, and not while you have it open (see
            Notifications).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 4, 2026">
        <List>
          <li>
            <b>Added:</b> the app measures how long it takes to load, and how long each request to
            the club takes, so we can find what is slow. It is not tied to you (see What we
            collect).
          </li>
          <li>
            <b>Added:</b> an event’s organizers can invite somebody who registered on its public
            page to join the club. The invite goes to the address they registered with, and its link
            starts joining with the name and phone number they gave.
          </li>
          <li>
            <b>Changed:</b> trusted partners are now called verified professionals, shown with a
            verified mark, and each writes the profession shown beside their name.
          </li>
        </List>
      </Note>
      <Note title="What changed on November 3, 2026">
        <List>
          <li>
            <b>Added:</b> you can measure distances in Filters from another city, state or ZIP code
            instead of home. What you type is looked up with OpenStreetMap, and the place found is
            kept on your device only (see What we collect).
          </li>
        </List>
      </Note>
      <Note title="What changed on November 2, 2026">
        <List>
          <li>
            <b>Added:</b> once a day, on each way you use the club, we note how you are seeing it:
            the kind of browser and its version, the system, the screen’s size, light or dark, and
            whether notifications are allowed. Administrators see this by name, so they can help you
            get the most from the club, such as adding it to your Home Screen. It is kept for 180
            days (see What we collect and How long we keep it).
          </li>
          <li>
            <b>Added:</b> administrators see how each member came to the club, by name: the invite
            or QR code that let them in, and whether they asked for one.
          </li>
          <li>
            <b>Added:</b> if you were invited at one address and signed in at another, you can have
            a code emailed to the first to prove it is yours. We keep that address and a scrambled
            copy of the code for at most a day after the code runs out (see What we collect and How
            long we keep it).
          </li>
          <li>
            <b>Changed:</b> asking for an invite no longer means choosing an organization. What you
            send goes to The SCI Club’s org admins, and the page no longer shows anybody’s name.
          </li>
          <li>
            <b>Changed:</b> after you add yourself to an event’s list on its public page, the page
            says whether the address you gave is a member’s, has an invitation, or neither, so you
            know whether to sign in, create your account, or ask for an invite.
          </li>
          <li>
            <b>Added:</b> an organization’s org admins can notify its members, mentors and org
            admins of one of its events, and remind them. They see, by name, who it went to, whether
            each opened it, and whether each said Going or Interested. You can turn these
            notifications off on Me.
          </li>
          <li>
            <b>Added:</b> we note which events you open in the app. Administrators, and the org
            admins of the event’s organization, see only how many members opened the event page and
            how often, not who. Opening an event’s public page, or tapping its RSVP or Interested,
            adds one to a count for that day, with nothing about who did it.
          </li>
        </List>
      </Note>
      <Note title="What changed on October 31, 2026">
        <List>
          <li>
            <b>Changed:</b> an org admin or a trusted partner can connect two members without asking
            either of them first. You are added to a group conversation with the other member and
            told who connected you. You can leave it, block or report anyone in it, at any time.
          </li>
          <li>
            <b>Added:</b> org admins see what trusted partners see of the people they invited or
            connected, and counts for their organization, such as members, event turnout and reviews
            (see Who can see what).
          </li>
        </List>
      </Note>
      <Note title="What changed on October 30, 2026">
        <List>
          <li>
            <b>Changed:</b> Join replaces Follow. An organization’s members are shown to other
            members, on its page and on each member’s profile, unless you are hidden from Peers. If
            you followed an organization, you are now its member and in its members’ group chat. You
            can leave at any time.
          </li>
          <li>
            <b>Added:</b> joining an organization’s members by pressing Join, by its invite, QR code
            or link, or by checking in to its event. Its org admins see how you joined and can
            decline a membership, saying why. They see that you checked in, and can invite you to
            join, once, by a direct message.
          </li>
        </List>
      </Note>
      <Note title="What changed on October 29, 2026">
        <List>
          <li>
            <b>Added:</b> when you agreed to the Terms of Service and this policy, and to which
            version, is kept with your account.
          </li>
          <li>
            <b>Changed:</b> every event has a page anyone with its link can open, whoever in the
            club it is for, so members can invite people to it.
          </li>
          <li>
            <b>Changed:</b> when you change a post in a room, anybody who can read the post can see
            what it said before. Once somebody else has replied, you can add words or photographs to
            a post but not change or remove what it already says, or delete it.
          </li>
          <li>
            <b>Added:</b> trusted partners, professionals who work with people with spinal cord
            injuries, shown with their title. They can introduce two members to each other, and see
            the people they invited or introduced (see Who can see what). Joining, you can say you
            are such a professional; that alone makes nobody a partner.
          </li>
        </List>
      </Note>
      <Note title="What changed on October 28, 2026">
        <List>
          <li>
            <b>Added:</b> address suggestions. When an administrator or an organization account
            types a location’s street address, what they type goes to Komoot’s Photon service to
            suggest matching addresses. Members’ information is never sent.
          </li>
          <li>
            <b>Changed:</b> a reaction to your post or message now tells you who reacted, in a
            notification, as a like already did. The app’s icon shows how many kinds of notification
            you have not opened yet, instead of unread conversations.
          </li>
          <li>
            <b>Changed:</b> on the map, a place with one member shows that member’s photograph and
            name, as Peers does.
          </li>
          <li>
            <b>Changed:</b> the ZIP code you give is now kept, and only you can see it. On the map
            you are counted at the middle of your ZIP code instead of your city’s; other members
            never see the ZIP code itself, but if you are the only member there, your photograph and
            name show at its middle, so they can tell roughly which part of town you live in. Leave
            the ZIP code out, in Your details, to be counted by city only.
          </li>
          <li>
            <b>Added:</b> asking for an invite. Somebody without one can send an organization’s org
            admins their name, email address and a note. The page that offers this shows each org
            admin’s first name to anyone who opens it.
          </li>
          <li>
            <b>Changed:</b> an org admin’s QR code or invite link lets in whoever uses it before it
            expires, and its maker is told who joined.
          </li>
          <li>
            <b>Added:</b> a link to a post can be shared outside the club. It carries none of the
            post’s words; only members can read the post. The confirmation email now has a code to
            type in the app, as well as its link.
          </li>
          <li>
            <b>Added:</b> that the club is not covered by HIPAA, how we keep your information safe
            and what we do if it is ever exposed, when the law can require us to share it, your
            privacy rights wherever you live in the US, and where your information is kept.
          </li>
          <li>
            <b>Added:</b> mentions. Typing @ and a member’s username in a post or reply tells them
            who mentioned them, in a notification, and links to their profile.
          </li>
        </List>
      </Note>
      <Note title="What changed on October 26, 2026">
        <List>
          <li>
            <b>Added:</b> the map. Members are counted at the middle of their city, never closer;
            Show me on the map, on Me, leaves you out. Use my location on the map stays on your
            device. Map pictures come from the club’s own copy of OpenStreetMap, served by
            Cloudflare. Event and organization addresses are looked up with OpenStreetMap.
          </li>
        </List>
      </Note>
      <Note title="What changed on October 25, 2026">
        <List>
          <li>
            <b>Added:</b> the iPhone app, link previews, YouTube videos, your Google photo, Sign in
            with Apple, looking up where you live, photographs, notifications, public event pages
            and their guest lists, adding events by calendar invitation, blocking, reporting a
            profile, what administrators can see, how long we keep things, and deleting your account
            by email.
          </li>
          <li>
            <b>Removed:</b> signing in by text message, which the club does not offer.
          </li>
        </List>
      </Note>

      <Section title="Who we are">
        <P>
          The SCI Club is a private, invite-only community for adults living with spinal cord injury
          and their family members. It is operated by Alfred Shaheen (“we”, “us”). This policy
          covers The SCI Club app and website, and the emails they send.
        </P>
        <P>
          <b>
            We do not sell your information. There is no advertising in the club, and we do not
            track you across other apps or websites.
          </b>
        </P>
        <P>
          The club is not a doctor, hospital or health plan, so HIPAA, the US health privacy law,
          does not cover what you tell it. This policy does: the health information you share is
          used only as it says.
        </P>
      </Section>

      <Section title="What we collect">
        <P>When you join, and as you use the club, we keep:</P>
        <List>
          <li>
            <b>Your email address</b>, which is your account, and a password if you choose one. We
            keep a scrambled form of the password, never the password itself.
          </li>
          <li>
            <b>About you:</b> your name, your username (the <b>@name</b> others see), your birthday,
            city and state, your ZIP code if you give one, and a photograph with its description if
            you add one.
          </li>
          <li>
            <b>A phone number, only if you add one</b>, for the hosts of events you RSVP to. It is
            never used to sign you in.
          </li>
          <li>
            <b>About your injury or condition:</b> which describes you best (or that you are a
            family or a friend of someone with SCI, or staff who work with people with spinal cord
            injuries), its level, whether it is complete, when it began and how, as far as you
            choose to say. This is health information.
          </li>
          <li>
            <b>What you choose to answer</b> in the profile questions, such as your languages,
            interests, work, education and family, the self-care devices and procedures you use
            (catheters, for example), and the topics you want to talk about. Every one of them can
            be left out.
          </li>
          <li>
            <b>The organizations you are a member of</b>, how you came to be, and the events you
            check in to.
          </li>
          <li>
            <b>What you do in the club:</b> your messages, posts, reviews and photographs, the
            events you reply to, the posts you like, react to or save, the posts you have read, in a
            room or on Home, the events you open, and anything you report or anyone you block.
          </li>
          <li>
            <b>If you register for an event on its public page:</b> your name, your email address,
            your phone number if you give one, and whether you are going or interested, whether or
            not you have an account.
          </li>
          <li>
            <b>Your answers while you join:</b> what you have answered so far and the step you are
            on, so you can pick up where you left off, on this device or another. We also note which
            steps you reached; administrators see only how many people reached each step, never who.
          </li>
          <li>
            <b>When you agreed</b> to the Terms of Service and this policy, and to which version.
          </li>
          <li>
            <b>Whether you read a post on a phone or tablet, or on a computer</b>, from October 20,
            2026, worked out from what your browser says about itself.
          </li>
          <li>
            <b>How you are seeing the club:</b> at most once a day for each way you use it, the kind
            of browser and its version, the name of the system, whether you are in a browser, the
            app on your Home Screen or the store app, the screen’s size, light or dark, whether
            notifications are allowed, and when your copy of the app was built. Never the browser’s
            full description of itself, or your internet address.
          </li>
          <li>
            <b>If you turn notifications on</b> for a device: an address for that device, given by
            its notification service, and the kind of browser or device it is.
          </li>
          <li>
            <b>If you sign in with Google or Apple:</b> the name, email address and account number
            they send us. If you use Apple’s Hide My Email, the address we hold is the one Apple
            makes for us.
          </li>
          <li>
            <b>Your Google photo, only if you choose it.</b> Signed in with Google, the photo step
            and Your details offer your Google profile photo. Your device fetches it from Google to
            show you; it is copied to the club only if you press <b>Use my Google photo</b>.
          </li>
          <li>
            <b>If you sign in with Apple:</b> a token from Apple, kept only so we can ask Apple to
            end the club’s Sign in with Apple when you unlink Apple or delete your account. Apple
            may also tell us that you stopped using Sign in with Apple with the club, deleted your
            Apple Account, or turned Hide My Email forwarding off or on. Administrators are shown
            that, so they can help you keep a way to sign in.
          </li>
          <li>
            <b>How you sign in:</b> whether you joined with email, Google or Apple, and when and
            which way you sign in, and whether it was in the app added to your Home Screen.
          </li>
          <li>
            <b>If you add a passkey:</b> a public key and the name of the device it is on. Your
            fingerprint or face never leaves your device.
          </li>
          <li>
            <b>If you invite somebody:</b> the email address you give us, which goes on the club’s
            list, and we email them a link. You can withdraw the invite until it is used.
          </li>
          <li>
            <b>If you prove an invite sent to another address:</b> that address, and a scrambled
            copy of the code we email to it.
          </li>
          <li>
            <b>If you ask for an invite</b>, before you are a member: your name, your email address,
            and a note if you write one.
          </li>
          <li>
            <b>If you add an event by calendar invitation</b> (members who speak for an
            organization, and administrators): the address it came from, and what it says about the
            event: title, time, place, link and description. Its other guests are never kept. An
            invitation from anybody else is ignored, and the club keeps nothing from it.
          </li>
        </List>
        <P>
          Like any website, the services that run the club see your device’s internet (IP) address
          when it connects, and our sign-in service keeps it, with the kind of browser, for each
          signed-in session and in a log of sign-ins, to keep accounts secure. On your device, the
          app keeps you signed in and remembers settings such as text size, and, if you open a link
          to a post before you are signed in, which post, for 30 days, so it can take you there once
          you are. It uses no cookies or outside tools for advertising or analytics.
        </P>
        <P>
          To find what is slow, the app records how long it took to open and how long each request
          to the club took. With each time it records which kind of screen it was (an event, not
          which event), what the request asked for (not what was in it), whether you were signed in,
          whether you were using the installed app, whether it was a phone, and the kind of
          connection. It is not tied to your account or your internet address, only administrators
          see it, as summaries, and it is deleted after 30 days.
        </P>
      </Section>

      <Section title="Your phone’s camera, photos and location">
        <List>
          <li>
            <b>Camera and photos:</b> only when you choose to add a photograph, to your profile, a
            post or a message. We receive only the picture you pick.
          </li>
          <li>
            <b>Location:</b> only if you ask for it, while joining, on the step that asks where you
            live. You can type a ZIP code, or press <b>Use my location</b>, which your device asks
            you to allow. We send the ZIP code, or your device’s position, to OpenStreetMap’s
            Nominatim service, which answers with a city and state. The position is not kept. The
            ZIP code is kept, and only you can see it: the map counts you at its middle. Or skip
            both and choose your state and city yourself.
          </li>
          <li>
            <b>On the map:</b> <b>Use my location</b> asks your device only when you press it, and
            only for your approximate position. It is used on your device to show where you are, and
            is never sent to the club or kept.
          </li>
          <li>
            <b>Events near you:</b> to show events within a distance of home, and to place members
            on the map, a nightly job looks up the middle of each city and ZIP code members live in,
            also with OpenStreetMap. It sends only the city and state, or the ZIP code, never who
            lives there.
          </li>
          <li>
            <b>Distance from another place:</b> if you choose Change beside the distance in Filters,
            what you type is sent to OpenStreetMap’s Nominatim service to find it. The place found
            is kept on your device until you go back to home. To measure events from it, its
            position is sent to the club with the question and not kept.
          </li>
          <li>
            <b>Event and organization addresses</b> are looked up with OpenStreetMap when they are
            saved, so they can be placed on the map. Only the address is sent.
          </li>
        </List>
        <P>
          OpenStreetMap’s own policy is the{' '}
          <OutsideLink href="https://osmfoundation.org/wiki/Privacy_Policy">
            OSMF Privacy Policy
          </OutsideLink>
          .
        </P>
      </Section>

      <Section title="Links and videos">
        <P>
          When a message or a post has a link in it, the club’s own server visits that page once, to
          show its title and picture under the link, and keeps a copy of the picture. So your phone
          contacts nobody when you read it: the site learns only that the club visited, not who
          posted the link or who read it. Opening the link takes you to that site, under its own
          policy.
        </P>
        <P>
          A YouTube video plays in place, from YouTube’s privacy-enhanced player. YouTube receives
          anything only when you press play, and then under{' '}
          <OutsideLink href="https://policies.google.com/privacy">
            Google’s Privacy Policy
          </OutsideLink>
          . In the iPhone app, the player is loaded through a page of the club’s website,
          thesciclub.com/embed/, because YouTube will not play inside the app itself. YouTube then
          receives what it would from its player on any website.
        </P>
      </Section>

      <Section title="Notifications">
        <P>
          Notifications are off until you turn them on, and you can choose which kinds you get on Me
          → Settings. They reach your device through its notification service: Apple’s on an iPhone,
          iPad or Mac, Google’s on Android or in Chrome, or your browser maker’s. A notification can
          show the first words of a message, and the name of the group it was sent in, on your lock
          screen. For a conversation, you get at most one notification every two minutes while it
          stays unread, saying how many messages are new, and none while you have it open.
        </P>
        <P>
          In the iPhone app, notifications go through Apple Push Notification service, and the
          address we keep is a token for your iPhone. On the website, a notification’s words are
          encrypted so that only your device can read them; in the app they are not, so Apple could
          read them on the way. Once notifications are on, the app’s icon shows how many kinds of
          notification you have not opened yet, such as messages or replies; opening one, or your
          notifications list, clears it.
        </P>
        {/* 20261028980000. */}
        <P>
          For an event you said you are going to, you are also reminded ten minutes before it
          starts, if that kind of notification is on, and we email you the day before: its name,
          when and where it is, and a link to it. The email goes to your account’s address through
          our email provider. You can switch these emails off on Me → Settings.
        </P>
        {/* 20261029070000. */}
        <P>
          When a member mentions your username in a post, you are told who, with the start of the
          post, once for each post. Not by somebody you blocked or who blocked you, and only in a
          room you can read. Mentions in conversations notify nobody.
        </P>
      </Section>

      <Section title="How we use it">
        <List>
          <li>
            To sign you in, with your email and password, Google, Apple or a passkey, and to check
            that you were invited.
          </li>
          <li>
            To show your profile to other members and to suggest peers and mentors to you, using
            things like your injury, your age and where you live.
          </li>
          <li>To show you events, rooms and conversations, and to notify you about them.</li>
          <li>
            To keep the club safe: looking into reports and blocks, and closing an account if
            needed.
          </li>
        </List>
        <P>
          We never use your injury, your health or anything else about you for advertising, and
          never sell it.
        </P>
      </Section>

      <Section title="Who can see what">
        <List>
          <li>
            <b>Other members</b> see your profile: your name, photograph, injury, age, where you
            live and what you have chosen to share. They never see your email address, your phone
            number or your birthday; your age is worked out from your birthday on our side. You can
            hide yourself from Peers, on Me.
          </li>
          <li>
            <b>The members building the club</b> are shown to anybody, without an account, on{' '}
            <Link to="/about" className="font-semibold text-emphasis underline">
              About us
            </Link>
            , with their agreement: their profile as members see it, but never their age, where they
            live, or the month and day of their injury.
          </li>
          <li>
            <b>On the map</b>, other members see how many members live in each place, shown at the
            middle of your ZIP code if you gave one, or of your city, never your address or anything
            closer. A place with one member shows that member’s photograph and name, as Peers does,
            so others can tell roughly which part of town they live in. To be counted by city only,
            leave your ZIP code out. Turn off <b>Show me on the map</b>, on Me, to be left out;
            hiding yourself from Peers leaves you off the map too.
          </li>
          <li>
            <b>Members see some of what you do:</b> who likes or reacts to a post, who is going to
            an event, and, in a conversation you are in, that you have read a message. Liking or
            reacting to a post or a message tells its author who you are, in a notification, and so
            does mentioning a member in a post. A post shows how many people have read it, never
            who.
          </li>
          <li>
            <b>Members who speak for organizations</b>, such as hospitals and peer support programs,
            see the same profile inside the app as anybody else, to help match members with peers
            and mentors. They see your email address and phone number only on the guest list of an
            event they manage, and only if you RSVP (see Event hosts, below).
          </li>
          <li>
            <b>Staff</b> work with people with spinal cord injuries at an organization, such as a
            hospital’s peer support lead or a physical therapist, and an administrator chose them
            and their organization. A verified mark, their organization and the profession they
            write are shown beside their name. They see the same profiles as anybody. For the people
            they invited or connected, they also see whether each joined, finished their profile and
            was introduced to a mentor, and how many of them posted in a room or RSVP to an event,
            as a count. They cannot read conversations they are not in. Staff see no email address
            or phone number, except an address they sent an invite to themselves.
          </li>
          <li>
            <b>Org admins</b> see the same about the people they invited or connected, and counts
            for their organization: members, how they joined, events, turnout and reviews. They see
            everyone in their organization by name, and, for each of its events, whether you said
            Going or Interested and, if they notified you of it, whether you opened the
            notification.
          </li>
          <li>
            <b>Family.</b> A member who joined as family or a friend of someone with SCI can ask any
            member to link as family, and any other member, except staff, can ask them. They say
            how: spouse or partner, parent, child, brother or sister, or other family. You are told
            who asked and as what. Until you say yes, only the two of you see the request, and if
            you say no they are not told. Once you say yes, members who can see both of your
            profiles see the link on each, with how you are related. Either of you can remove it at
            any time, and a block between you removes it.
          </li>
          <li>
            <b>Being connected.</b> An org admin or a staff member can connect two or more members.
            You are not asked first: you are added to a group conversation, a new one or one that
            already exists, with a line saying who connected you and their note, and you are told.
            Whoever connected you is in it only if they chose to be, and can read it only then. If
            they started the group, they can add more people to it later. You can leave it, block or
            report anyone in it, at any time.
          </li>
          <li>
            <b>Your email address</b> is also seen by whoever invited you, who already had it. If
            you join with a QR code or invite link, whoever made it is told that you joined, and
            sees your profile like any member.
          </li>
          <li>
            <b>If you ask for an invite</b>, what you send is seen by The SCI Club’s org admins, and
            nobody else.
          </li>
          <li>
            <b>A post you change</b> shows Edited, and anybody who can read it can open its earlier
            versions. Once somebody else has replied to it, you can add words or photographs but not
            change or remove what it already says, or delete it, so the replies still make sense.
          </li>
          <li>
            <b>Direct and group conversations</b> cannot be read by administrators. If somebody
            reports a single message or post, that one message is shown to administrators, with who
            wrote it and when, and nothing else from the conversation.
          </li>
          <li>
            <b>What Google or Apple sends us</b> is used only to sign you in. It is not shown to
            other members or to organizations, and it is never shared. Unlink either on Me and it is
            no longer used to sign you in.
          </li>
          <li>
            <b>Photographs</b> are only shown to people signed in to the club. Nobody outside it can
            open them, even with a copied link.
          </li>
        </List>
      </Section>

      <Section title="What administrators can see">
        <P>The club’s administrators look after it. To do that, they can see:</P>
        <List>
          <li>every member’s email address and phone number;</li>
          <li>
            reports: the one reported message or post, a copy of its words, who wrote it, when, and
            who reported it; or a copy of a reported profile as it was then (name, @username,
            photograph and what the member wrote), and who reported it;
          </li>
          <li>blocks: who blocked whom, with no words, and a weekly count;</li>
          <li>
            when you change a message in a conversation, the earlier wording, which nobody else can
            read, you included;
          </li>
          <li>who is going to each event, to pass on to its host (see Event hosts);</li>
          <li>
            in <b>Admin → Stats</b>: counts, such as how many members opened the app this week,
            never who; and, naming members, how each member signs in and came to the club, how each
            is seeing the club, whether each has notifications on and on how many devices, and who
            has read each post and when, including reads from before October 20, 2026, with whether
            each read was on a phone or tablet, or a computer.
          </li>
        </List>
      </Section>

      {/* The owner's practice, 2026-10-08 (email added 2026-10-10). Keep in
          step with GOING_SHARES_CONTACT in components/rsvp-sheet.tsx. */}
      <Section title="Event hosts">
        <P>
          When you <b>RSVP</b> to an event, the organization hosting it receives your email address,
          and your phone number if you have added one, for that event only: to tell you about
          changes, to remind you, and to look after the people who come. Choosing Interested shares
          nothing. Hosts agree not to use your details for marketing, fundraising or promotions, and
          not to pass them on. The RSVP button says this, and offers Interested instead. Anybody in
          the club who manages the event sees them on its guest list; for other hosts, an
          administrator passes them on.
        </P>
        {/* Public event pages and registrations, 2026-10-22 (20261022190000);
            every event's since 2026-10-29 (20261029110000). */}
        <P>
          Every event has a page that anyone with its link can open, unless it is invite only. In
          the club, an event for the members of chosen organizations shows only for them, but its
          link opens for anyone. An invite-only event opens only for the people invited and its
          organizers: whoever added or changed it, the org admins of its host and of any co-host,
          and the club’s administrators. Somebody outside the club invited to it by email gets their
          own link, which opens that event for them with their name and address filled in; accepting
          adds them to its guest list as going, as below. Everyone invited to an invite-only event
          sees who else is invited, by name and photograph, and who organized it: who added it, and
          anyone who changed it or invited people, except members hidden from Peers or blocked
          either way. A member who opens an invite-only event they are not invited to can ask to
          join it. Its organizers then see that member’s name and photograph, and either approve,
          which invites them and tells them, or decline, which nobody is told about. Blocked either
          way, an organizer is not told. It shows the event's details only, never who is going or
          how many. Adding yourself to the club’s list there shares your name, email address and
          phone number, if you give it, with the club’s administrators and anybody in the club who
          manages that event, for that event only. It does not register you with the host. The guest
          list also says whether the address belongs to a member, or to somebody joining. The page
          then says what comes next for that address: sign in if it is a member’s, create your
          account if it has an invitation, or ask for one. If you then sign in or join with that
          address, it becomes your Going or Interested, and the paragraph above applies.
        </P>
      </Section>

      <Section title="Grants">
        <P>
          The club lists grants that organizations offer, such as for equipment or adaptive sport,
          and when to apply, with a link to each one. We do not help with applications or apply for
          you, and we share nothing about you with grant-makers. You apply on the organization’s own
          site, under its own policy.
        </P>
      </Section>

      <Section title="Emails">
        <P>
          We email you only to run your account: the code and link that confirm your address, a link
          to reset or change your password, a notice when your password changes, and the invitation
          link if somebody invites you. Invitation links are sent by the club on behalf of the
          member or organization that invited you, and can carry their name and message. An
          invitation email has a tiny picture in it: when your mail app loads it, we note the time,
          as a sign that it was opened. We also note when its link is first used, and whether you
          accept, say you are going and join. Whoever invited you sees this: the event’s organizers
          for an invite to an event, and the club’s administrators. An invite to an event shows the
          event with Going, Maybe and Can’t go, and its organizers see your answer. If you are a
          member and somebody invites you by name to an invite-only event, we email you the event
          the same way, once. If you add an event by calendar invitation, we email you what became
          of it, and when it waits for approval we email whoever may approve it, with your address.
          We also email you the day before an event you are going to, unless you switch that off
          (see Notifications). We do not send newsletters or promotions.
        </P>
        <P>
          <b>
            We do not sell or share your email address or phone number with third parties for
            marketing or promotional purposes.
          </b>{' '}
          They reach the service providers that send the emails and run the app (see Service
          providers, below) and, if you RSVP to an event, that event’s host, for that event only
          (see Event hosts).
        </P>
        <P>
          The{' '}
          <Link to="/terms" className="font-semibold text-emphasis underline">
            Terms of Service
          </Link>{' '}
          say more about membership.
        </P>
      </Section>

      <Section title="Service providers">
        <P>
          Apart from what members, hosts and organizations see as this policy describes, we share
          your information only with the service providers that run the club for us, and they
          receive only what they need to do that work:
        </P>
        <List>
          <li>hosting, our database, file storage and sign-in;</li>
          <li>sending email, and receiving calendar invitations and the email you send us;</li>
          <li>running the nightly job that imports events;</li>
          <li>location lookup (OpenStreetMap);</li>
          <li>
            address suggestions (Komoot’s Photon service, which searches OpenStreetMap): when an
            administrator or an organization account types a location’s street address, what they
            type is sent to Photon to suggest matching addresses. Members’ information is never sent
            to it;
          </li>
          <li>
            map pictures (Cloudflare, which stores and serves the club’s own copy of OpenStreetMap’s
            map; like any web host, it sees your device’s internet address and which parts of the
            map it loads);
          </li>
          <li>
            visit counts on the website (Cloudflare Web Analytics): when you open a page of the
            website, signed in or not, Cloudflare counts the visit: the kind of page (such as an
            event page, never which event or anything else in its address), your country, the kind
            of device and browser, and how fast the page loaded. Like any web host, it sees your
            device’s internet address. It runs in a hidden page of its own, apart from the club’s,
            so it cannot see your account or anything on your screen, and it is told nothing about
            who you are. It uses no cookies, does not recognize you from one visit to the next, and
            is never loaded in the iPhone app;
          </li>
          <li>device notifications (Apple, Google, or your browser’s maker);</li>
          <li>Google or Apple, if you sign in with them.</li>
        </List>
        <P>
          On the website, screens that offer Google sign-in load Google’s button from Google, so
          Google can see that the page was opened, under{' '}
          <OutsideLink href="https://policies.google.com/privacy">
            Google’s Privacy Policy
          </OutsideLink>
          . In the iPhone app, Google is contacted only when you press its button. Apart from that,
          a YouTube video you play and your Google photo, nothing in the club loads anything from
          Google.
        </P>
      </Section>

      <Section title="When the law asks">
        <P>
          We would share information about you outside the club only if the law requires it, such as
          a court order, or to protect somebody from serious harm. If we are allowed to, we tell you
          first.
        </P>
      </Section>

      <Section title="Keeping it safe">
        <P>
          Everything between your device and the club is encrypted on the way. Passwords are kept
          only in scrambled form, photographs open only for people signed in, and the database
          itself checks who may read each thing, so a member sees only what this policy says they
          can.
        </P>
        <P>
          No system is perfectly secure. If we learn that your information has been exposed, we will
          tell you, and the authorities where the law requires, with what happened and what you can
          do. If you think somebody else has used your account, change your password and email{' '}
          <ContactEmail />.
        </P>
      </Section>

      <Section title="Your rights">
        <P>
          Wherever you live, you can see and correct most of what we hold about you on Me, ask us
          for a copy of all of it, and ask us to correct or delete it. It costs nothing. Email{' '}
          <ContactEmail />, from the address on your account if you can; we may write back to that
          address to check it is you before we act, and we reply when it is done.
        </P>
        <P>
          California and other US states give their residents rights to know what is collected, to
          correct and delete it, and to opt out of its sale, of its sharing for advertising, and of
          decisions made about them by a computer alone. We do not sell your information or share it
          for advertising, and no decision about you is made by a computer alone, so there is
          nothing to opt out of. We will not treat you differently for asking about your
          information. The club does not track you across other sites, so a browser’s Do Not Track
          or Global Privacy Control setting has nothing to stop here.
        </P>
      </Section>

      <Section title="Where it is kept">
        <P>
          The club is run from the United States. Its service providers may store or handle your
          information in the United States or in other countries where they work.
        </P>
      </Section>

      <Section title="How long we keep it">
        <List>
          <li>
            <b>Your account and profile:</b> until you delete your account, or an administrator
            removes it.
          </li>
          <li>
            <b>Your answers while you join:</b> deleted once you finish joining, or after 90 days if
            you do not.
          </li>
          <li>
            <b>A registration from an event's public page:</b> 90 days after the event.
          </li>
          <li>
            <b>Your notifications list:</b> 30 days.
          </li>
          <li>
            <b>How you are seeing the club:</b> 180 days.
          </li>
          <li>
            <b>An address you proved an invite with:</b> a day after the code runs out.
          </li>
          <li>
            <b>Apple’s token:</b> until you unlink Apple or delete your account, and then until
            Apple confirms the link is ended.
          </li>
          <li>
            <b>A calendar invitation:</b> kept with the address it came from, as the record of where
            its event came from, after the event too.
          </li>
          <li>
            <b>Your ZIP code:</b> until you change or remove it in Your details, or your account is
            deleted. <b>A position</b> used to find your city: not kept at all.
          </li>
          <li>
            <b>What you write in Chat:</b> until it is deleted. After your account is deleted it
            stays, as below.
          </li>
          <li>
            <b>Reports:</b> kept, with their copy of the reported words, even after the message is
            deleted or the profile is changed. Once the reported member’s account is deleted, a
            report of their profile keeps only what they wrote: their name, @username and photograph
            go.
          </li>
          <li>
            <b>Blocks:</b> until you unblock. The administrators’ record that it happened stays.
          </li>
          <li>
            <b>Sign-in records</b>, with their email and IP addresses: until your account is
            deleted.
          </li>
          <li>
            <b>A request for an invite:</b> 90 days after an org admin answers it, or 90 days after
            it was sent if nobody does.
          </li>
          <li>
            <b>An invited email address:</b> invites do not expire, so it stays on the list until
            the invite is used, or withdrawn by whoever sent it or an administrator. A withdrawn
            invite keeps its record of who invited the address.
          </li>
        </List>
      </Section>

      <Section title="Adults only">
        <P>
          The SCI Club is for people 18 and over. We do not knowingly collect information from
          anybody younger, and the app does not let anybody under 18 join.
        </P>
      </Section>

      <Section title="Deleting your account">
        <P>
          You can delete your account yourself, from <b>Me → Account → Delete my account</b>. That
          erases your name, username, email address, phone number, photograph, birthday, injury, any
          Google or Apple account you linked, everything you answered about yourself, and your
          likes, reactions, saves, follows, replies to events, blocks and notifications, and your
          sign-in records with their email and IP addresses, and takes your address off the invite
          list. If you signed in with Apple, we also ask Apple to end the club’s Sign in with Apple.
        </P>
        <P>
          What you wrote in Chat, and the photographs you shared there, stay, so other people’s
          conversations still make sense, but they say “Deleted member” instead of your name. The
          other person in a one-to-one conversation can then delete it, with everything both of you
          wrote and every photograph in it. A report keeps its copy of the reported words, with
          nobody named. A report of your profile keeps what you wrote on it, but your name,
          @username and photograph go from it. Details already passed to an event’s host stay with
          that host. A registration on an event’s public page stays until 90 days after the event,
          and a calendar invitation you sent keeps the address it came from.
        </P>
        <P>
          If you cannot sign in, or are an administrator, email <ContactEmail /> to ask us to delete
          your account, or for a copy of what we hold about you. Write from the address on your
          account if you can. We delete it by hand and reply when it is done. You can also correct
          anything about you on Me.{' '}
          <Link to="/delete-account" className="font-semibold text-emphasis underline">
            Deleting your account
          </Link>{' '}
          has the steps.
        </P>
      </Section>

      <Section title="Changes">
        <P>
          If this policy changes, the date at the top changes, and the top of the page says what
          changed.
        </P>
      </Section>

      <Section title="Contact">
        <P>
          Questions about this policy or your information: <ContactEmail />. The SCI Club, operated
          by Alfred Shaheen.
        </P>
      </Section>
    </LegalPage>
  );
}
