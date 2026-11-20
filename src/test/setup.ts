import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetPageReturnForTest } from '@/lib/page-return';
import { forgetSharedReads } from '@/lib/shared-reads';

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself only when Vitest's `globals` are on.
 * They are not, so without this every `render` stacks another copy of the
 * component in the same document — and a `queryBy…` that should find nothing
 * finds the previous test's markup instead. That fails honest tests and, worse,
 * passes dishonest ones.
 */
afterEach(cleanup);

/** Reads shared between screens start from nothing in each test (lib/shared-reads.ts). */
afterEach(forgetSharedReads);

/** Each test's first focus is a return of its own (lib/page-return.ts). */
afterEach(resetPageReturnForTest);

/**
 * No test may reach the network.
 *
 * Three times while Chat was built, a screen test called an unstubbed
 * `@/lib/chat` hook, the hook called the real Supabase client, and the client
 * talked to the **hosted project** — because `.env.local` points there and
 * Vitest loads it like any other Vite process. Every one of those tests was
 * green: the read succeeded against production data, or failed slowly and was
 * swallowed by the hook's error path. The fix each time was one more `vi.mock`,
 * which fixes the test somebody noticed and not the class of fault.
 *
 * So the guard is here instead, once, for every test file. `fetch` and
 * `WebSocket` throw with the URL in the message, so a test that reaches for the
 * network fails on its first request and says where it was going. The cure is
 * always the same: stub the hook the screen actually calls.
 *
 * If a test ever has a legitimate reason to serve a request, it stubs `fetch`
 * itself with `vi.stubGlobal` — which is a decision in the file that needs it,
 * visible in review, rather than a door left open for everybody.
 */
function requestTarget(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) return String(input.url);
  return String(input);
}

globalThis.fetch = (input: RequestInfo | URL) => {
  throw new Error(
    `Tests must not use the network: fetch(${requestTarget(input)}). ` +
      'Stub the hook or module that made this request.',
  );
};

globalThis.WebSocket = function BlockedWebSocket(url: string | URL) {
  throw new Error(
    `Tests must not use the network: WebSocket(${requestTarget(url)}). ` +
      'Stub the hook or module that opened this socket.',
  );
} as unknown as typeof WebSocket;

// Unsent words kept for a box (lib/chat/drafts.ts) must not carry into the
// next test of the same conversation.
afterEach(() => {
  // Node-only tests (scripts/, jobs/) have no sessionStorage.
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});
