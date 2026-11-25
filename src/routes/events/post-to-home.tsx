import { House } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { POST_MAX } from '@/lib/chat/post-length';
import { roomsByCategory, useChatRooms } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import { describeThrown } from '@/lib/describe-error';
import { SITE_ORIGIN } from '@/lib/site-origin';
import type { ClubEvent } from '@/types/domain';

/** As Home's Ask (routes/home/new.tsx), without loading that screen here. */
const GENERAL_ROOM = 'general';

/**
 * The Events room, where an event goes by default (the owner, 2026-11-25: "It
 * should default to posting in the events room"). It was started in the app,
 * so its id differs between the test and live clubs: found by its name, as
 * App Feedback is (routes/home/feedback-card.tsx).
 */
const EVENTS_ROOM_NAME = /^events$/i;

/**
 * Post on Home, for whoever may change the event (the owner, 2026-11-25: "an
 * option for an organizer to post an event to the Home [feed] in such a way
 * that people can RSVP from the home feed").
 *
 * It is a topic like any other, in a room that shows on Home (Events, or
 * General while there is none, unless another is picked): its title the event's name, its first post the
 * organizer's words and the event's link. Home and Chat draw a post that links
 * the club's own event as the event's card, RSVP and all (club-link-card.tsx),
 * so nothing new is kept in the database and replies, reports and removal work
 * as they do for every post.
 *
 * Only an event the whole club can see: Home is every member's, and the card
 * draws nothing for a member who may not see the event, which would leave a
 * title that opens nothing.
 */
export function PostToHome({ event }: { event: ClubEvent }) {
  const { rooms } = useChatRooms();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ roomId: string; topicId: string } | null>(null);

  const onHome = rooms.filter(
    (room) => room.openedAt !== null && room.showInHome && room.category !== 'Classifieds',
  );
  const room =
    onHome.find((r) => r.id === chosenRoom) ??
    onHome.find((r) => EVENTS_ROOM_NAME.test(r.name.trim())) ??
    onHome.find((r) => r.id === GENERAL_ROOM) ??
    roomsByCategory(onHome)[0]?.[1][0] ??
    null;

  function post() {
    if (!room || saving) return;
    setSaving(true);
    setFailure(null);
    // The club's address, as Share uses, so every copy of the app (and the test
    // site) reads it as the event's link and draws its card.
    const link = `${SITE_ORIGIN}/events/${event.id}`;
    const said = words.trim();
    const title = event.title.trim().slice(0, 140);
    const target = room;
    createTopic(target.id, title, said ? `${said}\n\n${link}` : link)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        setPosted({ roomId: target.id, topicId: result.value });
        setOpen(false);
        setWords('');
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <section aria-labelledby="post-to-home-heading">
      <h2
        id="post-to-home-heading"
        className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
      >
        Post on Home
      </h2>
      {posted ? (
        <p
          role="status"
          className="mb-2.5 rounded-[14px] border border-line bg-paper p-3.5 text-[0.875rem] text-ink leading-[1.45]"
        >
          Posted. Members see it on Home and can RSVP from there.{' '}
          <Link
            to={`/chat/rooms/${posted.roomId}/topics/${posted.topicId}`}
            className="font-bold text-emphasis underline underline-offset-2"
          >
            See the post
          </Link>
        </p>
      ) : null}
      {open ? (
        <form
          className="rounded-[14px] border border-line bg-paper p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
        >
          <p className="text-[0.8125rem] text-ink2 leading-[1.45]">
            A post titled “{event.title}”, with the event’s card under it, so members can RSVP right
            from Home. It is posted in your name.
          </p>
          <label
            htmlFor="post-to-home-words"
            className="mt-3 block font-bold font-head text-[0.875rem] text-ink"
          >
            A few words <span className="font-normal text-grey">(optional)</span>
          </label>
          <textarea
            id="post-to-home-words"
            rows={3}
            maxLength={POST_MAX - 200}
            value={words}
            onChange={(e) => {
              setWords(e.target.value);
            }}
            placeholder="Who it is for, what to bring…"
            aria-describedby="post-to-home-words-hint"
            className="mt-1.5 w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-emphasis"
          />
          <p id="post-to-home-words-hint" className="mt-1 text-[0.75rem] text-grey leading-[1.45]">
            Shown when someone opens the post. Home shows its title and the event’s card.
          </p>
          {onHome.length > 1 ? (
            <>
              <label
                htmlFor="post-to-home-room"
                className="mt-3 block font-bold font-head text-[0.875rem] text-ink"
              >
                Room
              </label>
              <select
                id="post-to-home-room"
                value={room?.id ?? ''}
                onChange={(e) => {
                  setChosenRoom(e.target.value);
                }}
                className="mt-1.5 min-h-[48px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 text-[1rem] text-ink outline-none focus:border-emphasis"
              >
                {roomsByCategory(onHome).map(([category, inCategory]) => (
                  <optgroup key={category} label={category}>
                    {inCategory.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </>
          ) : null}
          {failure ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {failure} Nothing has been posted.
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-[9px]">
            <button
              type="submit"
              disabled={saving || room === null}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] bg-emphasis px-3 font-bold font-head text-[0.9375rem] text-paper disabled:opacity-40"
            >
              {saving ? 'Posting…' : 'Post'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setFailure(null);
              }}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-line px-3 font-bold font-head text-[0.9375rem] text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : posted ? null : (
        // Once posted, only the way to it: a second tap would put the same
        // event on Home twice.
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[13px] border-[1.6px] border-emphasis px-3 font-bold font-head text-[0.9375rem] text-emphasis hover:bg-tint"
        >
          <House aria-hidden="true" className="h-[17px] w-[17px]" />
          Post on Home, with RSVP
        </button>
      )}
    </section>
  );
}
