import { describe, expect, it } from 'vitest';
import {
  FALLBACK_TITLE,
  NAVIGATE,
  navigationRequest,
  pickWindow,
  readPushPayload,
  safePath,
} from '@/lib/push/payload';

const origin = 'https://thesciclub.netlify.app';

describe('safePath', () => {
  it('keeps a path on this origin, with its query and hash', () => {
    expect(safePath('/chat/t/abc', origin)).toBe('/chat/t/abc');
    expect(safePath('/chat?segment=rooms#top', origin)).toBe('/chat?segment=rooms#top');
    expect(safePath(`${origin}/events`, origin)).toBe('/events');
  });

  it('sends anything that would leave the club home', () => {
    expect(safePath('https://evil.example/login', origin)).toBe('/');
    expect(safePath('//evil.example/login', origin)).toBe('/');
    expect(safePath('javascript:alert(1)', origin)).toBe('/');
    expect(safePath('http://thesciclub.netlify.app/chat', origin)).toBe('/');
  });

  // The administrators' alerts open the admin site (20261122090000): its front
  // page exactly, and nothing else there or like it.
  it('lets out only the admin site front page', () => {
    expect(safePath('https://admin.thesciclub.com/', origin)).toBe('https://admin.thesciclub.com/');
    expect(safePath('https://admin.thesciclub.com', origin)).toBe('https://admin.thesciclub.com/');
    expect(safePath('https://admin.thesciclub.com/peers/x', origin)).toBe('/');
    expect(safePath('https://admin.thesciclub.com/?next=//evil.example', origin)).toBe('/');
    expect(safePath('http://admin.thesciclub.com/', origin)).toBe('/');
    expect(safePath('https://admin.thesciclub.com.evil.example/', origin)).toBe('/');
  });

  it('sends nothing, or not a string, home', () => {
    expect(safePath(undefined, origin)).toBe('/');
    expect(safePath('', origin)).toBe('/');
    expect(safePath(42, origin)).toBe('/');
  });
});

describe('readPushPayload', () => {
  it('shows what the sender wrote and remembers where it goes', () => {
    const shown = readPushPayload(
      JSON.stringify({ title: 'Bo sent you a message', url: '/chat/t/abc', tag: 'thread:abc' }),
      origin,
    );
    expect(shown.title).toBe('Bo sent you a message');
    expect(shown.options.tag).toBe('thread:abc');
    expect(shown.options.data.url).toBe('/chat/t/abc');
  });

  // The lock screen's words are the sender's decision. Nothing here invents a
  // body, and an absent one is absent rather than an empty string.
  it('adds no body the sender did not send', () => {
    const shown = readPushPayload(JSON.stringify({ title: 'Bo sent you a message' }), origin);
    expect('body' in shown.options).toBe(false);
    expect('tag' in shown.options).toBe(false);
  });

  it('carries a body when the sender sent one', () => {
    const shown = readPushPayload(JSON.stringify({ title: 'Bo', body: 'See you Friday' }), origin);
    expect(shown.options.body).toBe('See you Friday');
  });

  // Every push must show something — see the file's header — so none of these
  // may throw or come back without a title.
  it.each([
    ['nothing at all', null],
    ['an empty body', ''],
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '"hello"'],
    ['JSON null', 'null'],
    ['a blank title', JSON.stringify({ title: '   ', url: '/chat' })],
  ])('falls back to activity without repeating the app name for %s', (_, raw) => {
    const shown = readPushPayload(raw, origin);
    expect(shown.title).toBe(FALLBACK_TITLE);
    expect(shown.options.icon).toBe('/favicon-192x192.png');
  });

  it('carries a badge number when there is one, and only a sensible one', () => {
    expect(readPushPayload(JSON.stringify({ title: 'x', badge: 3 }), origin).badge).toBe(3);
    expect(readPushPayload(JSON.stringify({ title: 'x', badge: 0 }), origin).badge).toBe(0);
    expect('badge' in readPushPayload(JSON.stringify({ title: 'x' }), origin)).toBe(false);
    expect('badge' in readPushPayload(JSON.stringify({ title: 'x', badge: -1 }), origin)).toBe(
      false,
    );
    expect('badge' in readPushPayload(JSON.stringify({ title: 'x', badge: '3' }), origin)).toBe(
      false,
    );
  });

  it('never keeps an address off the club', () => {
    const shown = readPushPayload(
      JSON.stringify({ title: 'x', url: 'https://evil.example/' }),
      origin,
    );
    expect(shown.options.data.url).toBe('/');
  });
});

describe('pickWindow', () => {
  const at = (path: string, focused = false) => ({ url: `${origin}${path}`, focused });

  it('opens a window when none is open', () => {
    expect(pickWindow([], '/chat', origin)).toBeNull();
  });

  it('prefers the window already showing the address', () => {
    expect(pickWindow([at('/peers', true), at('/chat/t/abc')], '/chat/t/abc', origin)).toBe(1);
  });

  it('then the focused one', () => {
    expect(pickWindow([at('/peers'), at('/events', true)], '/chat/t/abc', origin)).toBe(1);
  });

  it('then any', () => {
    expect(pickWindow([at('/peers'), at('/events')], '/chat/t/abc', origin)).toBe(0);
  });
});

describe('navigationRequest', () => {
  const origin = 'https://thesciclub.com';

  it('reads the address the worker asks the app to open', () => {
    expect(navigationRequest({ type: NAVIGATE, path: '/chat/t/abc?message=m' }, origin)).toBe(
      '/chat/t/abc?message=m',
    );
  });

  it('ignores anything else, and never leaves the club', () => {
    expect(navigationRequest({ type: 'other', path: '/chat' }, origin)).toBeNull();
    expect(navigationRequest(null, origin)).toBeNull();
    expect(navigationRequest({ type: NAVIGATE }, origin)).toBeNull();
    expect(navigationRequest({ type: NAVIGATE, path: 'https://evil.example/x' }, origin)).toBe('/');
  });
});
