import { ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchesOrganizationSearch } from '@/routes/admin/organizations-section';
import type { Organization } from '@/types/domain';

/**
 * Choosing an organization from a long list (the owner, 2026-11-25): one box
 * that drops down the whole list, like onboarding's "Which condition?", and
 * narrows it as you type. Yours come first, then everything else.
 *
 * An ARIA 1.2 combobox, as AddressField's: arrows move, Enter picks, Escape
 * closes. The arrow button opens the list without the phone's keyboard.
 */
interface Choice {
  value: string;
  name: string;
  town: string | null;
}

function town(organization: Organization): string | null {
  if (!organization.city) return null;
  return organization.state ? `${organization.city}, ${organization.state}` : organization.city;
}

export function OrganizationCombobox({
  id,
  label,
  labelClassName = 'block font-bold text-[0.8125rem] text-ink',
  yours,
  yoursLabel = 'Your organizations',
  others = [],
  othersLabel = 'All organizations',
  value,
  onChange,
  none,
  noneValue = '',
  placeholder = 'Choose or type to search',
  disabled = false,
  className,
}: {
  id: string;
  label: string;
  labelClassName?: string;
  yours: Organization[];
  yoursLabel?: string;
  others?: Organization[];
  othersLabel?: string;
  value: string;
  onChange: (id: string) => void;
  /** The choice with no organization, if there is one. */
  none?: string | undefined;
  noneValue?: string;
  placeholder?: string;
  disabled?: boolean;
  className: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);

  const yourIds = useMemo(() => new Set(yours.map((o) => o.id)), [yours]);
  const rest = useMemo(() => others.filter((o) => !yourIds.has(o.id)), [others, yourIds]);
  const chosen = [...yours, ...rest].find((o) => o.id === value);
  const shown = chosen?.name ?? (none !== undefined && value === noneValue ? none : '');

  const find = (query ?? '').trim();
  const sections = useMemo(() => {
    const keep = (list: Organization[]) =>
      (find === '' ? list : list.filter((o) => matchesOrganizationSearch(o, find))).map(
        (o): Choice => ({ value: o.id, name: o.name, town: town(o) }),
      );
    const out: { label: string | null; choices: Choice[] }[] = [];
    if (none !== undefined && find === '')
      out.push({ label: null, choices: [{ value: noneValue, name: none, town: null }] });
    const mine = keep(yours);
    if (mine.length > 0) out.push({ label: rest.length > 0 ? yoursLabel : null, choices: mine });
    const theirs = keep(rest);
    if (theirs.length > 0)
      out.push({ label: yours.length > 0 ? othersLabel : null, choices: theirs });
    return out;
  }, [find, none, noneValue, yours, rest, yoursLabel, othersLabel]);
  const flat = sections.flatMap((section) => section.choices);
  const expanded = open && !disabled;

  // The chosen one is where the list opens, and the arrows keep the active
  // one in view: it is the option marked selected, so a change of it reruns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: active moves the mark this finds.
  useEffect(() => {
    if (!expanded || !listBox.current) return;
    const at = listBox.current.querySelector<HTMLElement>('[aria-selected="true"]');
    if (at && 'scrollIntoView' in at) at.scrollIntoView({ block: 'nearest' });
  }, [expanded, active]);

  const openList = () => {
    setOpen(true);
    setActive(
      Math.max(
        0,
        flat.findIndex((c) => c.value === value),
      ),
    );
  };
  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const pick = (choice: Choice) => {
    onChange(choice.value);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = flat.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) {
        openList();
        return;
      }
      if (last < 0) return;
      const down = event.key === 'ArrowDown';
      setActive((at) => (down ? (at >= last ? 0 : at + 1) : at <= 0 ? last : at - 1));
    } else if (event.key === 'Enter') {
      const choice = expanded ? flat[active] : undefined;
      if (choice) {
        event.preventDefault();
        pick(choice);
      }
    } else if (event.key === 'Escape' && expanded) {
      // Not the sheet or page around it.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  let index = -1;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus leaving the box and its list closes the list.
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={shown || placeholder}
          value={query ?? shown}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onClick={() => {
            if (!expanded) openList();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={`${className} pr-10`}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={expanded ? `Close the list of organizations` : `Show all organizations`}
          onMouseDown={(event) => {
            // Keeps focus where it is, so a phone's keyboard does not open.
            event.preventDefault();
          }}
          onClick={() => {
            if (expanded) close();
            else openList();
          }}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-grey"
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {expanded ? (
        <div
          ref={listBox}
          id={listId}
          role="listbox"
          aria-label={label}
          className="mt-1 max-h-[18rem] overflow-y-auto overscroll-contain rounded-[11px] border border-line bg-paper py-1 shadow-sm"
        >
          {flat.length === 0 ? (
            <p role="status" className="px-3 py-2 text-[0.8125rem] text-grey">
              No organization matches that.
            </p>
          ) : (
            sections.map((section) => (
              // biome-ignore lint/a11y/useSemanticElements: a group of options inside a listbox, which fieldset is not.
              <div
                key={section.label ?? section.choices[0]?.value}
                role="group"
                aria-label={section.label ?? undefined}
              >
                {section.label ? (
                  <p
                    aria-hidden="true"
                    className="px-3 pt-2 pb-1 font-bold text-[0.6875rem] text-grey uppercase tracking-[0.1em]"
                  >
                    {section.label}
                  </p>
                ) : null}
                {section.choices.map((choice) => {
                  index += 1;
                  const at = index;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the box's own keys choose it (aria-activedescendant).
                    <div
                      key={choice.value}
                      id={`${listId}-${at}`}
                      role="option"
                      aria-selected={at === active}
                      tabIndex={-1}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-[0.875rem] text-ink ${
                        at === active ? 'bg-tint outline-2 outline-emphasis -outline-offset-2' : ''
                      } ${choice.value === value ? 'font-bold' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onMouseEnter={() => {
                        setActive(at);
                      }}
                      onClick={() => {
                        pick(choice);
                      }}
                    >
                      <span>{choice.name}</span>
                      {choice.town ? (
                        <span className="shrink-0 font-normal text-[0.75rem] text-grey">
                          {choice.town}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
