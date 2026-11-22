import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { LinkedText } from '@/components/linked-text';
import {
  AnonymousAvatarLink,
  AvatarLink,
  FormerMemberAvatar,
  MemberAvatar,
} from '@/components/member-avatar';
import { useAnonymity } from '@/lib/chat/anonymous';
import { useSeenOnHome } from '@/lib/chat/home-views';
import { chatTime } from '@/lib/chat/time';
import type { ChatAuthor } from '@/lib/chat/types';
import { useMinute } from '@/lib/chat/use-minute';
import type { HomeTopic } from '@/lib/home/types';
import { markdownToPlain } from '@/lib/markdown';
import { splitMentions } from '@/lib/mentions';
import { useOrganizations } from '@/lib/organizations';
import { AttachmentGrid } from '@/routes/chat/attachment-grid';
import { PostLikes } from '@/routes/chat/like-button';
import { LinkPreviewCard } from '@/routes/chat/link-preview-card';
import { ViewCount } from '@/routes/chat/view-count';
import { byline, type CardLikes, RoomTag } from '@/routes/home/topic-card';

/**
 * A photograph on Home, from the mock's `postCard`: a topic whose first post carries one.
 *
 * - Not one link: the photos are buttons, and a button inside a link fights over the tap. The
 *   title link stretches over the card; other controls sit above it.
 * - `fill`: Chat's grid sizes one photo for a bubble, which leaves half a card blank.
 * - No city: `ChatAuthor` leaves it out so a member hidden from Peers is not placed on a map.
 *   Do not add one.
 * - Reply goes to the topic page rather than a comments sheet, so Report, Remove and Mute live
 *   in one place.
 * - The like is on the opening post (HANDOFF.md "What Home is" step 3); no opening post, no likes.
 */
export function PhotoCard({
  topic,
  author,
  linkState,
  likes,
  viewCount,
  reactions,
  first = false,
}: {
  topic: HomeTopic;
  /** Null for a former member, and while the name is still loading. */
  author: ChatAuthor | null;
  linkState: unknown;
  /** Who likes the opening post, as the topic page's posts take it. */
  likes?: CardLikes | undefined;
  viewCount?: number | null | undefined;
  reactions?: ReactNode;
  /** One of the cards drawn first: its photographs load ahead of the rest. */
  first?: boolean;
}) {
  useMinute();
  const navigate = useNavigate();
  const opening = topic.opening;
  const to = `/chat/rooms/${topic.roomId}/topics/${topic.id}`;
  // Home's posts carry the flag; asked for only when the opening post did not come.
  const found = useAnonymity('topic', topic.authorId === null && !topic.opening ? topic.id : null);
  const anonymity =
    topic.authorId !== null
      ? undefined
      : topic.opening
        ? { anonymous: topic.opening.anonymous === true, byAsker: false }
        : (found ?? null);
  const name = byline(topic.authorId, author, anonymity);
  // Read here is read: a view, as opening the topic is (home-views.ts).
  const seenRef = useSeenOnHome(topic.opening?.id);
  const { organizations } = useOrganizations(topic.title.includes('@'));

  return (
    <article ref={seenRef} className="relative rounded-[17px] border border-line bg-paper p-3.5">
      <div className="flex items-center gap-3">
        {anonymity?.anonymous ? (
          <AnonymousAvatarLink state={linkState} />
        ) : (
          <AvatarLink
            memberId={author?.id}
            hasProfile={author?.hasProfile}
            state={linkState}
            className="relative z-[1]"
          >
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
          <span className="block font-extrabold font-head text-[0.90625rem] text-ink">
            {author?.hasProfile ? (
              <Link
                to={`/peers/${author.id}`}
                state={linkState}
                data-target="small"
                className="relative z-[1] underline-offset-2 hover:underline"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </span>
          <span className="block text-[0.78125rem] text-grey">
            {author?.level ? (
              <>
                <LevelHighlight
                  level={author.level}
                  stage={author.stage}
                  band={author.band}
                  injuryType={author.injuryType}
                />
                {' · '}
              </>
            ) : null}
            {chatTime(topic.createdAt)}
          </span>
        </span>
      </div>

      <div className="mt-2.5">
        <RoomTag room={topic.room} linkState={linkState} />
      </div>

      {opening ? (
        <div className="relative z-[1]">
          <AttachmentGrid
            paths={opening.attachments}
            from={name}
            fill
            eager={first ? 'first' : 'later'}
            onOpen={() => {
              void navigate(to, { state: linkState });
            }}
            openLabel="Open the topic."
          />
        </div>
      ) : null}

      {/* A title's @people and @Organizations open their pages (the owner, 2026-11-17). */}
      {splitMentions(topic.title, organizations).some((part) => part.kind !== 'text') ? (
        <>
          <Link
            to={to}
            state={linkState}
            aria-label="Open the post"
            className="block h-0 after:absolute after:inset-0 after:rounded-[17px]"
          />
          <p className="mt-2.5 font-extrabold font-head text-[1rem] text-ink leading-[1.32] [overflow-wrap:anywhere] [&_a]:relative [&_a]:z-[1]">
            <LinkedText text={topic.title} />
          </p>
        </>
      ) : (
        <Link
          to={to}
          state={linkState}
          data-target="small"
          className="mt-2.5 block font-extrabold font-head text-[1rem] text-ink leading-[1.32] [overflow-wrap:anywhere] underline-offset-2 hover:underline after:absolute after:inset-0 after:rounded-[17px]"
        >
          {topic.title}
        </Link>
      )}
      {opening?.body ? (
        <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[0.875rem] text-ink leading-[1.52] [&_a]:relative [&_a]:z-[1]">
          <LinkedText text={markdownToPlain(opening.body)} />
        </p>
      ) : null}
      {opening?.linkPreview ? (
        <LinkPreviewCard preview={opening.linkPreview} className="relative" />
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-line border-t pt-2">
        {opening && likes ? (
          <PostLikes
            {...likes}
            what={topic.title}
            linkState={linkState}
            className="relative min-h-[2.25rem] text-[0.8125rem]"
          />
        ) : null}
        {opening ? <ViewCount count={viewCount} postId={opening.id} /> : null}
        {topic.replyCount > 0 ? (
          <Link
            to={to}
            state={linkState}
            aria-label={`${topic.replyCount} ${topic.replyCount === 1 ? 'reply' : 'replies'} to ${topic.title}`}
            data-target="small"
            className="relative inline-flex min-h-[2.25rem] items-center font-semibold text-[0.8125rem] text-ink2 underline-offset-2 hover:underline"
          >
            {topic.replyCount} {topic.replyCount === 1 ? 'reply' : 'replies'}
          </Link>
        ) : null}
        {/* Named for the topic so a links list is not all "Reply"; the visible word
            starts the name for voice control. */}
        <Link
          to={to}
          state={linkState}
          aria-label={`Reply to ${topic.title}`}
          data-target="small"
          className="relative inline-flex min-h-[2.25rem] items-center font-bold text-[0.8125rem] text-emphasis underline-offset-2 hover:underline"
        >
          Reply
        </Link>
      </div>
      {opening && likes?.failure ? (
        <p role="alert" className="mt-1 text-[0.78125rem] text-destructive leading-[1.45]">
          {likes.failure}
        </p>
      ) : null}
      {reactions}
    </article>
  );
}
