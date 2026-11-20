import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  type AddressSuggestion,
  narrowSuggestions,
  rememberedSuggestions,
  SUGGEST_AFTER,
  SUGGEST_DELAY_MS,
  type SuggestionKind,
  suggestAddresses,
} from '@/lib/address-suggestions';

/**
 * Scrolls the suggestions up into what the on-screen keyboard leaves visible
 * (the owner, 2026-11-20: adding an event and an organization on a phone, no
 * suggestions were seen; they were drawn under the keyboard). Only as far as
 * keeps the box itself in sight. `view` is the visual viewport, which shrinks
 * to the part above the keyboard; the rectangles are the layout viewport's.
 */
export function revealAboveKeyboard(
  list: HTMLElement,
  box: HTMLElement | null,
  view: Pick<VisualViewport, 'offsetTop' | 'height'> | null = window.visualViewport,
): void {
  const top = view ? view.offsetTop : 0;
  const bottom = view ? view.offsetTop + view.height : window.innerHeight;
  const over = list.getBoundingClientRect().bottom - bottom;
  if (over <= 0) return;
  const room = box ? box.getBoundingClientRect().top - top - 8 : over + 8;
  const by = Math.min(over + 8, room);
  if (by <= 0) return;
  let scroller: HTMLElement | null = list.parentElement;
  while (scroller) {
    const { overflowY } = getComputedStyle(scroller);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      scroller.scrollHeight > scroller.clientHeight
    )
      break;
    scroller = scroller.parentElement;
  }
  (scroller ?? document.scrollingElement ?? document.documentElement).scrollBy({ top: by });
}

/**
 * A street address box that suggests addresses as it is typed: the WAI-ARIA
 * 1.2 combobox with a list, nothing chosen until arrows or a tap pick one.
 * Typing freely always works; if Photon fails, it is a plain box.
 */
export function AddressField({
  label,
  value,
  onChange,
  onPick,
  className,
  describedBy,
  maxLength,
  placeholder,
  suggest = true,
  kind = 'address',
}: {
  label: ReactNode;
  value: string;
  onChange: (text: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
  className: string;
  describedBy?: string;
  maxLength?: number;
  placeholder?: string;
  /** False: a plain box, nothing sent (an online event's "On Zoom"). */
  suggest?: boolean;
  /** Street addresses, or cities ('city': the city and its state). */
  kind?: SuggestionKind;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const asking = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [said, setSaid] = useState('');

  const stop = () => {
    clearTimeout(timer.current);
    asking.current?.abort();
    asking.current = null;
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      asking.current?.abort();
    },
    [],
  );

  const noun = (count: number) =>
    kind === 'city' ? (count === 1 ? 'city' : 'cities') : count === 1 ? 'address' : 'addresses';

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const ask = (typed: string) => {
    stop();
    setActive(-1);
    if (!suggest || typed.trim().length < SUGGEST_AFTER) {
      setSuggestions([]);
      setOpen(false);
      setSaid('');
      return;
    }
    const show = (list: AddressSuggestion[]) => {
      setSuggestions(list);
      const shown = list.length > 0 && document.activeElement === input.current;
      setOpen(shown);
      setSaid(
        shown ? `${list.length} ${noun(list.length)} suggested. Up and down arrows to choose.` : '',
      );
    };
    // Already answered: at once, nothing asked.
    const known = rememberedSuggestions(typed, kind);
    if (known) {
      show(known);
      return;
    }
    // Meanwhile, those shown that still fit, so typing on narrows at once.
    setSuggestions((shown) => narrowSuggestions(shown, typed));
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      asking.current = controller;
      void suggestAddresses(typed, controller.signal, kind).then((found) => {
        if (asking.current !== controller) return;
        asking.current = null;
        show(found ?? []);
      });
    }, SUGGEST_DELAY_MS);
  };

  const pick = (suggestion: AddressSuggestion) => {
    stop();
    onPick(suggestion);
    setSuggestions([]);
    close();
    setSaid(`Filled in ${suggestion.line}.`);
    input.current?.focus();
  };

  const expanded = open && suggestions.length > 0;
  useEffect(() => {
    // Again when a longer list arrives while it is open.
    if (expanded && suggestions.length > 0 && listBox.current)
      revealAboveKeyboard(listBox.current, input.current);
  }, [expanded, suggestions]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = suggestions.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (last < 0) return;
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!expanded) {
        setOpen(true);
        setActive(event.altKey ? -1 : down ? 0 : last);
        return;
      }
      if (event.altKey) return;
      setActive((at) => (down ? (at >= last ? 0 : at + 1) : at <= 0 ? last : at - 1));
    } else if (event.key === 'Enter') {
      const chosen = expanded ? suggestions[active] : undefined;
      if (chosen) {
        event.preventDefault();
        pick(chosen);
      }
    } else if (event.key === 'Escape') {
      if (expanded) {
        // Not the sheet or page around it.
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus leaving the box and its list closes the list.
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <label className="text-ink">
        {label}
        <input
          ref={input}
          className={className}
          maxLength={maxLength}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            ask(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {expanded ? (
        <div ref={listBox} className="mt-1 rounded-[11px] border border-line bg-paper shadow-sm">
          <div
            id={listId}
            role="listbox"
            aria-label={kind === 'city' ? 'Suggested cities' : 'Suggested addresses'}
            className="py-1"
          >
            {suggestions.map((suggestion, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the box's own keys choose it (aria-activedescendant).
              <div
                key={suggestion.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-label={suggestion.name ? `${suggestion.name}, ${suggestion.line}` : undefined}
                tabIndex={-1}
                className={`flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-1.5 text-[0.9375rem] text-ink ${
                  index === active ? 'bg-tint outline-2 outline-emphasis -outline-offset-2' : ''
                }`}
                onMouseDown={(event) => {
                  // Keeps focus in the box, so the list is not closed first.
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  pick(suggestion);
                }}
              >
                {suggestion.name ? <span className="font-bold">{suggestion.name}</span> : null}
                <span>{suggestion.line}</span>
              </div>
            ))}
          </div>
          {/* OpenStreetMap's licence (ODbL) asks for the credit; links reached by Tab. */}
          <p className="border-line border-t px-3 py-1.5 text-[0.8125rem] text-grey">
            Suggestions:{' '}
            <a
              className="text-emphasis underline"
              href="https://photon.komoot.io"
              target="_blank"
              rel="noreferrer"
              data-target="small"
            >
              Photon
            </a>
            , ©{' '}
            <a
              className="text-emphasis underline"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              data-target="small"
            >
              OpenStreetMap contributors
            </a>
          </p>
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {said}
      </span>
    </div>
  );
}
