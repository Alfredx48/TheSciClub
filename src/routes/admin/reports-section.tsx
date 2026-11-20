import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { anonymousName, useAnonymity } from '@/lib/chat/anonymous';
import { useChatAuthors } from '@/lib/chat/authors';
import { useEdits } from '@/lib/chat/edits';
import { resolveReport } from '@/lib/chat/reports';
import { removeMessage } from '@/lib/chat/threads';
import { chatTimeLong } from '@/lib/chat/time';
import { removePost } from '@/lib/chat/topics';
import type { ChatAuthor, ChatEdit, ChatReport } from '@/lib/chat/types';
import { describeThrown } from '@/lib/describe-error';
import { ReasonField, SmallButton } from '@/routes/admin/controls';
import { ReportedProfileCopy } from '@/routes/admin/reported-profile';
import { AttachmentGrid } from '@/routes/chat/attachment-grid';
import { EarlierVersions } from '@/routes/chat/earlier-versions';

/**
 * What members have handed over, for an administrator.
 *
 * A row is the report, never a window into a direct conversation: `admin_chat_reports()` returns
 * no thread id, so the privacy promise on /chat cannot be eroded by adding a button. A post does
 * carry its room and topic, since rooms are readable by every member anyway.
 *
 * No strike control here: a strike belongs on the member's row, with the whole picture, not on
 * one message out of context. "Go to Bo" links the two. `report_count` is information, never a
 * threshold.
 *
 * No Remove for a direct message (the owner, 2026-09-21): it protects nobody, and the report
 * keeps the copy. `contextKind` is recorded at filing, so this holds once the original is gone.
 *
 * Names link to the profile, or to the member's row here when they have none (/peers/:id uses
 * browse_members and cannot see members hidden from Peers); from chat_authors.has_profile.
 *
 * Earlier versions come from chat_edits (HANDOFF.md "What Home is", decision 10) and go with
 * the row; the snapshot survives. Resolved reports collapse, not delete, and need a sentence
 * (required by the database) so the next administrator knows what was decided.
 */
