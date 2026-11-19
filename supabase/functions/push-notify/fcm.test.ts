import { expect, it, vi } from 'vitest';
import { fcmDevice, fcmSender } from './fcm.ts';

it('sends a routable alert and only prunes a token explicitly marked unregistered', async () => {
  const key = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  const der = await crypto.subtle.exportKey('pkcs8', key.privateKey);
  const pem = btoa(String.fromCharCode(...new Uint8Array(der)));
  const secret = JSON.stringify({
    type: 'service_account',
    project_id: 'sciclub-test',
    client_email: 'push@example.test',
    private_key: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`,
  });
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'test-access-token', expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json({}, { status: 404 }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        },
        { status: 404 },
      ),
    );
  const deliver = fcmSender(secret, send);
  const device = fcmDevice('fcm:My_Device:Token');
  expect(device).toBe('My_Device:Token');
  expect(fcmDevice('fcm:https://example.test')).toBeNull();
  if (!device) throw new Error('Missing test token');
  const message = {
    title: 'Message',
    body: 'Ada replied',
    tag: 'thread-1',
    url: '/chat/t/1?n=thread',
  };

  await expect(deliver(device, message)).resolves.toEqual({ status: 404, unregistered: false });
  await expect(deliver(device, message)).resolves.toEqual({ status: 404, unregistered: true });
  expect(send).toHaveBeenCalledTimes(3);
  const [url, request] = send.mock.calls[1] ?? [];
  expect(url).toBe('https://fcm.googleapis.com/v1/projects/sciclub-test/messages:send');
  if (typeof request?.body !== 'string') throw new Error('Missing FCM request body');
  expect(JSON.parse(request.body)).toMatchObject({
    message: {
      token: device,
      notification: { title: message.title, body: message.body },
      data: { url: message.url },
      android: { notification: { tag: message.tag } },
    },
  });
});
