import { type MouseEvent, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { markdownToHtml, splitPhotos } from '@/lib/markdown';
import { useMentionedMembers } from '@/lib/mentions';
import { useOrganizations } from '@/lib/organizations';
import { AttachmentGrid } from '@/routes/chat/attachment-grid';
import { LocalPhotos } from '@/routes/chat/local-photos';
import { sanitizeHtml } from '@/routes/events/rich-text';

/** A post's words, as Post and the reply box's Preview draw them. */
export const POST_TEXT =
  'mt-2 text-[0.875rem] text-ink leading-[1.5] [overflow-wrap:anywhere] [&>*+*]:mt-2 [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-line [&_blockquote]:border-l-[3px] [&_blockquote]:pl-3 [&_blockquote]:text-ink2 [&_blockquote>*+*]:mt-2 [&_h3]:font-extrabold [&_h3]:font-head [&_h3]:text-[0.96875rem] [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc';

/**
 * A post's words, formatted as an event's description is (lib/markdown.ts,
 * through the same allowlist), with each @username of a member who has a
 * profile as a link to it (20261029070000). Other @names stay words.
 *
 * A photograph put in the words (`![Photo](path)`, the owner, 2026-11-19) is
 * drawn there by AttachmentGrid when it is one of `photos`, the post's own
 * attachments; a line naming anything else draws nothing. Photographs one
 * after another are one grid (the owner, 2026-11-23: six drawn full width
 * took about four screens): four tiles, the last saying how many more. One
 * not yet uploaded ("local:…", the reply box's Preview) is drawn from its file.
 */
export function PostBody({
  text,
  className,
  photos = [],
  from = '',
  eager,
}: {
  text: string;
  className?: string;
  /** The post's attachments: the only photographs its words may show. */
  photos?: readonly string[];
  /** Whose post, for a photograph's description. */
  from?: string;
  /** Its photographs load at once: one of the topic's first (AttachmentGrid). */
  eager?: 'first' | undefined;
}) {
  const navigate = useNavigate();
  const members = useMentionedMembers(text);
  const { organizations } = useOrganizations();
  const local = useContext(LocalPhotos);
  const shows = (path: string) =>
    path.startsWith('local:') ? !!local(path) : photos.includes(path);
  const html = (words: string) =>
    sanitizeHtml(
      markdownToHtml(
        words,
        (username) => {
          const member = members.get(username);
          return member?.hasProfile ? `/peers/${member.id}` : null;
        },
        organizations,
      ),
      { peers: true },
    );

  // A profile opens in the app, not as a new page load.
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest('a');
    const href = link?.getAttribute('href') ?? '';
    const inApp = href.startsWith('/peers/') || href.startsWith('/events/organizations/');
    if (!inApp || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    void navigate(href);
  };

  const pieces = splitPhotos(text);
  if (!pieces.some((piece) => piece.kind === 'photo')) {
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: the links inside take the keys; Enter on one is a click.
      // biome-ignore lint/a11y/noStaticElementInteractions: only clicks on a profile link inside are handled.
      <div
        className={className}
        onClick={follow}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeHtml rebuilds the string from an allowlist
        dangerouslySetInnerHTML={{ __html: html(text) }}
      />
    );
  }

  // Photographs one after another (only blank lines between) are one run.
  const runs: ({ kind: 'words'; text: string } | { kind: 'photos'; paths: string[] })[] = [];
  for (const piece of pieces) {
    const last = runs.at(-1);
    if (piece.kind === 'words') runs.push(piece);
    else if (last?.kind === 'photos') last.paths.push(piece.path);
    else runs.push({ kind: 'photos', paths: [piece.path] });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the links inside take the keys; Enter on one is a click.
    // biome-ignore lint/a11y/noStaticElementInteractions: only clicks on a profile link inside are handled.
    <div className={className} onClick={follow}>
      {runs.map((run, index) => {
        if (run.kind === 'words') {
          return (
            <div
              // The pieces never move about: the index is their place.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={index}
              className="[&>*+*]:mt-2"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeHtml rebuilds the string from an allowlist
              dangerouslySetInnerHTML={{ __html: html(run.text) }}
            />
          );
        }
        const shown = run.paths.filter(shows);
        return shown.length > 0 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <div key={index} className="[&>div]:mt-0">
            <AttachmentGrid paths={shown} from={from} eager={eager} />
          </div>
        ) : null;
      })}
    </div>
  );
}
