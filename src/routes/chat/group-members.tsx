import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { FormerMemberAvatar, GroupAvatar, MemberAvatar } from '@/components/member-avatar';
import { WheelBadge } from '@/components/wheel-badge';
import { useAccount } from '@/lib/account';
import { useAttachmentUrls } from '@/lib/chat/attachments';
import { useChatAuthors } from '@/lib/chat/authors';
import { addToGroup, leaveGroup, useThreadRoster } from '@/lib/chat/groups';
import { useMyThreads } from '@/lib/chat/threads';
import { describeThrown } from '@/lib/describe-error';
import { useThreadOrganization } from '@/lib/organization-members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { GroupIdentity } from '@/routes/chat/group-identity';
import { MemberPicker } from '@/routes/chat/member-picker';

/**
 * A group's members, adding and leaving, and its name and picture (`GroupIdentity`). Linked from
 * the thread header's "N members" line.
 *
 * Nobody removes anybody but themselves: the delete policy is own-row-only. Who may evict whom is a
 * moderation question this build does not answer.
 *
 * An event's group takes no members by hand (`chat_add_to_group` refuses an `event_id`). Adding to
 * an organization's group makes a member (20261030020000), so only its org admins and the club's
 * administrators see the picker.
 *
 * Leaving confirms in place, not with `confirm()`, which screen readers do not read reliably.
 */
