import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { MemberAvatar } from '@/components/member-avatar';
import {
  insertMention,
  loadMentionCandidates,
  type MentionCandidate,
  type MentionQuery,
  mentionAt,
  suggestMentions,
} from '@/lib/mentions';
import { useOrganizations } from '@/lib/organizations';
import { cn } from '@/lib/utils';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import type { Organization } from '@/types/domain';

/**
 * Typing "@" in a post suggests members to mention (20261029070000), as
 * AddressField suggests addresses: a list the box controls, nothing chosen
 * until the arrows choose, Enter or Tab to pick, Escape to close, and a tap
 * on a row works too. A textarea takes no combobox role, so it keeps its own
 * and says it has a list (aria-autocomplete, aria-activedescendant); a
 * status line says how many are offered.
 */
export interface MentionSuggestions {
  /** Spread on the textarea. */
  boxProps: {
    'aria-autocomplete': 'list';
    'aria-controls': string | undefined;
    'aria-activedescendant': string | undefined;
    onSelect: () => void;
    onBlur: () => void;
  };
  /** Called first from the textarea's own onKeyDown; true when it used the key. */
  onKeyDown: (event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent) => boolean;
  /** The list, drawn where the caller puts it, and its status line. */
  list: ReactNode;
}

/**
 * A box that is not a textarea: the post editor (rich-editor.tsx), which says
 * the words of the line being typed up to the caret, and puts the picked name
 * in place of the "@" typed there.
 */
export interface MentionField {
  /** The current line's words and the caret in them; null with a selection. */
  read: () => { text: string; caret: number } | null;
  focused: () => boolean;
  /** Put `@words ` in place of what `query` covers, up to `caret`. */
  put: (query: MentionQuery, caret: number, words: string) => void;
}

type Offer =
  | { kind: 'member'; member: MentionCandidate }
  | { kind: 'organization'; organization: Organization };

function sameQuery(a: MentionQuery | null, b: MentionQuery | null): boolean {
  return a?.start === b?.start && a?.text === b?.text;
}

