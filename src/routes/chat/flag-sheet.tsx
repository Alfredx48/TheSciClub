import { useId, useRef, useState } from 'react';
import { SheetGrip } from '@/components/sheet-grip';
import { StrikeRuleSelect } from '@/components/strike-rule-select';
import { describeThrown } from '@/lib/describe-error';
import { useDialogFocus } from '@/lib/dialog-focus';
import type { StrikeRule } from '@/lib/strike-rules';

/** As chat_flag_anonymous_post allows. */
const REASON_MAX = 500;

/**
 * An administrator flags an anonymous post (20261120110000; the owner, 2026-11-20). The post is
 * hidden, the flag is a strike against whoever wrote it, and they are told the reason written
 * here, so it is required. The administrator never learns who it was.
 *
 * ReportSheet's geometry, three ways out (close, backdrop, Escape) and focus handling.
 */
export function FlagSheet({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  /** Resolves to null on success, or to a sentence to show. */
  onSend: (reason: string, rule: StrikeRule) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [rule, setRule] = useState<StrikeRule | ''>('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const titleId = useId();
  const reasonId = useId();
  const ruleId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(dialog, heading, onCancel);

  const ready = rule !== '' && reason.trim() !== '' && reason.trim().length <= REASON_MAX;

  function send() {
    if (sending || !ready) return;
    setSending(true);
    setFailure(null);
    void onSend(reason.trim(), rule)
      .then((said) => {
        if (said) setFailure(said);
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSending(false);
      });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close without flagging"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 z-[70] bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 z-[71] flex max-h-[88%] flex-col rounded-t-3xl bg-paper shadow-[0_-14px_40px_rgba(10,20,35,.3)] lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:max-h-[82%] lg:w-[520px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:shadow-[0_24px_60px_rgba(10,20,35,.35)]"
      >
        <SheetGrip sheet={dialog} onClose={onCancel} />

        <div className="flex-1 overflow-y-auto px-[18px] pt-1 pb-4 lg:pt-5">
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="font-extrabold font-head text-[1.3125rem] text-ink tracking-[-0.01em] outline-none"
          >
            Flag this anonymous post
          </h2>
          <p className="mt-2 text-[0.84375rem] text-ink2 leading-[1.55]">
            It is hidden at once (replies to it stay), and whoever wrote it is told your reason, not
            who flagged it. You will not learn who it was.
          </p>
          <p className="mt-2 text-[0.84375rem] text-ink2 leading-[1.55]">
            It counts as a strike against them, and stops their anonymous posting: for a month after
            a first flag, three months after a second. If it is their third strike, their membership
            pauses for 30 days. To hide it without a strike, remove it instead.
          </p>

          <label
            htmlFor={ruleId}
            className="mt-4 block font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]"
          >
            Which rule it breaks
          </label>
          <StrikeRuleSelect id={ruleId} value={rule} onChange={setRule} className="mt-2" />

          <label
            htmlFor={reasonId}
            className="mt-4 block font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]"
          >
            Why it is flagged
          </label>
          <p className="mt-1 text-[0.75rem] text-grey leading-[1.45]">
            Required. The writer reads this, word for word, and can respond to the administrators.
          </p>
          <textarea
            id={reasonId}
            value={reason}
            rows={3}
            maxLength={REASON_MAX}
            placeholder="What breaks the club's rules"
            onChange={(event) => {
              setReason(event.target.value);
            }}
            className="mt-2 min-h-[5em] w-full resize-y rounded-[13px] border-[1.6px] border-line bg-canvas px-[13px] py-[10px] text-[0.9375rem] text-ink leading-[1.45] outline-none focus:border-emphasis focus:bg-paper"
          />

          {failure ? (
            <p
              role="alert"
              className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
            >
              {failure} Nothing has been flagged, and your words are still here.
            </p>
          ) : null}
        </div>

        <div className="flex flex-none items-center justify-between gap-2.5 border-line border-t px-[18px] pt-3 pb-6 lg:pb-4">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] rounded-xl bg-tint px-5 font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-line"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !ready}
            className="min-h-[48px] flex-1 rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white transition-colors hover:bg-action-hi disabled:opacity-40"
          >
            {sending ? 'Flagging…' : 'Flag and hide'}
          </button>
        </div>
      </div>
    </>
  );
}
