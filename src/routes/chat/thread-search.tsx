import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMessageSearch } from '@/lib/chat/message-search';
import { MessageResults } from '@/routes/chat/message-results';

/**
 * Finding words said in this one conversation (the owner, 2026-11-19), from
 * the magnifier in its header. A hit closes the search and scrolls to its
 * message, reading back to it when it is older than what is loaded.
 */
export function ThreadSearch({
  threadId,
  viewerId,
  onClose,
}: {
  threadId: string;
  viewerId: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const found = useMessageSearch(query, threadId);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <section
      aria-label="Search this conversation"
      className="flex max-h-[55%] flex-none flex-col border-line border-b bg-paper px-4 pt-3 pb-3 md:px-6"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-col">
        <label className="relative block flex-none">
          <span className="sr-only">Search this conversation</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-grey"
          />
          <input
            ref={box}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Search this conversation"
            className="min-h-[46px] w-full rounded-[13px] border-[1.6px] border-line bg-paper py-2 pr-3 pl-10 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
          />
        </label>
        {query.trim() === '' ? null : (
          <div className="mt-2.5 min-h-0 overflow-y-auto">
            <MessageResults
              query={query}
              hits={found.hits}
              searching={found.searching}
              error={found.error}
              more={found.more}
              loadingMore={found.loadingMore}
              onMore={found.showMore}
              viewerId={viewerId}
              replace
              onPick={onClose}
            />
          </div>
        )}
      </div>
    </section>
  );
}
