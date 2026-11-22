import { describe, expect, it } from 'vitest';
import { deviceOf, endpointOf, keep } from './shape.ts';

// The owner, 2026-11-21: request logs without personal details (20261122040000).
describe('what is kept of a request', () => {
  it('names what was asked, never its arguments, ids or file names', () => {
    expect(endpointOf('/rest/v1/rpc/home_feed')).toBe('rpc:home_feed');
    expect(endpointOf('/rest/v1/members?id=eq.0b7c9f2e-1111-2222-3333-444455556666')).toBe(
      'table:members',
    );
    expect(endpointOf('/auth/v1/factors/0b7c9f2e-1111/verify')).toBe('auth:factors');
    expect(endpointOf('/storage/v1/object/public/photos/0b7c9f2e/face.jpg')).toBe('storage:public');
    expect(endpointOf('/storage/v1/object/private-bucket/someone/file.pdf')).toBe('storage:read');
    expect(endpointOf('/functions/v1/push-notify')).toBe('function:push-notify');
  });

  it('keeps the kind of device, not the browser words, and no address or member', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/605')).toBe(
      'iphone',
    );
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131 Mobile')).toBe('android');
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) Safari/605')).toBe('computer');
    const kept = keep({
      id: 'abc',
      timestamp: '2026-11-22T03:07:27.692000',
      method: 'POST',
      path: '/rest/v1/rpc/my_badge_counts',
      status: '200',
      ms: '56',
      session: 'session-1',
      agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)',
      colo: 'SJC',
    });
    expect(kept).toEqual({
      id: 'abc',
      at: '2026-11-22T03:07:27.692000Z',
      method: 'POST',
      endpoint: 'rpc:my_badge_counts',
      status: 200,
      ms: 56,
      bytes: null,
      session: 'session-1',
      device: 'iphone',
      colo: 'SJC',
    });
    expect(Object.keys(kept)).not.toContain('agent');
  });
});
