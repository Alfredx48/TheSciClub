import { Maximize2, Minimize2, SendHorizontal, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAnnounce } from '@/lib/announce';
import { MAX_ATTACHMENTS } from '@/lib/chat/attachments';
import { forgetHandedPhotos, handedPhotos, readKeptDraft, writeDraft } from '@/lib/chat/drafts';
import type { MentionScope } from '@/lib/mentions';
import { type PhotoTarget, pastePhotos } from '@/lib/paste-photos';
import { noteSent } from '@/lib/push/notifications';
import { useDraftFiles } from '@/lib/use-draft-media';
import { DraftStatus, type DraftStorage } from '@/routes/chat/draft-status';
import { useMentionSuggestions } from '@/routes/chat/mention-suggestions';
import { PhotoPicker, PhotoStrip } from '@/routes/chat/photo-picker';

/**
 * The box at the foot of a topic or a thread; it also edits a post or message there.
 *
 * A growing textarea, not the mock's one-line input: members dictate paragraphs, and a line
 * that scrolls sideways hides them.
 *
 * Height is scrollHeight plus the border, measured (offsetHeight - clientHeight), not counted:
 * border-box makes scrollHeight short by the borders, and the used width shifts with zoom and
 * pixel ratio. Short by 2px summons a scrollbar on Windows and Linux only (macOS/iOS overlay
 * bars hide it). overflowY is hidden while growing and before measuring, since a showing bar
 * narrows the box and inflates scrollHeight; auto only at the maximum.
 *
 * `sendOnEnter`: Enter sends in a direct thread, breaks a paragraph in a topic; Shift+Enter is
 * the other. Words and photographs survive a failed send: cleared only after the write returns.
 *
 * Photographs (up to four) go to `onSend` as files; the caller uploads them, as it knows the
 * folder. Words are optional once there is one.
 *
 * `editing` loads a post's or message's words here (the owner, 2026-10-22); the draft is put
 * aside and returns on Cancel, Escape or save. Unchanged words just close the edit, since the
 * database refuses a no-op edit.
 *
 * `replyingTo` draws the reply bar and moves focus into the box. `mentions` suggests members
 * after "@" (20261029070000); `mentionScope` says where to look (the owner, 2026-10-29).
 */
/** About six lines: the least the box may grow to, however short the screen. */
const MIN_CAP = 150;
/**
 * The share of the visible screen the box may grow to (the owner, 2026-11-21: room for a long
 * message). Visible means above the keyboard on a phone, so the conversation keeps the rest.
 */
const SCREEN_SHARE = 0.5;

/** The tallest the box may grow, from the screen as it is now. */
function maxHeight(visible: number): number {
  return Math.max(MIN_CAP, Math.floor(visible * SCREEN_SHARE));
}

/** Past about three lines the box offers to open full screen (the owner, 2026-11-21). */
const OFFER_FULL_SCREEN = 100;

function visibleHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * Grow the box to fit, up to maxHeight. Measured, not counted, as only the browser knows where
 * lines wrap. See the header: the lines that look redundant are the ones that matter.
 * Full screen (`data-full`), the box fills what it is given. Says whether the words run past
 * about three lines.
 */
function fitToContent(element: HTMLTextAreaElement): boolean {
  if (element.dataset.full === 'true') {
    element.style.maxHeight = 'none';
    element.style.height = '100%';
    element.style.overflowY = 'auto';
    return true;
  }
  const cap = maxHeight(visibleHeight());
  element.style.maxHeight = `${cap}px`;
  element.style.overflowY = 'hidden';
  element.style.height = 'auto';
  // offsetHeight - clientHeight is the borders as actually used; overflowY hidden above means a
  // leftover scrollbar cannot have moved the wrap.
  const wanted = element.scrollHeight + (element.offsetHeight - element.clientHeight);
  element.style.height = `${Math.min(wanted, cap)}px`;
  element.style.overflowY = wanted > cap ? 'auto' : 'hidden';
  return wanted > OFFER_FULL_SCREEN;
}

