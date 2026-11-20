import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { POST_MAX } from '@/lib/chat/post-length';
import { sendPost } from '@/lib/chat/topics';
import { describeThrown } from '@/lib/describe-error';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { PostOptions } from '@/routes/chat/post-options';

/**
 * Answering a question from Home, in its card (the owner, 2026-10-10).
 *
 * "Answer" opens a box under the question and puts the cursor in it within
 * the same tap: iOS raises the keyboard only for focus given inside the
 * gesture, so the box is drawn synchronously (flushSync) and focused before
 * the handler returns. Posting sends the answer as a reply to the topic and
 * opens the topic on it, so the member sees it among the others.
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
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Naming nobody (20261120100000).
  const [anonymous, setAnonymous] = useState(false);
  const id = `answer-${topicId}`;
  const mention = useMentionSuggestions({ box, value: text, onChange: setText });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          flushSync(() => {
            setOpen(true);
          });
          box.current?.focus();
        }}
        aria-label={`Answer ${title}`}
        className="relative z-[1] min-h-[2.25rem] rounded-full bg-gold px-4 font-bold font-head text-[0.8125rem] text-on-gold transition-colors hover:bg-gold-hi"
      >
        Answer
      </button>
    );
  }

  function post() {
    const words = text.trim();
    if (!words || saving) return;
    setSaving(true);
    setFailure(null);
    sendPost(topicId, answerAs, words, [], null, anonymous)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        void navigate(`/chat/rooms/${roomId}/topics/${topicId}?post=${result.value.id}`, {
          state: linkState,
        });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'Your answer was not posted.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <form
      className="relative z-[1] mt-1 w-full basis-full"
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your answer to {title}
      </label>
      <textarea
        id={id}
        ref={box}
        rows={3}
        maxLength={POST_MAX}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        {...mention.boxProps}
        onKeyDown={(event) => {
          mention.onKeyDown(event);
        }}
        placeholder="Your answer…"
        className="w-full rounded-[12px] border-[1.6px] border-line bg-canvas px-3.5 py-2.5 text-[1rem] text-ink leading-[1.45] outline-none focus:border-emphasis"
      />
      {mention.list}
      <PostOptions
        id={id}
        className="mt-0"
        noun="answer"
        anonymous={{ checked: anonymous, onChange: setAnonymous }}
      />
      {failure ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-destructive leading-[1.45]">
          {failure} Your answer is still here.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!text.trim() || saving}
          className="min-h-[44px] flex-1 rounded-[12px] bg-gold px-5 font-bold font-head text-[0.9375rem] text-on-gold transition-colors hover:bg-gold-hi disabled:opacity-40"
        >
          {saving ? 'Posting…' : 'Post answer'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFailure(null);
          }}
          className="min-h-[44px] rounded-[12px] bg-tint px-4 font-semibold text-[0.875rem] text-emphasis hover:bg-line"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
