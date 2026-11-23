import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { attachmentFolder } from '@/lib/chat/attachments';
import { memberDraftKey } from '@/lib/chat/drafts';
import { POST_MAX } from '@/lib/chat/post-length';
import { sendPost } from '@/lib/chat/topics';
import { describeThrown } from '@/lib/describe-error';

// The reply box (TipTap, the largest part of a topic's code) is not needed to
// read Home: fetched when Answer is pressed, and kept once fetched.
let composer: ReturnType<typeof importComposer> | null = null;
const importComposer = () => import('@/routes/chat/post-composer');
const loadComposer = () => {
  composer ??= importComposer().catch((e: unknown) => {
    composer = null;
    throw e;
  });
  return composer;
};
const PostComposer = lazy(() =>
  loadComposer().then((module) => ({ default: module.PostComposer })),
);

/**
 * Answering a question from Home, in its card (the owner, 2026-10-10).
 *
 * "Answer" opens the topic's own reply box under the question (the owner,
 * 2026-11-23: "When you tap answer you do not get a rich text box"): written as
 * it will look, with photographs, Preview and the Markdown switch, as everywhere
 * a member replies. Its draft is the topic's, so one put down here is waiting in
 * the topic, and the other way round. Posting sends the answer as a reply to
 * the topic and opens the topic on it, so the member sees it among the others.
 *
 * The cursor goes into the box once it is drawn. iOS raises the keyboard only
 * for focus given inside the tap, so on the first Answer a phone may need a
 * second tap in the box; the box is fetched from the first touch of Answer.
 *
 * Everything here is `relative z-[1]`: the card's title link is stretched over
 * the whole card, and anything not lifted above it is pressed through to the
 * topic (the room name was, until 2026-10-10).
 */
export function AnswerBox({
  topicId,
  roomId,
  title,
  answerAs,
  linkState,
}: {
  topicId: string;
  roomId: string;
  title: string;
  /** The member answering. */
  answerAs: string;
  linkState: unknown;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Naming nobody (20261120100000).
  const [anonymous, setAnonymous] = useState(false);
  const area = useRef<HTMLDivElement>(null);

  // The cursor into the box as soon as it is drawn: the editor is built after
  // the box is, so it is watched for rather than focused at once.
  useEffect(() => {
    if (!open || !area.current) return;
    const within = area.current;
    const focusBox = () => {
      const box = within.querySelector<HTMLElement>('[contenteditable="true"], textarea');
      if (!box) return false;
      box.focus();
      return true;
    };
    if (focusBox()) return;
    const watch = new MutationObserver(() => {
      if (focusBox()) watch.disconnect();
    });
    watch.observe(within, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
    };
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onPointerDown={() => void loadComposer()}
        onFocus={() => void loadComposer()}
        onClick={() => {
          setOpen(true);
        }}
        aria-label={`Answer ${title}`}
        className="relative z-[1] min-h-[2.25rem] rounded-full bg-gold px-4 font-bold font-head text-[0.8125rem] text-on-gold transition-colors hover:bg-gold-hi"
      >
        Answer
      </button>
    );
  }

  return (
    <div ref={area} className="relative z-[1] mt-1 w-full basis-full [&>section]:mt-0">
      <Suspense
        fallback={
          <p className="py-4 text-center text-[0.8125rem] text-grey" role="status">
            Loading the answer box…
          </p>
        }
      >
        <PostComposer
          draftKey={memberDraftKey(answerAs, `topic:${topicId}`)}
          placeholder={`Your answer to ${title}`}
          sendLabel="Post answer"
          maxLength={POST_MAX}
          folder={attachmentFolder('room', roomId)}
          anonymousOption={{ checked: anonymous, onChange: setAnonymous }}
          onSend={async (body, paths, asNobody) => {
            try {
              const result = await sendPost(topicId, answerAs, body, paths, null, asNobody);
              if (!result.ok) return result.error;
              void navigate(`/chat/rooms/${roomId}/topics/${topicId}?post=${result.value.id}`, {
                state: linkState,
              });
              return null;
            } catch (e: unknown) {
              return describeThrown(e, 'Your answer was not posted.');
            }
          }}
        />
      </Suspense>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
        }}
        className="mt-2 min-h-[44px] w-full rounded-[12px] bg-tint px-4 font-semibold text-[0.875rem] text-emphasis hover:bg-line"
      >
        Cancel
      </button>
    </div>
  );
}
