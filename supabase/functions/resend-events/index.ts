/**
 * resend-events: Resend's webhook, so Admin can see what became of each email (the owner,
 * 2026-11-22: "I never got the email" answered in seconds). Every email the club sends goes
 * through Resend — the sign-in codes and confirmations by Supabase's SMTP, the invites and
 * reminders by the functions — and Resend reports each one sent, delivered, bounced… here.
 *
 * Kept in delivery_log (20261122090000): the subject, what happened and why, and a hash of the
 * address to look one up by. Never the address. Signed by Resend (verify.ts); anything unsigned
 * is refused. No JWT: Resend has none (config.toml).
 *
 * Secret: RESEND_WEBHOOK_SECRET, the endpoint's signing secret from Resend → Webhooks.
 */
import { rowsOf } from './shape.ts';
import { verifiedWebhook } from './verify.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  const body = await request.text();
  const signed = await verifiedWebhook(
    SECRET,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    body,
  );
  if (!signed) return new Response('not signed', { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('not JSON', { status: 400 });
  }
  const rows = await rowsOf(event);
  if (rows.length === 0) return new Response('ok', { status: 200 });

  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  const saved = await fetch(`${SUPABASE_URL}/rest/v1/delivery_log`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!saved.ok) {
    console.error('resend-events: could not keep it', saved.status, await saved.text());
    // Resend tries again later.
    return new Response('not kept', { status: 500 });
  }
  return new Response('ok', { status: 200 });
});