export interface ComposerEditing {
  /** The post or message being edited; a new id loads its words. */
  id: string;
  /** Its words as they are now. */
  initial: string;
  noun: 'message' | 'post';
  /** How many photographs it has. An edit keeps them. */
  photos: number;
  /** A post may have photographs added while it is edited (20261029000000). */
  addPhotos?: boolean;
  /** It shares a post, which an edit keeps, so its words may go. */
  shared?: boolean;
  /**
   * Somebody else has replied, so its words may only be added to
   * (20261029260000): what was there must still start the box.
   */
  appendOnly?: boolean;
  /** The item's element id: its ••• takes focus afterwards. */
  anchor: string;
  /** Resolves to null once saved, or to the sentence to show; files are the photographs added. */
  onSave: (body: string, files: File[]) => Promise<string | null>;
  /** The edit is over: saved, cancelled, or nothing changed. */
  onClose: () => void;
}

export interface ComposerReplyingTo {
  /** The post or message being answered; focus moves into the box when it changes. */
  id: string;
  /** Whose it is, for "Replying to Jan". */
  name: string;
  onCancel: () => void;
}

/** Back to the edited item's •••, or the box when it has none. */
export function focusAfterEdit(anchor: string, fallback: HTMLElement | null) {
  const actions = document
    .getElementById(anchor)
    ?.querySelector<HTMLElement>('[data-item-actions]');
  (actions ?? fallback)?.focus();
}

export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

