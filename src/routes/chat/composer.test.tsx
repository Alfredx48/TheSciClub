import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnounceProvider } from '@/lib/announce';
import { MAX_ATTACHMENTS } from '@/lib/chat/attachments';
import { Composer } from '@/routes/chat/composer';

/**
 * What the composer hands over, and when it will not. Object URLs are stubbed
 * because jsdom has none; the strip is asserted by its controls, not its
 * pictures.
 */
beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:preview',
    revokeObjectURL: () => undefined,
  });
});

const photo = (name: string, size = 100, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type });

// The input is the platform's own picker behind the button, hidden from the
// accessibility tree on purpose — the button is the control. Reached by its
// type rather than by a label it deliberately does not have.
const fileInput = (): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>('input[type=file]');
  if (!element) throw new Error('the composer should carry a file input');
  return element;
};

type OnSend = (body: string, files: File[]) => Promise<string | null>;

function renderComposer(onSend = vi.fn<OnSend>(() => Promise.resolve(null))) {
  render(
    <Composer placeholder="Message Bo" sendLabel="Send this message" onSend={onSend} sendOnEnter />,
  );
  return onSend;
}

describe('the composer', () => {
  it('will not send nothing', () => {
    renderComposer();
    expect(screen.getByRole('button', { name: 'Send this message' })).toBeDisabled();
  });

  it('sends the words with no photographs', async () => {
    const onSend = renderComposer();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Hello{Enter}');
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Hello', []);
    });
  });

  // The owner, 2026-11-21: after a long message went, the empty box stayed as tall as it was.
  // A frame can come before React has emptied the box, so one is run at once here.
  it('shrinks back to one line once a long message has gone', async () => {
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });
    const tall = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLTextAreaElement) {
        return this.value.length > 20 ? 300 : 44;
      });
    const onSend = renderComposer();
    const user = userEvent.setup();
    const box = screen.getByRole('textbox');
    await user.type(box, 'A message long enough to wrap onto many lines');
    expect(box.style.height).toBe('300px');
    await user.click(screen.getByRole('button', { name: 'Send this message' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(box.style.height).toBe('44px');
    });
    tall.mockRestore();
  });

  // Words are optional once there is a photograph — the row's own check says
  // words *or* a picture.
  it('sends a photograph alone, and clears the strip once it has gone', async () => {
    const onSend = renderComposer();
    const user = userEvent.setup();
    const file = photo('cushion.jpg');
    await user.upload(fileInput(), file);
    expect(screen.getByRole('button', { name: 'Take back cushion.jpg' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send this message' });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('', [file]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
    });
  });

  // The owner, 2026-11-07: a chosen photograph opens full size before it goes.
  it('opens a chosen photograph full size, steps to the next, and closes back to it', async () => {
    renderComposer();
    const user = userEvent.setup();
    await user.upload(fileInput(), [photo('a.jpg'), photo('b.jpg')]);
    const opener = screen.getByRole('button', { name: 'Open a.jpg' });
    await user.click(opener);
    const viewer = screen.getByRole('dialog', { name: /Photographs to send/ });
    expect(viewer).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('img', { name: 'b.jpg' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Photographs to send/ })).toBeNull();
    expect(opener).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Take back a.jpg' })).toBeInTheDocument();
  });

  it('takes a chosen photograph back before it is sent', async () => {
    const onSend = renderComposer();
    const user = userEvent.setup();
    await user.upload(fileInput(), [photo('a.jpg'), photo('b.jpg')]);
    await user.click(screen.getByRole('button', { name: 'Take back a.jpg' }));
    expect(screen.queryByRole('button', { name: 'Take back a.jpg' })).toBeNull();
    await user.type(screen.getByRole('textbox'), 'One left{Enter}');
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const [, files] = onSend.mock.calls[0] as unknown as [string, File[]];
    expect(files.map((f) => f.name)).toEqual(['b.jpg']);
  });

  it('keeps the photos that fit and opens the library in single-select mode for the last slot', async () => {
    renderComposer();
    const user = userEvent.setup();
    const input = fileInput();
    const most = MAX_ATTACHMENTS;
    await user.upload(
      input,
      Array.from({ length: most + 1 }, (_, n) => photo(`${String(n + 1)}.jpg`)),
    );
    expect(screen.getAllByRole('button', { name: /Take back/ })).toHaveLength(most);
    expect(screen.queryByRole('button', { name: `Take back ${String(most + 1)}.jpg` })).toBeNull();

    await user.click(screen.getByRole('button', { name: `Take back ${String(most)}.jpg` }));
    expect(input.multiple).toBe(false);
    await user.upload(input, [photo('a.jpg'), photo('b.jpg')]);
    expect(screen.getByRole('button', { name: 'Take back a.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take back b.jpg' })).toBeNull();
    expect(
      screen.getByRole('button', { name: `${String(most)} photographs is the most` }),
    ).toBeDisabled();
  });

  it('refuses a video in a sentence that says what to do instead', () => {
    renderComposer();
    // Not user.upload: userEvent honours the input's `accept` and drops the
    // file before the picker sees it, and the picker's own check — for a
    // browser or a phone that offers the file anyway — is what is under test.
    fireEvent.change(fileInput(), { target: { files: [photo('clip.mp4', 10, 'video/mp4')] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/not a photograph.*video can be linked/);
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });

  it('keeps the words and the photographs when the send is refused', async () => {
    const onSend = vi.fn<OnSend>(() => Promise.resolve('The room closed while you typed.'));
    renderComposer(onSend);
    const user = userEvent.setup();
    await user.upload(fileInput(), photo('a.jpg'));
    await user.type(screen.getByRole('textbox'), 'Still here{Enter}');
    await waitFor(() => {
      expect(screen.getByText(/The room closed while you typed/)).toBeInTheDocument();
    });
    expect(screen.getByRole('textbox')).toHaveValue('Still here');
    expect(screen.getByRole('button', { name: 'Take back a.jpg' })).toBeInTheDocument();
  });
});

