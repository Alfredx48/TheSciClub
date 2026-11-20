import {
  Bold,
  Eye,
  Heading,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useAnnounce } from '@/lib/announce';
import {
  attachmentProblem,
  deleteAttachments,
  MAX_ATTACHMENTS,
  uploadAttachments,
  useSmallCopies,
} from '@/lib/chat/attachments';
import { forgetHandedPhotos, handedPhotos, readKeptDraft, writeDraft } from '@/lib/chat/drafts';
import { photoPaths } from '@/lib/markdown';
import { roundTrips } from '@/lib/markdown-doc';
import type { MentionScope } from '@/lib/mentions';
import { pastedImages } from '@/lib/paste-photos';
import { noteSent } from '@/lib/push/notifications';
import { cn } from '@/lib/utils';
import {
  type ComposerEditing,
  type ComposerReplyingTo,
  excerpt,
  focusAfterEdit,
} from '@/routes/chat/composer';
import { DraftStatus, type DraftStorage } from '@/routes/chat/draft-status';
import { LocalPhotos } from '@/routes/chat/local-photos';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { POST_TEXT, PostBody } from '@/routes/chat/post-body';
import { PostOptions } from '@/routes/chat/post-options';
import { type Format, RichEditor, type RichEditorHandle } from '@/routes/chat/rich-editor';
import { insertLink, prefixLines, wrap } from '@/routes/events/description-editor';
import { readLink } from '@/routes/events/event-draft';

/**
 * The reply box at the foot of a topic, and the box a post there is edited in
 * (the owner, 2026-11-19: "a rich text reply box with a preview button",
 * "Whenever someone taps reply anywhere it should be a rich text box", posts
 * in rooms only; a direct conversation keeps Composer).
 *
 * The words are written as they will look (rich-editor.tsx), or, with the M↓
 * switch, as Markdown, which is what is saved either way ("allow for people
 * to enter raw markdown"). The switch is remembered on this device. Preview
 * draws the post as members will see it.
 *
 * Photographs go in the words, where they were pasted, dropped or chosen
 * ("They stay where you pasted them in"), as a line `![Photo](path)` naming
 * one of the post's attachments, still four at most. Until Send they are the
 * member's files, named "local:1"…; Send uploads those still in the words, in
 * order, to `folder`, names them by their paths, and only then writes the
 * post; a refused post takes them back out.
 *
 * It sits at the end of the topic, below the last reply, and scrolls with it
 * (the owner, 2026-11-19); Reply and Edit bring it into view.
 *
 * As Composer: a draft kept on this device (photographs not, as files are
 * not kept), put aside while a post is edited; Escape cancels an edit; an
 * unchanged edit just closes. A post only added to (20261029260000) whose
 * words the editor would write differently, and a question's title, are
 * edited as Markdown.
 */

const MODE_KEY = 'club:post-editor';
const LOCAL_PHOTO = /^\s*!\[[^\]\n]*\]\((local:[^)\s]+)\)\s*$/;

/** A post being edited here: Composer's, with the photographs added as paths. */
export interface PostEditing extends Omit<ComposerEditing, 'onSave' | 'addPhotos'> {
  /** Its photographs now, in order. */
  attachments: readonly string[];
  /** A question's title: words only, no formatting. */
  plain?: boolean;
  /**
   * `added` uploaded; `kept` the photographs it keeps when some were taken
   * out (20261119150000), or null when it keeps them all.
   */
  onSave: (body: string, added: string[], kept: string[] | null) => Promise<string | null>;
}

function readMode(): 'rich' | 'markdown' {
  try {
    return localStorage.getItem(MODE_KEY) === 'markdown' ? 'markdown' : 'rich';
  } catch {
    return 'rich';
  }
}

function saveMode(mode: 'rich' | 'markdown') {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Remembered for this visit only.
  }
}