export function ReportsSection({
  reports,
  loading,
  error,
  reload,
  onGoToMember,
}: {
  reports: ChatReport[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Switches to the Members tab and scrolls that member's row into view. */
  onGoToMember: (memberId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // For has_profile only — the names themselves come with the report, so a
  // former member is still named after chat_authors has stopped knowing them.
  const authors = useChatAuthors(reports.flatMap((r) => [r.reporterId, r.reportedAuthorId]));
  const edits = useEdits(
    reports.flatMap((r) => (r.postId ? [r.postId] : [])),
    reports.flatMap((r) => (r.messageId ? [r.messageId] : [])),
  );
  const editsOf = (report: ChatReport): ChatEdit[] =>
    (report.postId ? edits.byPost.get(report.postId) : null) ??
    (report.messageId ? edits.byMessage.get(report.messageId) : null) ??
    [];

  // A block waits for no decision, so it is listed apart (20261022050000).
  const blocks = reports.filter((r) => r.kind === 'block');
  const open = reports.filter((r) => r.resolvedAt === null && r.kind !== 'block');
  const closed = reports.filter((r) => r.resolvedAt !== null && r.kind !== 'block');

  // The weekly count of blocks opens here (#blocks, 20261022090000): once,
  // when the list has loaded.
  const { hash } = useLocation();
  const blocksHeading = useRef<HTMLHeadingElement | null>(null);
  const landed = useRef(false);
  const hasBlocks = blocks.length > 0;
  useEffect(() => {
    const heading = blocksHeading.current;
    if (hash !== '#blocks' || loading || !hasBlocks || landed.current || !heading) return;
    landed.current = true;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [hash, loading, hasBlocks]);

  function removeReported(report: ChatReport) {
    const what = report.kind === 'post' ? 'post' : 'message';
    // A post in a topic disappears (20260927030000); a group message keeps its
    // place with "Removed by an administrator" in it.
    const ok = window.confirm(
      report.kind === 'post'
        ? 'Remove this post or reply?\n\nIt disappears from the room for everybody. This report keeps its copy of what it said.'
        : 'Remove this message?\n\nIts text is replaced with "Removed by an administrator" for everybody in the conversation. This report keeps its copy of what it said.',
    );
    if (!ok) return;
    const id = report.kind === 'post' ? report.postId : report.messageId;
    if (!id) {
      setFailure(`That ${what} is no longer there.`);
      return;
    }
    setBusyId(report.id);
    setFailure(null);
    const run = report.kind === 'post' ? removePost(id) : removeMessage(id);
    run
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        // The row is blanked; its photographs stay, as nothing named on a report can be deleted
        // (20260918210000). Re-read, so the row stops offering to remove what is gone.
        reload();
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setBusyId(null);
      });
  }

  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-2">
        <h2 className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
          Reports
        </h2>
        <span className="text-[0.75rem] text-grey">
          {/* A count of zero is not drawn as "0 open". */}
          {open.length === 0 ? 'nothing waiting' : `${open.length} waiting`}
        </span>
      </div>
      <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
        One post, one message or one profile, handed over by the member who saw it. Nothing else
        about a conversation comes with it, and there is no way from here into one.
      </p>

      {failure ? (
        <p
          role="alert"
          className="mb-2 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
        >
          {failure}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
        {loading ? (
          <p className="py-6 text-center text-[0.8125rem] text-grey">Loading the reports…</p>
        ) : error ? (
          <p className="px-3 py-6 text-center text-[0.8125rem] text-grey leading-[1.45]">{error}</p>
        ) : open.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.8125rem] text-grey leading-[1.45]">
            Nothing has been reported. Members can hand over a post, a message or a member’s profile
            from where they are reading it.
          </p>
        ) : (
          open.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              edits={editsOf(report)}
              authors={authors}
              busy={busyId === report.id}
              onRemove={() => {
                removeReported(report);
              }}
              onGoToMember={onGoToMember}
              onResolved={reload}
              onFailure={setFailure}
            />
          ))
        )}
      </div>

      {blocks.length > 0 ? (
        <>
          <h2
            id="blocks"
            ref={blocksHeading}
            tabIndex={-1}
            className="mt-5 scroll-mt-4 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em] outline-none"
          >
            Blocks
          </h2>
          <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
            A member blocked another. Nothing to decide and no words with it; the member blocked is
            not told.
          </p>
          <ul className="overflow-hidden rounded-[14px] border border-line bg-paper">
            {blocks.map((block) => (
              <li key={block.id} className="border-line border-b p-3 last:border-b-0">
                <p className="text-[0.875rem] text-ink leading-[1.45]">
                  <MemberName
                    id={block.reporterId}
                    name={block.reporterName}
                    gone="A deleted member"
                    authors={authors}
                    onGoToMember={onGoToMember}
                  />{' '}
                  blocked{' '}
                  <MemberName
                    id={block.reportedAuthorId}
                    name={block.reportedAuthorName}
                    gone="a deleted member"
                    authors={authors}
                    onGoToMember={onGoToMember}
                  />
                  <span className="ml-2 text-[0.75rem] text-grey">
                    {chatTimeLong(block.createdAt)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {closed.length > 0 ? (
        <>
          <h2 className="mt-5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
            Settled
          </h2>
          <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
            Kept, not deleted: what was decided about somebody last time is most of deciding what to
            do about them this time.
          </p>
          <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
            {closed.map((report) => (
              <div key={report.id} className="border-line border-b p-3 last:border-b-0">
                <Where report={report} authors={authors} onGoToMember={onGoToMember} />
                <Snapshot report={report} edits={editsOf(report)} />
                <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
                  {report.resolvedByName ?? 'A deleted member'} settled this
                  {report.resolvedAt ? ` on ${chatTimeLong(report.resolvedAt)}` : ''}:{' '}
                  <span className="text-ink2">{report.resolution}</span>
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function ReportRow({
  report,
  edits,
  authors,
  busy,
  onRemove,
  onGoToMember,
  onResolved,
  onFailure,
}: {
  report: ChatReport;
  edits: ChatEdit[];
  authors: Map<string, ChatAuthor>;
  busy: boolean;
  onRemove: () => void;
  onGoToMember: (memberId: string) => void;
  onResolved: () => void;
  onFailure: (said: string | null) => void;
}) {
  const [settling, setSettling] = useState(false);
  // Bound to a const so the callback below closes over a narrowed id rather
  // than re-reading a nullable field.
  const authorId = report.reportedAuthorId;
  const [said, setSaid] = useState('');
  const [saving, setSaving] = useState(false);

  function settle() {
    if (!said.trim() || saving) return;
    setSaving(true);
    onFailure(null);
    // The write is here rather than in the parent because the sentence it
    // needs lives in this row's own state.
    resolveReport(report.id, said)
      .then((result) => {
        if (!result.ok) {
          onFailure(result.error);
          return;
        }
        setSettling(false);
        setSaid('');
        onResolved();
      })
      .catch((e: unknown) => {
        onFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className="border-line border-b p-3 last:border-b-0">
      <Where report={report} authors={authors} onGoToMember={onGoToMember} />
      <Snapshot report={report} edits={edits} />

      <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
        {report.raisedByVotes ? (
          // Nobody reported it: the votes did (20261118190000).
          <>Members voted this down to −3 by {chatTimeLong(report.createdAt)}</>
        ) : (
          <>
            Reported by{' '}
            <MemberName
              id={report.reporterId}
              name={report.reporterName}
              gone="a deleted member"
              authors={authors}
              onGoToMember={onGoToMember}
            />{' '}
            on {chatTimeLong(report.createdAt)}
          </>
        )}
        {/* Only past one. "1 member reported this" is a sentence saying what
            the row already says. */}
        {report.reportCount > 1 ? ` · ${report.reportCount} members reported this` : ''}
      </p>
      {report.note && !report.raisedByVotes ? (
        <p className="mt-1.5 text-[0.8125rem] text-ink2 leading-[1.5]">“{report.note}”</p>
      ) : null}

      {report.kind === 'profile' && !report.reportedAuthorId ? (
        <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
          Their account has been deleted. The name, @username and photograph went with it; what they
          wrote stays.
        </p>
      ) : report.kind === 'profile' ? (
        <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
          A profile is not removed from here. What to do about it is on their row, and the copy
          above stays as it was when it was reported.
        </p>
      ) : null}
      {report.contextKind === 'direct' ? (
        <p className="mt-1.5 text-[0.75rem] text-grey leading-[1.45]">
          A direct message is not removed from here: it protects nobody who has not already read it.
          What to do about it is on their row.
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {report.kind === 'profile' ||
        report.contextKind === 'direct' ? null : report.alreadyRemoved ? (
          <span className="rounded-full bg-tint px-3 py-1.5 font-semibold text-[0.75rem] text-grey">
            Already removed
          </span>
        ) : (
          <SmallButton destructive disabled={busy} onClick={onRemove}>
            {busy ? 'Removing…' : `Remove the ${report.kind}`}
          </SmallButton>
        )}
        {/* A post only, and never a message: there is no thread id in the
            answer to build a link out of, deliberately. */}
        {report.kind === 'post' && report.roomId && report.topicId ? (
          <Link
            to={`/chat/rooms/${report.roomId}/topics/${report.topicId}`}
            data-target="small"
            className="whitespace-nowrap rounded-full bg-tint px-3 py-1.5 font-semibold text-[0.75rem] text-emphasis transition-colors hover:bg-line"
          >
            Open the post
          </Link>
        ) : null}
        {authorId ? (
          <SmallButton
            onClick={() => {
              onGoToMember(authorId);
            }}
          >
            Go to {report.reportedAuthorName ?? 'them'}
          </SmallButton>
        ) : null}
        {settling ? null : (
          <SmallButton
            onClick={() => {
              setSettling(true);
            }}
          >
            Settle it
          </SmallButton>
        )}
      </div>

      {settling ? (
        <div className="mt-1">
          {/* Not "reason": what is being asked for is what was done about it,
              and it is what the next administrator to look at this person
              reads. "Resolved" on its own is refused by the database. */}
          <ReasonField
            id={`settle-${report.id}`}
            value={said}
            onChange={setSaid}
            label="What was decided (only administrators see this)"
            placeholder="Removed it and spoke to them"
          />
          <div className="mt-2 flex gap-1.5">
            {/* Required, and the button says so by being unavailable until
                there is a sentence. The database refuses a blank one either
                way — this only stops the round trip. */}
            <SmallButton disabled={!said.trim() || saving} onClick={settle}>
              {saving ? 'Saving…' : 'Settle it'}
            </SmallButton>
            <SmallButton
              onClick={() => {
                setSettling(false);
                setSaid('');
              }}
            >
              Not now
            </SmallButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Where it was said, who said it and when. The name is a link to the person;
 * the place is words, never a link — see the header.
 */
function Where({
  report,
  authors,
  onGoToMember,
}: {
  report: ChatReport;
  authors: Map<string, ChatAuthor>;
  onGoToMember: (memberId: string) => void;
}) {
  const gone = useGone(report);
  return (
    <p className="font-extrabold font-head text-[0.90625rem] text-ink leading-[1.35]">
      <MemberName
        id={report.reportedAuthorId}
        name={report.reportedAuthorName}
        gone={gone}
        authors={authors}
        onGoToMember={onGoToMember}
      />
      <span className="ml-2 font-semibold text-[0.75rem] text-grey">
        {report.place} · {chatTimeLong(report.writtenAt)}
      </span>
      {report.kind === 'profile' ? (
        <span className="ml-2 rounded-full bg-tint px-2.5 py-[3px] font-extrabold font-head text-[0.6875rem] text-emphasis uppercase tracking-[0.08em]">
          Profile report
        </span>
      ) : null}
    </p>
  );
}

/**
 * A member's name as a link: their profile if they have one, else their row here (it exists for
 * every member, so it is also the safe default before `authors` arrives); a plain word once gone.
 */
function MemberName({
  id,
  name,
  gone,
  authors,
  onGoToMember,
}: {
  id: string | null;
  name: string | null;
  /** What to print when there is nobody left to name. */
  gone: string;
  authors: Map<string, ChatAuthor>;
  onGoToMember: (memberId: string) => void;
}) {
  if (!id) return <>{name ?? gone}</>;
  const label = name ?? gone;
  const style =
    'underline decoration-line underline-offset-2 transition-colors hover:text-emphasis';
  if (authors.get(id)?.hasProfile) {
    return (
      <Link to={`/peers/${id}`} data-target="small" className={style}>
        {label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-target="small"
      className={style}
      onClick={() => {
        onGoToMember(id);
      }}
    >
      {label}
    </button>
  );
}

/**
 * What the reporter saw, kept whatever has happened since. The words are a copy; the photographs
 * are the originals, readable via the report (20260918200000) and undeletable once named
 * (20260918210000).
 */
function Snapshot({ report, edits }: { report: ChatReport; edits: ChatEdit[] }) {
  const gone = useGone(report);
  if (report.profile) {
    return <ReportedProfileCopy profile={report.profile} photoPath={report.profilePhotoPath} />;
  }
  return (
    <div className="mt-1.5 border-line border-l-2 pl-2.5">
      {report.bodySnapshot ? (
        <p className="whitespace-pre-line text-[0.8125rem] text-ink leading-[1.5]">
          {report.bodySnapshot}
        </p>
      ) : null}
      {report.attachments.length > 0 ? (
        <div className="max-w-[20rem]">
          <AttachmentGrid paths={report.attachments} from={report.reportedAuthorName ?? gone} />
          <p className="mt-1 text-[0.71875rem] text-grey leading-[1.45]">
            {report.attachments.length === 1
              ? 'One photograph was'
              : `${report.attachments.length} photographs were`}{' '}
            reported with it, and kept: a reported photograph cannot be deleted, even by whoever
            sent it.
          </p>
        </div>
      ) : null}
      {edits.length > 0 ? (
        <EarlierVersions edits={edits} from={report.reportedAuthorName ?? gone} />
      ) : null}
    </div>
  );
}

/**
 * Who wrote a reported post with nobody named: "Anonymous", which administrators are not told
 * past (20261120110000), or a member who has since left.
 */
function useGone(report: ChatReport): string {
  const asked = report.kind === 'post' && !report.reportedAuthorId ? report.postId : null;
  const anonymity = useAnonymity('post', asked);
  return anonymity?.anonymous ? anonymousName(anonymity.byAsker) : 'Deleted member';
}
