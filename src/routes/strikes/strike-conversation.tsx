import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeThrown } from '@/lib/describe-error';
import {
  loadStrikeConversation,
  replyAboutStrike,
  STRIKE_MESSAGE_MAX,
  type StrikeKind,
  type StrikeMessage,
  type StrikeSummary,
  withdrawFlag,
  withdrawNamedStrike,
} from '@/lib/strike-conversations';
import { strikeRule } from '@/lib/strike-rules';
import { cn } from '@/lib/utils';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function moment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A strike or a flag, and the conversation about it (20261120120000; the owner, 2026-11-20).
 * The member it is against reads it on its own page, or on the paused screen; administrators
 * read it from Admin → Reports or a notice, answer, and can withdraw it from here.
 */
export function StrikeConversation({
  kind,
  id,
  isAdmin,
}: {
  kind: StrikeKind;
  id: string;
  isAdmin: boolean;
}) {
  const [summary, setSummary] = useState<StrikeSummary | null>(null);
  const [messages, setMessages] = useState<StrikeMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadStrikeConversation(kind, id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSummary(result.value.summary);
    setMessages(result.value.messages);
  }, [kind, id]);

  useEffect(() => {
    void load().catch((e: unknown) => {
      setError(describeThrown(e, 'Could not load this strike.'));
    });
  }, [load]);

  if (error && !summary) {
    return (
      <p role="alert" className="mt-6 text-[0.875rem] text-destructive leading-[1.5]">
        {error}
      </p>
    );
  }
  if (!summary) return <p className="mt-6 text-[0.875rem] text-grey">Loading…</p>;

  const rule = strikeRule(summary.rule);
  const admin = isAdmin && !summary.mine;
  const flag = kind === 'flag';

  return (
    <div>
      <p className="font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
        {flag ? 'Flag on an anonymous post' : 'Strike'}
      </p>
      <h1 className="mt-1 font-display font-extrabold text-[1.5rem] text-ink leading-tight tracking-[-0.01em]">
        {rule?.name ?? 'A strike'}
      </h1>
      <p className="mt-1 text-[0.8125rem] text-grey">
        {day(summary.givenAt)}
        {admin && summary.memberName ? ` · ${summary.memberName}` : ''}
        {admin && flag ? ' · Writer not shown' : ''}
        {summary.withdrawnAt ? '' : ' · Counts as a strike'}
      </p>

      {summary.withdrawnAt ? (
        <div className="mt-4 rounded-[14px] border border-line bg-paper p-3.5">
          <p className="font-bold text-[0.875rem] text-ink">
            Withdrawn on {day(summary.withdrawnAt)}. It no longer counts.
          </p>
          {summary.withdrawnReason ? (
            <p className="mt-1 text-[0.84375rem] text-ink2 leading-[1.5]">
              “{summary.withdrawnReason}”
            </p>
          ) : null}
        </div>
      ) : null}

      <Heading>Reason given</Heading>
      <p className="mt-1.5 text-[0.9375rem] text-ink leading-[1.55]">“{summary.reason}”</p>

      {flag && summary.words !== null ? (
        <>
          <Heading>{summary.mine ? 'Your post' : 'The post'}</Heading>
          {summary.place ? (
            <p className="mt-1.5 text-[0.8125rem] text-grey">
              In “
              {summary.withdrawnAt && summary.url ? (
                <Link to={summary.url} className="font-semibold text-emphasis underline">
                  {summary.place}
                </Link>
              ) : (
                summary.place
              )}
              ”{summary.withdrawnAt ? '' : ' · hidden'}
            </p>
          ) : null}
          <p className="mt-1.5 whitespace-pre-wrap rounded-[12px] border border-line bg-paper px-3 py-2.5 text-[0.875rem] text-ink2 leading-[1.5]">
            {summary.words || 'Photographs only.'}
          </p>
        </>
      ) : null}

      {rule && rule.id !== 'other' ? (
        <>
          <Heading>The rule</Heading>
          <p className="mt-1.5 text-[0.875rem] text-ink2 leading-[1.55]">{rule.counts}</p>
          {rule.fine ? (
            <p className="mt-1 text-[0.875rem] text-ink2 leading-[1.55]">{rule.fine}</p>
          ) : null}
        </>
      ) : null}

      <Heading>Conversation</Heading>
      <p className="mt-1.5 text-[0.84375rem] text-ink2 leading-[1.5]">
        {admin
          ? flag
            ? 'The writer reads your answer signed “An administrator”. You never see who they are.'
            : `${summary.memberName ?? 'The member'} reads your answer signed “An administrator”. Every administrator can read and answer here.`
          : flag
            ? 'Tell the administrators your side. Every administrator can read it, and none of them can see who you are. They answer as “An administrator”.'
            : 'Tell the administrators your side. Every administrator can read it, and they answer as “An administrator”.'}
      </p>

      {messages.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                'max-w-[88%] rounded-[14px] px-3 py-2.5',
                // The reader's side on the right: the member's, or the administrators'.
                message.fromMember === summary.mine
                  ? 'self-end bg-tint text-ink'
                  : 'self-start border border-line bg-paper text-ink',
              )}
            >
              <p className="font-bold text-[0.75rem] text-grey">
                {message.author} · {moment(message.createdAt)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[0.9rem] leading-[1.5]">
                {message.body}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <ReplyBox
        kind={kind}
        id={id}
        label={admin ? 'Your answer' : 'Your side'}
        onSent={() => {
          void load();
        }}
      />

      {admin && !summary.withdrawnAt ? (
        <WithdrawPanel
          kind={kind}
          id={id}
          onDone={() => {
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
      {children}
    </h2>
  );
}

function ReplyBox({
  kind,
  id,
  label,
  onSent,
}: {
  kind: StrikeKind;
  id: string;
  label: string;
  onSent: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = text.trim() !== '' && !sending;

  return (
    <div className="mt-4">
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <textarea
        id={fieldId}
        value={text}
        rows={3}
        maxLength={STRIKE_MESSAGE_MAX}
        placeholder={label}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="min-h-[5em] w-full resize-y rounded-[13px] border-[1.6px] border-line bg-canvas px-[13px] py-[10px] text-[0.9375rem] text-ink leading-[1.45] outline-none focus:border-emphasis focus:bg-paper"
      />
      {failure ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {failure}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          setSending(true);
          setFailure(null);
          void replyAboutStrike(kind, id, text.trim())
            .then((result) => {
              if (!result.ok) {
                setFailure(result.error);
                return;
              }
              setText('');
              onSent();
            })
            .finally(() => {
              setSending(false);
            });
        }}
        className="mt-2 min-h-[48px] w-full rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white transition-colors hover:bg-action-hi disabled:opacity-40"
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

function WithdrawPanel({ kind, id, onDone }: { kind: StrikeKind; id: string; onDone: () => void }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-6 min-h-[44px] w-full rounded-xl border-[1.6px] border-line px-5 font-bold font-head text-[0.9375rem] text-ink2"
      >
        {kind === 'flag' ? 'Withdraw the flag' : 'Withdraw the strike'}
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-[14px] border border-line bg-paper p-3.5">
      <p className="font-extrabold font-head text-[0.9375rem] text-ink">
        {kind === 'flag' ? 'Withdraw this flag?' : 'Withdraw this strike?'}
      </p>
      <p className="mt-1 text-[0.84375rem] text-ink2 leading-[1.5]">
        {kind === 'flag'
          ? 'The post comes back as it was. The strike no longer counts, and what it caused is undone: the pause on anonymous posting, and the 30-day pause if it caused one. The writer is told your reason.'
          : 'It stops counting, and a 30-day pause it caused is lifted. It stays on the record, and the member is told your reason.'}
      </p>
      <label htmlFor={fieldId} className="mt-3 block font-semibold text-[0.75rem] text-ink">
        Why are you withdrawing it?
      </label>
      <input
        id={fieldId}
        value={reason}
        maxLength={500}
        onChange={(event) => {
          setReason(event.target.value);
        }}
        className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-2.5 py-2 text-[0.875rem] text-ink outline-none focus:border-emphasis"
      />
      {failure ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {failure}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason('');
          }}
          className="min-h-[44px] rounded-xl bg-tint px-4 font-bold font-head text-[0.875rem] text-emphasis"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || reason.trim() === ''}
          onClick={() => {
            setBusy(true);
            setFailure(null);
            const done =
              kind === 'flag'
                ? withdrawFlag(id, reason.trim())
                : withdrawNamedStrike(id, reason.trim());
            void done
              .then((result) => {
                if (!result.ok) {
                  setFailure(result.error);
                  return;
                }
                setOpen(false);
                onDone();
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          className="min-h-[44px] flex-1 rounded-xl bg-action px-4 font-bold font-head text-[0.875rem] text-white disabled:opacity-40"
        >
          {busy ? 'Withdrawing…' : 'Withdraw it'}
        </button>
      </div>
    </div>
  );
}
