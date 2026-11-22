/**
 * Resend signs each webhook as Svix does: HMAC-SHA256 of `<id>.<timestamp>.<body>` with the
 * endpoint's secret (`whsec_<base64>`), sent as `svix-signature: v1,<base64> [v1,<base64>…]`.
 * A report is taken only with a matching signature and a timestamp within five minutes, so an
 * old one cannot be sent again.
 */
const TOLERANCE_S = 5 * 60;

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function base64(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)));
}

/** Equal strings, compared in time that does not depend on where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifiedWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret.startsWith('whsec_') || !id || !timestamp || !signature) return false;
  const at = Number(timestamp);
  if (!Number.isInteger(at) || Math.abs(nowS - at) > TOLERANCE_S) return false;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      bytes(secret.slice('whsec_'.length)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false;
  }
  const expected = base64(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  return signature
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, sent]) => version === 'v1' && sent !== undefined && same(sent, expected));
}
