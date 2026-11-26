import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { useAccount } from '@/lib/account';
import { attachmentFolder, deleteAttachments, uploadAttachments } from '@/lib/chat/attachments';
import { memberDraftKey, readKeptDraft, writeDraft } from '@/lib/chat/drafts';
import { PRICED_ROOM, parsePrice, setListingPrice } from '@/lib/chat/listing-prices';
import {
  holdsOtherPost,
  otherDraftKey,
  savedPost,
  setAsideFor,
  swapDrafts,
} from '@/lib/chat/other-draft';
import { POST_COUNT_FROM, POST_MAX } from '@/lib/chat/post-length';
import { roomPrompt } from '@/lib/chat/room-prompts';
import { roomsByCategory, useChatRooms } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import { categoryName } from '@/lib/chat/types';
import { describeThrown } from '@/lib/describe-error';
import { draftMediaGeneration, mayHaveDraftMedia, writeDraftMedia } from '@/lib/draft-media';
import { useFormDraft } from '@/lib/form-draft';
import { type PhotoTarget, pastePhotos } from '@/lib/paste-photos';
import { noteSent } from '@/lib/push/notifications';
import { useDraftFiles } from '@/lib/use-draft-media';
import { DraftStatus } from '@/routes/chat/draft-status';
import { PhotoPicker, PhotoStrip } from '@/routes/chat/photo-picker';
import { PlaceAsk } from '@/routes/chat/place-ask';
import { PostOptions } from '@/routes/chat/post-options';
import { DescriptionEditor } from '@/routes/events/description-editor';
import { backToHome } from '@/routes/home/back';
import { appFeedbackRoom } from '@/routes/home/feedback-card';

/**
 * Starting a topic: a title and the first post itself.
 *
 * `chat_create_topic` writes both in one transaction, so the body is an ordinary post. A topic is
 * not always a question (the owner, 2026-09-20): tips and lists are topics too, so the copy never
 * asks "what are you asking?".
 *
 * On refusal the fields stay and the screen does not navigate; the database's own sentence is
 * shown, since it says something useful (not a member, room closed).
 *
 * /home/new hands over with `{ from: 'home', segment, kind }`, reusing this screen so a topic is
 * written one way. Back says "Home" and returns to the member's pill, as does the posted topic's.
 * `kind: 'share'` puts the photograph picker first and makes words optional once there is one
 * (`chat_posts_check`); the title stays required, as it is the room's list line. Asking changes
 * only the back link.
 */
export default function NewTopicPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const account = useAccount();
  const location = useLocation();
  const roomsRead = useChatRooms();
  const sharing = fromHome(location.state)?.kind === 'share';
  // Each Marketplace room keeps a listing of its own (the owner, 2026-11-21):
  // List something in Giving away opens in Giving away, on the item half
  // listed there or a clean form, never on a post half written for General.
  function draftKeyFor(id: string | undefined) {
    const feedback = appFeedbackRoom(roomsRead.rooms)?.id === id;
    const listing = roomsRead.rooms.find((r) => r.id === id)?.category === 'Classifieds';
    return memberDraftKey(
      account.userId,
      `new-post:${feedback ? 'feedback' : listing ? `listing:${id}` : sharing ? 'photo' : 'post'}`,
    );
  }
  const draftKey = draftKeyFor(roomId);
  // The words carried from the quick box win over a different unfinished post,
  // which is set aside, not lost (lib/chat/other-draft.ts). Decided once, when
  // the rooms say which draft this is; choosing another room afterwards, or
  // "Switch to it", changes nothing more.
  const words = carriedDraft(location.state).draft;
  const [decided, setDecided] = useState(false);
  const [opened, setOpened] = useState(0);
  const settling = !decided && holdsOtherPost(draftKey, words);
  const loading = roomsRead.loading;
  useEffect(() => {
    if (decided || loading) return;
    if (!draftKey || !holdsOtherPost(draftKey, words)) {
      setDecided(true);
      return;
    }
    let live = true;
    void setAsideFor(draftKey, words).finally(() => {
      if (live) setDecided(true);
    });
    return () => {
      live = false;
    };
  }, [decided, draftKey, loading, words]);
  if (settling) return null;
  return (
    <NewTopicForm
      key={`${draftKey ?? ''}:${String(opened)}`}
      draftKey={draftKey}
      draftKeyFor={draftKeyFor}
      roomId={roomId}
      roomsRead={roomsRead}
      onOpenedOther={() => {
        setOpened((n) => n + 1);
      }}
    />
  );
}

