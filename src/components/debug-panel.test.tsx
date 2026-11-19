import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugPanel } from '@/components/debug-panel';
import {
  debugChain,
  debugMark,
  debugReport,
  debugRequest,
  debugScreen,
  debugState,
  markParts,
  resetDebugLog,
  summarize,
} from '@/lib/debug-log';
import { timedFetch } from '@/lib/page-speed';

const account = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/lib/account', () => ({ useAccount: () => ({ isAdmin: account.isAdmin }) }));

/**
 * Home, reached by a tap at 1000 on the page's clock: the ranking, then the
 * posts once it has answered, the events beside them, and much later a post
 * marked seen. As the owner's first list went (2026-11-18), in small.
 */
function aVisit() {
  debugScreen('/home', 1000, false);
  debugRequest('rpc:home_topics_ranked', '', 1040, 600, true, 2100);
  debugRequest('table:chat_topics', 'select=id,title', 1650, 300, true, null);
  debugRequest('table:events', 'select=*', 1045, 250, false, null);
  debugRequest('rpc:chat_mark_posts_seen', '', 5000, 100, true, null);
}

const visit = () => {
  const [only] = debugState().screens;
  if (!only) throw new Error('no screen');
  return only;
};

beforeEach(() => {
  account.isAdmin = true;
  resetDebugLog(true);
  vi.restoreAllMocks();
});

describe('debug mode', () => {
  // The owner, 2026-11-18: how long each request takes, to see why Home is slow.
  it('lists a screen’s requests with when each started and how long it took', async () => {
    aVisit();
    render(<DebugPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Debug/ }));
    const lists = screen.getAllByRole('list');
    const list = lists[lists.length - 1];
    if (!list) throw new Error('no list');
    // In the order they were asked, each timed from reaching the screen; one
    // asked long after the screen had loaded is said to be later.
    expect([...list.querySelectorAll('li')].map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^rpc:home_topics_ranked\+40 ms600 ms/),
      expect.stringMatching(/^✕ table:events\+45 ms250 ms/),
      expect.stringMatching(/^table:chat_topics\+650 ms300 ms/),
      expect.stringMatching(/^rpc:chat_mark_posts_seenlater, \+4\.00 s100 ms/),
    ]);
  });

  // The owner's first list said "last reply after 16.66 s" of a Home that had
  // loaded in under two: a badge count much later was taken for its loading,
  // and a request still out was named as one the posts had waited for.
  it('counts as loading only what was asked before a quiet second, and as waited for only what had answered', () => {
    aVisit();
    expect(summarize(visit())).toMatchObject({
      count: 4,
      loadingCount: 3,
      failed: 1,
      lastReplyMs: 950,
      addedMs: 1150,
    });
    // The posts were asked for when the ranking answered; the events' read
    // answered before that too, but earlier, and ran beside it.
    expect(debugChain(visit()).map((request) => request.endpoint)).toEqual([
      'rpc:home_topics_ranked',
      'table:chat_topics',
    ]);
  });

  // The owner, 2026-11-18: "how long it takes for the posts to render and
  // what are the constituent parts".
  it('says when a screen’s posts were on the glass, in parts that add up to it', () => {
    aVisit();
    debugRequest('table:members', '', 1010, 25, true, null);
    vi.spyOn(performance, 'now').mockReturnValue(2010);
    debugMark('/home', 'Fresh posts on screen', [
      'table:members',
      'rpc:home_topics_ranked',
      'table:chat_topics',
    ]);
    const [mark] = visit().marks;
    if (!mark) throw new Error('no mark');
    expect(mark).toMatchObject({ label: 'Fresh posts on screen', ms: 1010 });
    const parts = markParts(visit(), mark);
    expect(parts).toEqual([
      { label: 'before the first request', ms: 10 },
      { label: 'table:members', ms: 25 },
      { label: 'between requests', ms: 5 },
      { label: 'rpc:home_topics_ranked', ms: 600 },
      { label: 'between requests', ms: 10 },
      { label: 'table:chat_topics', ms: 300 },
      { label: 'rendering, after the last reply', ms: 60 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.ms, 0)).toBe(mark.ms);
  });

  it('keeps nothing while it is off', () => {
    resetDebugLog(false);
    aVisit();
    expect(debugState().screens).toEqual([]);
  });

  it('keeps push endpoint filters out of debug mode and query details out of copied reports', async () => {
    aVisit();
    const request = timedFetch(() => Promise.resolve(new Response()));
    await request('https://test.example/rest/v1/push_subscriptions?endpoint=eq.example-device');
    expect(visit().requests.at(-1)).toMatchObject({
      endpoint: 'table:push_subscriptions',
      detail: '',
    });
    const report = debugReport(visit());
    expect(report).toContain('table:push_subscriptions');
    expect(report).toContain('table:chat_topics');
    expect(report).not.toContain('example-device');
    expect(report).not.toContain('select=');
  });

  // An administrator's tool: nobody else is shown it, whatever their browser holds.
  it('draws nothing for a member who is not an administrator', () => {
    account.isAdmin = false;
    aVisit();
    const { container } = render(<DebugPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
