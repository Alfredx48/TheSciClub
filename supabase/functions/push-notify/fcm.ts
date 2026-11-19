import type { PushMessage } from './compose.ts';
import { toBase64Url } from './webpush.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const encoder = new TextEncoder();

interface Credentials {
  projectId: string;
  email: string;
  privateKey: string;
}

interface FcmResult {
  status: number;
  unregistered: boolean;
}

export function fcmDevice(endpoint: string): string | null {
  return /^fcm:([A-Za-z0-9_:-]{1,1020})$/.exec(endpoint)?.[1] ?? null;
}

function credentials(secret: string): Credentials {
  const value = JSON.parse(secret) as Record<string, unknown> | null;
  const projectId = value?.project_id;
  const email = value?.client_email;
  const privateKey = value?.private_key;
  if (
    value?.type !== 'service_account' ||
    typeof projectId !== 'string' ||
    !/^[a-z][a-z0-9-]{4,29}$/.test(projectId) ||
    typeof email !== 'string' ||
    typeof privateKey !== 'string'
  ) {
    throw new Error('Invalid FCM service account configuration');
  }
  return { projectId, email, privateKey };
}

async function accessToken(
  account: Credentials,
  send: typeof fetch,
): Promise<{ value: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(
    encoder.encode(
      JSON.stringify({
        iss: account.email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const pem = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(
    account.privateKey,
  )?.[1];
  if (!pem) throw new Error('Invalid FCM service account key');
  const der = Uint8Array.from(atob(pem.replace(/\s+/g, '')), (byte) => byte.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const jwt = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(jwt));
  const response = await send(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${jwt}.${toBase64Url(new Uint8Array(signature))}`,
    }),
  });
  if (!response.ok) throw new Error(`FCM OAuth token request failed (${response.status})`);
  const result = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (
    typeof result.access_token !== 'string' ||
    typeof result.expires_in !== 'number' ||
    !Number.isFinite(result.expires_in)
  ) {
    throw new Error('Invalid FCM OAuth token response');
  }
  return { value: result.access_token, expiresAt: now + result.expires_in };
}

function payload(token: string, message: PushMessage): string | null {
  const shape = (body: string) =>
    JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body },
        data: { url: message.url },
        android: {
          ttl: '86400s',
          priority: 'high',
          notification: { channel_id: 'club-notifications', tag: message.tag, sound: 'default' },
        },
      },
    });
  const full = shape(message.body);
  if (encoder.encode(full).length <= 4096) return full;
  const short = shape('');
  return encoder.encode(short).length <= 4096 ? short : null;
}

export function fcmSender(secret: string, send: typeof fetch = fetch) {
  const account = credentials(secret);
  let cached: { value: string; expiresAt: number } | null = null;
  let pending: ReturnType<typeof accessToken> | null = null;

  return async (device: string, message: PushMessage): Promise<FcmResult> => {
    const body = payload(device, message);
    if (!body) return { status: 413, unregistered: false };
    if (!cached || cached.expiresAt - Math.floor(Date.now() / 1000) < 60) {
      pending ??= accessToken(account, send).finally(() => {
        pending = null;
      });
      cached = await pending;
    }
    const token = cached;
    const response = await send(
      `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' },
        body,
      },
    );
    if (response.status === 401 && cached === token) cached = null;
    const result = (await response.json().catch(() => null)) as {
      error?: { details?: ({ '@type'?: string; errorCode?: string } | null)[] };
    } | null;
    const unregistered =
      response.status === 404 &&
      Array.isArray(result?.error?.details) &&
      result.error.details.some(
        (detail) =>
          detail?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
          detail.errorCode === 'UNREGISTERED',
      );
    return { status: response.status, unregistered };
  };
}
