import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { SegmentPills } from '@/components/segment-pills';
import { POST_MAX } from '@/lib/chat/post-length';
import { roomsByCategory, useChatRooms } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import type { ChatRoom } from '@/lib/chat/types';
import { describeThrown } from '@/lib/describe-error';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { PostOptions } from '@/routes/chat/post-options';
import { SimilarTopics } from '@/routes/chat/similar-topics';
import { backToHome } from '@/routes/home/back';

/**
 * Asking or sharing from Home.
 *
 * ---------------------------------------------------------------------------
 * Asking: write first, the room is optional
 * ---------------------------------------------------------------------------
 * The owner, 2026-10-09 (App Feedback, "Asking questions should be easier"):
 * choosing a room should be optional, and asking should open straight on
 * somewhere to type. This screen used to be a list of rooms with Continue,
 * which handed over to the New topic screen; now asking happens here. The
 * question is the topic's title, the details (optional) its first post, and
 * the room defaults to General (20261010010000), from where the asker or an
 * administrator can move it to the right room later.
 *
 * A question is still a topic in a room (CONTEXT.md), so reports, mutes,
 * removal and notifications reach it unchanged. With no details, the first
 * post repeats the question: a post needs words, and the topic page does not
 * draw the same words twice.
 *
 * ---------------------------------------------------------------------------
 * Sharing: a photograph needs the photo picker
 * ---------------------------------------------------------------------------
 * Sharing still hands over to the New topic screen, which has the picker; the
 * room is chosen the same way, General unless another is picked.
 *
 * ---------------------------------------------------------------------------
 * A native select for the room
 * ---------------------------------------------------------------------------
 * Grouped under the room headings with optgroups. On a phone it opens the
 * system's own picker, which is the easiest list there is to move through at
 * any text size, and it takes one line of the screen until it is wanted.
 */

type Kind = 'ask' | 'share';

const KINDS: [Kind, string][] = [
  ['ask', 'Ask a question'],
  ['share', 'Share something'],
];

/** The room a question goes to when none is chosen. */
export const GENERAL_ROOM = 'general';

const LINK_CLASS =
  'inline-flex min-h-[2.75rem] items-center font-semibold text-[0.875rem] text-emphasis underline decoration-line underline-offset-2 hover:decoration-emphasis';

const FIELD =
  'mt-1.5 w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-ink outline-none focus:border-emphasis';

