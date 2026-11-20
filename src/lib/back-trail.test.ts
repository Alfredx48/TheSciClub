import { describe, expect, it } from 'vitest';
import { type Arrival, nextTrail, type Step } from '@/lib/back-trail';

/**
 * The way back (the owner, 2026-11-18): to the screen the member was on, one
 * step a press, starting again at a tab.
 */
let keys = 0;
function at(path: string, state: unknown = null): Arrival {
  const [pathname = '', search = ''] = path.split('?');
  keys += 1;
  return { key: `k${keys}`, pathname, search: search ? `?${search}` : '', state };
}

/** A walk from nothing: each arrival pushed, as a tap on a card or link is. */
function walk(...paths: string[]): Step[] {
  return paths.reduce<Step[]>((trail, path) => nextTrail(trail, at(path), { move: 'PUSH' }), []);
}

const paths = (trail: readonly Step[]) => trail.map((each) => each.pathname);

describe('the way back', () => {
  it('remembers each screen opened from the last, across tabs’ addresses', () => {
    // A room, a post in it, then its author's profile, which lives under Peers.
    const trail = walk('/chat', '/chat/rooms/life', '/chat/rooms/life/topics/t1', '/peers/ana');
    expect(paths(trail)).toEqual([
      '/chat',
      '/chat/rooms/life',
      '/chat/rooms/life/topics/t1',
      '/peers/ana',
    ]);
    // The tab's first screen is named without waiting for its heading.
    expect(trail[0]?.name).toBe('Chat');
  });

  it('starts again at a tab’s first screen, whatever came before', () => {
    const trail = walk('/chat', '/chat/rooms/life', '/events?segment=orgs');
    expect(paths(trail)).toEqual(['/events']);
  });

  // Two screens must never bounce between each other: going to the one
  // before, by the line, a link on the page or the browser, steps back.
  it('steps back rather than forward when the screen before is opened again', () => {
    const there = walk('/chat', '/chat/rooms/life', '/chat/rooms/life/topics/t1');
    const byLink = nextTrail(there, at('/chat/rooms/life'), { move: 'PUSH' });
    expect(paths(byLink)).toEqual(['/chat', '/chat/rooms/life']);

    const room = there[1];
    if (!room) throw new Error('no room');
    const byBrowser = nextTrail(there, { ...room }, { move: 'POP' });
    expect(paths(byBrowser)).toEqual(['/chat', '/chat/rooms/life']);
  });

  it('keeps one step for one screen when only its address’s tail changes', () => {
    const there = walk('/chat', '/chat/rooms/life');
    const sorted = nextTrail(there, at('/chat/rooms/life?sort=replies'), { move: 'PUSH' });
    expect(paths(sorted)).toEqual(['/chat', '/chat/rooms/life']);
    expect(sorted[1]?.search).toBe('?sort=replies');
  });

  it('lets a form become what it made', () => {
    const there = walk('/chat', '/chat/rooms/life', '/chat/rooms/life/new');
    const made = nextTrail(there, at('/chat/rooms/life/topics/t9'), { move: 'REPLACE' });
    expect(paths(made)).toEqual(['/chat', '/chat/rooms/life', '/chat/rooms/life/topics/t9']);
  });

  // Were a tab to go where it was left (none does now): the way back from there is
  // the one that led to it, not the tab just left.
  it('puts a tab’s own trail back when the tab returns to a deeper screen', () => {
    const chat = walk('/chat', '/chat/rooms/life', '/chat/rooms/life/topics/t1');
    const events = walk('/events');
    const back = nextTrail(events, at('/chat/rooms/life/topics/t1'), {
      move: 'PUSH',
      tab: true,
      kept: chat,
    });
    expect(paths(back)).toEqual(['/chat', '/chat/rooms/life', '/chat/rooms/life/topics/t1']);

    // Nothing kept that leads there: the screen alone, and its own parent.
    const alone = nextTrail(events, at('/peers/ana'), { move: 'PUSH', tab: true, kept: chat });
    expect(paths(alone)).toEqual(['/peers/ana']);
  });

  it('goes to a screen’s own parent, fresh, when nothing is remembered', () => {
    // Opened from a notification: one step, so the line used the screen's
    // own parent. Arriving there does not make the screen left its "back".
    const opened = walk('/chat/rooms/life/topics/t1');
    const parent = nextTrail(opened, at('/chat/rooms/life'), { move: 'PUSH', back: true });
    expect(paths(parent)).toEqual(['/chat/rooms/life']);
  });
});
