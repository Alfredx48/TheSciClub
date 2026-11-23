import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Topics from '@/lib/chat/topics';
import type { ChatAuthor } from '@/lib/chat/types';
import { TopicCard } from '@/routes/home/topic-card';
import { makeHomeTopic, makePost, makeRoom } from '@/test/factory';

vi.mock('@/lib/organizations', () => ({
  useOrganizations: () => ({ organizations: [{ id: 'o1', name: 'NorCal SCI' }] }),
}));

const sent = vi.hoisted(() => ({ calls: [] as unknown[][], failure: null as string | null }));
vi.mock('@/lib/chat/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof Topics>()),
  sendPost: (...args: unknown[]) => {
    sent.calls.push(args);
    return Promise.resolve(
      sent.failure ? { ok: false, error: sent.failure } : { ok: true, value: { id: 'answer-1' } },
    );
  },
}));

/**
 * The reply box stands in for itself: its editor (TipTap) does not run here. What is checked is
 * what the card gives it and does with what it sends.
 */
vi.mock('@/routes/chat/post-composer', () => {
  return {
    PostComposer: (props: {
      placeholder: string;
      sendLabel: string;
      draftKey?: string;
      folder: string;
      onSend: (body: string, paths: string[], anonymous: boolean) => Promise<string | null>;
    }) => {
      const [text, setText] = useState('');
      const [failure, setFailure] = useState<string | null>(null);
      return (
        <section aria-label="Your reply" data-draft={props.draftKey} data-folder={props.folder}>
          <textarea
            aria-label={props.placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          {failure ? <p role="alert">{failure}</p> : null}
          <button
            type="button"
            onClick={() => {
              void props.onSend(text, ['rooms/bowel/1.webp'], false).then(setFailure);
            }}
          >
            {props.sendLabel}
          </button>
        </section>
      );
    },
  };
});

beforeEach(() => {
  sent.calls = [];
  sent.failure = null;
});

const author = (o: Partial<ChatAuthor> & { id: string }): ChatAuthor => ({
  displayName: 'Jan',
  username: null,
  photoPath: null,
  photoAlt: null,
  avatarColor: null,
  level: 'T4',
  isAdmin: false,
  hasProfile: true,
  ...o,
});

function Where() {
  const location = useLocation();
  return (
    <p>
      at {location.pathname} with {JSON.stringify(location.state)}
    </p>
  );
}

function renderCard(props: Partial<Parameters<typeof TopicCard>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route
          path="/home"
          element={
            <TopicCard
              topic={makeHomeTopic({ id: 't1', title: 'Morning or evening routine?' })}
              starter={author({ id: 'a', displayName: 'Alex', level: 'C6' })}
              repliers={[]}
              linkState={{ from: 'home' }}
              {...props}
            />
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a topic on Home', () => {
  // The whole card is the target, but the link's name is the title alone:
  // not the room, the byline and the reply run together.
  it('is a link named for its title to the topic, and one on the room name to the room', async () => {
    const user = userEvent.setup();
    renderCard();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/chat/rooms/bowel',
      '/chat/rooms/bowel/topics/t1',
      '/peers/a',
    ]);
    const link = screen.getByRole('link', { name: 'Morning or evening routine?' });
    await user.click(link);
    expect(
      screen.getByText('at /chat/rooms/bowel/topics/t1 with {"from":"home"}'),
    ).toBeInTheDocument();
  });

  it('says which room it is in, and who asked', () => {
    renderCard({ topic: makeHomeTopic({ room: makeRoom({ name: 'Bowel management' }) }) });
    expect(screen.getByText('Bowel management')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex' }).closest('span')).toHaveTextContent(
      /^Alex · C6 · /,
    );
  });

  it('opens the profile from a name', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('link', { name: 'Alex' }));
    expect(screen.getByText('at /peers/a with {"from":"home"}')).toBeInTheDocument();
  });

  // Decorative: hidden from a screen reader, which has the name beside it.
  it('draws who asked with their picture beside their name', () => {
    renderCard();
    const row = screen.getByRole('link', { name: 'Alex' }).closest('p');
    const picture = row?.querySelector('[aria-hidden="true"]');
    expect(picture).not.toBeNull();
    expect(picture).toHaveTextContent(/\S/);
  });

  it('says Deleted member for somebody who has left, and not while a name is loading', () => {
    const { unmount } = renderCard({ topic: makeHomeTopic({ authorId: null }), starter: null });
    expect(screen.getByText(/^Deleted member · /)).toBeInTheDocument();
    unmount();
    renderCard({ topic: makeHomeTopic({ authorId: 'somebody' }), starter: null });
    expect(screen.queryByText(/Deleted member/)).toBeNull();
    expect(screen.getByText(/^… · /)).toBeInTheDocument();
  });

  it('shows the first reply, with who wrote it', () => {
    renderCard({
      topic: makeHomeTopic({
        replyCount: 3,
        firstReply: makePost({ authorId: 'j', body: 'Evenings, after a year of mornings.' }),
      }),
      repliers: [author({ id: 'j', displayName: 'Jan', level: 'T4' })],
    });
    // With when it came (the owner, 2026-11-18).
    expect(screen.getByRole('link', { name: 'Jan' }).closest('span')).toHaveTextContent(
      /^Jan · T4 · \S/,
    );
    expect(screen.getByText('Evenings, after a year of mornings.')).toBeInTheDocument();
    expect(screen.getByText('3 replies')).toBeInTheDocument();
  });

  it('says a reply was a photograph when it had no words', () => {
    renderCard({
      topic: makeHomeTopic({
        replyCount: 1,
        firstReply: makePost({ body: '', attachments: ['rooms/bowel/a.webp'] }),
      }),
    });
    expect(screen.getByText('Replied with a photograph.')).toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
  });

  it('says there are no replies yet, and never draws a zero', () => {
    renderCard({ topic: makeHomeTopic({ replyCount: 0, firstReply: null }) });
    expect(screen.getByText('No replies yet.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b0 repl/);
  });
});

