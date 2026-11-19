import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAuthor } from '@/lib/chat/types';
import { PostLikes } from '@/routes/chat/like-button';

// Names are a read of chat_authors; `.env.local` points at the hosted
// project, so an unstubbed hook here would read production.
const db = vi.hoisted(() => ({ authors: new Map<string, ChatAuthor>() }));
vi.mock('@/lib/chat/authors', () => ({
  useChatAuthors: () => db.authors,
}));

const author = (o: Partial<ChatAuthor> & { id: string }): ChatAuthor => ({
  displayName: 'Jan',
  username: null,
  photoPath: null,
  photoAlt: null,
  avatarColor: null,
  level: 'T10',
  isAdmin: false,
  hasProfile: true,
  ...o,
});

beforeEach(() => {
  db.authors = new Map([
    ['jan', author({ id: 'jan', displayName: 'Jan' })],
    ['sam', author({ id: 'sam', displayName: 'Sam', level: null, hasProfile: false })],
  ]);
});

function renderLikes(props: Partial<Parameters<typeof PostLikes>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <MemoryRouter>
      <p>
        <button type="button">Before</button>
      </p>
      <PostLikes
        likedBy={['jan', 'sam']}
        readerId="me"
        what="Nicole's post"
        onToggle={onToggle}
        onDownvote={() => undefined}
        {...props}
      />
    </MemoryRouter>,
  );
  return onToggle;
}

describe('PostLikes', () => {
  // The robots, 2026-11-04: a liked post drew "Like" until its likes were read.
  it('draws neither arrow pressed while loading, nor a guessed score', () => {
    renderLikes({ likedBy: ['me'], loading: true });
    for (const button of screen.getAllByRole('button', {
      name: "Your vote on Nicole's post is not known",
    })) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('aria-pressed');
    }
    expect(screen.getByText('…')).toBeVisible();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('says when the score is unavailable rather than showing zero', () => {
    renderLikes({ likedBy: [], unavailable: true });
    expect(screen.getByText('Votes unavailable')).toBeVisible();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('upvotes and downvotes on a press, each named for the post', async () => {
    const onDownvote = vi.fn();
    const onToggle = renderLikes({ onDownvote });
    await userEvent.click(screen.getByRole('button', { name: "Upvote Nicole's post" }));
    await userEvent.click(screen.getByRole('button', { name: "Downvote Nicole's post" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onDownvote).toHaveBeenCalledOnce();
  });

  it('draws the score between the arrows and the reader’s vote pressed', () => {
    renderLikes({ likedBy: ['jan', 'me'], score: 7, myVote: 1 });
    expect(
      screen.getByRole('button', { name: "Score 7 on Nicole's post. Show who upvoted." }),
    ).toHaveTextContent('7');
    expect(
      screen.getByRole('button', { name: "Upvoted Nicole's post. Press to take it back." }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws a downvote pressed, and a score below zero', () => {
    renderLikes({ likedBy: [], score: -2, myVote: -1 });
    expect(
      screen.getByRole('button', { name: "Downvoted Nicole's post. Press to take it back." }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('−2')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Score/ })).toBeNull();
  });

  it('shows no boost to a member', () => {
    renderLikes({ score: 12 });
    expect(screen.queryByText(/Boost/)).toBeNull();
  });

  // The owner, 2026-11-18: an administrator's long press or right click boosts, and the click
  // that ends the long press is not also an upvote.
  describe('an administrator’s boost', () => {
    it('boosts on a right click, without upvoting', () => {
      const onBoost = vi.fn();
      const onToggle = renderLikes({ onBoost, boost: 10 });
      const up = screen.getByRole('button', { name: "Upvote Nicole's post" });
      fireEvent.contextMenu(up);
      fireEvent.click(up);
      expect(onBoost).toHaveBeenCalledExactlyOnceWith(true);
      expect(onToggle).not.toHaveBeenCalled();
      expect(screen.getByText('Boosted')).toBeVisible();
    });

    it('boosts on a long press, and the click that ends it does not upvote', () => {
      vi.useFakeTimers();
      try {
        const onBoost = vi.fn();
        const onToggle = renderLikes({ onBoost });
        const up = screen.getByRole('button', { name: "Upvote Nicole's post" });
        fireEvent.pointerDown(up, { pointerType: 'touch' });
        vi.advanceTimersByTime(600);
        fireEvent.pointerUp(up, { pointerType: 'touch' });
        fireEvent.click(up);
        expect(onBoost).toHaveBeenCalledExactlyOnceWith(true);
        expect(onToggle).not.toHaveBeenCalled();
        // A quick tap is still an upvote.
        vi.advanceTimersByTime(1500);
        fireEvent.pointerDown(up, { pointerType: 'touch' });
        fireEvent.pointerUp(up, { pointerType: 'touch' });
        fireEvent.click(up);
        expect(onToggle).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('can boost again or take the boost back from the list, for a keyboard', async () => {
      const onBoost = vi.fn();
      renderLikes({ onBoost, boost: 10 });
      await userEvent.click(screen.getByRole('button', { name: /^Score/ }));
      // Again moves the post up again, as another reply would (20261119120000).
      await userEvent.click(screen.getByRole('button', { name: 'Boost again' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove boost' }));
      expect(onBoost.mock.calls).toEqual([[true], [false]]);
    });
  });

  describe('the list of who upvoted', () => {
    async function open() {
      renderLikes();
      await userEvent.click(screen.getByRole('button', { name: /^Score 2 on/ }));
      return screen.getByRole('dialog', { name: 'Who upvoted this' });
    }

    it('is a dialog that says who can see it, with focus on its title', async () => {
      const dialog = await open();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveTextContent('Every member can see this list. Downvotes are anonymous.');
      expect(screen.getByRole('heading', { name: 'Who upvoted this' })).toHaveFocus();
    });

    it('names everybody, linking those with a profile', async () => {
      await open();
      expect(screen.getByRole('link', { name: 'Jan' })).toHaveAttribute('href', '/peers/jan');
      expect(screen.getByText('Sam')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Sam' })).toBeNull();
    });

    it('closes with Escape and puts focus back on the score', async () => {
      await open();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: /^Score 2 on/ })).toHaveFocus();
    });

    it('closes with Close and with the backdrop', async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /^Score 2 on/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Close the list' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps Tab inside it', async () => {
      await open();
      await userEvent.tab();
      expect(screen.getByRole('link', { name: 'Jan' })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('link', { name: 'Jan' })).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });
  });
});
