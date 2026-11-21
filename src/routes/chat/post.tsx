import { cloneElement, type ReactElement, type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { LevelHighlight } from '@/components/injury-stage-pill';
import {
  ANONYMOUS_PAGE,
  AnonymousAvatarLink,
  AvatarLink,
  FormerMemberAvatar,
  MemberAvatar,
} from '@/components/member-avatar';
import { PartnerLabel } from '@/components/partner-label';
import { anonymousName, anonymousNote } from '@/lib/chat/anonymous';
import { firstClubLink } from '@/lib/chat/club-links';
import type { PostVote } from '@/lib/chat/likes';
import { chatTime } from '@/lib/chat/time';
import type { ChatAuthor, ChatEdit, ChatPost } from '@/lib/chat/types';
import { useMinute } from '@/lib/chat/use-minute';
import { photoPaths } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { AttachmentGrid } from '@/routes/chat/attachment-grid';
import { ClubLinkCard } from '@/routes/chat/club-link-card';
import { EarlierVersions } from '@/routes/chat/earlier-versions';
import { PostLikes } from '@/routes/chat/like-button';
import { LinkPreviewCard } from '@/routes/chat/link-preview-card';
import { POST_TEXT, PostBody } from '@/routes/chat/post-body';
import type { ReactionBarProps } from '@/routes/chat/reaction-bar';
import { ReportControl } from '@/routes/chat/report-control';
import { ViewCount } from '@/routes/chat/view-count';

/**
 * One post in a topic, from the mock's `fpost()`.
 *
 * Removed posts never get here: the topic page leaves them out (the owner, 2026-09-27). Removal
 * is still soft underneath, for reports and moderation (20260927030000).
 *
 * A null author is a former member: words stay, name does not (the owner's decision); the tile
 * is the neutral one.
 *
 * Controls: Like, count, views, Save (private, 2026-10-20), Edit and Reply (decisions 9 and 11),
 * then Remove or Report in the same spot, never both: an administrator gets Remove on everything
 * and no Report to themselves. Edit is the author's alone, administrators included. Block comes
 * last, on somebody else's (the owner, 2026-10-22). Each control names its post for screen
 * readers, and all are visible buttons, never gestures: members use mouth sticks and head
 * pointers.
 *
 * Edit puts the words in the topic's composer and outlines the post; words only. Administrators
 * see earlier versions from chat_edits.
 *
 * Replies come as `children`, indented; each can hold its own conversation (the owner,
 * 2026-10-09). They can be hidden (the owner, 2026-09-29), shown by default on every visit. What
 * is stored is the count when hidden, not a flag, so a new reply unfolds them.
 */
export function Post({
  post,
  author,
  number,
  total,
  nested = false,
  depth = 1,
  canEdit,
  repeatsTitle = false,
  removeLabel,
  editing,
  onEdit,
  canReply = false,
  onReply,
  canRemove,
  onRemove,
  removing,
  canReport,
  reported,
  onReport,
  canFlag = false,
  onFlag,
  onBlock,
  share,
  edits,
  likes,
  viewCount,
  reactions,
  replies = 0,
  flash = false,
  hideBody = false,
  opening = false,
  place,
  composer,
  answers = false,
  writer,
  children,
}: {
  /**
   * Whether the reader wrote this anonymous post: only the writer is told
   * (20261120110000).
   */
  writer?: { you: boolean } | undefined;
  /** An administrator, on an anonymous post: hide it and count it against its writer. */
  canFlag?: boolean;
  onFlag?: () => void;
  /** A question's own post, at the top: its Reply says Answer question. */
  answers?: boolean;
  /** The box a reply to this post is being written in, drawn under it. */
  composer?: ReactNode;
  /** Where the author is, in Classifieds (author-places.ts). */
  place?: string | undefined;
  post: ChatPost;
  /** Null for a removed member, and also while the name is still loading. */
  author: ChatAuthor | null;
  /** Its place among the top-level posts still standing. Absent on a reply. */
  number?: number;
  total?: number;
  /** A reply, drawn under its post: no number, no border of its own. */
  nested?: boolean;
  /** Indentation stops after four levels to leave room for words on phones. */
  depth?: number;
  /** The reader's own standing post. */
  canEdit: boolean;
  /** A topic's opening post repeating its title, under that title: not said twice. */
  repeatsTitle?: boolean;
  /** In place of Remove, e.g. Delete topic for an unanswered topic's opening post. */
  removeLabel?: string | undefined;
  /** Its words are in the composer. */
  editing: boolean;
  onEdit: () => void;
  /** Whether the reader may write in this room at all. */
  canReply?: boolean;
  onReply?: () => void;
  canRemove: boolean;
  onRemove: () => void;
  removing: boolean;
  /** Somebody else's post, which this reader cannot remove. */
  canReport: boolean;
  /** Already handed over. The control stays, and says so, and does nothing. */
  reported: boolean;
  onReport: () => void;
  /** Somebody else's post, by a member not yet blocked. Absent draws no Block. */
  onBlock?: (() => void) | undefined;
  /** Share into a conversation (share-post.tsx). Absent draws none. */
  share?: ReactNode;
  /** Earlier versions, for an administrator. Absent or empty for everybody else. */
  edits?: ChatEdit[];
  /**
   * Who likes it, and what pressing Like does. Absent draws no likes at all —
   * while they have not loaded, or where a screen does not read them.
   */
  likes?: PostVote | undefined;
  /** Distinct members delivered this post, including zero. */
  viewCount?: number | null | undefined;
  reactions?: ReactElement<ReactionBarProps>;
  /** How many replies `children` holds, for the hide control. */
  replies?: number;
  /** Lit up once: the post a notification or a link was about. */
  flash?: boolean;
  /**
   * The post is the topic's title word for word (a question with no details): draw only its
   * actions as a row under the header. No Edit, which would edit a copy of the title.
   */
  hideBody?: boolean;
  /**
   * The topic's own first post: drawn under the title as part of the topic,
   * not as a card that reads like an answer. The header names who started it.
   */
  opening?: boolean;
  /** The replies, as `<Post nested>` elements. */
  children?: ReactNode;
}) {
  useMinute();
  // The count the replies were hidden at, or null. See the header.
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  const hidden = replies > 0 && hiddenAt === replies;
  const repliesId = `replies-${post.id}`;
  const anonymous = post.anonymous === true;
  const name = anonymous
    ? anonymousName(post.byAsker)
    : author
      ? author.displayName
      : 'a deleted member';
  const note = anonymous ? anonymousNote(writer) : null;
  // The club's own event or topic draws its own card (club-link-card.tsx).
  const clubLink = post.removedAt ? null : firstClubLink(post.body);
  // Photographs its words show in place; the grid has the rest.
  const shownBody = !!post.body && !hideBody && !repeatsTitle;
  const placed = shownBody ? new Set(photoPaths(post.body)) : new Set<string>();
  const below = post.attachments.filter((path) => !placed.has(path));
  const whose = canEdit ? 'your' : anonymous ? 'the anonymous' : `${name}'s`;
  const control =
    'font-semibold text-[0.75rem] text-grey underline decoration-line underline-offset-2';

  const reply = canReply ? (
    <button
      type="button"
      onClick={onReply}
      aria-label={answers ? 'Answer this question' : `Reply to ${whose} post`}
      className={
        answers
          ? // The home card's Answer, gold (answer-box.tsx; the owner, 2026-11-19:
            // "highlight the answer button. Similar to how it appears on the
            // home card").
            'relative inline-flex min-h-[2.25rem] items-center rounded-full bg-gold px-4 font-bold font-head text-[0.8125rem] text-on-gold transition-colors hover:bg-gold-hi'
          : 'relative inline-flex min-h-11 items-center rounded-full px-3 text-[0.6875rem] text-grey hover:bg-tint'
      }
    >
      {answers ? 'Answer question' : 'Reply'}
    </button>
  ) : null;

  const controls = (
    <>
      {canEdit && !editing ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit your post"
          data-target="small"
          className={`${control} hover:text-emphasis`}
        >
          Edit
        </button>
      ) : null}
      {canFlag && onFlag ? (
        <button
          type="button"
          onClick={onFlag}
          data-target="small"
          className={`${control} hover:text-destructive`}
        >
          Flag and hide
        </button>
      ) : null}
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label={removeLabel ?? `Remove ${whose} post`}
          data-target="small"
          className={`${control} hover:text-destructive`}
        >
          {removing ? 'Removing…' : (removeLabel ?? 'Remove')}
        </button>
      ) : canReport ? (
        <ReportControl
          reported={reported}
          label={`Report ${whose} post`}
          onReport={onReport}
          buttonClassName={`${control} hover:text-destructive`}
          noteClassName="font-semibold text-[0.75rem] text-grey"
        />
      ) : null}
      {onBlock ? (
        <button
          type="button"
          onClick={onBlock}
          data-target="small"
          className={`${control} hover:text-destructive`}
        >
          Block {name}
        </button>
      ) : null}
    </>
  );

  return (
    <article
      // The address a notification points into: ?post=<id> on the topic.
      id={`post-${post.id}`}
      // Focusable from script only, so a screen reader arriving from a
      // notification starts on the post it was about. The flash marks it.
      tabIndex={-1}
      className={cn(
        hideBody || opening
          ? 'mb-2.5 border-line border-b pb-2.5'
          : nested
            ? depth <= 4
              ? 'mt-2.5 rounded-bl-xl border-line border-l-2 pl-3'
              : 'mt-2.5'
            : 'mb-2.5 rounded-[15px] border border-line bg-paper px-3.5 py-[13px]',
        editing ? 'outline-2 outline-emphasis outline-offset-2' : 'outline-none',
        flash && 'message-flash',
      )}
    >
      {hideBody || opening ? (
        <h2 className="sr-only">{hideBody ? 'The question' : 'The post'}</h2>
      ) : (
        <div className={cn('flex gap-2.5', note ? 'items-start' : 'items-center')}>
          {anonymous ? (
            <AnonymousAvatarLink />
          ) : (
            <AvatarLink memberId={author?.id} hasProfile={author?.hasProfile}>
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
            </AvatarLink>
          )}

          <span className="min-w-0 flex-1">
            <span className="block font-extrabold font-head text-[0.875rem] text-ink">
              {anonymous ? (
                <Link to={ANONYMOUS_PAGE} className="underline-offset-2 hover:underline">
                  {name}
                </Link>
              ) : author ? (
                author.hasProfile ? (
                  <Link to={`/peers/${author.id}`} className="underline-offset-2 hover:underline">
                    {author.displayName}
                  </Link>
                ) : (
                  // Named, not linked: /peers/:id will not show them, and a link
                  // to a page that says "no such member" is worse than plain
                  // text.
                  author.displayName
                )
              ) : (
                'Deleted member'
              )}
              {author?.level ? (
                <span className="ml-[7px] font-semibold text-[0.78125rem] text-grey">
                  <LevelHighlight
                    level={author.level}
                    stage={author.stage}
                    band={author.band}
                    injuryType={author.injuryType}
                  />
                </span>
              ) : null}
            </span>
            {note ? (
              // The writer only: chat_anonymous_writers names nobody else's.
              <span className="block text-[0.75rem] text-grey">{note}</span>
            ) : null}
            <PartnerLabel memberId={author?.id} />
            <span className="block text-[0.78125rem] text-grey">
              {chatTime(post.createdAt)}
              {place ? ` · ${place}` : null}
            </span>
          </span>

          {/* The mock's `.pnum`, counted among the top-level posts still
            standing. A reply has no number. */}
          {number !== undefined && total !== undefined ? (
            <span className="flex-none font-bold text-[0.71875rem] text-grey">
              {number}/{total}
            </span>
          ) : null}
        </div>
      )}

      {post.body && !hideBody && !repeatsTitle ? (
        // Formatted (the owner, 2026-10-11): the first post's toolbar writes
        // a small Markdown (lib/markdown.ts), shown through the same allowlist
        // as an event's description. Plain text reads as it did: its line
        // breaks and its addresses as links. An @name links to its member.
        // A photograph put in the words is drawn there (the owner,
        // 2026-11-19); the rest below them, as before.
        <PostBody
          text={post.body}
          photos={post.attachments}
          from={anonymous ? name : (author?.displayName ?? 'a deleted member')}
          className={POST_TEXT}
        />
      ) : null}
      {below.length > 0 ? (
        <AttachmentGrid
          paths={below}
          from={anonymous ? name : (author?.displayName ?? 'a deleted member')}
        />
      ) : null}
      {clubLink ? (
        <ClubLinkCard link={clubLink} />
      ) : post.linkPreview ? (
        <LinkPreviewCard preview={post.linkPreview} />
      ) : null}
      {post.editedAt ? (
        <p className="mt-1 text-[0.78125rem] text-grey">Edited · {chatTime(post.editedAt)}</p>
      ) : null}
      {edits && edits.length > 0 ? <EarlierVersions edits={edits} from={name} /> : null}

      <div
        className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-1', hideBody ? 'mt-0' : 'mt-2')}
      >
        {likes ? <PostLikes {...likes} what={`${whose} post`} className="text-[0.75rem]" /> : null}
        <ViewCount count={viewCount} postId={post.id} />
        {reactions ? (
          cloneElement(reactions, {
            compact: true,
            actions: controls,
            actionsTitle: 'Post actions',
            reply,
            share,
          })
        ) : (
          <>
            {reply}
            {share}
            {controls}
          </>
        )}
      </div>
      {likes?.failure ? (
        <p role="alert" className="mt-1.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {likes.failure}
        </p>
      ) : null}

      {/* The reply being written to this post, right under it (the owner,
        2026-11-19), above the replies it already has. */}
      {composer ? <div className="mt-2.5">{composer}</div> : null}

      {replies > 0 ? (
        <button
          type="button"
          onClick={() => {
            setHiddenAt(hidden ? null : replies);
          }}
          aria-expanded={!hidden}
          aria-controls={repliesId}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${replies} ${replies === 1 ? 'reply' : 'replies'} to ${whose} post`}
          data-target="small"
          className={`mt-2 ${control} hover:text-emphasis`}
        >
          {hidden ? 'Show' : 'Hide'} {replies} {replies === 1 ? 'reply' : 'replies'}
        </button>
      ) : null}
      {replies > 0 ? (
        <div id={repliesId} hidden={hidden}>
          {children}
        </div>
      ) : null}
    </article>
  );
}
