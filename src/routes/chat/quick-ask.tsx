import { MessageCirclePlus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { memberDraftKey, readKeptDraft, writeDraft } from '@/lib/chat/drafts';
import { roomsByCategory } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import type { ChatRoom } from '@/lib/chat/types';
import { describeThrown } from '@/lib/describe-error';
import { noteSent } from '@/lib/push/notifications';
import { DraftStatus, type DraftStorage } from '@/routes/chat/draft-status';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { PostOptions } from '@/routes/chat/post-options';
import { SimilarTopics } from '@/routes/chat/similar-topics';

/**
 * Asking where you already are: a box at the top of Home and of every room,
 * typed into and posted from there.
 *
 * The owner, 2026-10-09: "the least amount of friction". Before, asking was a
 * card to tap, a screen to load, a title box, a first-post box and a button.
 * Here it is one tap into the box (the phone's keyboard opens on that tap,
 * which is the only way iOS opens it) and one on Post. Everything else is
 * optional: whether it is a question (ticked), which room (General from Home,
 * this one in a room), and "Add details or a photo", which carries the words
 * into the full form rather than losing them.
 *
 * Those open with the tap into the box, not after the first word (the owner,
 * 2026-10-22), so they are seen before the words are written; tapping away
 * from an empty box folds them up again, and the X in its corner folds it up
 * with whatever was typed thrown away (the owner, 2026-11-09).
 *
 * The words are the topic's title, and its first post too: a post needs words,
 * and the topic page does not draw them twice. 140 characters, the title's
 * limit; the count shows only near it.
 *
 * Drafts stay on the device, per member and place.
 */
const LIMIT = 140;

export function QuickAsk({
  rooms,
  memberId,
  fixedRoom,
  linkState,
  className,
}: {
  /** The rooms that can be asked in, for the picker. Unused with `fixedRoom`. */
  rooms: readonly ChatRoom[];
  memberId?: string | null;
  /** In a room: always this one, and no picker. */
  fixedRoom?: ChatRoom;
  /** Router state for the topic it opens, so its back link returns here. */
  linkState?: unknown;
  className?: string;
}) {
  const navigate = useNavigate();
  const id = useId();
  const key = memberDraftKey(memberId, `ask:${fixedRoom?.id ?? 'home'}`);
  const [recovered] = useState(() => readKeptDraft(key));
  const [text, setText] = useState(recovered?.text ?? '');
  const [storage, setStorage] = useState<DraftStorage>(null);
  const hadDraft = useRef(Boolean(recovered));
  const box = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionSuggestions({ box, value: text, onChange: setText });
  const [isQuestion, setIsQuestion] = useState(recovered?.question ?? true);
  const [anonymous, setAnonymous] = useState(recovered?.anonymous ?? false);
  const [chosenRoom, setChosenRoom] = useState<string | null>(recovered?.room ?? null);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  // Held open by a press inside the box (the owner, 2026-11-20: tapping Anonymous or "?" in an
  // empty box closed it). A phone does not move focus to a tick box or a button when it is
  // tapped, so the box read the words losing focus as the member leaving, folded up, and took
  // the explanation sheet with it. Presses in that sheet count as inside: React passes them up
  // through the portal. A press anywhere else lets it fold again.
  const [held, setHeld] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!held) return;
    function away(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target || form.current?.contains(target) || target.closest('[data-post-options-sheet]'))
        return;
      setHeld(false);
    }
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
    };
  }, [held]);

  useEffect(() => {
    if (!key || (!text.trim() && !hadDraft.current)) return;
    const saved = writeDraft(key, text, {
      anonymous,
      question: isQuestion,
      room: chosenRoom ?? undefined,
    });
    hadDraft.current = Boolean(saved);
    setStorage(saved);
  }, [key, text, anonymous, isQuestion, chosenRoom]);

  const open = rooms.filter((room) => room.openedAt !== null);
  const room =
    fixedRoom ??
    (chosenRoom
      ? open.find((r) => r.id === chosenRoom)
      : (open.find((r) => r.id === 'general') ?? roomsByCategory(open)[0]?.[1][0])) ??
    null;
  const words = text.trim();
  const started = text.length > 0;
  const expanded = started || focused || held;

  function post() {
    if (!room || !words || saving) return;
    setSaving(true);
    setFailure(null);
    const target = room;
    createTopic(
      target.id,
      words,
      words,
      [],
      isQuestion,
      anonymous && target.category !== 'Classifieds',
    )
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        if (key) writeDraft(key, '');
        setText('');
        noteSent();
        void navigate(`/chat/rooms/${target.id}/topics/${result.value}`, { state: linkState });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <form
      ref={form}
      onPointerDown={() => {
        setHeld(true);
      }}
      className={`rounded-[17px] border-[1.6px] border-line bg-paper p-3.5 focus-within:border-emphasis ${className ?? ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
      onFocus={() => {
        setFocused(true);
      }}
      // Folded up again only once focus has left the whole box: moving from
      // the words to the room or the tick keeps it open.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="flex items-center gap-2.5">
        <label htmlFor={`${id}-text`} className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-[2.2em] w-[2.2em] flex-none place-items-center rounded-full bg-tint text-emphasis"
          >
            <MessageCirclePlus className="h-[1.2em] w-[1.2em]" />
          </span>
          <span className="font-extrabold font-head text-[0.9375rem] text-ink">
            {fixedRoom ? `Ask or post in ${fixedRoom.name}` : 'Ask or post to the club'}
          </span>
        </label>
        {expanded ? (
          <button
            type="button"
            aria-label="Close without posting"
            // Kept from taking focus: the box folding up as the words lose it
            // would take this button away before the tap lands (Safari).
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              setText('');
              setFailure(null);
              setFocused(false);
              setHeld(false);
              box.current?.blur();
            }}
            className="-my-2 -mr-2 grid h-11 w-11 flex-none place-items-center rounded-full text-grey hover:bg-tint hover:text-ink"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <textarea
        id={`${id}-text`}
        ref={box}
        rows={expanded ? 3 : 1}
        maxLength={LIMIT}
        value={text}
        onChange={(event) => {
          setText(event.target.value.replace(/\n/g, ' '));
        }}
        {...mention.boxProps}
        // Enter posts on a keyboard with one; a phone's return key has no
        // other use in a box that is one line of title.
        onKeyDown={(event) => {
          if (mention.onKeyDown(event)) return;
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            post();
          }
        }}
        placeholder="Ask a question, or share something"
        aria-describedby={started ? `${id}-left` : undefined}
        className="mt-2 w-full resize-none rounded-[12px] border-[1.6px] border-line bg-canvas px-3.5 py-2.5 text-[1rem] text-ink leading-[1.45] outline-none focus:border-emphasis"
      />
      {mention.list}
      {started ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <DraftStatus storage={storage} restored={text === recovered?.text} className="mt-1" />
          {text === recovered?.text ? (
            <button
              type="button"
              className="min-h-11 rounded px-2 font-semibold text-[0.875rem] text-emphasis underline"
              onClick={() => {
                const field = box.current;
                field?.focus();
                field?.setSelectionRange(field.value.length, field.value.length);
              }}
            >
              Resume draft
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <>
          {focused || held || text !== recovered?.text ? (
            <SimilarTopics text={text} linkState={linkState} />
          ) : null}
          {text.length > LIMIT - 40 ? (
            <p id={`${id}-left`} className="mt-1 text-[0.75rem] text-grey">
              {LIMIT - text.length} characters left. More can go in the details.
            </p>
          ) : (
            <span id={`${id}-left`} className="sr-only">
              Up to {LIMIT} characters.
            </span>
          )}
          <PostOptions
            id={id}
            className="mt-0"
            question={{ checked: isQuestion, onChange: setIsQuestion }}
            anonymous={
              room?.category === 'Classifieds'
                ? undefined
                : { checked: anonymous, onChange: setAnonymous }
            }
          />
          {fixedRoom ? null : (
            <label className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.875rem] text-ink">
              <span className="font-bold">Room</span>
              <select
                value={room?.id ?? ''}
                onChange={(event) => {
                  setChosenRoom(event.target.value);
                }}
                className="min-h-[44px] min-w-0 flex-1 rounded-[11px] border-[1.6px] border-line bg-paper px-2.5 text-[1rem] text-ink outline-none focus:border-emphasis"
              >
                {!room ? <option value="">Choose a room</option> : null}
                {roomsByCategory([...open]).map(([category, inCategory]) => (
                  <optgroup key={category} label={category}>
                    {inCategory.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          {failure ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {failure} Nothing was posted; your words are still here.
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!words || !room || saving}
              className="min-h-[44px] flex-1 rounded-[12px] bg-gold px-5 font-bold font-head text-[0.9375rem] text-on-gold transition-colors hover:bg-gold-hi disabled:opacity-40"
            >
              {saving ? 'Posting…' : 'Post'}
            </button>
            {/* The room's full form, which has the details box and the photo
                picker; the words and the tick go with it. */}
            <Link
              to={room ? `/chat/rooms/${room.id}/new` : '/home/new'}
              state={{
                ...(typeof linkState === 'object' && linkState !== null ? linkState : {}),
                draft: text,
                question: isQuestion,
                anonymous,
              }}
              className="flex min-h-[44px] items-center rounded-[12px] bg-tint px-4 font-semibold text-[0.875rem] text-emphasis hover:bg-line"
            >
              Add details or a photo
            </Link>
          </div>
        </>
      ) : null}
    </form>
  );
}
