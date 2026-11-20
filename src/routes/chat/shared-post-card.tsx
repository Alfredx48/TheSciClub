import { Link } from 'react-router-dom';
import { AnonymousAvatar, FormerMemberAvatar, MemberAvatar } from '@/components/member-avatar';
import { anonymousName, useAnonymity } from '@/lib/chat/anonymous';
import { useSmallCopies } from '@/lib/chat/attachments';
import { useChatAuthors } from '@/lib/chat/authors';
import { type SharedPost, sharedPostPath } from '@/lib/chat/shared-posts';
import { markdownToPlain } from '@/lib/markdown';
import { excerpt } from '@/routes/chat/reaction-bar';

/** How much of a shared post's words the card shows. */
const CARD_WORDS = 160;

/**
 * A post shared into a conversation: its room, who wrote it, the topic, the
 * start of its words and its first photograph, all one link to the post.
 *
 * `undefined` while the card is read; `null` when this reader may not see
 * the post (a closed room, removed, deleted, or a block either way), which
 * draws the same sentence and nothing of the post, whatever the reason.
 * Paper inside a navy bubble too, as a link's card is.
 */
export function SharedPostCard({ post }: { post: SharedPost | null | undefined }) {
  if (post === undefined) {
    return (
      <span className="mt-2 block w-full max-w-[420px] rounded-[13px] border border-line bg-paper px-3 py-2.5 text-[0.8125rem] text-grey">
        Shared post…
      </span>
    );
  }
  if (post === null) {
    return (
      <span className="mt-2 block w-full max-w-[420px] rounded-[13px] border border-line border-dashed bg-paper px-3 py-2.5 text-[0.8125rem] text-grey italic">
        This post isn't available.
      </span>
    );
  }
  return <Card post={post} />;
}

function Card({ post }: { post: SharedPost }) {
  const authors = useChatAuthors([post.authorId]);
  const author = post.authorId ? (authors.get(post.authorId) ?? null) : null;
  // No author: anonymous (20261120100000), or a member who has left.
  const anonymity = useAnonymity('post', post.authorId === null ? post.postId : null);
  const name = author
    ? author.displayName
    : post.authorId || !anonymity
      ? '…'
      : anonymity.anonymous
        ? anonymousName(anonymity.byAsker)
        : 'Deleted member';
  const photos = useSmallCopies(post.photoPath ? [post.photoPath] : []);
  const picture = post.photoPath ? (photos.small.get(post.photoPath) ?? null) : null;
  const words = excerpt(markdownToPlain(post.body), CARD_WORDS);

  return (
    <Link
      to={sharedPostPath(post)}
      className="mt-2 block w-full max-w-[420px] overflow-hidden rounded-[13px] border border-line bg-paper text-left text-ink no-underline hover:bg-tint"
    >
      {post.photoPath ? (
        <span className="block aspect-[1.91/1] w-full bg-tint">
          {picture ? (
            // Decorative: the words beside it say what the post is.
            <img src={picture} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : null}
        </span>
      ) : null}
      <span className="block px-3 py-2.5">
        <span className="sr-only">Shared post: </span>
        <span className="block font-semibold text-[0.71875rem] text-grey uppercase tracking-[0.06em] [overflow-wrap:anywhere]">
          {post.roomName}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span aria-hidden="true" className="flex-none">
            {anonymity?.anonymous ? (
              <AnonymousAvatar className="h-[1.5rem] w-[1.5rem] rounded-[7px]" />
            ) : author ? (
              <MemberAvatar
                id={author.id}
                displayName={author.displayName}
                photoPath={author.photoPath}
                photoAlt={author.photoAlt}
                className="h-[1.5rem] w-[1.5rem] rounded-[7px] text-[0.625rem]"
              />
            ) : (
              <FormerMemberAvatar className="h-[1.5rem] w-[1.5rem] rounded-[7px] text-[0.625rem]" />
            )}
          </span>
          <span className="min-w-0 font-semibold text-[0.8125rem] text-ink2">
            {post.opening ? name : `${name}, replying in`}
          </span>
        </span>
        <span className="mt-1 line-clamp-3 block font-bold font-head text-[0.875rem] leading-[1.35] [overflow-wrap:anywhere]">
          {post.topicTitle}
        </span>
        {words && words !== post.topicTitle ? (
          <span className="mt-1 line-clamp-3 block text-[0.8125rem] text-ink2 leading-[1.45] [overflow-wrap:anywhere]">
            {words}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
