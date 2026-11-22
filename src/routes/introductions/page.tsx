import { type RefObject, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ScreenBack } from '@/components/back-line';
import { MemberAvatar } from '@/components/member-avatar';
import { useAnnounce } from '@/lib/announce';
import { PARTNER_ROLE_NAME } from '@/lib/club-partners';
import {
  answerIntroduction,
  fetchIntroductionForMe,
  type IntroductionForMe,
} from '@/lib/introductions';

/**
 * One introduction, to one of the two a professional introduced
 * (20261029100000): who, why, and Yes or Not now. Opened from the bell.
 */
export default function IntroductionPage() {
  const { id = '' } = useParams<{ id: string }>();
  const announce = useAnnounce();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; error: string }
    | { kind: 'none' }
    | { kind: 'ready'; introduction: IntroductionForMe }
  >({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const said = useRef<HTMLParagraphElement | null>(null);
  // After an answer, focus goes to the line that replaced the buttons.
  const [answered, setAnswered] = useState(0);
  useEffect(() => {
    if (answered > 0) said.current?.focus();
  }, [answered]);

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    void fetchIntroductionForMe(id).then((result) => {
      if (!live) return;
      if (!result.ok) setState({ kind: 'error', error: result.error });
      else if (!result.value) setState({ kind: 'none' });
      else setState({ kind: 'ready', introduction: result.value });
    });
    return () => {
      live = false;
    };
  }, [id]);

  function answer(yes: boolean) {
    if (busy || state.kind !== 'ready') return;
    setBusy(true);
    setFailure(null);
    void answerIntroduction(id, yes).then(async (result) => {
      if (!result.ok) {
        setFailure(result.error);
        setBusy(false);
        return;
      }
      // Read back what the database holds: their answer, and the group if
      // that was the second yes.
      const again = await fetchIntroductionForMe(id);
      setBusy(false);
      if (again.ok && again.value) setState({ kind: 'ready', introduction: again.value });
      announce(
        !yes
          ? 'You said not now.'
          : result.value
            ? 'You both said yes. Your conversation is open.'
            : 'You said yes.',
      );
      setAnswered((n) => n + 1);
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-2 pb-3">
        <div className="mx-auto flex w-full max-w-[var(--events-measure)] flex-col">
          <ScreenBack />
          <h1 className="font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
            Introduction
          </h1>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 py-4">
        {state.kind === 'loading' ? (
          <p role="status" className="text-grey">
            Loading…
          </p>
        ) : state.kind === 'error' ? (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        ) : state.kind === 'none' ? (
          <p className="text-ink2">This introduction is not there any more.</p>
        ) : (
          <Introduction
            introduction={state.introduction}
            busy={busy}
            failure={failure}
            said={said}
            onAnswer={answer}
          />
        )}
      </div>
    </div>
  );
}

function Introduction({
  introduction: i,
  busy,
  failure,
  said,
  onAnswer,
}: {
  introduction: IntroductionForMe;
  busy: boolean;
  failure: string | null;
  said: RefObject<HTMLParagraphElement | null>;
  onAnswer: (yes: boolean) => void;
}) {
  const partnerName = i.partner?.name ?? `A ${PARTNER_ROLE_NAME.toLowerCase()} member`;
  return (
    <div className="space-y-4">
      <section aria-label="Who introduced you" className="flex items-center gap-3">
        {i.partner ? (
          <span aria-hidden="true" className="flex-none">
            <MemberAvatar
              id={i.partner.id}
              displayName={i.partner.name}
              photoPath={i.partner.photoPath}
            />
          </span>
        ) : null}
        <p className="min-w-0 text-[0.9375rem] text-ink2 leading-[1.45]">
          {i.partner ? (
            <Link to={`/peers/${i.partner.id}`} className="font-bold text-ink underline">
              {partnerName}
            </Link>
          ) : (
            <b className="text-ink">{partnerName}</b>
          )}
          {i.partner?.title ? `, ${i.partner.title},` : ''} would like to introduce you to
        </p>
      </section>

      <Link
        to={`/peers/${i.other.id}`}
        className="flex items-center gap-3 rounded-[14px] border border-line bg-paper px-3.5 py-3 hover:bg-tint"
      >
        <span aria-hidden="true" className="flex-none">
          <MemberAvatar
            id={i.other.id}
            displayName={i.other.name}
            photoPath={i.other.photoPath}
            photoAlt={i.other.photoAlt}
          />
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-[1.0625rem] text-ink">{i.other.name}</span>
          <span className="block text-[0.8125rem] text-grey">
            {i.other.username ? `@${i.other.username} · ` : ''}See their profile
          </span>
        </span>
      </Link>

      <figure className="rounded-[14px] bg-tint px-4 py-3">
        <figcaption className="font-bold text-[0.8125rem] text-grey">
          {i.partner ? `${i.partner.name.split(' ')[0]} wrote` : 'The note'}
        </figcaption>
        <blockquote className="mt-1 whitespace-pre-wrap text-[0.9375rem] text-ink leading-[1.5]">
          {i.note}
        </blockquote>
      </figure>

      <Answer introduction={i} busy={busy} said={said} onAnswer={onAnswer} />

      {failure ? (
        <p
          role="alert"
          className="rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.875rem] text-destructive leading-[1.45]"
        >
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function Answer({
  introduction: i,
  busy,
  said,
  onAnswer,
}: {
  introduction: IntroductionForMe;
  busy: boolean;
  said: RefObject<HTMLParagraphElement | null>;
  onAnswer: (yes: boolean) => void;
}) {
  const line = (text: string) => (
    <p ref={said} tabIndex={-1} className="text-[0.9375rem] text-ink2 leading-[1.5] outline-none">
      {text}
    </p>
  );

  if (i.status === 'opened') {
    return (
      <div className="space-y-3">
        {line('You both said yes.')}
        {i.threadId ? (
          <Link
            to={`/chat/t/${i.threadId}`}
            className="inline-flex min-h-[48px] items-center rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white"
          >
            Open the conversation
          </Link>
        ) : (
          <p className="text-[0.875rem] text-grey">You have left that conversation.</p>
        )}
      </div>
    );
  }
  if (i.status === 'withdrawn')
    return line(`${i.partner?.name ?? 'They'} took this introduction back.`);
  if (i.status === 'expired')
    return line('This introduction was not answered in time, and has closed.');
  if (i.status === 'declined' || i.myAnswer === false) return line('You said not now.');
  if (i.myAnswer === true)
    return line("You said yes. We'll open a conversation when you've both said yes.");

  return (
    <div className="flex flex-wrap gap-2.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onAnswer(true);
        }}
        className="min-h-[48px] flex-1 rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
      >
        Yes, introduce us
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onAnswer(false);
        }}
        className="min-h-[48px] rounded-xl bg-tint px-5 font-bold font-head text-[0.9375rem] text-emphasis hover:bg-line disabled:opacity-40"
      >
        Not now
      </button>
      <p className="w-full text-[0.8125rem] text-grey">
        If you say not now, the other member is not told.
      </p>
    </div>
  );
}