export function useMentionSuggestions({
  box,
  field,
  value,
  onChange,
  above = false,
  enabled = true,
  among,
  first,
}: {
  box?: RefObject<HTMLTextAreaElement | null>;
  /** In place of `box`, for the post editor. */
  field?: MentionField;
  value: string;
  /** The words with the @name put in. */
  onChange: (value: string) => void;
  /** Floats over what is above the box, as at the foot of a topic; the caller is `relative`. */
  above?: boolean;
  enabled?: boolean;
  /** Only these members: a conversation's own. */
  among?: readonly string[] | undefined;
  /** These members ahead of the rest: the people already in a topic. */
  first?: readonly string[] | undefined;
}): MentionSuggestions {
  const listId = `${useId()}-mentions`;
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [members, setMembers] = useState<MentionCandidate[] | null>(null);
  const [active, setActive] = useState(-1);
  // Escape closes the list for that "@" until another is typed.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const caretTo = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const read = (): { text: string; caret: number } | null => {
    if (field) return field.read();
    const element = box?.current;
    return element && element.selectionStart === element.selectionEnd
      ? { text: element.value, caret: element.selectionStart }
      : null;
  };

  const look = () => {
    const at = enabled ? read() : null;
    const next = at ? mentionAt(at.text, at.caret) : null;
    if (sameQuery(query, next)) return;
    setQuery(next);
    setActive(-1);
    if (next) setAdded(null);
  };

  // The words change: typed, or swapped for a post being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger to look again.
  useEffect(() => {
    if (field ? field.focused() : document.activeElement === box?.current) look();
  }, [value]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the picked name, drawn.
  useLayoutEffect(() => {
    const element = box?.current;
    const caret = caretTo.current;
    if (!element || caret === null) return;
    caretTo.current = null;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [value, box]);

  const wanted = query !== null && query.start !== closedAt;
  useEffect(() => {
    if (!wanted || members !== null) return;
    let live = true;
    void loadMentionCandidates().then((found) => {
      if (live) setMembers(found);
    });
    return () => {
      live = false;
    };
  }, [wanted, members]);

  // Up to 20, in a list that scrolls (the owner, 2026-10-29).
  // Organizations by full name too, everywhere members are (the owner, 2026-11-17).
  const { organizations } = useOrganizations(wanted && query.text !== '');
  const orgs: Organization[] =
    wanted && query.text !== ''
      ? organizations
          .filter((org) =>
            org.name
              .toLowerCase()
              .split(/\s+/)
              .some((word) => word.startsWith(query.text)),
          )
          .slice(0, 5)
      : [];
  const offered: Offer[] = [
    ...(wanted && members ? suggestMentions(members, query.text, 20, { among, first }) : []).map(
      (member): Offer => ({ kind: 'member', member }),
    ),
    ...orgs.map((organization): Offer => ({ kind: 'organization', organization })),
  ];
  const open = offered.length > 0;

  // The chosen row stays in sight as the arrows move through a scrolled list.
  useEffect(() => {
    if (active < 0) return;
    const row = listRef.current?.querySelector(`#${CSS.escape(`${listId}-${active}`)}`);
    // jsdom has no scrollIntoView.
    if (row && 'scrollIntoView' in row) row.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const pick = (offer: Offer) => {
    const at = read();
    if (!at || !query) return;
    const words = offer.kind === 'member' ? offer.member.username : offer.organization.name.trim();
    setQuery(null);
    setActive(-1);
    setClosedAt(null);
    setAdded(words);
    if (field) {
      field.put(query, at.caret, words);
      return;
    }
    const next = insertMention(at.text, at.caret, query, words);
    caretTo.current = next.caret;
    onChange(next.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent): boolean => {
    const composing = 'nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing;
    if (!open || !query || composing) return false;
    const last = offered.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      setActive((at) => (down ? (at >= last ? 0 : at + 1) : at <= 0 ? last : at - 1));
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = offered[active];
      if (!chosen || event.shiftKey) return false;
      event.preventDefault();
      pick(chosen);
      return true;
    }
    if (event.key === 'Escape') {
      // Not the edit, the sheet or the page around it.
      event.preventDefault();
      event.stopPropagation();
      setClosedAt(query.start);
      setActive(-1);
      return true;
    }
    return false;
  };

  const said = open
    ? `${offered.length} to mention. Up and down arrows to choose, Enter to pick.`
    : added
      ? `Mentioned @${added}.`
      : '';

  const list = (
    <>
      {open ? (
        <div
          className={cn(
            'rounded-[11px] border border-line bg-paper shadow-sm',
            // Over the posts, so the box being typed in never moves out of sight.
            above ? 'absolute inset-x-0 bottom-full z-20 mb-2 shadow-lg' : 'mt-1',
          )}
        >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Members and organizations to mention"
            // About four and a half rows, so a fifth shows there is more to scroll.
            className="max-h-[min(14.5rem,40dvh)] overflow-y-auto overscroll-contain py-1"
          >
            {offered.map((offer, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the box's own keys choose it (aria-activedescendant).
              <div
                key={offer.kind === 'member' ? offer.member.id : offer.organization.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-label={
                  offer.kind === 'member'
                    ? `${offer.member.displayName}, @${offer.member.username}`
                    : `${offer.organization.name}, organization`
                }
                tabIndex={-1}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[0.9375rem] text-ink',
                  index === active && 'bg-tint outline-2 outline-emphasis -outline-offset-2',
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  pick(offer);
                }}
              >
                {offer.kind === 'member' ? (
                  <>
                    <span aria-hidden="true" className="flex-none">
                      <MemberAvatar
                        id={offer.member.id}
                        displayName={offer.member.displayName}
                        photoPath={offer.member.photoPath}
                        photoAlt={offer.member.photoAlt}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold">{offer.member.displayName}</span>
                      <span className="block text-[0.8125rem] text-grey">
                        @{offer.member.username}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="flex-none">
                      <OrganizationBadge organization={offer.organization} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold">{offer.organization.name}</span>
                      <span className="block text-[0.8125rem] text-grey">Organization</span>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* Once an "@" is typed, so a box that never has one adds no live region. */}
      {query !== null || added !== null ? (
        <span role="status" className="sr-only">
          {said}
        </span>
      ) : null}
    </>
  );

  return {
    boxProps: {
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open && active >= 0 ? `${listId}-${active}` : undefined,
      onSelect: look,
      onBlur: () => {
        setQuery(null);
        setActive(-1);
      },
    },
    onKeyDown,
    list,
  };
}