describe('editing in the composer', () => {
  type OnSave = (body: string) => Promise<string | null>;

  /** A message with a ••• that starts the edit, and the box below it. */
  function Harness({
    onSave,
    onSend,
    initial,
    photos,
  }: {
    onSave: OnSave;
    onSend: OnSend;
    initial: string;
    photos: number;
  }) {
    const [editing, setEditing] = useState(false);
    return (
      <AnnounceProvider>
        <div id="message-m1">
          <button
            type="button"
            data-item-actions=""
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit your message
          </button>
        </div>
        <Composer
          placeholder="Message Bo"
          sendLabel="Send this message"
          sendOnEnter
          onSend={onSend}
          editing={
            editing
              ? {
                  id: 'm1',
                  initial,
                  noun: 'message',
                  photos,
                  anchor: 'message-m1',
                  onSave,
                  onClose: () => {
                    setEditing(false);
                  },
                }
              : null
          }
        />
      </AnnounceProvider>
    );
  }

  function renderEditor(o: { initial?: string; photos?: number; refuse?: string } = {}) {
    const onSave = vi.fn<OnSave>(() => Promise.resolve(o.refuse ?? null));
    const onSend = vi.fn<OnSend>(() => Promise.resolve(null));
    render(
      <Harness
        onSave={onSave}
        onSend={onSend}
        initial={o.initial ?? 'First draft.'}
        photos={o.photos ?? 0}
      />,
    );
    return { onSave, onSend, user: userEvent.setup() };
  }

  /** Types an unsent draft, then chooses Edit. */
  async function startEditing(user: ReturnType<typeof userEvent.setup>, draft = 'Half a thought') {
    await user.type(screen.getByLabelText('Message Bo'), draft);
    await user.click(screen.getByRole('button', { name: 'Edit your message' }));
  }

  it('loads the words with the caret at the end, under an Editing bar', async () => {
    const { user } = renderEditor();
    await startEditing(user);
    const box = screen.getByLabelText('Edit your message');
    expect(box).toHaveValue('First draft.');
    expect(box).toHaveFocus();
    expect((box as HTMLTextAreaElement).selectionStart).toBe('First draft.'.length);
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeInTheDocument();
    // The same button, named for what it does now; no photo picker.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Send this message' })).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
    expect(await screen.findByText('Editing your message.')).toBeInTheDocument();
  });

  it('saves with Enter, sends nothing new, and gives the draft back', async () => {
    const { user, onSave, onSend } = renderEditor();
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), ' Second thoughts. {Enter}');
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('First draft. Second thoughts.', []);
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Message Bo')).toHaveValue('Half a thought');
    expect(screen.queryByText('Editing message')).toBeNull();
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    // Back to the message's •••.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit your message' })).toHaveFocus();
    });
  });

  it('saves with the button too', async () => {
    const { user, onSave } = renderEditor();
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('First draft.!', []);
    });
    expect(await screen.findByLabelText('Message Bo')).toHaveValue('Half a thought');
  });

  it('is cancelled by Cancel, giving the draft back unsaved', async () => {
    const { user, onSave } = renderEditor();
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), ' gone');
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(screen.getByLabelText('Message Bo')).toHaveValue('Half a thought');
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('Edit cancelled.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit your message' })).toHaveFocus();
    });
  });

  it('is cancelled by Escape', async () => {
    const { user, onSave } = renderEditor();
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), ' gone{Escape}');
    expect(screen.getByLabelText('Message Bo')).toHaveValue('Half a thought');
    expect(onSave).not.toHaveBeenCalled();
  });

  // The database refuses an edit that changes nothing, so "Edited" is never a lie.
  it('only closes on unchanged words, spaces included', async () => {
    const { user, onSave } = renderEditor();
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), '  {Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message Bo')).toHaveValue('Half a thought');
    expect(await screen.findByText('Nothing changed. Edit cancelled.')).toBeInTheDocument();
  });

  it('will not save nothing, and says Remove is the way', async () => {
    const { user, onSave } = renderEditor();
    await startEditing(user);
    await user.clear(screen.getByLabelText('Edit your message'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText(/To delete it, use Remove/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Edit your message'), '{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves blank words when the message has photographs, which stay', async () => {
    const { user, onSave } = renderEditor({ photos: 2 });
    await startEditing(user);
    expect(screen.getByText('Its 2 photographs stay as they are.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Edit your message'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('', []);
    });
  });

  it('keeps the edit open, with the words, when the save is refused', async () => {
    const { user } = renderEditor({ refuse: 'You can only edit your own message.' });
    await startEditing(user);
    await user.type(screen.getByLabelText('Edit your message'), '!{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/only edit your own message/);
    expect(screen.getByLabelText('Edit your message')).toHaveValue('First draft.!');
  });

  it('does not give back a draft that was sent while it was set aside', async () => {
    let complete!: (problem: string | null) => void;
    const onSend = vi.fn<OnSend>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<Harness onSave={vi.fn<OnSave>()} onSend={onSend} initial="First draft." photos={0} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Message Bo'), 'On its way{Enter}');
    await user.click(screen.getByRole('button', { name: 'Edit your message' }));
    await act(async () => {
      complete(null);
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(screen.getByLabelText('Message Bo')).toHaveValue('');
  });

  it('keeps photographs chosen for the draft while editing', async () => {
    const { user } = renderEditor();
    await user.upload(fileInput(), photo('a.jpg'));
    await startEditing(user, 'With a picture');
    expect(screen.queryByRole('button', { name: 'Take back a.jpg' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(screen.getByRole('button', { name: 'Take back a.jpg' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message Bo')).toHaveValue('With a picture');
  });
});

describe('the reply bar', () => {
  it('says who is being answered, focuses the box, and can be closed', async () => {
    const onCancel = vi.fn();
    render(
      <Composer
        placeholder="Reply to this topic"
        sendLabel="Post this reply"
        onSend={() => Promise.resolve(null)}
        replyingTo={{ id: 'p1', name: 'Jan', onCancel }}
      />,
    );
    expect(screen.getByText(/Replying to/)).toHaveTextContent('Replying to Jan');
    expect(screen.getByLabelText('Reply to this topic')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Stop replying' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('sending while writing', () => {
  it('preserves a changed draft when an earlier send completes', async () => {
    let complete!: (problem: string | null) => void;
    const onSend = vi.fn<OnSend>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    renderComposer(onSend);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'First message' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'Next unsent draft' } });
    await act(async () => {
      complete(null);
      await Promise.resolve();
    });
    expect(box).toHaveValue('Next unsent draft');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('First message', []);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not send composition Enter (%o)',
    (composition) => {
      const onSend = renderComposer();
      const box = screen.getByRole('textbox');
      fireEvent.change(box, { target: { value: 'Composed words' } });
      fireEvent.keyDown(box, { key: 'Enter', ...composition });
      expect(onSend).not.toHaveBeenCalled();
      expect(box).toHaveValue('Composed words');
    },
  );
});

// The owner, 2026-10-22: a picture pasted into the box is attached, through
// the same limits as one chosen with the button (lib/paste-photos.ts).
describe('pasting a picture', () => {
  /** What a paste carries: pictures as files, and any words as text. */
  const clipboard = (files: File[], text = '') => ({
    files,
    items: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  });

  it('attaches it, and sends it', async () => {
    const onSend = renderComposer();
    const notPasted = fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: clipboard([photo('image.png', 100, 'image/png')]),
    });
    // A picture alone pastes nothing into the words.
    expect(notPasted).toBe(false);
    expect(screen.getByRole('button', { name: 'Take back image.png' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send this message' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('', [expect.objectContaining({ name: 'image.png' })]);
    });
  });

  it('lets the words in the same paste through', () => {
    renderComposer();
    const pasted = fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: clipboard([photo('chart.png', 100, 'image/png')], 'From the article'),
    });
    expect(pasted).toBe(true);
    expect(screen.getByRole('button', { name: 'Take back chart.png' })).toBeInTheDocument();
  });

  it('refuses one past the most in a sentence, as the button does', async () => {
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      fileInput(),
      Array.from({ length: MAX_ATTACHMENTS }, (_, n) => photo(`${String(n + 1)}.jpg`)),
    );
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: clipboard([photo('more.png', 100, 'image/png')]),
    });
    expect(screen.getAllByRole('button', { name: /Take back/ })).toHaveLength(MAX_ATTACHMENTS);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('leaves a paste with no picture to the box', () => {
    renderComposer();
    const pasted = fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: clipboard([], 'Just words'),
    });
    expect(pasted).toBe(true);
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });
});

// The owner, 2026-10-28: photographs added to a post after it is posted.
describe('adding photographs while editing a post', () => {
  function renderPostEditor(photos: number) {
    const onSave = vi.fn((_body: string, _files: File[]) => Promise.resolve(null));
    render(
      <AnnounceProvider>
        <div id="post-p1" />
        <Composer
          placeholder="Reply"
          sendLabel="Post this reply"
          onSend={() => Promise.resolve(null)}
          editing={{
            id: 'p1',
            initial: 'Our setup.',
            noun: 'post',
            photos,
            addPhotos: true,
            anchor: 'post-p1',
            onSave,
            onClose: () => undefined,
          }}
        />
      </AnnounceProvider>,
    );
    return onSave;
  }

  it('saves the words unchanged with a photograph added', async () => {
    const onSave = renderPostEditor(1);
    expect(screen.getByText(/You can add more\./)).toBeInTheDocument();
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    if (!input) throw new Error('no picker');
    const photo = new File([new Uint8Array(10)], 'chair.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, photo);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith('Our setup.', [photo]);
  });

  it('offers no more once the post has the most it may', () => {
    renderPostEditor(MAX_ATTACHMENTS);
    expect(screen.queryByText(/You can add more\./)).toBeNull();
    expect(
      screen.getByRole('button', { name: `${String(MAX_ATTACHMENTS)} photographs is the most` }),
    ).toBeDisabled();
  });
});

// The owner, 2026-11-10: switching tabs and coming back keeps what was typed.
describe('a kept draft', () => {
  it('comes back with the box, per conversation, and goes once sent', async () => {
    sessionStorage.clear();
    localStorage.clear();
    const onSend = vi.fn<OnSend>(() => Promise.resolve(null));
    const box = (key: string) => (
      <AnnounceProvider>
        <Composer
          placeholder="Message Bo"
          sendLabel="Send this message"
          onSend={onSend}
          draftKey={key}
        />
      </AnnounceProvider>
    );
    const first = render(box('thread:a'));
    await userEvent.type(screen.getByPlaceholderText('Message Bo'), 'Half a thought');
    first.unmount();
    sessionStorage.clear();

    const other = render(box('thread:b'));
    expect(screen.getByPlaceholderText('Message Bo')).toHaveValue('');
    other.unmount();

    render(box('thread:a'));
    expect(screen.getByPlaceholderText('Message Bo')).toHaveValue('Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Send this message' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message Bo')).toHaveValue('');
    });
    expect(localStorage.getItem('club:kept-draft:thread:a')).toBeNull();
  });
});
