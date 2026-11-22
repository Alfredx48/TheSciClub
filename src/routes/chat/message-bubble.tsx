import { Megaphone } from 'lucide-react';
import { cloneElement, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { LinkedText } from '@/components/linked-text';
import { AvatarLink, FormerMemberAvatar, MemberAvatar } from '@/components/member-avatar';
import { firstClubLink } from '@/lib/chat/club-links';
import type { SharedPost } from '@/lib/chat/shared-posts';
import { chatTimeLong, messageTime } from '@/lib/chat/time';
import type { ChatAuthor, ChatMessage } from '@/lib/chat/types';
import { AttachmentGrid } from '@/routes/chat/attachment-grid';
import { ClubLinkCard } from '@/routes/chat/club-link-card';
import { LinkPreviewCard } from '@/routes/chat/link-preview-card';
import type { ReactionBarProps } from '@/routes/chat/reaction-bar';
import { ReportControl } from '@/routes/chat/report-control';
import { SharedPostCard } from '@/routes/chat/shared-post-card';

/**
 * One message, from the mock's `msgBubble()`.
 *
 * Somebody else's: face, name and level, on the left. The reader's own: navy, on the right, no
 * avatar or name.
 *
 * A pending bubble is faded with "Sending…", never a made-up time; a refused write takes it
 * back out and returns the words to the composer (threads.ts).
 *
 * The database blanks a removed body; this only picks the sentence for it. A null author is a
 * former member: words stay, name does not.
 *
 * A reply carries a quote at the top (2026-09-29; HANDOFF.md "What Home is", decision 11), not a
 * nest. The quote's words come from `quoteText`, found by the thread page.
 *
 * Edit (author only) and Reply, then Remove on yours or Report on theirs, never both. An
 * administrator here is a member and gets the same: no Remove on others', or a private thread
 * would not be. Controls name their message for screen readers, and are visible buttons, never
 * gestures, for members using a mouth stick or head pointer. Block, after Report, names the member
 * (the owner, 2026-10-22).
 *
 * A shared post is a card under the words (shared-post-card.tsx), read with the reader's rights.
 */
export interface Quote {
  /** The quoted message's id, for the scroll. */
  id: string;
  /** Whose it was. */
  name: string;
  /** `quoteText`'s words. */
  text: string;
}

export function MessageBubble({
  message,
  author,
  mine,
  sharedPost,
  receipt = null,
  reactions,
  quote,
  onQuoteTap,
  flash,
  canEdit,
  editing,
  onEdit,
  canReply,
  onReply,
  canRemove,
  onRemove,
  removing,
  canReport,
  reported,
  onReport,
  onBlock,
  important = null,
  onToggleImportant,
  photosFirst = false,
}: {
  message: ChatMessage;
  /** Null for a removed member, and also while the name is still loading. */
  author: ChatAuthor | null;
  mine: boolean;
  /** The card for `message.sharedPostId`: undefined while read, null if not this reader's to see. */
  sharedPost?: SharedPost | null | undefined;
  /** A saved outgoing message read by another member, or no receipt yet. */
  receipt?: string | null;
  reactions?: ReactElement<ReactionBarProps>;
  /** The message this one answers, or null. */
  quote: Quote | null;
  onQuoteTap: (messageId: string) => void;
  /** Light the bubble up once: a quote of it was just tapped. */
  flash: boolean;
  /** The reader's own standing message. */
  canEdit: boolean;
  /** Its words are in the composer. */
  editing: boolean;
  onEdit: () => void;
  /** Any standing message, while there is somebody to reply to. */
  canReply: boolean;
  onReply: () => void;
  canRemove: boolean;
  onRemove: () => void;
  removing: boolean;
  /** Somebody else's message. Never true on the reader's own. */
  canReport: boolean;
  /** Already handed over. The control stays, and says so, and does nothing. */
  reported: boolean;
  onReport: () => void;
  /** Somebody else's message, by a member not yet blocked. Absent draws no Block. */
  onBlock?: (() => void) | undefined;
  /**
   * Marked Important (20261113140000): drawn in gold, with how many of those
   * asked have acknowledged it, which opens who.
   */
  important?: { acknowledged: number; asked: number; onShowWho: () => void } | null;
  /** One of the newest photographs: loaded at once, not as it is scrolled near. */
  photosFirst?: boolean;
  /** The reader may mark it Important, or take that off. Absent draws nothing. */
  onToggleImportant?: (() => void) | undefined;
}) {
  const removed = message.removedAt !== null;
  // Two sentences and not one: somebody thinking better of what they said and
  // an administrator taking it down are different facts, and rolling them
  // together would hide a moderation decision behind second thoughts.
  const gone = message.removedByAdmin ? 'Removed by an administrator.' : 'Removed by its author.';
  const name = author ? author.displayName : 'a deleted member';
  // The club's own event or topic draws its own card (club-link-card.tsx).
  const clubLink = removed ? null : firstClubLink(message.body);
  const whose = mine ? 'your' : `${name}'s`;
  const timestamp = (
    <p
      className={`mt-1 text-right text-[0.6875rem] leading-snug ${mine ? 'text-white/75' : 'text-grey'}`}
    >
      {message.pending ? (
        'Sending…'
      ) : (
        <>
          {message.editedAt ? <span title={chatTimeLong(message.editedAt)}>Edited · </span> : null}
          <time dateTime={message.createdAt} title={chatTimeLong(message.createdAt)}>
            {messageTime(message.createdAt)}
          </time>
          {receipt && mine && !removed ? ` · ${receipt}` : ''}
        </>
      )}
    </p>
  );
  const control =
    'font-semibold text-[0.71875rem] text-grey underline decoration-line underline-offset-2';
  const anchor = `message-${message.id}`;

  const quoteBlock = quote ? (
    <button
      type="button"
      onClick={() => {
        onQuoteTap(quote.id);
      }}
      data-target="small"
      className={
        'mb-1.5 block w-full rounded-[9px] border-l-2 px-2 py-1 text-left text-[0.78125rem] leading-[1.4] ' +
        (mine ? 'border-white/50 bg-white/10 text-white/85' : 'border-emphasis bg-tint text-ink2')
      }
    >
      <span className="block font-semibold">{quote.name}</span>
      <span className="block truncate">{quote.text}</span>
    </button>
  ) : null;

  const words = removed ? (
    <span className={mine ? 'text-white/70 italic' : 'text-grey italic'}>{gone}</span>
  ) : (
    <>
      {/* whitespace-pre-line, so the line breaks somebody typed survive. */}
      {message.body ? (
        <span className="whitespace-pre-line">
          <LinkedText text={message.body} />
        </span>
      ) : null}
      {message.sharedPostId ? <SharedPostCard post={sharedPost} /> : null}
      {message.attachments.length > 0 ? (
        <AttachmentGrid
          paths={message.attachments}
          from={mine ? 'you' : name}
          eager={photosFirst ? 'first' : undefined}
        />
      ) : null}
      {clubLink ? (
        <ClubLinkCard link={clubLink} />
      ) : message.linkPreview ? (
        <LinkPreviewCard preview={message.linkPreview} />
      ) : null}
    </>
  );

  const reply = canReply ? (
    <button
      type="button"
      onClick={onReply}
      aria-label={`Reply to ${whose} message`}
      className="relative inline-flex min-h-11 items-center rounded-full px-3 text-[0.6875rem] text-grey hover:bg-tint"
    >
      Reply
    </button>
  ) : null;

  const controls =
    removed || message.pending ? null : (
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {/* Behind the message's ••• with the rest (the owner, 2026-11-13). */}
        {onToggleImportant ? (
          <button
            type="button"
            onClick={onToggleImportant}
            aria-label={
              important ? `Take Important off ${whose} message` : `Mark ${whose} message Important`
            }
            data-target="small"
            className={`${control} hover:text-emphasis`}
          >
            {important ? 'Not Important' : 'Mark Important'}
          </button>
        ) : null}
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit your message"
            data-target="small"
            className={`${control} hover:text-emphasis`}
          >
            Edit
          </button>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            aria-label={`Remove ${whose} message`}
            data-target="small"
            className={`${control} hover:text-destructive`}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        ) : canReport ? (
          <ReportControl
            reported={reported}
            label={`Report ${name}'s message`}
            onReport={onReport}
            buttonClassName={`${control} hover:text-destructive`}
            noteClassName="font-semibold text-[0.71875rem] text-grey"
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
      </div>
    );

  // The reaction component owns this bubble and its chips together, so the
  // action row cannot move reactions away from a short message.
  const bubble = (
    <div
      className={
        'max-w-[17rem] px-3.5 py-2.5 text-[0.875rem] leading-[1.5] ' +
        (mine
          ? 'rounded-[15px_15px_4px_15px] bg-action text-white'
          : important
            ? 'rounded-[4px_15px_15px_15px] border-2 border-gold bg-gold-lt text-ink'
            : 'rounded-[4px_15px_15px_15px] border border-line bg-paper text-ink') +
        (mine && important ? ' outline-3 outline-gold outline-offset-2' : '') +
        (message.pending ? ' opacity-60' : '') +
        (editing ? ' outline-2 outline-emphasis outline-offset-2' : '') +
        (flash ? ' message-flash' : '')
      }
    >
      {important && !removed ? (
        <p
          className={`mb-1 flex items-center gap-1 font-bold text-[0.6875rem] uppercase tracking-[0.06em] ${mine ? 'text-gold-hi' : 'text-gold-ink'}`}
        >
          <Megaphone aria-hidden="true" className="h-3.5 w-3.5" />
          Important
        </p>
      ) : null}
      {quoteBlock}
      {words}
      {timestamp}
    </div>
  );
  const content =
    reactions && !removed && !message.pending ? (
      cloneElement(reactions, {
        compact: true,
        attached: true,
        bubble,
        align: mine ? 'end' : 'start',
        actions: controls,
        reply,
      })
    ) : (
      <>
        {bubble}
        {!removed && !message.pending ? (
          <>
            {reply}
            {controls}
          </>
        ) : null}
      </>
    );

  // Always in view, not behind the •••: who has acknowledged it.
  const acknowledgedLine =
    important && !removed && !message.pending ? (
      <button
        type="button"
        onClick={important.onShowWho}
        className="inline-flex min-h-11 items-center font-semibold text-[0.75rem] text-gold-ink underline decoration-gold underline-offset-2 hover:text-emphasis"
      >
        {important.asked === 0
          ? 'Nobody to acknowledge'
          : `Acknowledged by ${String(important.acknowledged)} of ${String(important.asked)}`}
      </button>
    ) : null;

  if (mine) {
    return (
      <div id={anchor} className="mb-3.5 flex flex-col items-end">
        {content}
        {acknowledgedLine}
      </div>
    );
  }

  return (
    <div id={anchor} className="mb-3.5 flex items-start gap-2.5">
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
      <div className="min-w-0">
        <p className="mb-[3px] font-semibold text-[0.71875rem] text-grey">
          {author ? (
            author.hasProfile ? (
              <Link to={`/peers/${author.id}`} className="underline-offset-2 hover:underline">
                {author.displayName}
              </Link>
            ) : (
              // Named, not linked: /peers/:id will not show them, and a link to
              // a page that says "no such member" is worse than plain text.
              author.displayName
            )
          ) : (
            'Deleted member'
          )}
          {author?.level ? (
            <>
              {' · '}
              <LevelHighlight
                level={author.level}
                stage={author.stage}
                band={author.band}
                injuryType={author.injuryType}
              />
            </>
          ) : null}
        </p>
        {content}
        {acknowledgedLine}
      </div>
    </div>
  );
}