/** A draft's words without photographs whose files are gone. */
function withoutLocalPhotos(text: string): string {
  return text
    .split('\n')
    .filter((line) => !LOCAL_PHOTO.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function PostComposer({
  placeholder,
  sendLabel,
  folder,
  onSend,
  maxLength = 4000,
  replyingTo = null,
  editing = null,
  mentionScope = {},
  draftKey,
  anonymousOption,
}: {
  placeholder: string;
  sendLabel: string;
  /** Where photographs go: the room's folder (lib/chat/attachments.ts). */
  folder: string;
  /** With the photographs uploaded: null on success, or a sentence to show. */
  onSend: (body: string, paths: string[], anonymous: boolean) => Promise<string | null>;
  maxLength?: number;
  replyingTo?: ComposerReplyingTo | null;
  editing?: PostEditing | null;
  mentionScope?: MentionScope;
  draftKey?: string | undefined;
  anonymousOption?: { checked: boolean; onChange: (checked: boolean) => void } | undefined;
}) {
  const id = useId();
  const announce = useAnnounce();
  const [recovered] = useState(() => readKeptDraft(draftKey));
  const [draft, setDraft] = useState(() => withoutLocalPhotos(recovered?.text ?? ''));
  const [storage, setStorage] = useState<DraftStorage>(null);
  const [anonymousChoice, setAnonymousChoice] = useState(recovered?.anonymous);
  const anonymous = !!anonymousOption && (anonymousChoice ?? anonymousOption.checked);
  const draftAnonymous = anonymousChoice ?? (anonymous ? true : undefined);
  const [mode, setMode] = useState(readMode);
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  // An edited post's photographs below its words, taken out (the owner,
  // 2026-11-19: "make it possible to delete images when someone edits").
  const [takenOut, setTakenOut] = useState<ReadonlySet<string>>(new Set());
  const [linking, setLinking] = useState<{ start: number; end: number } | null>(null);
  const [address, setAddress] = useState('');
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const rich = useRef<RichEditorHandle | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const linkField = useRef<HTMLInputElement | null>(null);
  // Where the caret goes in the Markdown box once the new words are drawn.
  const caretTo = useRef<{ start: number; end: number } | null>(null);
  const setAside = useRef<string | null>(null);
  const loaded = useRef<string | null>(null);
  const changed = useRef(false);

  // Photographs not yet uploaded: their files and object URLs, by name.
  const local = useRef(new Map<string, { file: File; url: string }>());
  const named = useRef(0);
  useEffect(() => {
    const files = local.current;
    return () => {
      for (const photo of files.values()) URL.revokeObjectURL(photo.url);
    };
  }, []);

  const editingId = editing?.id ?? null;
  const editingWords = editing?.initial ?? '';
  const editingNoun = editing?.noun ?? 'post';
  // Markdown, and no switch, where the editor must not rewrite a word.
  const asMarkdown =
    editing !== null &&
    (editing.plain === true || (editing.appendOnly === true && !roundTrips(editing.initial)));
  const shown = asMarkdown ? 'markdown' : mode;

  useEffect(() => {
    if (draftKey && editingId === null)
      setStorage(writeDraft(draftKey, withoutLocalPhotos(draft), { anonymous: draftAnonymous }));
  }, [draftKey, draft, editingId, draftAnonymous]);

  useLayoutEffect(() => {
    if (editingId === loaded.current) return;
    const from = loaded.current;
    loaded.current = editingId;
    setFailure(null);
    setPhotoProblem(null);
    setTakenOut(new Set());
    changed.current = false;
    if (editingId !== null) {
      if (from === null) setAside.current = draft;
      setDraft(editingWords);
      announce(`Editing your ${editingNoun}.`);
    } else {
      setDraft(setAside.current ?? '');
      setAside.current = null;
    }
  }, [editingId, editingWords, editingNoun, draft, announce]);

  // Reply and Edit are decisions to write: the box comes into view, focused.
  const replyingToId = replyingTo?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when what is answered or edited changes.
  useEffect(() => {
    if (!replyingToId && !editingId) return;
    const into = section.current;
    // jsdom has no scrollIntoView.
    if (into && 'scrollIntoView' in into) into.scrollIntoView({ block: 'nearest' });
    if (shown === 'rich') rich.current?.focus('end');
    else {
      const element = box.current;
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    }
  }, [replyingToId, editingId]);

  // A selfie from checking in arrives attached (lib/chat/drafts.ts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the box this key opened.
  useEffect(() => {
    if (!draftKey) return;
    const handed = handedPhotos(draftKey);
    forgetHandedPhotos(draftKey);
    if (handed.length === 0) return;
    const paths = addPhotos(handed);
    if (paths)
      setDraft((words) => [words.trim(), ...paths.map(photoLine)].filter(Boolean).join('\n\n'));
  }, [draftKey]);

  useLayoutEffect(() => {
    const caret = caretTo.current;
    const element = box.current;
    if (!caret || !element) return;
    caretTo.current = null;
    element.focus();
    element.setSelectionRange(caret.start, caret.end);
  });

  const placed = photoPaths(draft);
  const inWords = placed.filter((path) => path.startsWith('local:'));
  // An edited post's photographs: those in its words stay while they are
  // still there; the rest, below them, until taken out of the edit bar.
  const attachments = editing?.attachments ?? [];
  const placedBefore = new Set(photoPaths(editing?.initial ?? ''));
  const keeps = attachments.filter((path) =>
    placedBefore.has(path) ? placed.includes(path) : !takenOut.has(path),
  );
  const kept = keeps.length === attachments.length ? null : keeps;
  const below = attachments.filter((path) => !placedBefore.has(path));
  const already = keeps.length;

  /** Names for pictures to put in, or null when they cannot be (the sentence says why). */
  function addPhotos(files: File[]): string[] | null {
    const problem = attachmentProblem(files, already + new Set(inWords).size);
    setPhotoProblem(problem);
    if (problem) return null;
    return files.map((file) => {
      named.current += 1;
      const name = `local:${named.current}`;
      local.current.set(name, { file, url: URL.createObjectURL(file) });
      return name;
    });
  }

  function change(next: string) {
    changed.current = true;
    setDraft(next);
  }

  const markdownMention = useMentionSuggestions({
    box,
    value: draft,
    onChange: change,
    above: true,
    enabled: shown === 'markdown' && !editing?.plain,
    among: mentionScope.among,
    first: mentionScope.first,
  });

  /* ---------------------------------------------------------- the toolbar */

  function selection(): { start: number; end: number } {
    const element = box.current;
    return element
      ? { start: element.selectionStart, end: element.selectionEnd }
      : { start: draft.length, end: draft.length };
  }

  function applyText(edit: { value: string; start: number; end: number }) {
    if (edit.value.length > maxLength) return;
    caretTo.current = { start: edit.start, end: edit.end };
    change(edit.value);
  }

  function format(kind: Format) {
    if (shown === 'rich') {
      rich.current?.format(kind);
      return;
    }
    const { start, end } = selection();
    if (kind === 'bold') applyText(wrap(draft, start, end, '**', 'bold words'));
    if (kind === 'italic') applyText(wrap(draft, start, end, '*', 'italic words'));
    if (kind === 'heading') applyText(prefixLines(draft, start, end, () => '## ', 'Heading'));
    if (kind === 'quote') applyText(prefixLines(draft, start, end, () => '> ', 'Quoted words'));
    if (kind === 'bullets') applyText(prefixLines(draft, start, end, () => '- ', 'List item'));
    if (kind === 'numbers') applyText(prefixLines(draft, start, end, (n) => `${n}. `, 'List item'));
  }

  function startLink() {
    setLinking(selection());
    setAddress('');
    setLinkProblem(null);
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
    if (shown === 'rich') rich.current?.link(read.url);
    else applyText(insertLink(draft, linking.start, linking.end, read.url));
  }

  function putPhotos(files: File[]) {
    const paths = addPhotos(files);
    if (!paths) return;
    if (shown === 'rich') {
      rich.current?.insertPhotos(paths);
      return;
    }
    const { end } = selection();
    const before = draft.slice(0, end).replace(/\s+$/, '');
    const after = draft.slice(end).replace(/^\s+/, '');
    const lines = paths.map(photoLine).join('\n\n');
    const middle = `${before ? '\n\n' : ''}${lines}${after ? '\n\n' : ''}`;
    const next = `${before}${middle}${after}`;
    caretTo.current = { start: before.length + middle.length, end: before.length + middle.length };
    change(next);
  }

  function switchMode() {
    const next = shown === 'rich' ? 'markdown' : 'rich';
    setMode(next);
    saveMode(next);
    setLinking(null);
    announce(next === 'markdown' ? 'Writing in Markdown.' : 'Writing as it will look.');
  }

  /* ---------------------------------------------------------- sending */

  const body = draft.trim();
  const blank = editing !== null && body === '' && keeps.length === 0 && !editing.shared;
  const cannotSend = sending || (editing ? blank : body === '');

  function finishEdit(current: PostEditing, message: string) {
    current.onClose();
    announce(message);
    requestAnimationFrame(() => {
      if (section.current) focusAfterEdit(current.anchor, null);
    });
  }

  /** The words with photographs uploaded and named by their paths. */
  async function upload(
    words: string,
  ): Promise<{ ok: true; body: string; paths: string[] } | { ok: false; error: string }> {
    const lines = words.split('\n').filter((line) => {
      const name = LOCAL_PHOTO.exec(line)?.[1];
      return !name || local.current.has(name);
    });
    let text = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const names = [...new Set(photoPaths(text).filter((path) => path.startsWith('local:')))];
    if (names.length === 0) return { ok: true, body: text, paths: [] };
    const files = names.flatMap((name) => {
      const photo = local.current.get(name);
      return photo ? [photo.file] : [];
    });
    const up = await uploadAttachments(files, folder);
    if (!up.ok) return up;
    names.forEach((name, i) => {
      text = text.split(`](${name})`).join(`](${up.value[i] ?? ''})`);
    });
    return { ok: true, body: text, paths: up.value };
  }

  function forgetLocal() {
    for (const photo of local.current.values()) URL.revokeObjectURL(photo.url);
    local.current.clear();
  }

  function send() {
    if (cannotSend) return;
    const current = editing;
    if (current) {
      if (
        (!changed.current || body === current.initial.trim()) &&
        inWords.length === 0 &&
        kept === null
      ) {
        finishEdit(current, 'Nothing changed. Edit cancelled.');
        return;
      }
      if (current.appendOnly && !body.startsWith(current.initial.trim())) {
        setFailure(
          'Someone has replied, so you can add to this post but not change what it says. Put the words back as they were and add after them.',
        );
        return;
      }
    }
    setSending(true);
    setFailure(null);
    void (async () => {
      const uploaded = await upload(body);
      if (!uploaded.ok) return uploaded.error;
      const problem = current
        ? await current.onSave(uploaded.body, uploaded.paths, kept)
        : await onSend(uploaded.body, uploaded.paths, anonymous);
      if (problem) {
        if (uploaded.paths.length > 0) void deleteAttachments(uploaded.paths);
        return problem;
      }
      return null;
    })()
      .then((problem) => {
        if (problem) {
          setFailure(problem);
          return;
        }
        forgetLocal();
        if (current) {
          finishEdit(current, 'Changes saved.');
          return;
        }
        changed.current = false;
        if (draftKey) writeDraft(draftKey, '');
        setAnonymousChoice(undefined);
        setDraft('');
        setPreview(false);
        noteSent();
      })
      .finally(() => {
        setSending(false);
      });
  }

  function onKeys(event: KeyboardEvent | React.KeyboardEvent): boolean {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      if (!sending) finishEdit(editing, 'Edit cancelled.');
      return true;
    }
    // ⌘/Ctrl+Enter sends; Enter alone starts a new line, as in a topic.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- drawing */

  const label = editing ? `Edit your ${editing.noun}` : placeholder;
  const tools = !editing?.plain;
  const full = already + new Set(inWords).size >= MAX_ATTACHMENTS;
  const button =
    'grid h-11 w-10 flex-none place-items-center rounded-[10px] text-emphasis transition-colors hover:bg-tint disabled:opacity-35 aria-pressed:bg-tint';

  return (
    <section
      ref={section}
      aria-label={editing ? `Editing your ${editing.noun}` : 'Your reply'}
      className="mt-4 scroll-mb-4 rounded-[14px] border-[1.6px] border-line bg-paper focus-within:border-emphasis"
    >
      {failure ? (
        <p
          role="alert"
          className="m-2 mb-0 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[0.78125rem] text-destructive leading-[1.45]"
        >
          {failure} Your words are still here.
        </p>
      ) : null}
      {editing ? (
        <EditBar
          editing={editing}
          below={below}
          takenOut={takenOut}
          onTakeOut={(path) => {
            setTakenOut((out) => new Set(out).add(path));
            announce('Photograph taken out. It goes when you save.');
          }}
          onPutBack={() => {
            setTakenOut(new Set());
            announce('Photographs put back.');
          }}
          blank={blank}
          sending={sending}
          onCancel={() => {
            finishEdit(editing, 'Edit cancelled.');
          }}
        />
      ) : replyingTo ? (
        <div className="m-2 mb-0 flex items-center justify-between gap-2 rounded-[11px] bg-tint px-3 py-1.5">
          <span className="min-w-0 truncate text-[0.78125rem] text-ink2">
            Replying to <span className="font-semibold text-ink">{replyingTo.name}</span>
          </span>
          <button
            type="button"
            onClick={replyingTo.onCancel}
            aria-label="Stop replying"
            data-target="small"
            className="grid h-7 w-7 flex-none place-items-center rounded-full text-ink2 hover:bg-line"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {!editing && anonymousOption ? (
        <div className="px-3.5">
          <PostOptions
            id={id}
            className="mt-1"
            noun="reply"
            anonymous={{
              checked: anonymous,
              onChange: (checked) => {
                setAnonymousChoice(checked);
                anonymousOption.onChange(checked);
              },
            }}
          />
        </div>
      ) : null}
      {!editing && draft.trim() ? (
        <DraftStatus
          storage={storage}
          restored={draft === recovered?.text}
          className="px-3.5 pt-1"
        />
      ) : null}
      <fieldset className="flex flex-wrap items-center border-line border-b px-1 py-0.5">
        <legend className="sr-only">Formatting</legend>
        {tools ? (
          <>
            <Tool
              label="Bold"
              className={button}
              onClick={() => {
                format('bold');
              }}
            >
              <Bold className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool
              label="Italic"
              className={button}
              onClick={() => {
                format('italic');
              }}
            >
              <Italic className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool
              label="Heading"
              className={button}
              onClick={() => {
                format('heading');
              }}
            >
              <Heading className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool
              label="Quote"
              className={button}
              onClick={() => {
                format('quote');
              }}
            >
              <Quote className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool
              label="Bulleted list"
              className={button}
              onClick={() => {
                format('bullets');
              }}
            >
              <List className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool
              label="Numbered list"
              className={button}
              onClick={() => {
                format('numbers');
              }}
            >
              <ListOrdered className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
            <Tool label="Link" className={button} onClick={startLink}>
              <Link2 className="h-[18px] w-[18px]" aria-hidden="true" />
            </Tool>
          </>
        ) : null}
        <span className="flex-1" />
        {asMarkdown ? null : (
          <button
            type="button"
            aria-pressed={shown === 'markdown'}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={switchMode}
            title={shown === 'markdown' ? 'Write as it will look' : 'Write in Markdown'}
            aria-label="Write in Markdown"
            className="inline-flex h-11 min-w-11 flex-none items-center justify-center rounded-[10px] px-2 font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-tint aria-pressed:bg-emphasis aria-pressed:text-paper"
          >
            M↓
          </button>
        )}
      </fieldset>

      {linking ? (
        <div className="flex flex-wrap items-center gap-2 border-line border-b bg-tint/40 px-2.5 py-2">
          <label htmlFor={`${id}-link`} className="font-semibold text-[0.8125rem] text-ink">
            Web address
          </label>
          <input
            id={`${id}-link`}
            ref={linkField}
            value={address}
            inputMode="url"
            onChange={(event) => {
              setAddress(event.target.value);
              setLinkProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addLink();
              }
              if (event.key === 'Escape') setLinking(null);
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

      <LocalPhotos.Provider value={(path) => local.current.get(path)?.url}>
        {shown === 'rich' ? (
          <RichEditor
            ref={rich}
            value={draft}
            onChange={change}
            label={label}
            placeholder={label}
            readOnly={sending}
            onPhotos={addPhotos}
            onKeyDown={onKeys}
            mentionScope={mentionScope}
          />
        ) : (
          <div className="relative">
            {markdownMention.list}
            <textarea
              ref={box}
              value={draft}
              rows={4}
              maxLength={maxLength}
              placeholder={label}
              aria-label={label}
              readOnly={sending}
              {...(editing?.plain ? {} : markdownMention.boxProps)}
              onPaste={(event) => {
                const images = pastedImages(event.clipboardData);
                if (images.length === 0) return;
                event.preventDefault();
                putPhotos(images);
              }}
              onChange={(event) => {
                change(event.target.value);
              }}
              onKeyDown={(event) => {
                if (markdownMention.onKeyDown(event)) return;
                onKeys(event);
              }}
              className="block max-h-[50dvh] min-h-[7.5rem] w-full resize-none bg-transparent [field-sizing:content] px-3.5 py-2.5 font-mono text-[0.875rem] text-ink leading-[1.5] outline-none"
            />
          </div>
        )}

        {preview ? (
          <section
            aria-label="Preview"
            className="mx-2 mb-2 rounded-[12px] border border-line border-dashed px-3.5 py-2.5"
          >
            <p className="font-bold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
              Preview
            </p>
            {body ? (
              <PostBody text={body} photos={attachments} from="you" className={POST_TEXT} />
            ) : (
              <p className="mt-1 text-[0.8125rem] text-grey">Nothing written yet.</p>
            )}
          </section>
        ) : null}
      </LocalPhotos.Provider>

      {photoProblem ? (
        <p role="alert" className="mx-3.5 mb-1 text-[0.78125rem] text-destructive leading-[1.45]">
          {photoProblem}
        </p>
      ) : null}
      <div className="flex items-center gap-1 border-line border-t px-2 py-2">
        <button
          type="button"
          disabled={sending || full}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            picker.current?.click();
          }}
          title={full ? `${MAX_ATTACHMENTS} photographs is the most` : 'Add a photograph'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2.5 font-semibold text-[0.84375rem] text-emphasis transition-colors hover:bg-tint disabled:opacity-35"
        >
          <ImagePlus className="h-[18px] w-[18px]" aria-hidden="true" />
          {full ? 'Four is the most' : 'Photo'}
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const chosen = event.target.files ? [...event.target.files] : [];
            event.target.value = '';
            if (chosen.length) putPhotos(chosen);
          }}
        />
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => {
            setPreview((open) => !open);
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2.5 font-semibold text-[0.84375rem] text-emphasis transition-colors hover:bg-tint aria-pressed:bg-tint"
        >
          <Eye className="h-[17px] w-[17px]" aria-hidden="true" />
          Preview
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={send}
          disabled={cannotSend}
          aria-label={editing ? 'Save changes' : sendLabel}
          className="min-h-11 rounded-full bg-action px-5 font-bold font-head text-[0.9375rem] text-white transition-opacity disabled:opacity-35"
        >
          {sending ? (editing ? 'Saving…' : 'Posting…') : editing ? 'Save' : 'Post reply'}
        </button>
      </div>
    </section>
  );
}

function photoLine(path: string): string {
  return `![Photo](${path})`;
}

function EditBar({
  editing,
  below,
  takenOut,
  onTakeOut,
  onPutBack,
  blank,
  sending,
  onCancel,
}: {
  editing: PostEditing;
  /** Its photographs drawn below its words, rather than in them. */
  below: readonly string[];
  takenOut: ReadonlySet<string>;
  onTakeOut: (path: string) => void;
  onPutBack: () => void;
  blank: boolean;
  sending: boolean;
  onCancel: () => void;
}) {
  const { small } = useSmallCopies(below);
  const staying = below.filter((path) => !takenOut.has(path));
  return (
    <div className="m-2 mb-0 flex items-center gap-2 rounded-[11px] border-emphasis border-l-[3px] bg-tint py-1 pr-1 pl-3">
      <div className="min-w-0 flex-1 py-1 text-[0.8125rem] text-ink2 leading-[1.4]">
        <p className="font-semibold text-ink">Editing {editing.noun}</p>
        {editing.appendOnly ? (
          <p>
            Someone has replied, so you can add words or photographs but not change what it says.
          </p>
        ) : null}
        {editing.initial.trim() ? <p className="truncate">{excerpt(editing.initial)}</p> : null}
        {editing.appendOnly && editing.photos > 0 ? (
          <p>{editing.photos === 1 ? 'Its photograph stays.' : 'Its photographs stay.'}</p>
        ) : null}
        {!editing.appendOnly && staying.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-2" aria-label="Its photographs">
            {staying.map((path, index) => (
              <li key={path} className="relative">
                {small.get(path) ? (
                  <img
                    src={small.get(path)}
                    alt={`Photograph ${index + 1}`}
                    className="block h-[4.5rem] w-[4.5rem] rounded-[10px] bg-paper object-cover"
                  />
                ) : (
                  <span className="block h-[4.5rem] w-[4.5rem] rounded-[10px] bg-paper" />
                )}
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    onTakeOut(path);
                  }}
                  aria-label={`Take out photograph ${index + 1}`}
                  // 44px to press, a 28px circle to see, over the corner.
                  className="-top-3 -right-3 absolute grid h-11 w-11 place-items-center rounded-full disabled:opacity-50"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-action text-white shadow-[0_2px_6px_rgba(10,20,35,.3)]">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {takenOut.size > 0 ? (
          <>
            <p className="mt-1">
              {takenOut.size === 1
                ? 'A photograph will be taken out when you save.'
                : `${takenOut.size} photographs will be taken out when you save.`}
            </p>
            <button
              type="button"
              onClick={onPutBack}
              className="-my-1.5 inline-flex min-h-11 items-center font-semibold text-emphasis underline underline-offset-2"
            >
              Put {takenOut.size === 1 ? 'it' : 'them'} back
            </button>
          </>
        ) : null}
        {editing.shared ? <p>The shared post stays.</p> : null}
        <p aria-live="polite">
          {blank ? `A ${editing.noun} needs words. To delete it, use Remove.` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={sending}
        aria-label="Cancel editing"
        className="inline-flex min-h-11 flex-none items-center gap-1 rounded-full px-3 font-semibold text-[0.8125rem] text-emphasis hover:bg-line disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Cancel
      </button>
    </div>
  );
}

function Tool({
  label,
  className,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Keep the selection in the box: a pressed button would otherwise take
      // focus before the click reads where the selection was.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={cn(className)}
    >
      {children}
    </button>
  );
}
