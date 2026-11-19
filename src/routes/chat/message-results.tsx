import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useChatAuthors } from '@/lib/chat/authors';
import { type MessageHit, SHOW_AT_MOST, snippetAround } from '@/lib/chat/message-search';
import { chatTime } from '@/lib/chat/time';
import { searchWords } from '@/lib/search';

/**
 * Messages a search found, newest first. Each opens its conversation on that
 * message, centred and lit (?message=, as a notification does).
 */
export function MessageResults({
  query,
  hits,
  searching,
  error,
  viewerId,
  titleOf,
  replace = false,
  onPick,
}: {
  query: string;
  hits: MessageHit[];
  searching: boolean;
  error: string | null;
  viewerId: string | null;
  /** The conversation's name over each hit; left out inside one conversation. */
  titleOf?: (threadId: string) => string;
  replace?: boolean;
  onPick?: () => void;
}) {
  const authors = useChatAuthors(hits.map((hit) => hit.authorId));
  if (error) {
    return <p className="py-4 text-center text-[0.875rem] text-grey leading-relaxed">{error}</p>;
  }
  if (hits.length === 0) {
    return (
      <p role="status" className="py-4 text-center text-[0.875rem] text-grey leading-relaxed">
        {searching ? 'Searching messages…' : 'No message says that.'}
      </p>
    );
  }
  return (
    <>
      <ul className="rounded-[14px] border border-line bg-paper px-3.5">
        {hits.map((hit) => {
          const name =
            hit.authorId === viewerId
              ? 'You'
              : ((hit.authorId ? authors.get(hit.authorId)?.displayName : null) ??
                'Deleted member');
          return (
            <li key={hit.id} className="border-line border-b last:border-b-0">
              <Link
                to={{ pathname: `/chat/t/${hit.threadId}`, search: `?message=${hit.id}` }}
                replace={replace}
                onClick={onPick}
                className="block min-h-[44px] py-2.5"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-bold font-head text-[0.875rem] text-ink">
                    {titleOf ? titleOf(hit.threadId) : name}
                  </span>
                  <span className="flex-none text-[0.75rem] text-grey">
                    {chatTime(hit.createdAt)}
                  </span>
                </span>
                <span className="mt-0.5 block text-[0.84375rem] text-ink2 leading-[1.45] [overflow-wrap:anywhere]">
                  {titleOf ? <span className="font-semibold">{name}: </span> : null}
                  <Highlighted text={snippetAround(hit.body, query)} query={query} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hits.length >= SHOW_AT_MOST ? (
        <p className="mt-2 text-center text-[0.78125rem] text-grey">
          The newest {SHOW_AT_MOST}. Add a word to narrow it.
        </p>
      ) : null}
    </>
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The typed words marked where they start a word. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const words = searchWords(query);
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join('|')})`, 'giu');
  // Keyed by where each piece starts in the text, which is unique and fixed.
  let at = 0;
  const parts = text.split(pattern).map((piece, index) => {
    const part = { start: at, piece, marked: index % 2 === 1 };
    at += piece.length;
    return part;
  });
  return (
    <>
      {parts.map(({ start, piece, marked }) =>
        marked ? (
          <mark key={start} className="rounded-[3px] bg-gold/35 px-px text-ink">
            {piece}
          </mark>
        ) : (
          <Fragment key={start}>{piece}</Fragment>
        ),
      )}
    </>
  );
}
