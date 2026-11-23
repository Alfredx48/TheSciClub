import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type * as Mentions from '@/lib/mentions';
import { PostBody } from '@/routes/chat/post-body';

/** Every stored photograph signs; the signing is a storage call. */
vi.mock('@/lib/chat/attachments', () => ({
  useSmallCopies: (paths: readonly string[]) => {
    const urls = new Map(paths.map((path) => [path, `https://signed/${path}`]));
    return { small: urls, full: urls };
  },
}));

/** Who the @names are, as chat_authors would say (20261029070000). */
vi.mock('@/lib/mentions', async (importOriginal) => ({
  ...(await importOriginal<typeof Mentions>()),
  useMentionedMembers: () =>
    new Map([
      ['ana', { id: '0b6c7a3e-1d2f-4c5b-8a9e-0f1e2d3c4b5a', hasProfile: true }],
      ['hidden', { id: '1b6c7a3e-1d2f-4c5b-8a9e-0f1e2d3c4b5a', hasProfile: false }],
    ]),
}));

function renderBody(text: string) {
  render(
    <MemoryRouter initialEntries={['/chat/rooms/r/topics/t']}>
      <Routes>
        <Route path="/chat/rooms/r/topics/t" element={<PostBody text={text} />} />
        <Route path="/peers/:id" element={<p>Ana’s profile</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a post’s @mentions', () => {
  it('links a member with a profile, and leaves the others as words', () => {
    renderBody('Ask @ana, @hidden or @nobody about **ramps**');
    expect(screen.getByRole('link', { name: '@ana' })).toHaveAttribute(
      'href',
      '/peers/0b6c7a3e-1d2f-4c5b-8a9e-0f1e2d3c4b5a',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('ramps').tagName).toBe('STRONG');
  });

  it('opens the profile in the app', async () => {
    renderBody('Ask @ana');
    await userEvent.click(screen.getByRole('link', { name: '@ana' }));
    expect(screen.getByText('Ana’s profile')).toBeInTheDocument();
  });
});

describe('photographs in a post’s words', () => {
  it('draws six one after another as one grid of four tiles, the last saying how many more', () => {
    const six = Array.from({ length: 6 }, (_, n) => `rooms/r/${n + 1}.webp`);
    render(
      <MemoryRouter>
        <PostBody
          text={`Our ramp:\n\n${six.map((path) => `![Photo](${path})`).join('\n\n')}\n\nWhat do you think?`}
          photos={six}
          from="Bo"
        />
      </MemoryRouter>,
    );
    const tiles = screen.getAllByRole('button');
    expect(tiles).toHaveLength(4);
    expect(tiles[3]).toHaveAccessibleName('Photograph 4 of 6 from Bo, and 2 more. Open it.');
    expect(tiles[3]).toHaveTextContent('+2');
    expect(screen.getByText('What do you think?')).toBeInTheDocument();
  });
});