export default function GroupMembersPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const account = useAccount();
  const viewerId = account.status === 'member' ? account.userId : null;

  // The thread list, not the conversation: one round trip for the name and kind, no messages.
  const { threads, loading: threadsLoading, reload: reloadThreads } = useMyThreads();
  const thread = threads.find((candidate) => candidate.id === threadId) ?? null;
  const picture = useAttachmentUrls(thread?.photoPath ? [thread.photoPath] : []);
  const {
    memberIds,
    loading: rosterLoading,
    error: rosterError,
    reload,
  } = useThreadRoster(threadId);
  const authors = useChatAuthors(memberIds);
  const organizationId = useThreadOrganization(threadId);
  const mine = useMyOrganizations(viewerId);
  const addsToOrganization =
    typeof organizationId === 'string' &&
    account.status === 'member' &&
    (account.isAdmin || mine.ids.has(organizationId));

  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function toggle(memberId: string) {
    setPicked((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  }

  function add() {
    if (!threadId || picked.length === 0 || adding) return;
    setAdding(true);
    setFailure(null);
    // In order; the first refusal stops the rest, and the refetched roster shows who got in.
    void (async () => {
      for (const memberId of picked) {
        const result = await addToGroup(threadId, memberId);
        if (!result.ok) {
          setFailure(result.error);
          break;
        }
      }
      setPicked([]);
      reload();
      setAdding(false);
    })();
  }

  function leave() {
    if (!threadId || !viewerId || leaving) return;
    setLeaving(true);
    setFailure(null);
    void leaveGroup(threadId, viewerId)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          setLeaving(false);
          return;
        }
        // Replace, so Back cannot land on a thread that no longer loads for them.
        void navigate('/chat', { replace: true });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
        setLeaving(false);
      });
  }

  if (threadsLoading || rosterLoading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }

  if (thread?.kind !== 'group') {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <BackLink to="/chat" label="Chat" />
          <p className="mt-6 text-[0.875rem] text-ink2 leading-relaxed">
            {thread
              ? 'A conversation between two people has no members to manage.'
              : 'This group cannot be shown.'}
          </p>
        </div>
      </div>
    );
  }

  const inIt = new Set(memberIds);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[720px]">
        <BackLink to={`/chat/t/${thread.id}`} label={thread.name ?? 'Group'} />

        <div className="mt-1.5 flex items-center gap-3">
          {/* Decorative: the name beside it is the heading. Sized in rem so it
              grows with the text-size setting, as the name does. */}
          <GroupAvatar
            url={thread.photoPath ? picture.get(thread.photoPath) : null}
            className="h-[3.5rem] w-[3.5rem] rounded-[16px] text-[1.75rem]"
          />
          <h1 className="min-w-0 break-words font-extrabold font-head text-[1.25rem] text-ink tracking-[-0.01em]">
            {thread.name ?? 'Group'}
          </h1>
        </div>

        {thread.eventId ? null : <GroupIdentity thread={thread} onChanged={reloadThreads} />}

        <h2 className="mt-6 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          {memberIds.length} {memberIds.length === 1 ? 'member' : 'members'}
        </h2>
        <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
          Everybody here can read the whole conversation, including what was said before they
          arrived.
        </p>

        {failure ? (
          <p
            role="alert"
            className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
          >
            {failure}
          </p>
        ) : null}
        {rosterError ? (
          <p className="mt-3 text-[0.78125rem] text-grey leading-relaxed">{rosterError}</p>
        ) : null}

        <div className="mt-3 rounded-[14px] border border-line bg-paper px-3.5">
          {memberIds.map((memberId) => {
            const author = authors.get(memberId) ?? null;
            return (
              <div
                key={memberId}
                className="flex min-h-[56px] items-center gap-3 border-line border-b py-2.5 last:border-b-0"
              >
                {/* Decorative: the name beside it is the link. An initials-only link
                    reads as "link, N" to a screen reader. */}
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
                  <span className="block font-extrabold font-head text-[0.90625rem] text-ink">
                    {author?.hasProfile ? (
                      // Underlined: beside "— you" a link told apart by
                      // colour alone fails axe's link-in-text-block.
                      <Link
                        to={`/peers/${author.id}`}
                        className="text-emphasis underline decoration-line underline-offset-2 hover:decoration-emphasis"
                      >
                        {author.displayName}
                      </Link>
                    ) : (
                      (author?.displayName ?? 'Deleted member')
                    )}
                    {memberId === viewerId ? (
                      <span className="font-normal text-grey"> — you</span>
                    ) : null}
                  </span>
                  <span className="block text-[0.71875rem] text-grey">
                    {author?.username ? `@${author.username}` : null}
                    {author?.username && author.level ? ' · ' : null}
                    {author?.level ? (
                      <LevelHighlight
                        level={author.level}
                        stage={author.stage}
                        band={author.band}
                        injuryType={author.injuryType}
                      />
                    ) : null}
                    {author ? (
                      <WheelBadge
                        memberId={author.id}
                        name={author.displayName}
                        className="ml-1.5"
                      />
                    ) : null}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {thread.eventId ? (
          <p className="mt-4 rounded-r-[11px] border-gold border-l-[3px] bg-gold-lt px-3.5 py-3 text-gold-ink text-[0.7875rem] leading-[1.5]">
            This is the group chat for an event. It keeps the event’s name, and everybody going to
            it can join from the event, so nobody is added by hand here.
          </p>
        ) : organizationId === undefined ? null : organizationId && !addsToOrganization ? (
          <p className="mt-4 rounded-r-[11px] border-gold border-l-[3px] bg-gold-lt px-3.5 py-3 text-gold-ink text-[0.7875rem] leading-[1.5]">
            This is the group chat for an organization's members. Anybody who joins the organization
            is in it, and its org admins can add people here.
          </p>
        ) : (
          <>
            {addsToOrganization ? (
              <p className="mt-4 text-[0.78125rem] text-ink2 leading-[1.45]">
                Adding somebody here makes them a member of the organization.
              </p>
            ) : null}
            <MemberPicker
              picked={picked}
              onToggle={toggle}
              exclude={inIt}
              label="Add somebody"
              emptyNote="Everybody in the club is already in this group."
            />
            {picked.length > 0 ? (
              <button
                type="button"
                onClick={add}
                disabled={adding}
                className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-40 disabled:hover:bg-gold"
              >
                {adding
                  ? 'Adding…'
                  : `Add ${picked.length} ${picked.length === 1 ? 'member' : 'members'}`}
              </button>
            ) : null}
          </>
        )}

        <h2 className="mt-6 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          Leaving
        </h2>
        {confirmingLeave ? (
          <>
            <p className="mt-1.5 text-[0.78125rem] text-ink2 leading-[1.45]">
              You will stop being able to read this conversation, including the part of it that
              happened while you were in it. What you wrote stays, and anybody still in the group
              can bring you back.
            </p>
            <div className="mt-2.5 flex gap-2.5">
              <button
                type="button"
                onClick={leave}
                disabled={leaving}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-[13px] border-[1.6px] border-destructive font-bold font-head text-[0.9375rem] text-destructive disabled:opacity-40"
              >
                {leaving ? 'Leaving…' : 'Leave the group'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingLeave(false);
                }}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-[13px] border-[1.6px] border-line font-bold font-head text-[0.9375rem] text-ink"
              >
                Stay in it
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingLeave(true);
            }}
            className="mt-1.5 flex min-h-[44px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-line font-bold font-head text-[0.9375rem] text-ink"
          >
            Leave this group
          </button>
        )}
        <div className="h-3" />
      </div>
    </div>
  );
}
