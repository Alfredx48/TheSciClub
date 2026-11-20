import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Topics from '@/lib/chat/topics';
import type { ChatRoom } from '@/lib/chat/types';
import { QuickAsk } from '@/routes/chat/quick-ask';
import { makeRoom } from '@/test/factory';

const db = vi.hoisted(() => ({
  created: [] as unknown[][],
  failure: null as string | null,
}));

// Looking up similar questions is the network; stubbed, with what it finds.
const similar = vi.hoisted(() => ({
  found: [] as { id: string; roomId: string; title: string; replyCount: number }[],
}));
vi.mock('@/lib/chat/similar', () => ({ useSimilarTopics: () => similar.found }));
vi.mock('@/lib/chat/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof Topics>()),
  createTopic: (...args: unknown[]) => {
    db.created.push(args);
    return Promise.resolve(
      db.failure ? { ok: false, error: db.failure } : { ok: true, value: 'new-topic' },
    );
  },
}));

const rooms: ChatRoom[] = [
  makeRoom({ id: 'general', name: 'General', category: 'General', sortOrder: 0 }),
  makeRoom({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit', sortOrder: 11 }),
];

function Where() {
  const location = useLocation();
  return (
    <p>
      at {location.pathname} with {JSON.stringify(location.state)}
    </p>
  );
}

function renderAsk(props: Partial<Parameters<typeof QuickAsk>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/here']}>
      <Routes>
        <Route path="/here" element={<QuickAsk rooms={rooms} memberId="member-one" {...props} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.created = [];
  db.failure = null;
  similar.found = [];
  sessionStorage.clear();
  localStorage.clear();
});

describe('asking from Home', () => {
  it('is one box until it is tapped', () => {
    renderAsk();
    expect(screen.getByRole('textbox', { name: 'Ask or post to the club' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  // The owner, 2026-10-22: the choices open with the tap, before any words.
  it('opens its choices as soon as the box is tapped, and folds them away empty', async () => {
    renderAsk();
    await userEvent.click(screen.getByRole('textbox', { name: 'Ask or post to the club' }));
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add details or a photo' })).toBeInTheDocument();
    // Moving within the box keeps it open.
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    // Leaving it empty folds it up.
    await userEvent.click(document.body);
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
    // The X folds it up with the words thrown away (the owner, 2026-11-09).
    const box = screen.getByRole('textbox', { name: 'Ask or post to the club' });
    await userEvent.type(box, 'Never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Close without posting' }));
    expect(box).toHaveValue('');
    expect(box).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  // The owner, 2026-11-20: tapping Anonymous or "?" in an empty box closed it. A phone does
  // not focus a tick box or button it taps, so the words lose focus to nothing.
  it('stays open, explanation and all, when a tap inside does not take focus', async () => {
    renderAsk();
    const box = screen.getByRole('textbox', { name: 'Ask or post to the club' });
    await userEvent.click(box);
    const help = screen.getByRole('button', { name: 'What Question and Anonymous do' });
    fireEvent.pointerDown(help);
    fireEvent.blur(box, { relatedTarget: null });
    fireEvent.click(help);
    expect(
      await screen.findByRole('dialog', { name: 'Question and Anonymous' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    // Closing the sheet is a press inside it: still open.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    // A press anywhere else, taking focus away, folds it, empty.
    fireEvent.pointerDown(document.body);
    fireEvent.blur(box, { relatedTarget: null });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
    });
  });

  it('posts to General as a question in one tap, and opens it with the way back', async () => {
    const user = userEvent.setup();
    renderAsk({ linkState: { from: 'home', segment: 'topics' } });
    await user.type(
      screen.getByRole('textbox', { name: 'Ask or post to the club' }),
      'Best cushion?',
    );
    expect(screen.getByRole('combobox')).toHaveValue('general');
    expect(screen.getByRole('checkbox', { name: 'Question' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(db.created).toEqual([['general', 'Best cushion?', 'Best cushion?', [], true, false]]);
    });
    expect(
      screen.getByText(
        'at /chat/rooms/general/topics/new-topic with {"from":"home","segment":"topics"}',
      ),
    ).toBeInTheDocument();
  });

  it('posts with Enter, to the room chosen, as not a question when unticked', async () => {
    const user = userEvent.setup();
    renderAsk();
    const box = screen.getByRole('textbox', { name: 'Ask or post to the club' });
    await user.type(box, 'My new chair');
    await user.selectOptions(screen.getByRole('combobox'), 'equip');
    await user.click(screen.getByRole('checkbox', { name: 'Question' }));
    await user.type(box, '{Enter}');
    await waitFor(() => {
      expect(db.created).toEqual([['equip', 'My new chair', 'My new chair', [], false, false]]);
    });
  });

  it('will not post spaces', async () => {
    const user = userEvent.setup();
    renderAsk();
    await user.type(screen.getByRole('textbox', { name: 'Ask or post to the club' }), '   ');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('carries the words to the room’s full form for details or a photo', async () => {
    const user = userEvent.setup();
    renderAsk({ linkState: { from: 'home', segment: 'topics' } });
    await user.type(
      screen.getByRole('textbox', { name: 'Ask or post to the club' }),
      'Best cushion?',
    );
    await user.click(screen.getByRole('link', { name: 'Add details or a photo' }));
    expect(
      screen.getByText(
        'at /chat/rooms/general/new with {"from":"home","segment":"topics","draft":"Best cushion?","question":true,"anonymous":false}',
      ),
    ).toBeInTheDocument();
  });

  it('keeps what was typed when the post is refused', async () => {
    const user = userEvent.setup();
    db.failure = 'You cannot post in this room.';
    renderAsk();
    await user.type(screen.getByRole('textbox', { name: 'Ask or post to the club' }), 'Anyone?');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot post in this room.');
    expect(screen.getByRole('textbox', { name: 'Ask or post to the club' })).toHaveValue('Anyone?');
  });

  it('recovers a draft and its anonymous posting choice after the session ends', async () => {
    const user = userEvent.setup();
    const first = renderAsk();
    const name = 'Ask or post to the club';
    await user.type(screen.getByRole('textbox', { name }), 'Half a question');
    await user.click(screen.getByRole('checkbox', { name: 'Anonymous' }));
    first.unmount();
    sessionStorage.clear();

    renderAsk();
    await user.click(screen.getByRole('button', { name: 'Resume draft' }));
    expect(screen.getByRole('textbox', { name })).toHaveFocus();
    expect(screen.getByRole('textbox', { name })).toHaveValue('Half a question');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(db.created[0]).toEqual([
      'general',
      'Half a question',
      'Half a question',
      [],
      true,
      true,
    ]);
  });
});

describe('asking in a room', () => {
  it('names the room, offers no picker, and posts there', async () => {
    const user = userEvent.setup();
    const equip = rooms[1];
    if (!equip) throw new Error('fixture');
    renderAsk({ fixedRoom: equip });
    const box = screen.getByRole('textbox', { name: 'Ask or post in Equipment & assistive tech' });
    await user.type(box, 'Side guards?');
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(db.created).toEqual([['equip', 'Side guards?', 'Side guards?', [], true, false]]);
    });
  });
});

describe('questions already asked', () => {
  it('offers what looks the same, as links to read first', async () => {
    const user = userEvent.setup();
    similar.found = [
      { id: 't9', roomId: 'equip', title: 'Best cushion for long days', replyCount: 4 },
    ];
    renderAsk();
    await user.type(
      screen.getByRole('textbox', { name: 'Ask or post to the club' }),
      'Which cushion for long days?',
    );
    const link = screen.getByRole('link', { name: /Best cushion for long days/ });
    expect(link).toHaveAttribute('href', '/chat/rooms/equip/topics/t9');
    expect(link).toHaveTextContent('4 replies');
    // Nothing stops asking anyway.
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
  });

  it('says nothing when nothing matches', async () => {
    const user = userEvent.setup();
    renderAsk();
    await user.type(
      screen.getByRole('textbox', { name: 'Ask or post to the club' }),
      'Something new',
    );
    expect(screen.queryByText('Already asked')).toBeNull();
  });
});
