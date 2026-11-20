/**
 * "Post anonymously", offered wherever a member starts a topic or replies in a
 * discussion room, never in the Marketplace (20261120100000; the owner,
 * 2026-11-20). The words say exactly who still knows: administrators.
 *
 * A native checkbox inside its label, as QuestionSwitch: the whole row is the
 * target, and a screen reader hears one control with its explanation.
 */
export function AnonymousSwitch({
  checked,
  onChange,
  id = 'post-anonymously',
  compact = false,
  label = 'Post anonymously',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
  /** One line, over a reply box or in the quick box: no card. */
  compact?: boolean;
  label?: string;
}) {
  if (compact) {
    return (
      <label
        htmlFor={id}
        className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.875rem] text-ink"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          aria-describedby={`${id}-hint`}
          className="h-[1.15em] w-[1.15em] flex-none accent-emphasis"
        />
        <span>
          <span className="font-bold">{label}</span>
          <span id={`${id}-hint`} className="text-grey">
            {' '}
            · other members see “Anonymous”; administrators see your name
          </span>
        </span>
      </label>
    );
  }
  return (
    <label
      htmlFor={id}
      className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[13px] border-[1.6px] border-line bg-paper px-3.5 py-3 has-[:checked]:border-emphasis has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emphasis has-[:focus-visible]:outline-offset-2"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        aria-describedby={`${id}-hint`}
        className="mt-[0.2em] h-[1.15em] w-[1.15em] flex-none accent-emphasis outline-none"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold font-head text-[0.9375rem] text-ink">{label}</span>
        <span id={`${id}-hint`} className="mt-0.5 block text-[0.8125rem] text-ink2 leading-[1.45]">
          Other members see “Anonymous” instead of your name. Administrators can still see it is
          you.
        </span>
      </span>
    </label>
  );
}