export default function HomeNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const rooms = useChatRooms();

  // In the URL, so a link can open either kind: /home/new?kind=share.
  const [searchParams, setSearchParams] = useSearchParams();
  const kind: Kind = searchParams.get('kind') === 'share' ? 'share' : 'ask';
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [details, setDetails] = useState('');
  const detailsBox = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionSuggestions({
    box: detailsBox,
    value: details,
    onChange: setDetails,
  });
  const [isQuestion, setIsQuestion] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const back = backToHome(location.state) ?? '/home';
  const { segment } = (location.state ?? {}) as { segment?: unknown };

  // An administrator reads closed rooms too. Only a room a member can see is
  // somewhere to ask.
  const open = rooms.rooms.filter((room) => room.openedAt !== null);
  // General; or, before it exists, the first room as the select lists them.
  const fallback =
    open.find((room) => room.id === GENERAL_ROOM) ?? roomsByCategory(open)[0]?.[1][0] ?? null;
  const room = open.find((r) => r.id === chosenRoom) ?? fallback;
  const ready = question.trim().length > 0 && room !== null;

  function setKind(next: Kind) {
    // Replace, not push, as Home's pills do; and keep the state, which is the
    // way back to Home.
    setSearchParams(next === 'ask' ? {} : { kind: next }, {
      replace: true,
      state: location.state as unknown,
    });
  }

  function share(target: ChatRoom) {
    void navigate(`/chat/rooms/${target.id}/new`, { state: { from: 'home', segment, kind } });
  }

  function ask() {
    if (!room || saving || question.trim().length === 0) return;
    setSaving(true);
    setFailure(null);
    const title = question.trim();
    const target = room;
    createTopic(
      target.id,
      title,
      details.trim() || title,
      [],
      isQuestion,
      anonymous && target.category !== 'Classifieds',
    )
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        // Straight to it, with Home as the way back.
        void navigate(`/chat/rooms/${target.id}/topics/${result.value}`, {
          replace: true,
          state: { from: 'home', segment },
        });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[720px]">
        <BackLink to={back} label="Home" />

        <h1 className="mt-1 font-extrabold font-head text-[1.25rem] text-ink tracking-[-0.01em]">
          {kind === 'ask' ? 'Ask the club' : 'Share a photograph'}
        </h1>
        <SegmentPills segments={KINDS} value={kind} onChange={setKind} className="flex-wrap" />

        {rooms.loading ? (
          <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : rooms.error ? (
          <>
            <p
              role="alert"
              className="mt-4 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
            >
              {rooms.error}
            </p>
            <p className="mt-2">
              <Link to="/chat/rooms/new" className={LINK_CLASS}>
                Start a room
              </Link>
            </p>
          </>
        ) : open.length === 0 ? (
          <div className="mt-4 rounded-[13px] border border-line bg-paper px-4 py-4">
            <p className="text-[0.875rem] text-ink leading-[1.5]">
              No rooms are open yet. Start one — it begins with your first topic.
            </p>
            <p className="mt-1">
              <Link to="/chat/rooms/new" className={LINK_CLASS}>
                Start a room
              </Link>
            </p>
          </div>
        ) : kind === 'ask' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <p className="text-[0.8125rem] text-ink2 leading-[1.45]">
              Goes to every member. Answers come from people who have lived it.
            </p>

            {failure ? (
              <p
                role="alert"
                className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
              >
                {failure} Nothing has been posted, and what you wrote is still here.
              </p>
            ) : null}

            <label
              htmlFor="ask-question"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              Your question
            </label>
            {/* Focused on arrival: the owner asked for the screen to open on
                somewhere to type. A phone shows its keyboard only when the box
                is tapped, but the cursor is waiting there. */}
            <textarea
              id="ask-question"
              // biome-ignore lint/a11y/noAutofocus: opening on the box is the request; it is the screen's only purpose
              autoFocus
              rows={3}
              maxLength={140}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value.replace(/\n/g, ' '));
              }}
              aria-describedby="ask-question-left"
              placeholder="What would you like to know?"
              className={`${FIELD} text-[1.125rem] leading-[1.4]`}
            />
            <p id="ask-question-left" className="mt-1 text-[0.75rem] text-grey">
              {140 - question.length} characters left.
            </p>
            <SimilarTopics text={question} linkState={location.state as unknown} />

            <PostOptions
              id="ask-options"
              question={{ checked: isQuestion, onChange: setIsQuestion }}
              anonymous={
                room?.category === 'Classifieds'
                  ? undefined
                  : { checked: anonymous, onChange: setAnonymous }
              }
            />

            <label
              htmlFor="ask-details"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              More detail <span className="font-normal text-grey">(optional)</span>
            </label>
            <textarea
              id="ask-details"
              ref={detailsBox}
              rows={4}
              maxLength={POST_MAX}
              value={details}
              onChange={(event) => {
                setDetails(event.target.value);
              }}
              {...mention.boxProps}
              onKeyDown={(event) => {
                mention.onKeyDown(event);
              }}
              placeholder="What you have tried, or anything that helps people answer."
              className={`${FIELD} text-[0.9375rem] leading-[1.5]`}
            />
            {mention.list}

            <RoomSelect rooms={open} value={room?.id ?? ''} onChange={setChosenRoom} />

            <button
              type="submit"
              disabled={!ready || saving}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold px-4 py-2 text-center font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-40 disabled:hover:bg-gold"
            >
              {saving ? 'Posting…' : 'Post your question'}
            </button>
            {question.trim().length === 0 ? (
              <p className="mt-1.5 text-center text-[0.75rem] text-grey">Write your question.</p>
            ) : null}
          </form>
        ) : (
          <>
            <p className="text-[0.8125rem] text-ink2 leading-[1.45]">
              A picture and a line about it. Most of what gets shared here is something you did,
              made or worked out.
            </p>
            <RoomSelect rooms={open} value={room?.id ?? ''} onChange={setChosenRoom} />
            <button
              type="button"
              disabled={!room}
              onClick={() => {
                if (room) share(room);
              }}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold px-4 py-2 text-center font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-40 disabled:hover:bg-gold"
            >
              Continue
            </button>
          </>
        )}
        <div className="h-3" />
      </div>
    </div>
  );
}

function RoomSelect({
  rooms,
  value,
  onChange,
}: {
  rooms: ChatRoom[];
  value: string;
  onChange: (roomId: string) => void;
}) {
  return (
    <div className="mt-4">
      <label htmlFor="ask-room" className="block font-bold font-head text-[0.875rem] text-ink">
        Room <span className="font-normal text-grey">(optional)</span>
      </label>
      <p id="ask-room-hint" className="mt-0.5 text-[0.75rem] text-grey leading-[1.45]">
        General if you are not sure. It can be moved to the right room later.
      </p>
      <select
        id="ask-room"
        value={value}
        aria-describedby="ask-room-hint"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={`${FIELD} min-h-[48px] text-[1rem]`}
      >
        {roomsByCategory(rooms).map(([category, inCategory]) => (
          <optgroup key={category} label={category}>
            {inCategory.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-1 text-[0.8125rem] text-ink2">
        None of these fit?{' '}
        <Link to="/chat/rooms/new" className={LINK_CLASS}>
          Start a room
        </Link>
      </p>
    </div>
  );
}
