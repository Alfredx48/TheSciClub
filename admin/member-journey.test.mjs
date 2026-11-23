import { expect, it } from 'vitest';
import { allowedRequest } from './member-journey.mjs';

it('lets the browser read its own project without recording views or making app writes', () => {
  const project = 'https://probe.supabase.co';
  const allowed = (path, method) => allowedRequest(new URL(path, project), method, project);

  expect(allowed('/rest/v1/members', 'GET')).toBe(true);
  expect(allowed('/rest/v1/rpc/home_feed', 'POST')).toBe(true);
  expect(allowed('/storage/v1/object/sign/chat/post.webp', 'POST')).toBe(true);
  expect(allowed('/rest/v1/rpc/chat_mark_thread_read_through', 'POST')).toBe(false);
  expect(allowed('/rest/v1/rpc/record_event_view', 'POST')).toBe(false);
  expect(allowed('/rest/v1/chat_messages', 'POST')).toBe(false);
  expect(allowed('https://other-project.supabase.co/rest/v1/members', 'GET')).toBe(false);
});
