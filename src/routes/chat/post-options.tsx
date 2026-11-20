import { CircleHelp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ANONYMOUS_PAGE } from '@/components/member-avatar';
import { SheetGrip } from '@/components/sheet-grip';
import { standingRefusal, useAnonymousStanding } from '@/lib/chat/anonymous';
import { useDialogFocus } from '@/lib/dialog-focus';
import { type Explainer, firstTime, markSeen } from '@/lib/explainers';
import { cn } from '@/lib/utils';

/**
 * "Question" and "Anonymous", side by side on one line, with a "?" that explains them
 * (the owner, 2026-11-20: "I don't think we need to explain what post anonymously means. Nor
 * do we need to explain what this is a question means. That takes up too much space. Maybe have
 * a checkbox next to question and a checkbox next to anonymous all on the same line").
 *
 * The explanation comes up by itself the first time a member ticks Anonymous or unticks
 * Question, once per account (member_seen_explainers), and from "?" whenever they ask.
 *
 * Anonymous is offered in every discussion room except the Marketplace (20261120100000), so a
 * caller leaves it out there. When the member may not post anonymously (flagged, or paused for
 * strikes), the box is off and the line under it says the post will carry their name.
 */
export function PostOptions({
  id: given,
  question,
  anonymous,
  noun = 'post',
  className,
}: {
  id?: string;
  question?: { checked: boolean; onChange: (next: boolean) => void } | undefined;
  anonymous?: { checked: boolean; onChange: (next: boolean) => void } | undefined;
  /** What is being written, for "This post will show your name". */
  noun?: 'post' | 'reply' | 'answer';
  className?: string;
}) {
  const own = useId();
  const id = given ?? own;
  const [open, setOpen] = useState<Explainer[] | null>(null);

  const refusal = standingRefusal(useAnonymousStanding());
  const offerAnonymous = anonymous !== undefined;
  const anonymousChecked = anonymous?.checked === true;
  const anonymousChange = anonymous?.onChange;
  useEffect(() => {
    if (refusal && anonymousChecked) anonymousChange?.(false);
  }, [refusal, anonymousChecked, anonymousChange]);

  /** The first time on this account, explained without being asked. */
  function explainOnce(explainer: Explainer) {
    void firstTime(explainer).then((first) => {
      if (!first) return;
      markSeen(explainer);
      setOpen([explainer]);
    });
  }

  const asked: Explainer[] = [
    ...(offerAnonymous ? (['anonymous'] as const) : []),
    ...(question ? (['not_a_question'] as const) : []),
  ];

  return (
    <div className={cn('mt-3', className)}>
      <div className="flex min-h-[44px] flex-wrap items-center gap-x-5 gap-y-1">
        {question ? (
          <Box
            id={`${id}-question`}
            label="Question"
            checked={question.checked}
            onChange={(next) => {
              question.onChange(next);
              if (!next) explainOnce('not_a_question');
            }}
          />
        ) : null}
        {anonymous ? (
          <Box
            id={`${id}-anonymous`}
            label="Anonymous"
            checked={anonymous.checked && !refusal}
            disabled={refusal !== null}
            onChange={(next) => {
              anonymous.onChange(next);
              if (next) explainOnce('anonymous');
            }}
          />
        ) : null}
        <button
          type="button"
          aria-label={
            offerAnonymous && question
              ? 'What Question and Anonymous do'
              : offerAnonymous
                ? 'What Anonymous does'
                : 'What Question does'
          }
          onClick={() => {
            setOpen(asked);
          }}
          className="-mx-2 grid h-11 w-11 place-items-center rounded-full text-grey transition-colors hover:text-emphasis"
        >
          <CircleHelp aria-hidden="true" className="h-[1.15rem] w-[1.15rem]" />
        </button>
      </div>

      {anonymous && refusal ? (
        <p className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.45]">
          This {noun} will show your name. {refusal}{' '}
          <Link to={ANONYMOUS_PAGE} className="font-semibold text-emphasis underline">
            Why?
          </Link>
        </p>
      ) : null}

      {open ? (
        <ExplainSheet
          explainers={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Box({
  id,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-[44px] items-center gap-2 font-bold text-[0.875rem] text-ink',
        disabled ? 'cursor-not-allowed text-grey' : 'cursor-pointer',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="h-[1.15em] w-[1.15em] flex-none accent-emphasis disabled:opacity-40"
      />
      {label}
    </label>
  );
}

/** What the boxes do: one explanation, or both from "?". */
function ExplainSheet({ explainers, onClose }: { explainers: Explainer[]; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(dialog, heading, onClose);

  const both = explainers.length > 1;
  const title = both
    ? 'Question and Anonymous'
    : explainers[0] === 'anonymous'
      ? 'Posting anonymously'
      : 'Not a question';

  return createPortal(
    <div>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'fixed z-[71] flex flex-col bg-canvas',
          'inset-x-0 bottom-0 mx-auto max-h-[88%] max-w-[480px] rounded-t-3xl shadow-[0_-14px_40px_rgba(10,20,35,.3)]',
          'lg:bottom-auto lg:top-1/2 lg:max-h-[82%] lg:w-[520px] lg:max-w-none',
          'lg:-translate-y-1/2 lg:rounded-3xl lg:shadow-[0_24px_60px_rgba(10,20,35,.35)]',
        )}
      >
        <SheetGrip sheet={dialog} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-[18px] pt-1 pb-4 lg:pt-5">
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="font-extrabold font-head text-[1.3125rem] text-ink tracking-[-0.01em] outline-none"
          >
            {title}
          </h2>
          {explainers.includes('not_a_question') ? (
            <Part heading={both ? 'Question' : null}>
              <p>
                Questions are shown larger on Home, so more people see them and answer. Untick it
                for a tip, a story or news: it is shown as an ordinary post.
              </p>
            </Part>
          ) : null}
          {explainers.includes('anonymous') ? (
            <Part heading={both ? 'Anonymous' : null}>
              <p>
                Everybody sees “Anonymous” instead of your name and photo, administrators included.
                Only you see “You” beside it. When you answer under your own anonymous question, you
                show as “Anonymous · Asker”.
              </p>
              <p className="mt-2">
                The club’s rules still apply. An administrator can flag an anonymous post: it is
                hidden, you are told why, and it counts as a strike. After one flag you can’t post
                anonymously for a month, and after two within 12 months, for three months.
              </p>
              <p className="mt-2">
                Three strikes of any kind within 12 months pause your membership for 30 days, and
                after that you can never post anonymously again.
              </p>
              <Link
                to={ANONYMOUS_PAGE}
                onClick={onClose}
                className="mt-2 inline-block font-semibold text-emphasis underline"
              >
                More about anonymous posts
              </Link>
            </Part>
          ) : null}
        </div>
        <div className="flex-none border-line border-t px-[18px] pt-3 pb-6 lg:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white transition-colors hover:bg-action-hi"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Part({ heading, children }: { heading: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-3 text-[0.9375rem] text-ink2 leading-[1.55]">
      {heading ? (
        <h3 className="mb-1 font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
          {heading}
        </h3>
      ) : null}
      {children}
    </section>
  );
}
