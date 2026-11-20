import { Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '@/lib/account';
import { chatDayHeading } from '@/lib/chat/time';
import { describeError } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';
import { methodLabel } from '@/routes/admin/sign-in-methods';
import { firstName, mentorAskMailto } from '@/routes/peers/mentor-ask-email';
import { DetailRow, Section } from '@/routes/peers/profile-parts';

/**
 * At the foot of a member's page, for the club's administrators only: how the
 * member joined, what they use, whether the club can notify them, how they
 * sign in, and how often they come (the owner, 2026-11-18). Nothing new is
 * recorded; admin_member_story (20261118150000) reads what Admin → Stats and
 * Admin → Members already keep, and refuses anyone else.
 *
 * Values are short and carry no full stop, as the profile's Details card.
 */

interface StoryDevice {
  surface: 'browser' | 'home_screen' | 'app';
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  colorScheme: 'light' | 'dark' | null;
  notifications: 'allowed' | 'refused' | 'not_asked' | null;
  appBuilt: string | null;
  seenAt: string;
}

export interface MemberStory {
  joinedAt: string;
  came: {
    way: 'qr' | 'open' | 'organization' | 'member';
    claimedProfile: boolean;
    registered: boolean;
    invitedAt: string | null;
    sentAt: string | null;
    emailOpenedAt: string | null;
    linkOpenedAt: string | null;
    acceptedAt: string | null;
    by: { id: string; name: string | null } | null;
    organization: string | null;
    qrCode: { event: string | null; organization: string | null } | null;
    event: { id: string; title: string } | null;
    note: string | null;
    message: string | null;
  } | null;
  askedForInvite: boolean;
  signIns: {
    signedUpWith: string | null;
    linked: string[];
    count: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  devices: StoryDevice[];
  appLastSeen: string | null;
  notify: { app: number; web: number };
  activeDays: number;
  lastActive: string | null;
  recordedSince: string | null;
  /** Counts of what they have done (20261118160000); absent before it. */
  did?: {
    postsViewed: number;
    questionsAsked: number;
    questionsAnswered: number;
    messagesSent: number;
    eventsViewed: number;
    eventsGoing: number;
    reviewsWritten: number;
  };
}

/**
 * What they have done, as numbers. Events viewed is a count, never which;
 * reviews are those under their own name, as anonymous ones stay hidden.
 */
function DidCard({ did }: { did: NonNullable<MemberStory['did']> }) {
  const rows: [string, number][] = [
    ['Posts viewed', did.postsViewed],
    ['Questions asked', did.questionsAsked],
    ['Others’ questions answered', did.questionsAnswered],
    ['Messages sent', did.messagesSent],
    ['Events viewed', did.eventsViewed],
    ['Events RSVP’d going', did.eventsGoing],
    ['Reviews written', did.reviewsWritten],
  ];
  return (
    <>
      <h3 className="mt-4 mb-2 font-bold text-[0.78125rem] text-grey">Activity</h3>
      <div className="flow-root rounded-[17px] border border-line bg-paper px-3.5 py-1">
        <dl>
          {rows.map(([label, n]) => (
            <div
              key={label}
              className="flex justify-between gap-3 border-line border-b py-2.5 last:border-b-0"
            >
              <dt className="text-[0.78125rem] text-grey">{label}</dt>
              <dd className="font-semibold text-[0.85rem]">{n.toLocaleString('en-US')}</dd>
            </div>
          ))}
        </dl>
        <p className="border-line border-t py-2.5 text-[0.75rem] text-grey leading-[1.45]">
          Totals are all-time. Views are counted from Oct 11 for posts and Nov 3 for events, each
          post or event once, however often they opened it. Anonymous reviews are not counted.
        </p>
      </div>
    </>
  );
}

/** "Nov 10", or "Nov 10, 2025" in another year. */
function shortDate(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Mid-sentence: "today", "yesterday", "Monday", "Thu, Nov 6". */
function inline(iso: string): string {
  const said = chatDayHeading(iso);
  return said === 'Today' || said === 'Yesterday' ? said.toLowerCase() : said;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

const capital = (line: string) => line.charAt(0).toUpperCase() + line.slice(1);

/** Who or what brought them. */
export function cameSentence(story: MemberStory): React.ReactNode {
  const came = story.came;
  if (!came) {
    return story.askedForInvite
      ? 'Asked for an invite; no invite is on record'
      : 'No invite on record: added by hand, or before invites were kept';
  }
  const claimed = came.claimedProfile ? ', and claimed their directory profile' : '';
  const event = came.event ? (
    <>
      {came.registered ? ' after registering for ' : ' for '}
      <Link to={`/events/${came.event.id}`} className="underline underline-offset-2">
        {came.event.title}
      </Link>
    </>
  ) : null;
  if (came.way === 'open') return 'Joined while anybody could join, with no invite';
  if (came.way === 'qr') {
    const from = came.qrCode?.organization ? ` from ${came.qrCode.organization}` : '';
    const at = came.qrCode?.event ? ` at ${came.qrCode.event}` : '';
    return `Scanned a QR code${from}${at}${claimed}`;
  }
  if (came.way === 'organization') {
    return (
      <>
        Invited by {came.organization ?? 'an organization'}
        {event}
        {claimed}
      </>
    );
  }
  return (
    <>
      Invited by{' '}
      {came.by?.name ? (
        <Link to={`/peers/${came.by.id}`} className="underline underline-offset-2">
          {came.by.name}
        </Link>
      ) : (
        'a member who has since left'
      )}
      {event}
      {claimed}
    </>
  );
}

/** "Sent Nov 3 · email opened Nov 3 · link used Nov 4 · joined Nov 4": the one join date. */
function cameSteps(story: MemberStory): string {
  const came = story.came;
  const sent = came ? (came.sentAt ?? came.invitedAt) : null;
  const steps = [
    sent ? `sent ${shortDate(sent)}` : null,
    came?.emailOpenedAt ? `email opened ${shortDate(came.emailOpenedAt)}` : null,
    came?.linkOpenedAt ? `link used ${shortDate(came.linkOpenedAt)}` : null,
    `joined ${shortDate(story.joinedAt)}`,
    story.askedForInvite && came ? 'had asked for an invite' : null,
  ].filter((step): step is string => step !== null);
  return capital(steps.join(' · '));
}

const DEVICE: Record<string, string> = {
  iOS: 'iPhone',
  iPadOS: 'iPad',
  macOS: 'Mac',
  Android: 'Android phone',
  Windows: 'Windows computer',
  ChromeOS: 'Chromebook',
  Linux: 'Linux computer',
};

/** The device first: "iPhone · the club's app", "Mac · Chrome 157". */
export function deviceName(device: StoryDevice): string {
  const what = (device.os ? DEVICE[device.os] : undefined) ?? device.os ?? 'Unknown device';
  if (device.surface === 'app') return `${what} · the club’s app`;
  const browser = device.browser
    ? `${device.browser}${device.browserVersion ? ` ${device.browserVersion}` : ''}`
    : 'a browser';
  if (device.surface === 'home_screen') return `${what} · Home Screen shortcut (${browser})`;
  return `${what} · ${browser}`;
}

/** When, and what it says of notifications; why not, where it cannot be asked. */
function deviceDetails(device: StoryDevice): string {
  const notifications =
    device.notifications === 'allowed'
      ? 'notifications allowed'
      : device.notifications === 'refused'
        ? 'notifications blocked'
        : device.notifications === 'not_asked'
          ? 'notifications never turned on'
          : device.surface === 'browser' && (device.os === 'iOS' || device.os === 'iPadOS')
            ? 'no notifications in an iPhone browser'
            : null;
  return [`seen ${inline(device.seenAt)}`, notifications].filter(Boolean).join(' · ');
}

/** The ways they come, plainly: the club's app, the shortcut, the website. */
export function usesSentence(story: MemberStory): string {
  const app = story.appLastSeen !== null || story.devices.some((d) => d.surface === 'app');
  const ways = [
    app ? 'the club’s app' : null,
    story.devices.some((d) => d.surface === 'home_screen') ? 'the Home Screen shortcut' : null,
    story.devices.some((d) => d.surface === 'browser') ? 'the website in a browser' : null,
  ].filter((way): way is string => way !== null);
  const last = ways.pop();
  if (last === undefined) return 'Not seen yet';
  return capital(ways.length ? `${ways.join(', ')} and ${last}` : last);
}

/** Whether the club can reach them now, which is more than a permission. */
export function notifySentence(story: MemberStory): string {
  const { app, web } = story.notify;
  if (app + web === 0) {
    return story.devices.some((d) => d.notifications === 'refused')
      ? 'No: blocked on a device'
      : 'No: never turned on';
  }
  const on = [app ? plural(app, 'phone app') : null, web ? plural(web, 'browser') : null].filter(
    Boolean,
  );
  return `Yes, on ${on.join(' and ')}`;
}

export function activeSentence(story: MemberStory): string | null {
  if (!story.recordedSince) return null;
  return `On ${plural(story.activeDays, 'day')} since ${shortDate(story.recordedSince)}, when counting began`;
}

const METHOD_PHRASE: Record<string, string> = {
  email: 'email and password',
  link: 'a one-time link',
  passkey: 'a passkey',
  oauth: 'Google or Apple',
};
const phrase = (method: string) => METHOD_PHRASE[method] ?? methodLabel(method);

type State =
  | { status: 'loading' }
  | { status: 'ready'; story: MemberStory }
  | { status: 'hidden' }
  | { status: 'error'; message: string };

export function AdminMemberStory({ memberId, name }: { memberId: string; name: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void (async () => {
      const { data, error } = (await getSupabase()
        .rpc('admin_member_story', { p_member: memberId })
        .abortSignal(controller.signal)) as {
        data: MemberStory | null;
        error: { code?: string; message: string } | null;
      };
      if (controller.signal.aborted) return;
      // Not there yet (a database before 20261118150000) or not an
      // administrator after all: nothing to show, and nothing to say.
      if (error?.code === 'PGRST202' || error?.code === '42501' || (!error && !data)) {
        setState({ status: 'hidden' });
        return;
      }
      if (error) {
        setState({
          status: 'error',
          message: describeError(error, 'Could not load this member’s activity.'),
        });
        return;
      }
      if (!data) return;
      setState({ status: 'ready', story: data });
    })();
    return () => {
      controller.abort();
    };
  }, [memberId]);

  if (state.status === 'hidden') return null;

  return (
    <Section title="For administrators">
      <p className="-mt-1 mb-2.5 flex items-center gap-1.5 text-[0.78125rem] text-grey leading-[1.45]">
        <ShieldCheck aria-hidden="true" className="h-4 w-4 flex-none" />
        Only the club’s administrators see this, not {name} or other members.
      </p>
      <MentorAskCard memberId={memberId} name={name} />
      {state.status === 'loading' ? (
        <p className="text-[0.8125rem] text-grey">Loading…</p>
      ) : state.status === 'error' ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {state.message}
        </p>
      ) : (
        <StoryCards story={state.story} />
      )}
    </Section>
  );
}

function StoryCard({ story }: { story: MemberStory }) {
  const signedUp = story.signIns.signedUpWith;
  const others = story.signIns.linked.filter((m) => m !== signedUp);
  const signIns = story.signIns.count
    ? `Signed in ${plural(story.signIns.count, 'time')}${
        story.signIns.lastAt ? `, most recently ${inline(story.signIns.lastAt)}` : ''
      }`
    : null;
  const note = 'mt-1 block text-[0.78125rem] text-grey';
  return (
    <div className="flow-root rounded-[17px] border border-line bg-paper px-3.5 py-1">
      <DetailRow
        label="How they joined"
        value={
          <>
            {cameSentence(story)}
            <span className={note}>{cameSteps(story)}</span>
            {story.came?.message ? (
              <span className={note}>Their invite said: “{story.came.message}”</span>
            ) : null}
            {story.came?.note ? (
              <span className={note}>Note on the invite: {story.came.note}</span>
            ) : null}
          </>
        }
      />
      <DetailRow label="Uses" value={usesSentence(story)} />
      <DetailRow
        label="Devices"
        value={
          story.devices.length ? (
            <ul className="space-y-2">
              {story.devices.map((device) => (
                <li key={`${device.surface}:${device.os ?? ''}:${device.browser ?? ''}`}>
                  {deviceName(device)}
                  <span className="block text-[0.78125rem] text-grey">{deviceDetails(device)}</span>
                </li>
              ))}
            </ul>
          ) : (
            'None seen yet'
          )
        }
      />
      <DetailRow label="Notifications" value={notifySentence(story)} />
      <DetailRow
        label="Sign-in"
        value={
          signedUp || signIns ? (
            <>
              {signedUp
                ? `Signed up with ${phrase(signedUp)}${
                    others.length ? `; can also use ${others.map(phrase).join(', ')}` : ''
                  }`
                : 'Sign-up way not recorded'}
              {signIns ? <span className={note}>{signIns}</span> : null}
            </>
          ) : null
        }
      />
      <DetailRow
        label="Last active"
        value={
          story.lastActive ? chatDayHeading(story.lastActive) : 'Not seen since counting began'
        }
      />
      <DetailRow label="Days active" value={activeSentence(story)} />
    </div>
  );
}

function StoryCards({ story }: { story: MemberStory }) {
  return (
    <>
      <StoryCard story={story} />
      {story.did ? <DidCard did={story.did} /> : null}
    </>
  );
}

/**
 * Create email: the administrator's own mail app opens on an email to the
 * member, written and addressed, asking them to complete their profile,
 * install the app and post (the owner, 2026-11-20: "I want it to come from
 * me. Maybe a mailto link. Something I can do on my phone"). The club sends
 * nothing; they read it over and press Send. The address comes from
 * admin_member_email (20261121010000), as Admin → Members shows it.
 */
function MentorAskCard({ memberId, name }: { memberId: string; name: string }) {
  const account = useAccount();
  const [to, setTo] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setTo(undefined);
    void (async () => {
      const { data, error } = (await getSupabase()
        .rpc('admin_member_email', { p_member: memberId })
        .abortSignal(controller.signal)) as { data: string | null; error: unknown };
      if (controller.signal.aborted) return;
      setTo(error ? null : (data ?? null));
    })();
    return () => {
      controller.abort();
    };
  }, [memberId]);

  // Not there yet, or no address to write to: nothing to offer.
  if (!to) return null;
  return (
    <div className="mb-4 rounded-[17px] border border-line bg-paper p-3.5">
      <p className="text-[0.85rem] leading-[1.42]">
        Ask {firstName(name) || name} to complete their profile, install the app and answer or ask a
        question.
      </p>
      <a
        href={mentorAskMailto({ to, member: name, admin: account.displayName })}
        className="mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white"
      >
        <Mail aria-hidden="true" className="h-[18px] w-[18px]" />
        Create email
      </a>
      <p className="mt-2 break-words text-[0.78125rem] text-grey leading-[1.45]">
        Opens your mail app with the email written to {to}. Nothing goes until you send it.
      </p>
    </div>
  );
}