export function Composer({
  placeholder,
  sendLabel,
  onSend,
  sendOnEnter = false,
  maxLength = 4000,
  replyingTo = null,
  editing = null,
  mentions = false,
  mentionScope = {},
  draftKey,
  onTyping,
}: {
  placeholder: string;
  /** What the send button says to a screen reader. */
  sendLabel: string;
  /** Resolves to null on success, or to a sentence to show. */
  onSend: (body: string, files: File[], replyTo?: string) => Promise<string | null>;
  sendOnEnter?: boolean;
  maxLength?: number;
  /** A reply in progress, drawn over the box. */
  replyingTo?: ComposerReplyingTo | null;
  /** A post or message whose words are in the box: see the header. */
  editing?: ComposerEditing | null;
  /** Suggest members after an "@": see the header. */
  mentions?: boolean;
  mentionScope?: MentionScope;
  /** Keeps the unsent words on this device under this name (lib/chat/drafts.ts). */
  draftKey?: string | undefined;
  /**
   * Told at each change the member makes to a new message, whether it has
   * words: the dots the others see (lib/chat/typing.ts). Not while editing.
   */
  onTyping?: ((hasWords: boolean) => void) | undefined;
}) {
  const announce = useAnnounce();
  const [recovered] = useState(() => readKeptDraft(draftKey));
  const [draft, setDraft] = useState(recovered?.text ?? '');
  const [storage, setStorage] = useState<DraftStorage>(null);
  const [recoveredReply, setRecoveredReply] = useState(recovered?.replyTo);
  const reply =
    replyingTo ??
    (recoveredReply
      ? {
          id: recoveredReply,
          name: 'an earlier message',
          onCancel: () => {
            setRecoveredReply(undefined);
          },
        }
      : null);
  const replyId = reply?.id;
  useEffect(() => {
    if (replyingTo) setRecoveredReply(undefined);
  }, [replyingTo]);
  // A selfie from checking in arrives attached (lib/chat/drafts.ts).
  const photoDraft = useDraftFiles(draftKey);
  const { value: files, setValue: setFiles, loading: loadingPhotos } = photoDraft;
  useEffect(() => {
    if (!draftKey || loadingPhotos) return;
    const handed = handedPhotos(draftKey);
    forgetHandedPhotos(draftKey);
    if (handed.length) setFiles((current) => [...current, ...handed].slice(0, MAX_ATTACHMENTS));
  }, [draftKey, loadingPhotos, setFiles]);
  // Added to the post being edited: apart from the draft's, which wait for it.
  const [editFiles, setEditFiles] = useState<File[]>([]);
  // Pictures pasted into the box join the photographs (lib/paste-photos.ts).
  // Null while editing, which keeps the photographs it had.
  const photos = useRef<PhotoTarget | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  /** Whether the words run long enough to offer full screen. */
  const [long, setLong] = useState(false);
  /** Writing full screen: the box covers the conversation until shrunk or sent. */
  const [full, setFull] = useState(false);
  /** The visible screen, which the full-screen box covers exactly (above a phone's keyboard). */
  const [screen, setScreen] = useState<{ top: number; height: number } | null>(null);
  const draftVersion = useRef(0);
  /** The member's own draft, put aside while they edit. */
  const setAside = useRef<{ text: string; version: number } | null>(null);
  /** Whose words are in the box: the edited item's id, or null for the draft. */
  const loaded = useRef<string | null>(null);
  /** Bumped when the words are swapped, to fit the box and place the caret. */
  const [swaps, setSwaps] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (element) setLong(fitToContent(element));
  }, []);

  const editingId = editing?.id ?? null;
  // The member's own words only: while editing, the box holds the edited item's.
  useEffect(() => {
    if (draftKey && editingId === null)
      setStorage(writeDraft(draftKey, draft, { replyTo: replyId }));
  }, [draftKey, draft, editingId, replyId]);
  const editingWords = editing?.initial ?? '';
  const editingNoun = editing?.noun ?? 'message';
  useLayoutEffect(() => {
    if (editingId === loaded.current) return;
    const from = loaded.current;
    loaded.current = editingId;
    setFailure(null);
    if (editingId !== null) {
      if (from === null) setAside.current = { text: draft, version: draftVersion.current };
      draftVersion.current += 1;
      setDraft(editingWords);
      announce(`Editing your ${editingNoun}.`);
    } else {
      // The draft's own version too, so a send still in flight clears it.
      const back = setAside.current;
      setAside.current = null;
      draftVersion.current = back ? back.version : draftVersion.current + 1;
      setDraft(back ? back.text : '');
    }
    setSwaps((n) => n + 1);
  }, [editingId, editingWords, editingNoun, draft, announce]);

  useLayoutEffect(() => {
    const element = box.current;
    if (swaps === 0 || !element) return;
    setLong(fitToContent(element));
    // Editing starts with the caret at the end, where somebody fixing a
    // sentence wants it.
    if (loaded.current !== null) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [swaps]);

  // Pressing Reply is a decision to write, so the box takes focus.
  const replyingToId = replyingTo?.id ?? null;
  useEffect(() => {
    if (replyingToId) box.current?.focus();
  }, [replyingToId]);

  function resize() {
    const element = box.current;
    if (element) setLong(fitToContent(element));
  }

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.dataset.full = full ? 'true' : 'false';
    setLong(fitToContent(element));
    if (!full) {
      setScreen(null);
      return;
    }
    element.focus();
    const viewport = window.visualViewport;
    const measure = () => {
      setScreen(
        viewport
          ? { top: viewport.offsetTop, height: viewport.height }
          : { top: 0, height: window.innerHeight },
      );
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [full]);

  // The keyboard opening or the window changing size changes how tall the box may be.
  useEffect(() => {
    const viewport = window.visualViewport ?? window;
    const refit = () => {
      const element = box.current;
      if (element) setLong(fitToContent(element));
    };
    viewport.addEventListener('resize', refit);
    return () => {
      viewport.removeEventListener('resize', refit);
    };
  }, []);

  const mention = useMentionSuggestions({
    box,
    value: draft,
    onChange: (next) => {
      draftVersion.current += 1;
      setDraft(next);
      if (!editing) onTyping?.(next.trim() !== '');
      requestAnimationFrame(resize);
    },
    above: true,
    enabled: mentions,
    among: mentionScope.among,
    first: mentionScope.first,
  });

  const body = draft.trim();
  const empty = body === '' && files.length === 0;
  // Blank words with no photographs: Remove is the way to take it back.
  const blank =
    editing !== null &&
    body === '' &&
    editing.photos === 0 &&
    editFiles.length === 0 &&
    !editing.shared;
  const cannotSend = sending || loadingPhotos || (editing ? blank : empty);

  function finishEdit(current: ComposerEditing, message: string) {
    setEditFiles([]);
    current.onClose();
    announce(message);
    requestAnimationFrame(() => {
      // Not once the screen has gone.
      if (box.current) focusAfterEdit(current.anchor, box.current);
    });
  }

  function saveEdit(current: ComposerEditing) {
    if (body === current.initial.trim() && editFiles.length === 0) {
      finishEdit(current, 'Nothing changed. Edit cancelled.');
      return;
    }
    if (current.appendOnly && !body.startsWith(current.initial.trim())) {
      setFailure(
        'Someone has replied, so you can add to this post but not change what it says. Put the words back as they were and add after them.',
      );
      return;
    }
    setSending(true);
    setFailure(null);
    void current
      .onSave(body, editFiles)
      .then((problem) => {
        if (problem) {
          setFailure(problem);
          return;
        }
        finishEdit(current, 'Changes saved.');
      })
      .finally(() => {
        setSending(false);
      });
  }

  function send() {
    if (cannotSend) return;
    if (editing) {
      saveEdit(editing);
      return;
    }
    const submittedVersion = draftVersion.current;
    onTyping?.(false);
    setSending(true);
    setFailure(null);
    void (replyId ? onSend(body, files, replyId) : onSend(body, files))
      .then((problem) => {
        if (problem) {
          setFailure(problem);
          return;
        }
        // A member may already be writing the next message while this one
        // saves, or editing another with this draft put aside.
        if (
          draftVersion.current === submittedVersion ||
          setAside.current?.version === submittedVersion
        ) {
          if (draftKey && readKeptDraft(draftKey)?.text === draft) writeDraft(draftKey, '');
          if (draftVersion.current === submittedVersion) setDraft('');
          else if (setAside.current) setAside.current.text = '';
        }
        setRecoveredReply(undefined);
        photoDraft.clear();
        noteSent();
        setFull(false);
        // The box shrinks back only once the words have actually gone.
        requestAnimationFrame(resize);
      })
      .finally(() => {
        setSending(false);
      });
  }

  const textarea = (
    <textarea
      ref={box}
      value={draft}
      rows={1}
      maxLength={maxLength}
      placeholder={editing ? `Edit your ${editing.noun}` : placeholder}
      aria-label={editing ? `Edit your ${editing.noun}` : placeholder}
      readOnly={editing !== null && sending}
      {...(mentions ? mention.boxProps : {})}
      onPaste={(event) => {
        pastePhotos(event, photos.current);
      }}
      onChange={(event) => {
        draftVersion.current += 1;
        setDraft(event.target.value);
        if (!editing) onTyping?.(event.target.value.trim() !== '');
        resize();
      }}
      onKeyDown={(event) => {
        if (mention.onKeyDown(event)) return;
        if (event.key === 'Escape' && full) {
          event.preventDefault();
          setFull(false);
          return;
        }
        if (event.key === 'Escape' && editing) {
          event.preventDefault();
          if (!sending) finishEdit(editing, 'Edit cancelled.');
          return;
        }
        // Safari can report composition Enter only through legacy keyCode.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key !== 'Enter') return;
        if (sendOnEnter && !event.shiftKey) {
          event.preventDefault();
          send();
        }
      }}
      className={`block min-h-[44px] w-full resize-none border-[1.6px] border-line bg-canvas py-[11px] pl-[15px] text-[0.9375rem] text-ink leading-[1.45] outline-none focus:border-emphasis focus:bg-paper ${
        full
          ? 'rounded-[16px] pr-[15px]'
          : long
            ? 'rounded-[22px] pr-11'
            : 'rounded-[22px] pr-[15px]'
      }`}
    />
  );

  const failureLine = failure ? (
    <p
      role="alert"
      className="mb-2 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[0.78125rem] text-destructive leading-[1.45]"
    >
      {failure} Your words are still here.
    </p>
  ) : null;

  const editBar = editing ? (
    <div className="mx-auto mb-2 flex w-full max-w-[720px] items-center gap-2 rounded-[11px] border-emphasis border-l-[3px] bg-tint py-1 pr-1 pl-3">
      <div className="min-w-0 flex-1 py-1 text-[0.8125rem] text-ink2 leading-[1.4]">
        <p className="font-semibold text-ink">Editing {editing.noun}</p>
        {editing.appendOnly ? (
          <p>
            Someone has replied, so you can add words or photographs but not change what it says.
          </p>
        ) : null}
        {editing.initial.trim() ? <p className="truncate">{excerpt(editing.initial)}</p> : null}
        {editing.photos > 0 ? (
          <p>
            {editing.photos === 1
              ? 'Its photograph stays as it is.'
              : `Its ${editing.photos} photographs stay as they are.`}
            {editing.addPhotos && editing.photos < 4 ? ' You can add more.' : ''}
          </p>
        ) : null}
        {editing.shared ? <p>The shared post stays.</p> : null}
        <p aria-live="polite">
          {blank ? `A ${editing.noun} needs words. To delete it, use Remove.` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          finishEdit(editing, 'Edit cancelled.');
        }}
        disabled={sending}
        aria-label="Cancel editing"
        className="inline-flex min-h-11 flex-none items-center gap-1 rounded-full px-3 font-semibold text-[0.8125rem] text-emphasis hover:bg-line disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Cancel
      </button>
    </div>
  ) : null;

  return (
    <div
      className={
        full
          ? 'fixed inset-x-0 z-[70] flex flex-col bg-paper px-3.5 pt-2 pb-2.5'
          : 'flex-none border-line border-t bg-paper px-3.5 py-2.5'
      }
      style={full ? { top: screen?.top ?? 0, height: screen?.height ?? '100dvh' } : undefined}
    >
      {full ? (
        <div className="mx-auto mb-2 flex w-full max-w-[720px] flex-none items-center justify-between gap-2">
          <p className="font-semibold text-[0.9375rem] text-ink">
            {editing ? `Edit your ${editing.noun}` : 'Write your message'}
          </p>
          <button
            type="button"
            onClick={() => {
              setFull(false);
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-[0.8125rem] text-emphasis hover:bg-line"
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
            Shrink
          </button>
        </div>
      ) : null}
      {failureLine}
      {editBar}
      {reply && !editing ? (
        <div className="mx-auto mb-2 flex w-full max-w-[720px] items-center justify-between gap-2 rounded-[11px] bg-tint px-3 py-1.5">
          <span className="min-w-0 truncate text-[0.78125rem] text-ink2">
            Replying to <span className="font-semibold text-ink">{reply.name}</span>
          </span>
          <button
            type="button"
            onClick={reply.onCancel}
            aria-label="Stop replying"
            data-target="small"
            className="grid h-7 w-7 flex-none place-items-center rounded-full text-ink2 hover:bg-line"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {!editing && (draft.trim() || photoDraft.status !== 'idle') ? (
        <DraftStatus
          storage={storage}
          restored={draft === recovered?.text}
          media={photoDraft.status}
          className="mx-auto mb-1 w-full max-w-[720px]"
        />
      ) : null}
      {mentions ? (
        <div className="relative mx-auto w-full max-w-[720px]">{mention.list}</div>
      ) : null}
      {editing && !editing.addPhotos ? null : (
        <div className="mx-auto w-full max-w-[720px]">
          <PhotoStrip
            files={editing ? editFiles : files}
            disabled={sending}
            onRemove={(index) => {
              (editing ? setEditFiles : setFiles)((current) =>
                current.filter((_, i) => i !== index),
              );
            }}
          />
        </div>
      )}
      <div
        className={`mx-auto flex w-full max-w-[720px] items-end gap-[9px] ${full ? 'min-h-0 flex-1' : ''}`}
      >
        {editing ? (
          editing.addPhotos ? (
            <PhotoPicker
              files={editFiles}
              onChange={setEditFiles}
              disabled={sending}
              already={editing.photos}
              compact
            />
          ) : null
        ) : (
          <PhotoPicker
            ref={photos}
            files={files}
            onChange={setFiles}
            disabled={sending || loadingPhotos}
            compact
          />
        )}
        <div className={`relative min-w-0 flex-1 ${full ? 'h-full' : ''}`}>
          {textarea}
          {long && !full ? (
            <button
              type="button"
              onClick={() => {
                setFull(true);
              }}
              aria-label="Write full screen"
              title="Write full screen"
              data-target="small"
              className="absolute top-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-full text-ink2 hover:bg-line"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={cannotSend}
          aria-label={editing ? 'Save changes' : sendLabel}
          // 44px, and never data-target="small": this is the control the whole
          // screen exists for.
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-action text-white transition-opacity disabled:opacity-35"
        >
          <SendHorizontal className="h-[19px] w-[19px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