describe('likes on a topic card', () => {
  const likes = (o: Partial<NonNullable<Parameters<typeof TopicCard>[0]['likes']>> = {}) => {
    const likedBy = o.likedBy ?? [];
    return {
      likedBy,
      readerId: 'me',
      score: likedBy.length,
      myVote: likedBy.includes('me') ? (1 as const) : (0 as const),
      boost: null,
      onToggle: vi.fn(),
      onDownvote: vi.fn(),
      failure: null,
      ...o,
    };
  };

  it('draws no likes until it is handed them', () => {
    renderCard();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // The card is a stretched link. In a browser the button is lifted above the
  // link's pseudo-element; here there is no layout, so what this can hold is
  // that the button is not inside the link and that pressing it goes nowhere.
  it('likes the opening post, named for the topic, without opening it', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderCard({ likes: likes({ likedBy: ['jan'], onToggle }) });
    const like = screen.getByRole('button', { name: 'Upvote Morning or evening routine?' });
    expect(like.closest('a')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Score 1 on Morning or evening routine?. Show who upvoted.',
      }),
    ).toBeInTheDocument();
    await user.click(like);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^at \//)).toBeNull();
  });

  it('says it is liked when the reader has', () => {
    renderCard({ likes: likes({ likedBy: ['me'] }) });
    expect(
      screen.getByRole('button', {
        name: 'Upvoted Morning or evening routine?. Press to take it back.',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('is reached by Tab after the title, and before the count', async () => {
    const user = userEvent.setup();
    renderCard({ likes: likes({ likedBy: ['jan'] }) });
    // The room's name first, where it is drawn.
    await user.tab();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Morning or evening routine?' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Alex' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Upvote Morning or evening routine?' }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Score 1 on/ })).toHaveFocus();
  });

  it('draws Like and the count on the reader’s own topic', () => {
    renderCard({ likes: likes({ likedBy: ['jan'], readerId: 'me' }) });
    expect(screen.getByRole('button', { name: /^Upvote/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Score 1 on/ })).toBeInTheDocument();
  });

  it('shows zero likes on a new topic', () => {
    renderCard({ likes: likes() });
    // Up and down; a score of nobody's votes is not a list to open.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('0')).toBeVisible();
  });

  it('says so when a like did not land', () => {
    renderCard({ likes: likes({ failure: 'Your like was not saved. You cannot like this.' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Your like was not saved.');
  });

  it('draws no likes when the opening post was taken back', () => {
    renderCard({
      topic: makeHomeTopic({ id: 't1', title: 'Morning or evening routine?', opening: null }),
      likes: likes({ likedBy: ['jan'] }),
    });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a question', () => {
  it('is drawn large and labelled, and still opens the topic', async () => {
    const user = userEvent.setup();
    renderCard({
      topic: makeHomeTopic({ id: 'q1', title: 'Best cushion for long days?', isQuestion: true }),
    });
    const link = screen.getByRole('link', { name: /Best cushion for long days\?/ });
    expect(link).toHaveTextContent('Question');
    expect(link).toHaveClass('bg-gradient-to-br');
    await user.click(link);
    expect(screen.getByText(/at \/chat\/rooms\/bowel\/topics\/q1/)).toBeInTheDocument();
  });

  // The owner, 2026-11-17: an @mention on Home opened only the question.
  it('lets an @Organization in a question open its page, and the card the question', async () => {
    const user = userEvent.setup();
    renderCard({
      topic: makeHomeTopic({ id: 'q2', title: 'Going to @NorCal SCI tonight?', isQuestion: true }),
    });
    expect(screen.getByRole('link', { name: 'Open the question' })).toHaveAttribute(
      'href',
      '/chat/rooms/bowel/topics/q2',
    );
    await user.click(screen.getByRole('link', { name: '@NorCal SCI' }));
    expect(screen.getByText(/at \/events\/organizations\/o1/)).toBeInTheDocument();
  });

  it('leaves an ordinary topic as a plain title', () => {
    renderCard();
    const link = screen.getByRole('link', { name: 'Morning or evening routine?' });
    expect(link).not.toHaveTextContent('Question');
    expect(link).not.toHaveClass('bg-gradient-to-br');
  });
});

describe('the room name on a card', () => {
  // jsdom draws no layers, so a click here reaches the name whatever covers
  // it in a browser. The title's link is stretched over the card by a later
  // ::after; without a z-index the name is under it and a press opens the
  // topic (found by the owner, 2026-10-10; confirmed in Chromium).
  it('is lifted above the title link stretched over the card', () => {
    renderCard({ topic: makeHomeTopic({ room: makeRoom({ name: 'Bowel management' }) }) });
    expect(screen.getByRole('link', { name: 'Bowel management' })).toHaveClass('relative', 'z-[1]');
  });

  it('opens the room, with the way back to Home', async () => {
    const user = userEvent.setup();
    renderCard({
      topic: makeHomeTopic({ id: 't1', room: makeRoom({ id: 'bowel', name: 'Bowel management' }) }),
    });
    await user.click(screen.getByRole('link', { name: 'Bowel management' }));
    expect(screen.getByText('at /chat/rooms/bowel with {"from":"home"}')).toBeInTheDocument();
  });
});

describe('answering a question from Home', () => {
  const question = () =>
    makeHomeTopic({
      id: 'q1',
      title: 'Best cushion?',
      isQuestion: true,
      room: makeRoom({ id: 'bowel' }),
    });

  it('offers Answer on a question', () => {
    renderCard({ topic: question(), answerAs: 'me' });
    expect(screen.getByRole('button', { name: 'Answer Best cushion?' })).toBeInTheDocument();
  });

  it('offers nothing on an ordinary topic, or to nobody', () => {
    renderCard({ answerAs: 'me' });
    expect(screen.queryByRole('button', { name: /^Answer/ })).toBeNull();
  });

  it('opens the topic’s own reply box, with its draft, and the cursor in it', async () => {
    const user = userEvent.setup();
    renderCard({ topic: question(), answerAs: 'me' });
    await user.click(screen.getByRole('button', { name: 'Answer Best cushion?' }));
    const box = await screen.findByRole('textbox', { name: 'Your answer to Best cushion?' });
    await vi.waitFor(() => {
      expect(box).toHaveFocus();
    });
    const reply = screen.getByRole('region', { name: 'Your reply' });
    expect(reply).toHaveAttribute('data-draft', 'me:topic:q1');
    expect(reply).toHaveAttribute('data-folder', 'rooms/bowel');
  });

  it('posts the answer and opens the topic on it', async () => {
    const user = userEvent.setup();
    renderCard({ topic: question(), answerAs: 'me' });
    await user.click(screen.getByRole('button', { name: 'Answer Best cushion?' }));
    await user.type(await screen.findByRole('textbox', { name: /Your answer/ }), 'A ROHO.');
    await user.click(screen.getByRole('button', { name: 'Post answer' }));
    expect(
      await screen.findByText('at /chat/rooms/bowel/topics/q1 with {"from":"home"}'),
    ).toBeInTheDocument();
    expect(sent.calls).toEqual([['q1', 'me', 'A ROHO.', ['rooms/bowel/1.webp'], null, false]]);
  });

  it('keeps the answer when it is refused', async () => {
    const user = userEvent.setup();
    sent.failure = 'You cannot post in this room.';
    renderCard({ topic: question(), answerAs: 'me' });
    await user.click(screen.getByRole('button', { name: 'Answer Best cushion?' }));
    await user.type(await screen.findByRole('textbox', { name: /Your answer/ }), 'A ROHO.');
    await user.click(screen.getByRole('button', { name: 'Post answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot post in this room.');
    expect(screen.getByRole('textbox', { name: /Your answer/ })).toHaveValue('A ROHO.');
  });

  it('closes on Cancel', async () => {
    const user = userEvent.setup();
    renderCard({ topic: question(), answerAs: 'me' });
    await user.click(screen.getByRole('button', { name: 'Answer Best cushion?' }));
    await screen.findByRole('textbox', { name: /Your answer/ });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: /Your answer/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Answer Best cushion?' })).toBeInTheDocument();
  });
});

it('shows zero views on a new post and the real count after it has been read', () => {
  renderCard({ viewCount: 0 });
  expect(screen.getByText('0 views')).toBeVisible();
});
it('shows a positive view count', () => {
  renderCard({ viewCount: 3 });
  expect(screen.getByText('3 views')).toBeVisible();
});
