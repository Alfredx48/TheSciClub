import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Router from 'react-router-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Attachments from '@/lib/chat/attachments';
import type * as ChatRooms from '@/lib/chat/rooms';
import type * as Topics from '@/lib/chat/topics';
import type { ChatRoom } from '@/lib/chat/types';
import { makeRoom } from '@/test/factory';

/**
 * Starting a topic, asked from a room or from Home, and sharing a photograph.
 *
 * `topicProblem` and `backToHome` are left real: they are what the button
 * waits for and where Back goes, and a stub of either would let this file
 * assert its own answer. `useChatRooms`, `createTopic` and the uploads are the
 * network and are stubbed.
 */

const db = vi.hoisted(() => ({
  rooms: [] as ChatRoom[],
  created: [] as [string, string, string, string[]][],
  failure: null as string | null,
  uploads: [] as [string[], string][],
  deleted: [] as string[][],
  navigated: [] as [string, unknown][],
  questions: [] as boolean[],
}));

vi.mock('@/lib/account', () => ({ useAccount: () => ({ userId: 'member' }) }));

vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRooms>()),
  useChatRooms: () => ({ rooms: db.rooms, loading: false, error: null, reload: () => undefined }),
}));

vi.mock('@/lib/chat/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof Topics>()),
  createTopic: (
    roomId: string,
    title: string,
    body: string,
    paths: string[] = [],
    question = false,
  ) => {
    db.created.push([roomId, title, body, paths]);
    db.questions.push(question);
    return Promise.resolve(
      db.failure ? { ok: false, error: db.failure } : { ok: true, value: 'topic-1' },
    );
  },
}));

vi.mock('@/lib/chat/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof Attachments>()),
  uploadAttachments: (files: File[], folder: string) => {
    db.uploads.push([files.map((f) => f.name), folder]);
    return Promise.resolve({ ok: true, value: files.map((f) => `${folder}/${f.name}`) });
  },
  deleteAttachments: (paths: string[]) => {
    db.deleted.push(paths);
    return Promise.resolve();
  },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => (to: string, options?: { state?: unknown }) => {
    db.navigated.push([to, options?.state]);
  },
}));

