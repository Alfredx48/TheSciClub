import { Bold, Eye, Heading, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { linkedPaste, pasteInto } from '@/lib/paste-links';
import { cn } from '@/lib/utils';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { readLink } from '@/routes/events/event-draft';
import { EventDescription } from '@/routes/events/rich-text';

/**
 * "About it", with a formatting toolbar (the owner, 2026-10-10).
 *
 * The buttons write a small Markdown into the box (lib/markdown.ts says which),
 * so what is saved is still text: it fits save_event as it was, a screen reader
 * reads the box as an ordinary field, and dictation and switch control fill it
 * as they fill any other. A rich-text editor would be none of those.
 *
 * Bold, italic, a heading, two kinds of list and a link — not a font or a
 * size. Text in the club follows the member's own size setting and never
 * shrinks (HANDOFF "Accessibility over brand"), and a heading is how a long
 * description is split up without fighting that.
 *
 * Every button acts on the selection: it wraps the words chosen, or, with
 * nothing chosen, puts in an example and selects it to be typed over. Link
 * asks for the address in a field beside the toolbar rather than a browser
 * prompt, which a screen reader announces poorly and a phone draws badly.
 *
 * Preview shows the description as members will see it, through the same
 * renderer and allowlist as the event page.
 *
 * `mentions` suggests members after an "@", for a topic's first post.
 */
export function DescriptionEditor({
  id,
  value,
  maxLength,
  placeholder,
  hintClassName,
  onChange,
  onPaste,
  mentions = false,
  countFrom,
}: {
  id: string;
  value: string;
  maxLength: number;
  placeholder: string;
  hintClassName: string;
  onChange: (value: string) => void;
  /** For pictures pasted in (lib/paste-photos.ts); words paste as ever. */
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Suggest members after an "@" (20261029070000). */
  mentions?: boolean;
  /** Say how many characters are left only once it is this few. Always, without it. */
  countFrom?: number;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const linkField = useRef<HTMLInputElement | null>(null);
  // Where to put the cursor after a change, applied once the new text is drawn.
  const pending = useRef<Edit | null>(null);
  const [linking, setLinking] = useState<{ start: number; end: number } | null>(null);
  const [address, setAddress] = useState('');
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const mention = useMentionSuggestions({ box, value, onChange, enabled: mentions });

  useLayoutEffect(() => {
    const edit = pending.current;
    const el = box.current;
    if (!edit || !el) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(edit.start, edit.end);
  });

  function selection(): { start: number; end: number } {
    const el = box.current;
    return el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : { start: value.length, end: value.length };
  }

  function apply(edit: Edit) {
    if (edit.value.length > maxLength) return;
    pending.current = edit;
    onChange(edit.value);
  }

  function startLink() {
    setLinking(selection());
    setAddress('');
    setLinkProblem(null);
    // After it is drawn.
    requestAnimationFrame(() => linkField.current?.focus());
  }

  function addLink() {
    if (!linking) return;
    const read = readLink(address);
    if (!read.ok || !read.url) {
      setLinkProblem('Type a web address, like norcalsci.org/signup.');
      return;
    }
    setLinking(null);
    apply(insertLink(value, linking.start, linking.end, read.url));
  }

  const button =
    'grid h-11 w-11 flex-none place-items-center rounded-[10px] text-emphasis transition-colors hover:bg-tint aria-pressed:bg-tint';

  return (
    <>
      <fieldset className="mt-1.5 flex flex-wrap items-center gap-0.5 rounded-t-[12px] border-[1.6px] border-line border-b-0 bg-paper px-1 py-0.5">
        <legend className="sr-only">Formatting</legend>
        <ToolButton
          label="Bold"
          className={button}
          onClick={() => {
            const { start, end } = selection();
            apply(wrap(value, start, end, '**', 'bold words'));
          }}
        >
          <Bold className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label="Italic"
          className={button}
          onClick={() => {
            const { start, end } = selection();
            apply(wrap(value, start, end, '*', 'italic words'));
          }}
        >
          <Italic className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label="Heading"
          className={button}
          onClick={() => {
            const { start, end } = selection();
            apply(prefixLines(value, start, end, () => '## ', 'Heading'));
          }}
        >
          <Heading className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label="Bulleted list"
          className={button}
          onClick={() => {
            const { start, end } = selection();
            apply(prefixLines(value, start, end, () => '- ', 'List item'));
          }}
        >
          <List className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          className={button}
          onClick={() => {
            const { start, end } = selection();
            apply(prefixLines(value, start, end, (n) => `${n}. `, 'List item'));
          }}
        >
          <ListOrdered className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Link" className={button} onClick={startLink}>
          <Link2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolButton>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => {
            setPreview((p) => !p);
          }}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-2.5 font-semibold text-[0.84375rem] text-emphasis transition-colors hover:bg-tint aria-pressed:bg-tint"
        >
          <Eye className="h-[17px] w-[17px]" aria-hidden="true" />
          Preview
        </button>
      </fieldset>

      {linking ? (
        <div className="flex flex-wrap items-center gap-2 border-[1.6px] border-line border-b-0 bg-tint/40 px-2.5 py-2">
          <label htmlFor={`${id}-link`} className="font-semibold text-[0.8125rem] text-ink">
            Web address
          </label>
          <input
            id={`${id}-link`}
            ref={linkField}
            value={address}
            inputMode="url"
            onChange={(e) => {
              setAddress(e.target.value);
              setLinkProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLink();
              }
              if (e.key === 'Escape') setLinking(null);
            }}
            aria-invalid={linkProblem ? true : undefined}
            aria-describedby={linkProblem ? `${id}-link-problem` : undefined}
            placeholder="norcalsci.org/signup"
            className="min-h-[40px] min-w-0 flex-1 basis-[12em] rounded-[10px] border-[1.6px] border-line bg-paper px-3 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
          />
          <button
            type="button"
            onClick={addLink}
            className="min-h-[40px] rounded-[10px] bg-action px-3.5 font-bold font-head text-[0.875rem] text-white"
          >
            Add link
          </button>
          <button
            type="button"
            onClick={() => {
              setLinking(null);
              box.current?.focus();
            }}
            className="min-h-[40px] rounded-[10px] px-2.5 font-semibold text-[0.875rem] text-ink2"
          >
            Cancel
          </button>
          {linkProblem ? (
            <p
              id={`${id}-link-problem`}
              role="alert"
              className="w-full text-[0.78125rem] text-destructive"
            >
              {linkProblem}
            </p>
          ) : null}
        </div>
      ) : null}

      <textarea
        id={id}
        ref={box}
        value={value}
        rows={7}
        maxLength={maxLength}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (event.defaultPrevented) return;
          // Copied words keep their links (lib/paste-links.ts).
          const linked = linkedPaste(event.clipboardData);
          if (linked === null) return;
          event.preventDefault();
          pasteInto(event.currentTarget, linked);
        }}
        {...(mentions ? mention.boxProps : {})}
        onKeyDown={(e) => {
          mention.onKeyDown(e);
        }}
        aria-describedby={`${id}-hint`}
        placeholder={placeholder}
        className="w-full rounded-b-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[0.9375rem] text-ink leading-[1.5] outline-none focus:border-emphasis"
      />
      {mentions ? mention.list : null}
      <p id={`${id}-hint`} className={hintClassName}>
        Select words, then a button to format them.
        {countFrom === undefined || maxLength - value.length <= countFrom
          ? ` ${maxLength - value.length} characters left.`
          : null}
      </p>

      {preview ? (
        <section
          aria-label="Preview"
          className="mt-2 rounded-[12px] border border-line border-dashed px-3.5 py-2.5"
        >
          <p className="font-bold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
            Preview
          </p>
          {value.trim() ? (
            <EventDescription
              html=""
              text={value}
              className="mt-1 text-[0.8875rem] text-ink leading-[1.52] [&_a]:text-emphasis [&_a]:underline [&_h3]:mt-3.5 [&_h3]:font-extrabold [&_h3]:font-head [&_h3]:text-[1rem] [&_li]:ml-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_p]:mt-2.5 [&_ul]:mt-2 [&_ul]:list-disc"
            />
          ) : (
            <p className="mt-1 text-[0.8125rem] text-grey">Nothing written yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}

function ToolButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep the selection in the box: a pressed button would otherwise take
      // focus before the click reads where the selection was.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(className)}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ the edits */

/** The text after an edit, and what to select in it. */
export interface Edit {
  value: string;
  start: number;
  end: number;
}

/**
 * Wrap the selection in `marker` (** for bold, * for italic). With nothing
 * selected, put in `example` wrapped, and select the example to type over.
 * Spaces at the edges of a selection stay outside the markers, which Markdown
 * needs ("** word**" is not bold).
 */
export function wrap(
  value: string,
  start: number,
  end: number,
  marker: string,
  example: string,
): Edit {
  let from = start;
  let to = end;
  while (from < to && value[from] === ' ') from += 1;
  while (to > from && value[to - 1] === ' ') to -= 1;
  const inner = from === to ? example : value.slice(from, to);
  const next = `${value.slice(0, from)}${marker}${inner}${marker}${value.slice(to)}`;
  return { value: next, start: from + marker.length, end: from + marker.length + inner.length };
}

/**
 * Start every line the selection touches with a prefix: "## " for a
 * heading, "- " for a bullet, "1. ", "2. " for a numbered list. With an empty
 * line, put in `example` after the prefix and select it.
 */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: (n: number) => string,
  example: string,
): Edit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start));
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  if (lines.length === 1 && !lines[0]?.trim()) {
    const p = prefix(1);
    const next = `${value.slice(0, lineStart)}${p}${example}${value.slice(lineEnd)}`;
    return { value: next, start: lineStart + p.length, end: lineStart + p.length + example.length };
  }
  const changed = lines
    .map((line, i) => (line.trim() ? `${prefix(i + 1)}${line}` : line))
    .join('\n');
  const next = `${value.slice(0, lineStart)}${changed}${value.slice(lineEnd)}`;
  return { value: next, start: lineStart, end: lineStart + changed.length };
}

/**
 * Make the selection a link to `url`. With nothing selected, the address
 * itself is the words, selected so it can be typed over.
 */
export function insertLink(value: string, start: number, end: number, url: string): Edit {
  const words = value.slice(start, end).trim() || url.replace(/^https?:\/\//, '');
  const piece = `[${words}](${url})`;
  const next = `${value.slice(0, start)}${piece}${value.slice(end)}`;
  return { value: next, start: start + 1, end: start + 1 + words.length };
}
