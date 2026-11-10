import { MessageCirclePlus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { roomsByCategory } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import type { ChatRoom } from '@/lib/chat/types';
import { describeThrown } from '@/lib/describe-error';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { QuestionSwitch } from '@/routes/chat/question-switch';
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
 * What is typed is kept on this device (sessionStorage, per place) until it is
 * posted, so following a link away and coming back finds it still there.
 */
const LIMIT = 140;

function draftKey(place: string) {
  return `club:quick-ask:${place}`;
}

function readDraft(place: string): string {
  try {
    return sessionStorage.getItem(draftKey(place)) ?? '';
  } catch {
    return '';
  }
}

export function QuickAsk({
  rooms,
  fixedRoom,
  linkState,
  className,
}: {
  /** The rooms that can be asked in, for the picker. Unused with `fixedRoom`. */
  rooms: readonly ChatRoom[];
  /** In a room: always this one, and no picker. */
  fixedRoom?: ChatRoom;
  /** Router state for the topic it opens, so its back link returns here. */
  linkState?: unknown;
  className?: string;
}) {
  const navigate = useNavigate();
  const id = useId();
  const place = fixedRoom?.id ?? 'home';
  const [text, setText] = useState(() => readDraft(place));
  const box = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionSuggestions({ box, value: text, onChange: setText });
  const [isQuestion, setIsQuestion] = useState(true);
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(draftKey(place), text);
      else sessionStorage.removeItem(draftKey(place));
    } catch {
      // Private browsing: the draft is simply not kept.
    }
  }, [place, text]);

  const open = rooms.filter((room) => room.openedAt !== null);
  const room =
    fixedRoom ??
    open.find((r) => r.id === chosenRoom) ??
    open.find((r) => r.id === 'general') ??
    roomsByCategory(open)[0]?.[1][0] ??
    null;
  const words = text.trim();
  const started = text.length > 0;
  const expanded = started || focused;

  function post() {
    if (!room || !words || saving) return;
    setSaving(true);
    setFailure(null);
    const target = room;
    createTopic(target.id, words, words, [], isQuestion)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        setText('');
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

      {expanded ? (
        <>
          <SimilarTopics text={text} linkState={linkState} />
          {text.length > LIMIT - 40 ? (
            <p id={`${id}-left`} className="mt-1 text-[0.75rem] text-grey">
              {LIMIT - text.length} characters left. More can go in the details.
            </p>
          ) : (
            <span id={`${id}-left`} className="sr-only">
              Up to {LIMIT} characters.
            </span>
          )}
          <QuestionSwitch
            id={`${id}-question`}
            compact
            checked={isQuestion}
            onChange={setIsQuestion}
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
