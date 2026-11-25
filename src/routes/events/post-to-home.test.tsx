import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstClubLink } from '@/lib/chat/club-links';
import type * as ChatRooms from '@/lib/chat/rooms';
import type { ChatRoom } from '@/lib/chat/types';
import { makeEvent, makeRoom } from '@/test/factory';
import { PostToHome } from './post-to-home';

/**
 * Post on Home (the owner, 2026-11-25). The RSVP on Home is the card Home
 * draws for a post that links the club's own event, so what matters is that
 * the post this writes is one that card is drawn for. The room read and the
 * topic write are the network, stubbed; the write records what it was sent.
 */

const db = vi.hoisted(() => ({
  rooms: [] as ChatRoom[],
  created: [] as [string, string, string][],
}));

vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRooms>()),
  useChatRooms: () => ({ rooms: db.rooms, loading: false, error: null, reload: () => undefined }),
}));

vi.mock('@/lib/chat/topics', () => ({
  createTopic: (roomId: string, title: string, body: string) => {
    db.created.push([roomId, title, body]);
    return Promise.resolve({ ok: true, value: 'new-topic' });
  },
}));

beforeEach(() => {
  db.rooms = [
    makeRoom({ id: 'sport', name: 'Adaptive sport', category: 'Life', sortOrder: 9 }),
    makeRoom({ id: 'general', name: 'General', category: 'General', sortOrder: 0 }),
    // Started in the app, so found by its name.
    makeRoom({ id: 'events-1a2b', name: 'Events', category: 'Places', sortOrder: 20 }),
    // Not on Home, so not somewhere to post it.
    makeRoom({ id: 'feedback', name: 'App Feedback', category: 'Kit', showInHome: false }),
  ];
  db.created = [];
});

describe('posting an event on Home', () => {
  it('writes a post in the Events room, titled with the event, that Home draws as the event with its RSVP', async () => {
    const event = makeEvent({ id: '5d3c1a2b-0e4f-4a6b-8c9d-1e2f3a4b5c6d', title: 'Sled hockey' });
    render(
      <MemoryRouter>
        <PostToHome event={event} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Post on Home/ }));
    expect(screen.getByRole('combobox', { name: 'Room' })).toHaveValue('events-1a2b');
    expect(screen.queryByRole('option', { name: 'App Feedback' })).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: /A few words/ }), 'All levels');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(db.created).toHaveLength(1);
    });
    const [roomId, title, body] = db.created[0] ?? ['', '', ''];
    expect(roomId).toBe('events-1a2b');
    expect(title).toBe('Sled hockey');
    expect(body.startsWith('All levels\n\n')).toBe(true);
    expect(firstClubLink(body)).toMatchObject({ kind: 'event', ref: event.id });
    expect(await screen.findByRole('link', { name: 'See the post' })).toHaveAttribute(
      'href',
      '/chat/rooms/events-1a2b/topics/new-topic',
    );
  });
});