const { default: NewTopicPage, topicProblem } = await import('@/routes/chat/new-topic');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  db.rooms = [makeRoom({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit' })];
  db.created = [];
  db.failure = null;
  db.uploads = [];
  db.deleted = [];
  db.navigated = [];
  db.questions = [];
});

function renderPage(state?: unknown, room = 'equip') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/chat/rooms/${room}/new`, state }]}>
      <Routes>
        <Route path="/chat/rooms/:roomId/new" element={<NewTopicPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const photo = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/jpeg' });
// The platform's picker behind the button, hidden from the accessibility tree
// on purpose; reached by its type, as new-room.test.tsx does.
const fileInput = (): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>('input[type=file]');
  if (!element) throw new Error('the form should carry a file input');
  return element;
};

const post = () => screen.getByRole('button', { name: 'Post it' });

describe('asking, from a room', () => {
  it('has the formatting toolbar on the first post', () => {
    renderPage();
    for (const name of ['Bold', 'Italic', 'Heading', 'Bulleted list', 'Numbered list', 'Link']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  });

  it('goes back to the room and says New post', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'New post' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Equipment & assistive tech' })).toHaveAttribute(
      'href',
      '/chat/rooms/equip',
    );
  });

  it('needs only a title, and posts the title as the first post when there is nothing else', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(post()).toBeDisabled();
    await user.type(screen.getByLabelText('What is it about?'), 'Side guards?');
    expect(post()).toBeEnabled();
    await user.click(post());
    await waitFor(() => {
      expect(db.created).toEqual([['equip', 'Side guards?', 'Side guards?', []]]);
    });
  });

  // The owner, 2026-11-17: a life story stopped at 4,000 characters.
  it('takes a first post far longer than a chat message, every word of it', async () => {
    const user = userEvent.setup();
    renderPage();
    const story = 'Twenty years of pushing. '.repeat(400).trim();
    await user.type(screen.getByLabelText('What is it about?'), 'My story');
    await user.click(screen.getByLabelText(/Details/));
    await user.paste(story);
    // Nothing counts down at the start of a long story.
    expect(screen.queryByText(/characters left/, { selector: '#topic-body-hint' })).toBeNull();
    await user.click(post());
    await waitFor(() => {
      expect(db.created).toEqual([['equip', 'My story', story, []]]);
    });
  });

  it('starts from the words carried over from the quick box', () => {
    renderPage({ draft: 'Which side guards last?', question: true });
    expect(screen.getByLabelText('What is it about?')).toHaveValue('Which side guards last?');
    expect(screen.getByRole('checkbox', { name: 'Question' })).toBeChecked();
  });

  // The owner, 2026-11-26: "when I hit add Details it brought up my previous
  // post. I should be adding Details to a question I was in the middle of
  // asking." The question opens; the post left unfinished is kept, and swaps back.
  it('opens on the words carried over, not on a post left unfinished, and keeps that one', async () => {
    const user = userEvent.setup();
    const { writeDraft } = await import('@/lib/chat/drafts');
    const left = { title: 'Cushion for a long drive', body: 'Half written', askedAs: '' };
    writeDraft('member:new-post:post', JSON.stringify({ version: 1, value: left }));
    renderPage({ draft: 'Which side guards last?', question: true });

    expect(await screen.findByLabelText('What is it about?')).toHaveValue(
      'Which side guards last?',
    );
    expect(screen.getByLabelText(/^Details/)).toHaveValue('');
    await user.type(screen.getByLabelText(/^Details/), 'Aluminium or plastic?');
    await user.click(screen.getByRole('button', { name: 'Switch to it' }));

    expect(await screen.findByLabelText('What is it about?')).toHaveValue(
      'Cushion for a long drive',
    );
    expect(screen.getByLabelText(/^Details/)).toHaveValue('Half written');
    expect(screen.getByText('“Which side guards last?”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to it' }));
    expect(await screen.findByLabelText(/^Details/)).toHaveValue('Aluminium or plastic?');
  });

  it('opens the topic with no state for Home', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('What is it about?'), 'Side guards');
    await user.type(screen.getByLabelText(/^Details/), 'Which ones last?');
    await user.click(post());
    await waitFor(() => {
      expect(db.navigated).toEqual([['/chat/rooms/equip/topics/topic-1', undefined]]);
    });
  });
});

describe('asking, from Home', () => {
  const fromHome = { from: 'home', segment: 'topics', kind: 'ask' };

  it('goes back to the pill on Home it came from, and changes nothing else', () => {
    renderPage(fromHome);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home?segment=topics',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'New post' })).toBeInTheDocument();
    expect(screen.getByLabelText('What is it about?')).toBeInTheDocument();
    expect(post()).toBeDisabled();
  });

  it('hands the topic the way back to Home', async () => {
    const user = userEvent.setup();
    renderPage(fromHome);
    await user.type(screen.getByLabelText('What is it about?'), 'Side guards');
    await user.type(screen.getByLabelText(/^Details/), 'Which ones last?');
    await user.click(post());
    await waitFor(() => {
      expect(db.navigated).toEqual([
        ['/chat/rooms/equip/topics/topic-1', { from: 'home', segment: 'topics' }],
      ]);
    });
  });
});

describe('sharing a photograph, from Home', () => {
  const sharing = { from: 'home', segment: 'photos', kind: 'share' };

  it('says so, and puts the picker before the words', () => {
    renderPage(sharing);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Share a photograph' }),
    ).toBeInTheDocument();
    const title = screen.getByLabelText('Say something about it');
    const picker = screen.getByRole('button', { name: /photograph/i });
    // The picker comes first in the page, so first in reading and Tab order.
    expect(picker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('accepts a title and a photograph with no other words', async () => {
    const user = userEvent.setup();
    renderPage(sharing);
    await user.upload(fileInput(), photo('cushion.jpg'));
    await user.type(screen.getByLabelText('Say something about it'), 'Four hours, no marks');
    expect(post()).toBeEnabled();
    await user.click(post());
    await waitFor(() => {
      expect(db.created).toEqual([
        ['equip', 'Four hours, no marks', '', ['rooms/equip/cushion.jpg']],
      ]);
    });
    expect(db.navigated).toEqual([
      ['/chat/rooms/equip/topics/topic-1', { from: 'home', segment: 'photos' }],
    ]);
  });

  it('refuses a photograph with no title, and says why', async () => {
    const user = userEvent.setup();
    renderPage(sharing);
    await user.upload(fileInput(), photo('cushion.jpg'));
    expect(post()).toBeDisabled();
    expect(
      screen.getByText('Say something about it. It is the line in the list.'),
    ).toBeInTheDocument();
  });

  it('accepts words with no photograph, as an ordinary topic', async () => {
    const user = userEvent.setup();
    renderPage(sharing);
    await user.type(screen.getByLabelText('Say something about it'), 'My first flat');
    expect(post()).toBeDisabled();
    expect(screen.getByText('Add a photograph, or some words.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Details/), 'Step-free, at last.');
    expect(post()).toBeEnabled();
  });

  // What somebody has just typed is the most expensive thing on the page.
  it('keeps the draft on a refusal and takes the photograph back out', async () => {
    db.failure = 'The post was not created. You are not in this room.';
    const user = userEvent.setup();
    renderPage(sharing);
    await user.upload(fileInput(), photo('cushion.jpg'));
    await user.type(screen.getByLabelText('Say something about it'), 'Four hours, no marks');
    await user.click(post());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The post was not created. You are not in this room.',
    );
    expect(screen.getByLabelText('Say something about it')).toHaveValue('Four hours, no marks');
    expect(db.deleted).toEqual([['rooms/equip/cushion.jpg']]);
    expect(db.navigated).toEqual([]);
  });

  it('is asking when the state says anything else', () => {
    renderPage({ from: 'home', kind: 'something' });
    expect(screen.getByRole('heading', { level: 1, name: 'New post' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
  });
});

describe('what Post waits for', () => {
  it('asking wants a title, and the words are optional', () => {
    expect(topicProblem('', 'Words', 0, false)).not.toBeNull();
    expect(topicProblem('Title', '', 0, false)).toBeNull();
    expect(topicProblem('Title', 'Words', 0, false)).toBeNull();
  });

  it('sharing wants a title, and words or a photograph', () => {
    expect(topicProblem('', '', 1, true)).not.toBeNull();
    expect(topicProblem('Title', '  ', 0, true)).not.toBeNull();
    expect(topicProblem('Title', '', 1, true)).toBeNull();
    expect(topicProblem('Title', 'Words', 0, true)).toBeNull();
  });
});

describe('asking whether it is a question', () => {
  it('asks, unticked in a room, and sends what was chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    const box = screen.getByRole('checkbox', { name: 'Question' });
    expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText('What is it about?'), 'Side guards');
    await user.type(screen.getByLabelText(/^Details/), 'Which ones last?');
    await user.click(box);
    await user.click(post());
    await waitFor(() => {
      expect(db.questions).toEqual([true]);
    });
  });

  it('is not asked of a photograph being shared', () => {
    renderPage({ from: 'home', segment: 'photos', kind: 'share' });
    expect(screen.queryByRole('checkbox', { name: 'Question' })).toBeNull();
  });
});

// The owner, 2026-10-28: the App Feedback room's form reads as feedback.
describe('app feedback', () => {
  beforeEach(() => {
    db.rooms = [makeRoom({ id: 'equip', name: 'App Feedback', category: 'Kit' })];
  });

  it('says it is feedback, asks for it, and sends it, coming back to Me', async () => {
    const user = userEvent.setup();
    renderPage({ from: 'me' });
    expect(screen.getByRole('heading', { level: 1, name: 'New app feedback' })).toBeInTheDocument();
    expect(screen.getByLabelText('In a few words, what is it about?')).toHaveAttribute(
      'placeholder',
      'The map is hard to zoom on my phone',
    );
    expect(screen.getByRole('button', { name: 'Add a screenshot' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Question' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Me' })).toHaveAttribute('href', '/me');
    await user.type(screen.getByLabelText('In a few words, what is it about?'), 'Map zoom');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => {
      expect(db.created).toEqual([['equip', 'Map zoom', 'Map zoom', []]]);
    });
    expect(db.questions).toEqual([false]);
  });

  it('leaves every other room as it was', () => {
    db.rooms = [makeRoom({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit' })];
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'New post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a photograph' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post it' })).toBeInTheDocument();
  });
});

// The owner, 2026-10-28: the room can be changed while writing.
describe('choosing the room', () => {
  beforeEach(() => {
    db.rooms = [
      makeRoom({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit' }),
      makeRoom({ id: 'general', name: 'General', category: 'General' }),
      makeRoom({ id: 'shut', name: 'Not open yet', category: 'Kit', openedAt: null }),
      makeRoom({ id: 'fb', name: 'App Feedback', category: 'Kit' }),
    ];
  });

  it('offers the open rooms, and moves the post to another, keeping what came with it', async () => {
    const user = userEvent.setup();
    const state = { from: 'home', segment: 'all', draft: 'Side guards?' };
    renderPage(state);
    const select = screen.getByLabelText('Room');
    expect(select).toHaveValue('equip');
    const names = [...(select as HTMLSelectElement).options].map((o) => o.textContent);
    expect(names).toEqual(['General', 'Equipment & assistive tech']);
    await user.selectOptions(select, 'General');
    expect(db.navigated).toEqual([['/chat/rooms/general/new', state]]);
  });

  // The owner, 2026-11-21: List something in Giving away opened General, on a
  // post half written there.
  it('opens a Marketplace room on its own listing, never on a post half written elsewhere', async () => {
    const user = userEvent.setup();
    db.rooms.push(makeRoom({ id: 'giving-away', name: 'Giving away', category: 'Classifieds' }));
    const first = renderPage();
    await user.type(screen.getByLabelText('What is it about?'), 'Half a thought');
    first.unmount();

    const listing = renderPage(undefined, 'giving-away');
    expect(screen.getByLabelText('Room')).toHaveValue('giving-away');
    expect(screen.getByLabelText('What are you listing?')).toHaveValue('');
    await user.type(screen.getByLabelText('What are you listing?'), 'Shower chair');
    listing.unmount();

    renderPage(undefined, 'giving-away');
    expect(screen.getByLabelText('What are you listing?')).toHaveValue('Shower chair');
    cleanup();
    renderPage();
    expect(screen.getByLabelText('What is it about?')).toHaveValue('Half a thought');
  });

  it('is not offered on the App Feedback form', () => {
    db.rooms = [makeRoom({ id: 'equip', name: 'App Feedback', category: 'Kit' })];
    renderPage();
    expect(screen.queryByLabelText('Room')).toBeNull();
  });
});
