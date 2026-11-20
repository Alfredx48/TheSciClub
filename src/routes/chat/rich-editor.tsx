import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import {
  type Editor,
  EditorContent,
  type JSONContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { X } from 'lucide-react';
import { type Ref, useContext, useEffect, useImperativeHandle, useRef } from 'react';
import { useSmallCopies } from '@/lib/chat/attachments';
import { docToMarkdown, markdownToDoc } from '@/lib/markdown-doc';
import type { MentionScope } from '@/lib/mentions';
import { pastedImages } from '@/lib/paste-photos';
import { LocalPhotos } from '@/routes/chat/local-photos';
import { type MentionField, useMentionSuggestions } from '@/routes/chat/mention-suggestions';

/**
 * The words of a post as they will look (the owner, 2026-11-19: "a rich text
 * reply box"), for a reply in a room and an edit of one. TipTap, kept to
 * what lib/markdown.ts draws: paragraphs, a heading, bulleted and numbered
 * lists, a quote, bold, italic, links and photographs. What it holds is
 * Markdown to everybody else: `value` goes in and comes out as Markdown
 * (lib/markdown-doc.ts), so a draft, the database and the iPhone app never
 * see anything else, and the composer's Markdown switch shows the same words.
 *
 * Typing Markdown works here too: "## " starts a heading, "- " a list, "> " a
 * quote, **words** go bold.
 *
 * A picture pasted or dropped in, or chosen with the toolbar, goes in where
 * the caret is (the owner, 2026-11-19: "They stay where you pasted them in").
 * The composer decides whether it may (`onPhotos`, four at most) and says
 * what to call it until it is uploaded ("local:…"); it is drawn from the
 * file until then, and from storage once it has a path.
 *
 * A contenteditable, labelled as a multi-line text box, so a screen reader
 * reads it as one; the @ list is offered as for any other box
 * (mention-suggestions.tsx).
 */

export type Format = 'bold' | 'italic' | 'heading' | 'quote' | 'bullets' | 'numbers';

export interface RichEditorHandle {
  focus: (at?: 'end') => void;
  format: (kind: Format) => void;
  /** A link over the selected words, or the address as words when none are. */
  link: (href: string) => void;
  /** Photographs at the caret, by the names `onPhotos` gave them. */
  insertPhotos: (paths: string[]) => void;
}

export function RichEditor({
  value,
  onChange,
  label,
  placeholder,
  readOnly = false,
  onPhotos,
  onKeyDown,
  mentionScope = {},
  ref,
}: {
  value: string;
  onChange: (markdown: string) => void;
  label: string;
  placeholder: string;
  readOnly?: boolean;
  /** Pictures pasted or dropped: their names to put in, or null when refused. */
  onPhotos: (files: File[]) => string[] | null;
  /** Before the editor's own keys; true when it used the key. */
  onKeyDown?: (event: KeyboardEvent) => boolean;
  mentionScope?: MentionScope;
  ref?: Ref<RichEditorHandle>;
}) {
  // What this editor last said the words were: a different `value` came
  // from outside (a draft, an edit, the Markdown switch) and is loaded.
  const said = useRef(value);
  const latest = useRef({ onChange, onPhotos, onKeyDown });
  latest.current = { onChange, onPhotos, onKeyDown };
  const mentionKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);

  // Suspense can leave a render waiting before React commits it.
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        heading: { levels: [2] },
        link: { openOnClick: false, autolink: false, linkOnPaste: true, defaultProtocol: 'https' },
      }),
      Photo,
      Placeholder.configure({ placeholder }),
    ],
    content: load(value),
    editable: !readOnly,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: 'rich-editor',
      },
      handleKeyDown: (_view, event) =>
        mentionKeys.current(event) || (latest.current.onKeyDown?.(event) ?? false),
      handlePaste: (view, event) => {
        const images = pastedImages(event.clipboardData);
        if (images.length === 0) return false;
        const paths = latest.current.onPhotos(images);
        if (paths) insertPhotoNodes(view.state.selection.from, paths, editorRef.current);
        return true;
      },
      handleDrop: (view, event) => {
        const images = pastedImages(event.dataTransfer);
        if (images.length === 0) return false;
        event.preventDefault();
        const paths = latest.current.onPhotos(images);
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (paths) insertPhotoNodes(at ?? view.state.selection.from, paths, editorRef.current);
        return true;
      },
    },
    onUpdate: ({ editor: changed }) => {
      const markdown = docToMarkdown(changed.getJSON());
      said.current = markdown;
      latest.current.onChange(markdown);
    },
  });
  const pendingFocus = useRef<'current' | 'end' | null>(null);
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || value === said.current) return;
    said.current = value;
    editor.commands.setContent(load(value), { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [readOnly, editor]);

  useEffect(() => {
    if (!editor || pendingFocus.current === null) return;
    const at = pendingFocus.current;
    pendingFocus.current = null;
    editor.commands.focus(at === 'end' ? 'end' : null);
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (at) => {
        if (editor) editor.commands.focus(at === 'end' ? 'end' : null);
        else pendingFocus.current = at ?? 'current';
      },
      format: (kind) => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (kind === 'bold') chain.toggleBold().run();
        if (kind === 'italic') chain.toggleItalic().run();
        if (kind === 'heading') chain.toggleHeading({ level: 2 }).run();
        if (kind === 'quote') chain.toggleBlockquote().run();
        if (kind === 'bullets') chain.toggleBulletList().run();
        if (kind === 'numbers') chain.toggleOrderedList().run();
      },
      link: (href) => {
        if (!editor) return;
        const { empty } = editor.state.selection;
        if (empty) {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: href.replace(/^https?:\/\//, ''),
              marks: [{ type: 'link', attrs: { href } }],
            })
            .unsetMark('link')
            .run();
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        }
      },
      insertPhotos: (paths) => {
        if (editor) insertPhotoNodes(editor.state.selection.from, paths, editor);
      },
    }),
    [editor],
  );

  // The @ list, reading the line the caret is in.
  const field: MentionField = {
    read: () => {
      if (!editor) return null;
      const { selection } = editor.state;
      if (!selection.empty || !selection.$from.parent.isTextblock) return null;
      const { $from } = selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\n');
      return { text, caret: text.length };
    },
    focused: () => editor?.isFocused ?? false,
    put: (query, caret, words) => {
      if (!editor) return;
      const start = editor.state.selection.$from.start();
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: start + query.start, to: start + caret },
          { type: 'text', text: `@${words} ` },
        )
        .run();
    },
  };
  const mention = useMentionSuggestions({
    field,
    value,
    onChange: () => undefined,
    above: true,
    among: mentionScope.among,
    first: mentionScope.first,
  });
  mentionKeys.current = mention.onKeyDown;

  // The box says it has a list, as a textarea would (mention-suggestions.tsx).
  const { onSelect, onBlur, ...aria } = mention.boxProps;
  const look = useRef({ onSelect, onBlur });
  look.current = { onSelect, onBlur };
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    for (const [name, wanted] of Object.entries(aria)) {
      if (wanted === undefined) dom.removeAttribute(name);
      else dom.setAttribute(name, wanted);
    }
  });
  useEffect(() => {
    if (!editor) return;
    const select = () => {
      look.current.onSelect();
    };
    const blur = () => {
      look.current.onBlur();
    };
    editor.on('selectionUpdate', select);
    editor.on('blur', blur);
    return () => {
      editor.off('selectionUpdate', select);
      editor.off('blur', blur);
    };
  }, [editor]);

  return (
    <div className="relative">
      {mention.list}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Markdown as the editor's JSON: the shapes are the same, typed apart. */
const load = (markdown: string) => markdownToDoc(markdown) as JSONContent;

/**
 * Photographs at `at`, or just after the quote `at` is in: a post's
 * photograph is a line of its own, never quoted (lib/markdown.ts).
 */
function insertPhotoNodes(at: number, paths: string[], editor: Editor | null) {
  if (!editor || paths.length === 0) return;
  const $at = editor.state.doc.resolve(at);
  let where = at;
  for (let depth = 1; depth <= $at.depth; depth += 1) {
    if ($at.node(depth).type.name === 'blockquote') {
      where = $at.after(depth);
      break;
    }
  }
  editor
    .chain()
    .focus()
    .insertContentAt(
      where,
      paths.map((path) => ({ type: 'image', attrs: { path } })),
    )
    .run();
}

/**
 * A photograph in the words, by its path: "local:…" until it is uploaded,
 * then a path in the chat bucket. Only an image with a path is read from
 * pasted HTML (one copied within the editor): a picture copied from a web
 * page arrives as a file, through the paste above, or not at all.
 */
const Photo = Image.extend({
  // Not dragged: a drop could put it inside a quote.
  draggable: false,
  addAttributes() {
    return {
      path: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-path'),
        renderHTML: (attributes: { path?: string | null }) =>
          attributes.path ? { 'data-path': attributes.path } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-path]' }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PhotoView);
  },
}).configure({ inline: false, allowBase64: false });

function PhotoView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const path = typeof node.attrs.path === 'string' ? node.attrs.path : '';
  const local = useContext(LocalPhotos);
  const stored = useSmallCopies(path && !path.startsWith('local:') ? [path] : []);
  const url = path.startsWith('local:') ? local(path) : stored.small.get(path);
  return (
    <NodeViewWrapper
      className={`relative my-2 w-fit max-w-full rounded-[10px] ${selected ? 'outline-2 outline-emphasis outline-offset-2' : ''}`}
    >
      {url ? (
        <img
          src={url}
          alt="Photograph"
          className="block h-auto max-h-[14rem] w-auto max-w-full rounded-[10px]"
        />
      ) : (
        <div className="grid h-24 w-32 place-items-center rounded-[10px] bg-tint text-[0.75rem] text-grey">
          Photograph
        </div>
      )}
      {editor.isEditable ? (
        <button
          type="button"
          onClick={() => {
            deleteNode();
          }}
          aria-label="Take this photograph out"
          contentEditable={false}
          className="absolute top-1.5 right-1.5 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}
