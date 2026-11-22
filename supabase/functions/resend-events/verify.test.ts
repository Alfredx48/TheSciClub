import { describe, expect, it } from 'vitest';
import { verifiedWebhook } from './verify';

const secret = `whsec_${btoa('a test signing secret, 32 bytes!')}`;

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

// Only Resend may write what became of an email (20261122090000).
describe('resend-events signatures', () => {
  const now = 1_800_000_000;
  const body = '{"type":"email.bounced"}';

  it('takes a report Resend signed, and refuses a changed, unsigned, old or wrongly keyed one', async () => {
    const signature = await sign('msg_1', String(now), body);
    const headers = { id: 'msg_1', timestamp: String(now), signature };
    expect(await verifiedWebhook(secret, headers, body, now)).toBe(true);
    expect(
      await verifiedWebhook(secret, { ...headers, signature: `v1,x ${signature}` }, body, now),
    ).toBe(true);
    expect(await verifiedWebhook(secret, headers, '{"type":"email.delivered"}', now)).toBe(false);
    expect(await verifiedWebhook(secret, { ...headers, id: 'msg_2' }, body, now)).toBe(false);
    expect(await verifiedWebhook(secret, { ...headers, signature: null }, body, now)).toBe(false);
    expect(await verifiedWebhook(secret, headers, body, now + 600)).toBe(false);
    expect(await verifiedWebhook(`whsec_${btoa('another secret')}`, headers, body, now)).toBe(
      false,
    );
    expect(await verifiedWebhook('', headers, body, now)).toBe(false);
  });
});
