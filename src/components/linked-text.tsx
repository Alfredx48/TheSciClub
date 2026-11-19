import { Link } from 'react-router-dom';
import { findLinks } from '@/lib/links';
import { splitMentions, useMentionedMembers } from '@/lib/mentions';
import { useOrganizations } from '@/lib/organizations';
import { SITE_ORIGIN } from '@/lib/site-origin';

/**
 * The path of a link to the club itself, which opens in the app rather than a
 * new tab (the owner, 2026-11-03: an event or organization shared in a chat).
 * Null for anywhere else.
 */
export function clubPath(href: string): string | null {
  try {
    const url = new URL(href);
    const ours = url.origin === SITE_ORIGIN || url.origin === window.location.origin;
    return ours ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/**
 * Text somebody wrote, with its web addresses as links.
 *
 * The finding and the safety are `lib/links.ts`; this only draws. A link opens
 * in a new tab (in the installed app, the system browser) so the conversation
 * is still there to come back to. `nofollow ugc` because a member wrote it,
 * not the club; `noreferrer` because where a member read it is nobody else's
 * business.
 *
 * The colour is inherited and the underline carries it, so the same link reads
 * on a navy bubble and on paper without a second palette to keep above AA.
 * `overflow-wrap: anywhere` on links and words alike, because a shortened label,
 * a long number or a held-down key can be one word wider than a 320px screen.
 *
 * An @username of a member with a profile links to it, as in a post
 * (the owner, 2026-10-31). Other @names stay words.
 */
export function LinkedText({ text }: { text: string }) {
  const members = useMentionedMembers(text);
  const { organizations } = useOrganizations(text.includes('@'));
  return (
    <>
      {findLinks(text).map((piece, index) =>
        piece.kind === 'text' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional and never reorder
          <span key={index} className="[overflow-wrap:anywhere]">
            {splitMentions(piece.text, organizations).map((part, at) => {
              if (part.kind === 'organization') {
                return (
                  <Link
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reorder
                    key={at}
                    to={`/events/organizations/${part.id}`}
                    className="font-semibold underline decoration-1 underline-offset-2"
                  >
                    {part.text}
                  </Link>
                );
              }
              const member = part.kind === 'mention' ? members.get(part.username) : undefined;
              return member?.hasProfile ? (
                <Link
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reorder
                  key={at}
                  to={`/peers/${member.id}`}
                  className="font-semibold underline decoration-1 underline-offset-2"
                >
                  {part.text}
                </Link>
              ) : (
                part.text
              );
            })}
          </span>
        ) : clubPath(piece.href) !== null ? (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional and never reorder
            key={index}
            to={clubPath(piece.href) ?? '/'}
            className="font-semibold underline decoration-1 underline-offset-2 [overflow-wrap:anywhere]"
          >
            {piece.label}
          </Link>
        ) : (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional and never reorder
            key={index}
            href={piece.href}
            title={piece.href}
            // An email or a call opens the phone's own app, not a tab.
            target={/^https?:/.test(piece.href) ? '_blank' : undefined}
            rel="noopener noreferrer nofollow ugc"
            className="font-semibold underline decoration-1 underline-offset-2 [overflow-wrap:anywhere]"
          >
            {piece.label}
          </a>
        ),
      )}
    </>
  );
}
