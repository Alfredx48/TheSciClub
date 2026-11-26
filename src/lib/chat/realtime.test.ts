import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeRows } from '@/lib/chat/realtime';

/**
 * What can and cannot be proved here.
 *
 * Delivery cannot: the channel is a fake, so nothing in this file says a
 * message written by one member reaches another. That is checked by eye, with
 * two browsers on two test numbers, and it is written down in HANDOFF.md as
 * something to redo when this changes.
 *
 * What can be proved is the part that is easy to drop and impossible to notice:
 * that the hook **refetches on every subscribe and on every focus**. Realtime
 * delivers nothing while the socket is down and replays nothing when it comes
 * back, so a hook that only listened would silently miss whatever was said
 * during a tunnel. A test that only checked "it subscribes" would pass on that
 * broken version.
 */

interface Handler {
  event: string;
  filter: string | undefined;
  fire: (payload?: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => void;
}

interface FakeChannel {
  topic: string;
  handlers: Handler[];
  /** The callback `subscribe` was given, so a test can push a state at it. */
  status: (state: string) => void;
  on: (
    kind: string,
    config: { event: string; filter?: string },
    fire: Handler['fire'],
  ) => FakeChannel;
  subscribe: (callback: (state: string) => void) => FakeChannel;
}

const bus = vi.hoisted(() => ({
  channels: [] as FakeChannel[],
  removed: [] as string[],
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    channel(topic: string): FakeChannel {
      const channel: FakeChannel = {
        topic,
        handlers: [],
        status: () => undefined,
        on(_kind, config, fire) {
          channel.handlers.push({ event: config.event, filter: config.filter, fire });
          return channel;
        },
        subscribe(callback) {
          channel.status = callback;
          return channel;
        },
      };
      bus.channels.push(channel);
      return channel;
    },
    removeChannel(channel: FakeChannel) {
      bus.removed.push(channel.topic);
      return Promise.resolve('ok');
    },
  }),
}));

beforeEach(() => {
  bus.channels = [];
  bus.removed = [];
});

const only = () => {
  const channel = bus.channels[0];
  if (!channel) throw new Error('nothing subscribed');
  return channel;
};

describe('useRealtimeRows', () => {
  it('watches inserts and updates, and not deletes', () => {
    const onChange = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', filter: 'thread_id=eq.t1', onChange });
    });
    // Nothing in Chat deletes: removal is a soft update that blanks the body
    // and keeps the row, so it arrives as an UPDATE.
    expect(only().handlers.map((h) => h.event)).toEqual(['INSERT', 'UPDATE']);
    expect(only().handlers.every((h) => h.filter === 'thread_id=eq.t1')).toBe(true);
  });

  it('hears deletes when asked, unfiltered, passing the old row on', () => {
    // Me's own staff row (20261125160000): Realtime cannot filter a delete.
    const onChange = vi.fn();
    const onDelete = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'club_partners', filter: 'member_id=eq.m1', onChange, onDelete });
    });
    const deletes = only().handlers.filter((h) => h.event === 'DELETE');
    expect(deletes.map((h) => h.filter)).toEqual([undefined]);
    deletes[0]?.fire({ old: { member_id: 'm2' } });
    expect(onDelete).toHaveBeenCalledWith({ member_id: 'm2' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries no filter at all when it was not given one', () => {
    // The Chat list's subscription. RLS is what scopes it, not a filter.
    renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange: () => undefined });
    });
    expect(only().handlers.every((h) => h.filter === undefined)).toBe(true);
  });

  it('refetches the moment it subscribes, and on every reconnection', () => {
    const onChange = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_posts', onChange });
    });
    expect(onChange).not.toHaveBeenCalled();

    only().status('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(1);

    // A dropped socket coming back. Nothing said during the gap is replayed, so
    // the refetch is the only thing that recovers it.
    only().status('CLOSED');
    only().status('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // The first catch-up only covers the moment since the screen's own read
  // (2026-11-23: a topic read everything twice on opening); a reconnection
  // covers a gap of any length, so it still reads it all.
  it('gives the first subscribe to onFirstSubscribe, and every reconnection to onChange', () => {
    const onChange = vi.fn();
    const onFirstSubscribe = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_posts', onChange, onFirstSubscribe });
    });
    only().status('SUBSCRIBED');
    expect(onFirstSubscribe).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    only().status('CLOSED');
    only().status('SUBSCRIBED');
    expect(onFirstSubscribe).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('refetches when the window comes back', () => {
    const onChange = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange });
    });
    window.dispatchEvent(new Event('focus'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while the page is hidden, and once per screen when it is back', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const posts = vi.fn();
    const rows = vi.fn();
    const onRow = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_posts', onChange: posts });
      useRealtimeRows({ table: 'chat_messages', onChange: rows, onRow });
    });
    for (const channel of bus.channels) {
      for (const handler of channel.handlers) handler.fire({ new: { id: 'x' } });
      channel.status('SUBSCRIBED');
    }
    window.dispatchEvent(new Event('focus'));
    expect(posts).not.toHaveBeenCalled();
    expect(rows).not.toHaveBeenCalled();
    expect(onRow).not.toHaveBeenCalled();
    // Shown again: the page and the window both say so; each screen reads once.
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(posts).toHaveBeenCalledTimes(1);
    expect(rows).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it('passes a change on', () => {
    const onChange = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_topics', onChange });
    });
    for (const handler of only().handlers) handler.fire();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('hands a changed row to onRow, and keeps onChange for reconnects', () => {
    const onChange = vi.fn();
    const onRow = vi.fn();
    renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange, onRow });
    });
    only().handlers[0]?.fire({ new: { id: 'm1' } });
    expect(onRow).toHaveBeenCalledWith({ id: 'm1' }, 'INSERT');
    expect(onChange).not.toHaveBeenCalled();
    only().status('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing while there is nothing to watch', () => {
    // A screen whose id is not in the URL yet.
    renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange: () => undefined, enabled: false });
    });
    expect(bus.channels).toHaveLength(0);
  });

  it('gives every subscription its own channel and takes it down again', () => {
    // Two components can watch the same table at once — the Chat list watches every
    // message and an open conversation watches its own — and a shared topic is
    // how one unmounting takes the other's events with it.
    const first = renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange: () => undefined });
    });
    const second = renderHook(() => {
      useRealtimeRows({ table: 'chat_messages', onChange: () => undefined });
    });
    const topics = bus.channels.map((c) => c.topic);
    expect(new Set(topics).size).toBe(2);

    first.unmount();
    second.unmount();
    expect(bus.removed.sort()).toEqual(topics.sort());
  });

  it('does not rebuild the socket when only the callback changes', () => {
    // The callback is a new function on every render of the caller. Rebuilding
    // on it would tear the subscription down and up on every keystroke.
    const { rerender } = renderHook(
      ({ onChange }: { onChange: () => void }) => {
        useRealtimeRows({ table: 'chat_messages', onChange });
      },
      { initialProps: { onChange: () => undefined } },
    );
    rerender({ onChange: () => undefined });
    expect(bus.channels).toHaveLength(1);
  });

  it('uses the newest callback, not the one it subscribed with', () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { rerender } = renderHook(
      ({ onChange }: { onChange: () => void }) => {
        useRealtimeRows({ table: 'chat_messages', onChange });
      },
      { initialProps: { onChange: stale } },
    );
    rerender({ onChange: fresh });
    only().status('SUBSCRIBED');
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
