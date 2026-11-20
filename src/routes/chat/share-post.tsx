import { Copy, Send, Share, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { GroupAvatar, MemberAvatar } from '@/components/member-avatar';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { useChatAuthors } from '@/lib/chat/authors';
import { type ShareResult, type ShareTarget, sharePost } from '@/lib/chat/shared-posts';
import { threadTitle, useMyThreads } from '@/lib/chat/threads';
import type { ChatThread } from '@/lib/chat/types';
import { useDialogFocus } from '@/lib/dialog-focus';
import { markdownToPlain } from '@/lib/markdown';
import { useBrowseMembers } from '@/lib/members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { linkWithCode, shareTopicCode, turnOffQrCode } from '@/lib/qr-codes';
import { matchesSearch } from '@/lib/search';
import { canShareElsewhere, copyLink, shareLink } from '@/lib/share-link';
import { siteOrigin } from '@/lib/site-origin';
import { excerpt } from '@/routes/chat/reaction-bar';

/**
 * Share a post into a conversation (the owner, 2026-10-25): "Add the options
 * to share posts in group chats and DMs."
 *
 * A visible button beside React and Reply, as every action on a post is: no
 * long press. It opens a sheet of the member's conversations, newest first,
 * and "Someone else" for a member they have no conversation with yet. A search
 * above them finds either by name or @username (the owner, 2026-10-31). A line
 * of their own is optional. What arrives is a message carrying a card of the
 * post, which each reader sees only if they may read the post themselves
 * (shared-posts.ts).
 *
 * The destinations are radio buttons, one group across both lists, with the
 * whole row as the label, so a switch or a head pointer gets the platform's
 * own control and a large target. The lists scroll in a box measured in `em`,
 * so Send stays near at a large text size.
 */
export function SharePostButton({
  postId,
  words,
  link,
  topicId,
}: {
  postId: string;
  words: string;
  /** The post's own page, for an administrator's link to send outside the club. */
  link?: string;
  /** The topic, when this is its opening post: an administrator can make its link an invite. */
  topicId?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const account = useAccount();
  const what = `“${excerpt(markdownToPlain(words))}”`;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Share ${what}`}
        onClick={() => {
          setOpen(true);
        }}
        className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.6875rem] text-grey hover:bg-tint"
      >
        <Send aria-hidden="true" className="h-3 w-3" />
        Share
      </button>
      {open
        ? createPortal(
            <SharePostSheet
              postId={postId}
              what={what}
              link={link}
              topicId={topicId}
              memberId={account.status === 'member' ? account.userId : null}
              isAdmin={account.status === 'member' && account.isAdmin}
              onClose={() => {
                setOpen(false);
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The owner, 2026-11-16: "These questions are not meant to be shared, only
 * admins can share them and only in private discussions, not on any
 * platforms". A member shares a post inside the club only; an admin also gets
 * its link to copy into a private message, and no Share elsewhere. An admin is
 * a club administrator or, since 2026-11-19, an admin of any organization
 * ("any active admin of any organization", 20261119140000). Whether they are
 * one is read once the sheet opens, not for every post on the screen.
 */
function SharePostSheet({
  postId,
  what,
  link,
  topicId,
  memberId,
  isAdmin,
  onClose,
}: {
  postId: string;
  what: string;
  link: string | undefined;
  topicId: string | undefined;
  memberId: string | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const mine = useMyOrganizations(memberId);
  const admin = isAdmin || mine.ids.size > 0;
  const outside = admin ? link : undefined;
  const invites = admin && topicId ? topicId : null;
  const choices: InviteChoices = {
    mine: [...mine.ids],
    loading: mine.loading,
    anyOrganization: isAdmin,
  };
  return (
    <ShareSheet
      heading="Share post"
      what={what}
      {...(outside ? { link: outside } : {})}
      {...(invites ? { inviteTopic: invites, inviteChoices: choices } : {})}
      linkHeading="Link, for admins"
      linkNote="Send it only in a private message. Never post it anywhere. Only members can open it."
      sendNote="Only members who can read the post will see it."
      send={(to, authorId, line) => sharePost(postId, to, authorId, line)}
      onClose={onClose}
    />
  );
}

/** What was typed in the search, as it is matched. Empty is no search. */
function searchNeedle(search: string): string {
  return search.trim().toLowerCase().replace(/^@/, '');
}

function matchesNeedle(needle: string, name: string, username: string | null | undefined): boolean {
  return matchesSearch([name, username], needle);
}

/** The value of a destination's radio button. */
function targetKey(target: ShareTarget): string {
  return 'threadId' in target ? `thread:${target.threadId}` : `member:${target.memberId}`;
}

/**
 * The link, for outside the club (the owner, 2026-10-28): Copy link, and for
 * what may go anywhere (an event, an organization) the phone's share sheet
 * where there is one (2026-11-03: "copy a link, or share elsewhere"). A post's
 * link is copied only (2026-11-16: "only in private discussions").
 */
function ShareOutside({
  link,
  heading,
  note,
  elsewhere: offerElsewhere,
  inviteTopic,
  inviteChoices = NO_CHOICES,
}: {
  link: string;
  /** What the section is, where only some members see it. */
  heading?: string | undefined;
  note: string;
  elsewhere: boolean;
  /** An administrator sharing a topic, who can make the link an invite. */
  inviteTopic?: string | undefined;
  /** Which organizations the invite may join people to. */
  inviteChoices?: InviteChoices | undefined;
}) {
  const announce = useAnnounce();
  const [said, setSaid] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    id: string;
    code: string;
    until: Date;
    organization: string | null;
  } | null>(null);
  const [making, setMaking] = useState(false);
  const { byId } = useOrganizations();
  // The owner, 2026-11-19: their organization when they have one, none when
  // they have several. Until they choose, the default follows the read.
  const [picked, setPicked] = useState<InviteOrganization | null>(null);
  const choice: InviteOrganization = picked ?? {
    organization: inviteChoices.mine.length === 1 ? (inviteChoices.mine[0] ?? null) : null,
    other: false,
  };
  const ready = !inviteChoices.loading;
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? 'the organization') : null);
  const switchId = useId();
  const plain = link.startsWith('/') ? `${siteOrigin()}${link}` : link;
  const url = invite ? linkWithCode(plain, invite.code) : plain;

  // The owner, 2026-11-16: "a toggle that enables the link to work as an
  // invite link for 24 hours". Off by default, and off again each time the
  // sheet opens: the plain link is the one that leaks nothing.
  async function toggleInvite(on: boolean) {
    setSaid(null);
    // Off turns the code off too, so a link already copied stops letting
    // people in: what an administrator turning it off means.
    if (!on) {
      if (!invite) return;
      setMaking(true);
      const off = await turnOffQrCode(invite.id);
      setMaking(false);
      if (!off.ok) {
        setSaid(off.error);
        return;
      }
      setInvite(null);
      // A search left open goes with it: turned on again, the choice is plain.
      setPicked((was) => (was?.other ? null : was));
      announce('The link no longer lets people join, wherever it was sent.');
      return;
    }
    if (!inviteTopic || !ready) return;
    setMaking(true);
    const made = await shareTopicCode(inviteTopic, choice.organization);
    setMaking(false);
    if (!made.ok) {
      setSaid(made.error);
      return;
    }
    setInvite({
      id: made.id,
      code: made.code,
      until: made.expiresAt,
      organization: choice.organization,
    });
    announce(`Anyone with the link can join the club until ${untilWords(made.expiresAt)}.`);
  }

  // Another organization while the link lets people in: a new link for it,
  // and the one before stops, so one link is live and it says what it does.
  async function choose(next: InviteOrganization) {
    setPicked(next);
    setSaid(null);
    if (!invite || !inviteTopic) return;
    if (next.other && next.organization === null) return;
    if (next.organization === invite.organization) return;
    setMaking(true);
    const made = await shareTopicCode(inviteTopic, next.organization);
    if (!made.ok) {
      setMaking(false);
      setSaid(made.error);
      return;
    }
    if (made.id !== invite.id) {
      const off = await turnOffQrCode(invite.id);
      if (!off.ok) setSaid(off.error);
    }
    setMaking(false);
    setInvite({
      id: made.id,
      code: made.code,
      until: made.expiresAt,
      organization: next.organization,
    });
    const joins = nameOf(next.organization);
    announce(
      `A new link${joins ? ` that also joins people to ${joins}` : ' for the club only'}. The link before no longer lets people join. Copy it again.`,
    );
  }

  async function copy() {
    if (await copyLink(url)) {
      setSaid('Link copied.');
      announce('Link copied.');
    } else {
      setSaid(`Could not copy it. The link is ${url}`);
    }
  }

  async function elsewhere() {
    const outcome = await shareLink({
      url,
      title: 'The SCI Club',
      text: 'Have a look at this on The SCI Club.',
    });
    if (outcome === 'copied') {
      setSaid('Link copied.');
      announce('Link copied.');
    } else if (outcome === 'failed') {
      setSaid(`Could not share it. The link is ${url}`);
    }
  }

  const button =
    'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-[1.6px] border-emphasis bg-paper px-3 font-bold text-[0.9375rem] text-emphasis hover:bg-tint';
  return (
    <div className="mt-4 rounded-[14px] bg-tint p-3">
      {heading ? (
        <h3 className="mb-2 font-bold font-head text-[0.875rem] text-ink">{heading}</h3>
      ) : null}
      {inviteTopic ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-paper p-3">
          <div className="min-w-0 flex-1">
            <p
              id={`${switchId}-label`}
              className="font-bold text-[0.875rem] text-ink leading-[1.35]"
            >
              Let people join through this link
            </p>
            <p id={`${switchId}-about`} className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.4]">
              For 24 hours, anyone who opens it can join the club.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={invite !== null}
            aria-labelledby={`${switchId}-label`}
            aria-describedby={`${switchId}-about`}
            data-target="small"
            disabled={making || (invite === null && !ready)}
            onClick={() => {
              void toggleInvite(invite === null);
            }}
            className={`relative h-[30px] w-[52px] flex-none rounded-full transition-colors disabled:opacity-50 ${
              invite ? 'bg-action hover:bg-action-hi' : 'bg-line hover:bg-grey'
            }`}
          >
            <span
              className={`absolute top-[3px] h-6 w-6 rounded-full bg-paper transition-[left] ${
                invite ? 'left-[25px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>
      ) : null}
      {/* Once the link lets people join (the owner: "when the user says to
          let people join through a link"), with the default already made. */}
      {inviteTopic && invite ? (
        <InviteOrganizationField
          choices={inviteChoices}
          choice={choice}
          disabled={making}
          onChoose={(next) => {
            void choose(next);
          }}
        />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className={button}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          Copy link
        </button>
        {offerElsewhere && canShareElsewhere() ? (
          <button
            type="button"
            onClick={() => {
              void elsewhere();
            }}
            className={button}
          >
            <Share aria-hidden="true" className="h-4 w-4" />
            Share elsewhere
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[0.8125rem] text-ink2 leading-[1.45]">
        {invite
          ? `Send it only in a private message. Never post it anywhere. It works as an invite until ${untilWords(invite.until)}, or until you turn this off. Then it is an ordinary link, for members only.`
          : note}
      </p>
      {said ? (
        <p role="status" className="mt-1.5 break-all text-[0.8125rem] text-ink leading-[1.45]">
          {said}
        </p>
      ) : null}
    </div>
  );
}

/** Which organizations a topic's invite link may join people to. */
export interface InviteChoices {
  /** The organizations the member is an admin of. */
  mine: string[];
  loading: boolean;
  /** A club administrator: any organization in the directory. */
  anyOrganization: boolean;
}

const NO_CHOICES: InviteChoices = { mine: [], loading: false, anyOrganization: false };

/** The organization chosen, null for none; `other` while the directory's search is open. */
interface InviteOrganization {
  organization: string | null;
  other: boolean;
}

/**
 * Who joins through the link also joins this organization (the owner,
 * 2026-11-19: "an org selector when the user says to let people join through
 * a link"). Their own organizations and None; a club administrator also gets
 * Another organization, which opens a search of the whole directory.
 */
function InviteOrganizationField({
  choices,
  choice,
  disabled,
  onChoose,
}: {
  choices: InviteChoices;
  choice: InviteOrganization;
  disabled: boolean;
  onChoose: (next: InviteOrganization) => void;
}) {
  const id = useId();
  const { organizations, byId } = useOrganizations();
  const [find, setFind] = useState('');
  const mine = choices.mine
    .map((orgId) => byId.get(orgId))
    .filter((org) => org !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  // One found in the directory shows in the select once chosen.
  const foundOne =
    choice.organization && !choices.mine.includes(choice.organization)
      ? byId.get(choice.organization)
      : undefined;
  const value = choice.other ? 'other' : (choice.organization ?? 'none');
  const needle = find.trim();
  const found = organizations.filter((org) => matchesSearch([org.name, org.city], needle));
  const chosenName = choice.organization ? byId.get(choice.organization)?.name : null;
  const field =
    'min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-emphasis';

  return (
    <div className="mb-3 rounded-xl bg-paper p-3">
      <label htmlFor={`${id}-org`} className="block font-bold text-[0.875rem] text-ink">
        Organization they join
      </label>
      <p id={`${id}-org-about`} className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.4]">
        {chosenName
          ? `Whoever joins through the link also joins ${chosenName}.`
          : choice.other
            ? 'Find the organization below. Until you choose one, the link stays as it was.'
            : 'Whoever joins through the link joins the club only.'}
      </p>
      <select
        id={`${id}-org`}
        value={value}
        disabled={disabled || choices.loading}
        aria-describedby={`${id}-org-about`}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'other') {
            setFind('');
            onChoose({ organization: null, other: true });
          } else {
            onChoose({ organization: next === 'none' ? null : next, other: false });
          }
        }}
        className={`${field} mt-2`}
      >
        {mine.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
        {foundOne ? <option value={foundOne.id}>{foundOne.name}</option> : null}
        <option value="none">None, the club only</option>
        {choices.anyOrganization ? <option value="other">Another organization…</option> : null}
      </select>
      {choice.other ? (
        <fieldset className="mt-3">
          <legend className="sr-only">Another organization</legend>
          <label htmlFor={`${id}-find`} className="block font-bold text-[0.875rem] text-ink">
            Find an organization
          </label>
          <input
            id={`${id}-find`}
            type="search"
            autoComplete="off"
            value={find}
            placeholder="Name or city"
            onChange={(event) => {
              setFind(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            className={`${field} mt-1.5`}
          />
          {found.length === 0 ? (
            <p className="py-3 text-[0.875rem] text-grey">{`Nothing matches “${needle}”.`}</p>
          ) : (
            <div className="mt-2 max-h-[14em] overflow-y-auto rounded-[12px] border border-line px-3">
              {found.map((org) => (
                <label
                  key={org.id}
                  className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 border-line border-b py-2 last:border-b-0"
                >
                  <input
                    type="radio"
                    name={`${id}-other`}
                    value={org.id}
                    checked={false}
                    disabled={disabled}
                    onChange={() => {
                      onChoose({ organization: org.id, other: false });
                    }}
                    className="h-[22px] w-[22px] flex-none accent-emphasis"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-[0.875rem] text-ink [overflow-wrap:anywhere]">
                      {org.name}
                    </span>
                    {org.city ? (
                      <span className="block text-[0.75rem] text-grey">{org.city}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
    </div>
  );
}

/** "3:00 PM tomorrow", or "Tuesday at 3:00 PM", for when an invite link stops letting people in. */
function untilWords(when: Date, now: Date = new Date()): string {
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    when,
  );
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (when.toDateString() === now.toDateString()) return `${time} today`;
  if (when.toDateString() === tomorrow.toDateString()) return `${time} tomorrow`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(when);
  return `${day} at ${time}`;
}

/**
 * The sheet itself, for a post, an event or an organization (the owner,
 * 2026-11-03: "send it to a contact or group, copy a link, or share
 * elsewhere"). `send` puts it into the conversation chosen.
 */
export function ShareSheet({
  heading: title,
  what,
  link,
  linkHeading,
  linkNote,
  elsewhere = false,
  inviteTopic,
  inviteChoices,
  sendNote,
  send: deliver,
  onClose,
}: {
  heading: string;
  what: string;
  /** A path in the club or a whole address, for Copy link and Share elsewhere. */
  link?: string;
  /** Whether the phone's share sheet is offered for the link: not for a post. */
  elsewhere?: boolean;
  /** The topic an administrator can make the link an invite to (ShareOutside). */
  inviteTopic?: string | undefined;
  /** The organizations that invite may join people to. */
  inviteChoices?: InviteChoices | undefined;
  /** A heading over the link, where only some members see it. */
  linkHeading?: string;
  linkNote: string;
  sendNote: string;
  send: (to: ShareTarget, authorId: string, line: string) => Promise<ShareResult>;
  onClose: () => void;
}) {
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;
  const announce = useAnnounce();
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  useDialogFocus(dialog, heading, onClose);

  const threads = useMyThreads();
  // A direct conversation whose other member has left has nobody to send to.
  const offered = threads.threads.filter((t) => t.kind === 'group' || t.otherMemberId !== null);
  const authors = useChatAuthors(offered.map((t) => t.otherMemberId));
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<{ value: ShareTarget; name: string } | null>(null);
  const [line, setLine] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<{ threadId: string; name: string } | null>(null);

  useEffect(() => {
    if (sent) confirmation.current?.focus();
  }, [sent]);

  const chosen = target ? targetKey(target.value) : null;
  const needle = searchNeedle(search);
  const shownThreads = offered.filter((thread) => {
    if (chosen === `thread:${thread.id}`) return true;
    const other = thread.otherMemberId ? authors.get(thread.otherMemberId) : undefined;
    return matchesNeedle(needle, threadTitle(thread, other?.displayName ?? null), other?.username);
  });

  /** A conversation's name as it reads now: a name still loading when picked fills in. */
  function nameOf(to: { value: ShareTarget; name: string }): string {
    const value = to.value;
    if (!('threadId' in value)) return to.name;
    const thread = offered.find((t) => t.id === value.threadId);
    if (!thread) return to.name;
    const other = thread.otherMemberId ? authors.get(thread.otherMemberId) : undefined;
    return threadTitle(thread, other?.displayName ?? null) || to.name;
  }
  const targetName = target ? nameOf(target) : '';

  function send() {
    if (!target || !memberId || sending) return;
    setSending(true);
    setFailure(null);
    const to = target;
    const name = targetName;
    void deliver(to.value, memberId, line)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        setSent({ threadId: result.threadId, name });
        announce(`Shared with ${name}.`);
      })
      .finally(() => {
        setSending(false);
      });
  }

  const row =
    'flex min-h-[56px] w-full cursor-pointer items-center gap-3 border-line border-b py-2 last:border-b-0';

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close share"
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-black/40"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-post-heading"
        className="fixed inset-x-0 bottom-0 z-[81] max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-paper px-5 pt-4 pb-6 text-ink shadow-xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 pt-2">
            <h2
              id="share-post-heading"
              ref={heading}
              tabIndex={-1}
              className="font-bold font-head text-lg outline-none"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-[0.875rem] text-grey leading-snug [overflow-wrap:anywhere]">
              {what}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-grey hover:bg-tint"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="mt-4">
            <p
              ref={confirmation}
              tabIndex={-1}
              className="font-semibold text-[0.9375rem] text-ink leading-[1.45] outline-none"
            >
              Shared with {sent.name}.
            </p>
            <Link
              to={`/chat/t/${sent.threadId}`}
              onClick={onClose}
              className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-action px-4 font-bold text-[0.9375rem] text-white"
            >
              Go to the conversation
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 min-h-12 w-full rounded-xl border border-line font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label
              htmlFor="share-post-search"
              className="block font-bold font-head text-[0.875rem] text-ink"
            >
              Search
            </label>
            <input
              id="share-post-search"
              type="search"
              autoComplete="off"
              autoCapitalize="none"
              value={search}
              placeholder="Name or @username"
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                // Not Send: the keyboard's Enter ends a search.
                if (event.key === 'Enter') event.preventDefault();
              }}
              className="mt-1.5 mb-3 min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-emphasis"
            />
            <fieldset>
              <legend className="font-bold font-head text-[0.875rem] text-ink">Send to</legend>
              <p className="mt-0.5 text-[0.78125rem] text-grey leading-[1.45]">{sendNote}</p>
              {threads.loading ? (
                <p role="status" className="py-4 text-[0.875rem] text-grey">
                  Loading your conversations…
                </p>
              ) : threads.error ? (
                <p className="py-4 text-[0.875rem] text-ink2">{threads.error}</p>
              ) : offered.length === 0 && needle === '' ? (
                <p className="py-4 text-[0.875rem] text-grey">
                  No conversations yet. Choose someone below.
                </p>
              ) : shownThreads.length === 0 ? null : (
                <div className="mt-2 max-h-[16em] overflow-y-auto rounded-[14px] border border-line px-3.5">
                  {shownThreads.map((thread) => {
                    const other = thread.otherMemberId
                      ? (authors.get(thread.otherMemberId) ?? null)
                      : null;
                    const name = threadTitle(thread, other?.displayName ?? null) || '…';
                    const value: ShareTarget = { threadId: thread.id };
                    return (
                      <label key={thread.id} className={row}>
                        <input
                          type="radio"
                          name="share-to"
                          value={targetKey(value)}
                          checked={chosen === targetKey(value)}
                          onChange={() => {
                            setTarget({ value, name });
                          }}
                          className="h-[22px] w-[22px] flex-none accent-emphasis"
                        />
                        <span aria-hidden="true" className="flex-none">
                          {thread.kind === 'group' ? (
                            <GroupAvatar />
                          ) : other ? (
                            <MemberAvatar
                              id={other.id}
                              displayName={other.displayName}
                              photoPath={other.photoPath}
                              photoAlt={other.photoAlt}
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-extrabold font-head text-[0.90625rem] text-ink [overflow-wrap:anywhere]">
                            {name}
                          </span>
                          <span className="block text-[0.71875rem] text-grey">
                            {thread.kind === 'group'
                              ? `Group · ${thread.memberCount} ${thread.memberCount === 1 ? 'member' : 'members'}`
                              : 'Direct message'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* A search reaches every member, so the list is already open. */}
              {needle === '' ? (
                <button
                  type="button"
                  aria-expanded={picking}
                  aria-controls="share-post-members"
                  onClick={() => {
                    // A member chosen from the list goes with it, so Send never
                    // names somebody whose choice is no longer on screen.
                    if (picking && target && 'memberId' in target.value) setTarget(null);
                    setPicking(!picking);
                  }}
                  className="mt-2 inline-flex min-h-11 items-center font-semibold text-[0.875rem] text-emphasis underline underline-offset-2"
                >
                  {picking ? 'Hide the members' : 'Someone else'}
                </button>
              ) : null}
              <div id="share-post-members" hidden={!picking && needle === ''}>
                {picking || needle !== '' ? (
                  <MemberChoices
                    viewerId={memberId}
                    chosen={chosen}
                    needle={needle}
                    conversations={offered}
                    foundConversation={shownThreads.length > 0}
                    onChoose={(id, name) => {
                      setTarget({ value: { memberId: id }, name });
                      // Stays on screen once the search is cleared.
                      setPicking(true);
                    }}
                  />
                ) : null}
              </div>
            </fieldset>

            <label
              htmlFor="share-post-line"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              Add a message <span className="font-normal text-grey">(optional)</span>
            </label>
            <textarea
              id="share-post-line"
              rows={2}
              maxLength={4000}
              value={line}
              onChange={(event) => {
                setLine(event.target.value);
              }}
              className="mt-1.5 w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[1rem] text-ink leading-[1.5] outline-none focus:border-emphasis"
            />

            {failure ? (
              <p
                role="alert"
                className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
              >
                {failure}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!target || sending}
              className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-action px-4 font-bold text-[0.9375rem] text-white disabled:opacity-40"
            >
              {sending ? 'Sending…' : target ? `Send to ${targetName}` : 'Send'}
            </button>
          </form>
        )}

        {/* Below Send (the owner, 2026-11-16: "The copy link button should
            also be on the bottom"): sending inside the club comes first. */}
        {link && !sent ? (
          <ShareOutside
            link={link}
            heading={linkHeading}
            note={linkNote}
            elsewhere={elsewhere}
            inviteTopic={inviteTopic}
            inviteChoices={inviteChoices}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * Members to start a direct conversation with: the people Peers shows, as
 * New message offers them, narrowed by the sheet's search. A member with a
 * direct conversation is found there instead, not twice.
 */
function MemberChoices({
  viewerId,
  chosen,
  needle,
  conversations,
  foundConversation,
  onChoose,
}: {
  viewerId: string | null;
  chosen: string | null;
  needle: string;
  conversations: ChatThread[];
  foundConversation: boolean;
  onChoose: (memberId: string, name: string) => void;
}) {
  const { members, loading, error } = useBrowseMembers('names');
  const shown = useMemo(() => {
    const direct = new Set(conversations.map((thread) => thread.otherMemberId));
    return members
      .filter((member) => member.id !== viewerId)
      .filter(
        (member) =>
          // The chosen one stays, so the choice never vanishes from the group.
          `member:${member.id}` === chosen ||
          needle === '' ||
          (!direct.has(member.id) && matchesNeedle(needle, member.displayName, member.username)),
      );
  }, [members, viewerId, needle, conversations, chosen]);

  if (loading) {
    return (
      <p role="status" className="py-4 text-[0.875rem] text-grey">
        Loading the members…
      </p>
    );
  }
  if (error) return <p className="py-4 text-[0.875rem] text-ink2">{error}</p>;

  return (
    <>
      {shown.length === 0 ? (
        foundConversation ? null : (
          <p className="py-4 text-[0.875rem] text-grey">
            {needle === '' ? 'Nobody else is in the club yet.' : `Nobody matches “${needle}”.`}
          </p>
        )
      ) : (
        <div className="mt-2 max-h-[16em] overflow-y-auto rounded-[14px] border border-line px-3.5">
          {shown.map((member) => {
            const value = `member:${member.id}`;
            return (
              <label
                key={member.id}
                className="flex min-h-[56px] w-full cursor-pointer items-center gap-3 border-line border-b py-2 last:border-b-0"
              >
                <input
                  type="radio"
                  name="share-to"
                  value={value}
                  checked={chosen === value}
                  onChange={() => {
                    onChoose(member.id, member.displayName);
                  }}
                  className="h-[22px] w-[22px] flex-none accent-emphasis"
                />
                <span aria-hidden="true" className="flex-none">
                  <MemberAvatar
                    id={member.id}
                    displayName={member.displayName}
                    photoPath={member.photoPath}
                    photoAlt={member.photoAlt}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold font-head text-[0.90625rem] text-ink [overflow-wrap:anywhere]">
                    {member.displayName}
                  </span>
                  <span className="block text-[0.71875rem] text-grey">
                    {member.username ? `@${member.username}` : 'Member'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}
