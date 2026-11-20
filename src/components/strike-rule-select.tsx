import { STRIKE_RULES, type StrikeRule } from '@/lib/strike-rules';
import { cn } from '@/lib/utils';

/**
 * Which rule a strike or flag is for (20261120120000). Nothing is chosen at first: the
 * administrator picks one, and the member sees its name.
 */
export function StrikeRuleSelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: StrikeRule | '';
  onChange: (rule: StrikeRule | '') => void;
  className?: string | undefined;
}) {
  const chosen = STRIKE_RULES.find((r) => r.id === value);
  return (
    <>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value as StrikeRule | '');
        }}
        className={cn(
          'w-full rounded-[10px] border border-line bg-paper px-2.5 py-2 text-[0.875rem] text-ink outline-none focus:border-emphasis',
          className,
        )}
      >
        <option value="">Choose a rule</option>
        {STRIKE_RULES.map((rule) => (
          <option key={rule.id} value={rule.id}>
            {rule.name}
          </option>
        ))}
      </select>
      {chosen ? (
        <p className="mt-1 text-[0.75rem] text-grey leading-[1.45]">
          {chosen.counts}
          {chosen.fine ? ` ${chosen.fine}` : ''}
        </p>
      ) : null}
    </>
  );
}