function NewTopicForm({
  draftKey,
  draftKeyFor,
  roomId,
  roomsRead,
  onOpenedOther,
}: {
  draftKey: string | undefined;
  draftKeyFor: (roomId: string) => string | undefined;
  roomId: string | undefined;
  roomsRead: ReturnType<typeof useChatRooms>;
  onOpenedOther: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const home = fromHome(location.state);
  // Opened from Me's Send app feedback (the owner, 2026-10-28): back is Me.
  const fromMe = (location.state as { from?: unknown } | null)?.from === 'me';
  const sharing = home?.kind === 'share';
  const { rooms, loading } = roomsRead;
  // Carried from the quick box on Home or a room ("Add details or a photo"),
  // so nothing typed there is typed twice.
  const carried = carriedDraft(location.state);
  const draft = useFormDraft(
    draftKey,
    () => ({
      title: '',
      body: '',
      isQuestion: false,
      anonymous: false,
      priceText: '',
      destination: roomId,
      // The quick box's words it was started from, so the next "Add details"
      // with them opens it again even once its title has changed.
      askedAs: '',
    }),
    undefined,
    (initial) => ({
      ...initial,
      askedAs: carried.draft,
      title: carried.draft,
      isQuestion: carried.question,
      anonymous: carried.anonymous,
    }),
  );
  const { title, body, isQuestion, anonymous, priceText, destination } = draft.value;
  function set<K extends keyof typeof draft.value>(key: K, value: (typeof draft.value)[K]) {
    draft.setValue((current) => ({ ...current, [key]: value }));
  }
  const photoDraft = useDraftFiles(draftKey);
  const { value: files, setValue: setFiles } = photoDraft;
  // An unfinished post set aside for this one, offered back.
  const [other] = useState(() => (draftKey ? savedPost(otherDraftKey(draftKey)) : null));
  const otherTitle = typeof other?.title === 'string' ? other.title.trim() : '';
  const [swapping, setSwapping] = useState(false);

  /** Choosing another room takes what is written along, unless that room
   * keeps a draft of its own (a Marketplace room's listing), which then opens
   * instead and this one stays where it was. */
  async function moveDraft(next: string) {
    const nextKey = draftKeyFor(next);
    if (nextKey === draftKey) {
      set('destination', next);
      return;
    }
    const written = draft.storage !== null || files.length > 0;
    if (!nextKey || !written || readKeptDraft(nextKey) || mayHaveDraftMedia(nextKey)) return;
    writeDraft(
      nextKey,
      JSON.stringify({ version: 1, value: { ...draft.value, destination: next } }),
    );
    if (files.length > 0) await writeDraftMedia(nextKey, files, draftMediaGeneration());
    draft.discard();
    photoDraft.clear();
  }
  // Pictures pasted into the post join the photographs (lib/paste-photos.ts).
  const photoTarget = useRef<PhotoTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === (destination ?? roomId)) ?? null;
  // The App Feedback room's form reads as feedback (the owner, 2026-10-28);
  // every other room's is as it was.
  const feedback = room !== null && appFeedbackRoom([room]) !== null;
  // Examples in the room's own terms (room-prompts.ts).
  const prompt = roomPrompt(room);
  // Classifieds (the owner, 2026-11-12): photographs first, and a price in For sale.
  const listing = room?.category === 'Classifieds';
  const priced = room?.id === PRICED_ROOM;
  const price = priced ? parsePrice(priceText) : null;
  const problem =
    topicProblem(title, body, files.length, sharing) ??
    (price === undefined ? 'Write the price as a number, like 250 or 12.50.' : null);
  const ready = problem === null;

  if (loading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  if (!room) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          {home ? <BackLink to={home.back} label="Home" /> : <BackLink to="/chat" label="Chat" />}
          <p className="mt-6 text-[0.875rem] text-ink2">
            There is no such room, or it is not open.
          </p>
          {draft.storage || photoDraft.status !== 'idle' ? (
            <button
              type="button"
              className="min-h-11 font-semibold text-[0.875rem] text-emphasis underline"
              disabled={photoDraft.loading}
              onClick={() => {
                draft.discard();
                photoDraft.clear();
                set('destination', roomId);
              }}
            >
              Discard draft
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function submit() {
    if (!ready || saving || photoDraft.loading || !room) return;
    setSaving(true);
    setFailure(null);
    const roomId = room.id;
    void (async () => {
      // Files first, under the room's folder, then the topic that names them
      // on its first post. A refused topic takes its files back out.
      let paths: string[] = [];
      if (files.length > 0) {
        const up = await uploadAttachments(files, attachmentFolder('room', roomId));
        if (!up.ok) return up;
        paths = up.value;
      }
      const result = await createTopic(
        roomId,
        title.trim(),
        // The first post is optional: with none, it repeats the title, which
        // the topic page draws once.
        body.trim() || (paths.length > 0 ? '' : title.trim()),
        paths,
        !sharing && !feedback && !listing && isQuestion,
        // Never a listing: a buyer has to reach the seller. Nor app feedback,
        // which the club answers.
        !feedback && !listing && anonymous,
      );
      if (!result.ok) void deleteAttachments(paths);
      else {
        draft.finish();
        photoDraft.clear();
        // The listing stands even if its price does not save.
        if (typeof price === 'number') await setListingPrice(result.value, price);
      }
      return result;
    })()
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        noteSent();
        // Straight to the topic, which is also what marks it read, so the
        // member's own new topic is not bold in the list they land back on.
        // From Home, the topic is handed the same state, so its back link says
        // Home rather than naming a room the member never passed through.
        void navigate(`/chat/rooms/${room.id}/topics/${result.value}`, {
          replace: true,
          state: home ? { from: 'home', segment: home.segment } : undefined,
        });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  // Photographs with the first post. Asking, the words stay required — a topic
  // is a line in a list and a picture is not a title — so a photograph comes
  // with the post rather than instead of it. Sharing, the photograph is the
  // point, so it comes first and the words are optional.
  const photos = (
    <div className={sharing ? 'mt-4' : 'mt-3'}>
      <PhotoStrip
        files={files}
        disabled={saving || photoDraft.loading}
        onRemove={(index) => {
          setFiles((current) => current.filter((_, i) => i !== index));
        }}
      />
      <PhotoPicker
        ref={photoTarget}
        files={files}
        onChange={setFiles}
        disabled={saving || photoDraft.loading}
        addLabel={feedback ? 'Add a screenshot' : 'Add a photograph'}
      />
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[720px]">
        {home ? (
          <BackLink to={home.back} label="Home" />
        ) : fromMe ? (
          <BackLink to="/me" label="Me" />
        ) : (
          <BackLink to={`/chat/rooms/${room.id}`} label={room.name} />
        )}

        <h1 className="mt-1 font-extrabold font-head text-[1.25rem] text-ink tracking-[-0.01em]">
          {sharing
            ? 'Share a photograph'
            : feedback
              ? 'New app feedback'
              : listing
                ? 'New listing'
                : 'New post'}
        </h1>
        <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
          {feedback
            ? 'Tell us what works, what doesn’t, or what you’d like. It’s posted in the App Feedback room, where the team reads it. Every member can read it too, and nothing here is public.'
            : 'Every member can read this, including members who join later. Nothing here is public.'}
        </p>

        {other && draftKey ? (
          <div className="mt-2 rounded-[12px] border border-line bg-paper px-3 pt-2">
            <p className="text-[0.8125rem] text-ink2 leading-[1.45]">
              {otherTitle ? (
                <>
                  Another unfinished post:{' '}
                  <span className="font-semibold text-ink">“{otherTitle}”</span>
                </>
              ) : (
                'Another unfinished post, with no title yet'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-x-2">
              <button
                type="button"
                disabled={
                  saving || swapping || photoDraft.loading || photoDraft.status === 'saving'
                }
                className="min-h-11 font-semibold text-[0.8125rem] text-emphasis underline disabled:opacity-50"
                onClick={() => {
                  // This one takes its place, so neither is lost.
                  setSwapping(true);
                  void swapDrafts(draftKey, otherDraftKey(draftKey)).finally(onOpenedOther);
                }}
              >
                Switch to it
              </button>
              <span className="text-[0.75rem] text-grey">
                The post you are writing is kept too.
              </span>
            </div>
          </div>
        ) : null}
        {draft.storage || photoDraft.status !== 'idle' ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <DraftStatus
              storage={draft.storage}
              restored={draft.restored}
              media={photoDraft.status}
            />
            <button
              type="button"
              disabled={saving || photoDraft.loading}
              className="min-h-11 font-semibold text-[0.8125rem] text-emphasis underline disabled:opacity-50"
              onClick={() => {
                draft.discard();
                photoDraft.clear();
                setFailure(null);
              }}
            >
              {other ? 'Discard this draft' : 'Discard draft'}
            </button>
          </div>
        ) : null}
        {/* A listing starts with its photographs (the owner, 2026-11-12). */}
        {listing && !sharing ? (
          <>
            {photos}
            <p className="mt-1 text-[0.71875rem] text-grey">
              {files.length === 0
                ? 'Listings with a photograph get more replies. The first one is shown in the room.'
                : 'The first photograph is the one shown in the room.'}
            </p>
          </>
        ) : null}

        {/* The room can be changed here too (the owner, 2026-10-28): it was
            fixed once "Add details" brought the post over. The same screen
            for another room keeps what is typed; App Feedback's stays put. */}
        {feedback ? null : (
          <div className="mt-4">
            <label
              htmlFor="topic-room"
              className="block font-bold font-head text-[0.8125rem] text-ink"
            >
              Room
            </label>
            <select
              id="topic-room"
              value={room.id}
              onChange={(event) => {
                const next = event.target.value;
                void moveDraft(next).then(() =>
                  navigate(`/chat/rooms/${next}/new`, {
                    replace: true,
                    state: location.state as unknown,
                  }),
                );
              }}
              className="mt-1.5 min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3 py-2 text-[1rem] text-ink outline-none focus:border-emphasis"
            >
              {roomsByCategory(
                rooms.filter(
                  (r) => r.id === room.id || (r.openedAt !== null && !appFeedbackRoom([r])),
                ),
              ).map(([category, inCategory]) => (
                <optgroup key={category} label={categoryName(category)}>
                  {inCategory.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {failure ? (
          <p
            role="alert"
            className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
          >
            {failure} Nothing has been posted, and what you wrote is still here.
          </p>
        ) : null}

        {sharing ? photos : null}

        <label
          htmlFor="topic-title"
          className="mt-4 block font-bold font-head text-[0.8125rem] text-ink"
        >
          {sharing
            ? 'Say something about it'
            : feedback
              ? 'In a few words, what is it about?'
              : listing
                ? room.id === 'looking-for'
                  ? 'What are you looking for?'
                  : 'What are you listing?'
                : 'What is it about?'}
        </label>
        <input
          id="topic-title"
          value={title}
          maxLength={140}
          onChange={(event) => {
            set('title', event.target.value);
          }}
          placeholder={sharing ? 'The cushion that finally worked' : prompt.title}
          className="mt-1.5 min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
        />
        <p className="mt-1 text-[0.71875rem] text-grey">
          {140 - title.length} characters left.{' '}
          {listing
            ? 'This is the line under the photograph.'
            : 'This is the line people see in the list.'}
        </p>

        {priced ? (
          <>
            <label
              htmlFor="topic-price"
              className="mt-4 block font-bold font-head text-[0.8125rem] text-ink"
            >
              Price <span className="font-normal text-grey">(optional)</span>
            </label>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span aria-hidden="true" className="font-bold text-[1rem] text-ink2">
                $
              </span>
              <input
                id="topic-price"
                inputMode="decimal"
                value={priceText}
                maxLength={12}
                onChange={(event) => {
                  set('priceText', event.target.value);
                }}
                placeholder="250"
                aria-describedby="topic-price-hint"
                className="min-h-[44px] w-[10rem] rounded-[12px] border-[1.6px] border-line bg-paper px-3 py-2 text-[1rem] text-ink outline-none focus:border-emphasis"
              />
            </div>
            <p id="topic-price-hint" className="mt-1 text-[0.71875rem] text-grey">
              {price === undefined
                ? 'Write the price as a number, like 250 or 12.50.'
                : 'Leave it blank for offers.'}
            </p>
          </>
        ) : null}

        {listing ? <PlaceAsk /> : null}

        <label
          htmlFor="topic-body"
          className="mt-4 block font-bold font-head text-[0.8125rem] text-ink"
        >
          {feedback ? 'Tell us more' : listing ? 'Description' : 'Details'}{' '}
          {sharing ? null : <span className="font-normal text-grey">(optional)</span>}
        </label>
        {sharing ? (
          <p id="topic-body-hint" className="mt-0.5 text-[0.71875rem] text-grey">
            Optional when there is a photograph.
          </p>
        ) : null}
        {/* The event form's toolbar (the owner, 2026-10-11): bold, italic, a
            heading, lists and a link, written as a small Markdown that the
            topic page shows formatted (post.tsx). */}
        <DescriptionEditor
          id="topic-body"
          value={body}
          maxLength={POST_MAX}
          countFrom={POST_COUNT_FROM}
          onChange={(value) => {
            set('body', value);
          }}
          mentions
          placeholder={prompt.body}
          hintClassName="mt-1 text-[0.71875rem] text-grey leading-[1.45]"
          onPaste={(event) => {
            pastePhotos(event, photoTarget.current);
          }}
        />

        {/* Feedback is not asked as a question of the club. */}
        {/* Nor is a listing. */}
        {feedback || listing ? null : (
          <PostOptions
            id="new-topic-options"
            question={
              sharing
                ? undefined
                : {
                    checked: isQuestion,
                    onChange: (value) => {
                      set('isQuestion', value);
                    },
                  }
            }
            anonymous={{
              checked: anonymous,
              onChange: (value) => {
                set('anonymous', value);
              },
            }}
          />
        )}

        {sharing || listing ? null : photos}

        {/* Said where it stays, not only as the example that typing hides. */}
        {listing && room.id !== 'looking-for' ? (
          <p className="mt-4 text-[0.78125rem] text-ink2 leading-[1.45]">
            Meet somewhere public, and settle payment between yourselves. Nothing is paid through
            the club.
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!ready || saving || photoDraft.loading}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-40 disabled:hover:bg-gold"
        >
          {saving ? (feedback ? 'Sending…' : 'Posting…') : feedback ? 'Send feedback' : 'Post it'}
        </button>
        {/* Sharing, the rule is "a title, and words or a photograph", which is
            not what a disabled button says on its own. Asking, both fields
            are plainly there to be filled, as they always were. */}
        {sharing && problem ? (
          <p className="mt-1.5 text-center text-[0.71875rem] text-grey">{problem}</p>
        ) : null}
        <div className="h-3" />
      </div>
    </div>
  );
}

/**
 * What a screen opened from Home was handed, or null. Router state is not trusted: anything but
 * `'share'` is asking, and `backToHome` drops a segment that is not Home's.
 */
function fromHome(
  state: unknown,
): { back: string; segment: unknown; kind: 'ask' | 'share' } | null {
  const back = backToHome(state);
  if (!back) return null;
  const { segment, kind } = state as { segment?: unknown; kind?: unknown };
  return { back, segment, kind: kind === 'share' ? 'share' : 'ask' };
}

/**
 * Why Post is not ready yet, or null when it is. Asking wants a title (an empty first post
 * repeats it); sharing wants a title and words or a photograph, the database's rule. Exported for
 * its test.
 */
export function topicProblem(
  title: string,
  body: string,
  photographs: number,
  sharing: boolean,
): string | null {
  if (sharing) {
    if (title.trim().length === 0) return 'Say something about it. It is the line in the list.';
    if (body.trim().length === 0 && photographs === 0) return 'Add a photograph, or some words.';
    return null;
  }
  // The first post is optional since 2026-10-09: a title alone is a topic.
  if (title.trim().length === 0) return 'A title.';
  return null;
}

/** What the quick box handed over, or nothing. Router state is not trusted. */
function carriedDraft(state: unknown): { draft: string; question: boolean; anonymous: boolean } {
  if (typeof state !== 'object' || state === null) {
    return { draft: '', question: false, anonymous: false };
  }
  const { draft, question, anonymous } = state as {
    draft?: unknown;
    question?: unknown;
    anonymous?: unknown;
  };
  return {
    draft: typeof draft === 'string' ? draft.slice(0, 140) : '',
    question: question === true,
    anonymous: anonymous === true,
  };
}
