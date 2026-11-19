/**
 * push-notify: the sender. Piece 4 of notifications (HANDOFF.md).
 *
 * Called through pg_net by `push_notify_send` — from the triggers, and from
 * the daily cron — with `{ event, key }`: what happened and which row. It asks
 * the database who is owed a notification and what it may say (`push_owed`),
 * words each one
 * (compose.ts), and sends it: to a browser through its push service
 * (webpush.ts), to the store app's iPhones through Apple (apns.ts). A device
 * the service calls gone (404 or 410; Apple's BadDeviceToken too) is
 * forgotten (`push_forget`) — otherwise the table fills with phones that
 * were wiped. An Android sender (FCM) would be one more branch in `deliver`.
 *
 * Deployed with `verify_jwt = false` (supabase/config.toml): the caller is
 * the database, not a member, and carries the vault's `push_notify_secret`
 * instead of a JWT. This function never holds that secret; it passes on what
 * it was sent and the database says yes or no. So the public URL can be
 * called by anybody and does nothing for them.
 *
 * Secrets (`pnpm exec supabase secrets set`): VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, and optionally VAPID_SUBJECT; for the app, APNS_KEY_ID,
 * APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_KEY_P8 (the .p8, base64). Without the
 * four, iPhones in the app are skipped and browsers still sent to.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */

import { fromWithName, signedPhotoUrl } from '../_shared/event-invite-email.ts';
import { apnsDevice, apnsGone, apnsKeys, sendApns } from './apns.ts';
import { compose, type Owed, type PushMessage } from './compose.ts';
import { EVENTS } from './events.ts';
import { fcmDevice, fcmSender } from './fcm.ts';
import { type DueInvite, memberInviteEmail } from './invite-email.ts';
import { type DueEmail, reminderEmail } from './reminder-email.ts';
import { sendPush } from './webpush.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
};
const WEB_PUSH_CONFIGURED = Boolean(VAPID.publicKey && VAPID.privateKey);
// How a push service reaches us about abuse. A site URL rather than
// somebody's inbox.
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://thesciclub.netlify.app';
const APNS = apnsKeys((name) => Deno.env.get(name));
const FCM = configuredFcm();

function configuredFcm(): ReturnType<typeof fcmSender> | null {
  const secret = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!secret) return null;
  try {
    return fcmSender(secret);
  } catch {
    console.error('push-notify: invalid FCM service account configuration');
    return null;
  }
}
// The day-before email (20261028980000): Resend, as send-invite, from the
// same address. Without them the daily run sends pushes only.
/** How long a message's push waits before asking who is still owed it. */
const MESSAGE_WAIT_MS = 3000;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('INVITE_FROM') ?? '';

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Delivery = 'sent' | 'gone' | 'failed' | 'skipped';

/** Which service a device is on, for the log; never the device itself. */
function service(endpoint: string): string {
  const app = apnsDevice(endpoint);
  if (app) return `apns ${app.environment}`;
  if (fcmDevice(endpoint)) return 'fcm';
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

/** One message to one device, by the service it is on. */
async function deliver(row: Owed, message: PushMessage): Promise<Delivery> {
  const app = apnsDevice(row.endpoint);
  if (app) {
    if (!APNS) return 'skipped';
    const result = await sendApns(app, message, APNS);
    if (apnsGone(result)) return 'gone';
    if (result.status !== 200) {
      console.error('push-notify: Apple said', result.status, result.reason, app.environment);
      return 'failed';
    }
    return 'sent';
  }
  const android = fcmDevice(row.endpoint);
  if (android) {
    if (!FCM) return 'skipped';
    try {
      const result = await FCM(android, message);
      if (result.unregistered) return 'gone';
      if (result.status === 200) return 'sent';
      console.error('push-notify: FCM said', result.status);
    } catch {
      console.error('push-notify: FCM request failed');
    }
    return 'failed';
  }
  if (!row.endpoint.startsWith('https://') || !row.p256dh || !row.auth) return 'failed';
  if (!WEB_PUSH_CONFIGURED) return 'skipped';
  const status = await sendPush(
    { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
    JSON.stringify(message),
    VAPID,
    SUBJECT,
  );
  if (status === 404 || status === 410) return 'gone';
  if (status >= 400) {
    // The endpoint's host names the service; the path is the device.
    console.error('push-notify: push service said', status, service(row.endpoint));
    return 'failed';
  }
  return 'sent';
}

/** A PostgREST rpc as the service role. A new-format key goes as `apikey` only. */
function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!WEB_PUSH_CONFIGURED && !FCM) {
    console.error('push-notify: VAPID keys and FCM credentials are not set');
    return reply(500, { error: 'not configured' });
  }

  const secret = request.headers.get('x-notify-secret') ?? '';
  let event: unknown;
  let key: unknown;
  try {
    ({ event, key } = (await request.json()) as { event?: unknown; key?: unknown });
  } catch {
    return reply(400, { error: 'not JSON' });
  }
  // The key's contents are the database's to check; it casts what it reads.
  if (typeof event !== 'string' || !EVENTS.has(event) || typeof key !== 'object' || key === null) {
    return reply(400, { error: 'expected { event, key }' });
  }

  // A member with the conversation open marks the message read within a
  // second; asked after that, push_owed no longer owes them this push.
  if (event === 'message') await new Promise((done) => setTimeout(done, MESSAGE_WAIT_MS));

  const owedResponse = await rpc('push_owed', { p_secret: secret, p_event: event, p_key: key });
  if (!owedResponse.ok) {
    // A wrong secret is 42501, which PostgREST answers with 401 or 403.
    const text = await owedResponse.text();
    if (owedResponse.status === 401 || owedResponse.status === 403) {
      return reply(401, { error: 'not the trigger' });
    }
    console.error('push-notify: push_owed failed', owedResponse.status, text);
    return reply(502, { error: 'could not read who is owed' });
  }
  const owed = (await owedResponse.json()) as Owed[];

  const gone: string[] = [];
  let sent = 0;
  let skipped = 0;
  await Promise.all(
    owed.map(async (row) => {
      const message = compose(row);
      if (!message) return;
      try {
        const delivery = await deliver(row, message);
        if (delivery === 'gone') {
          // Worth a line: a device forgotten by mistake is a member who
          // silently stops being told anything.
          console.log(
            'push-notify: forgetting a device the service called gone',
            service(row.endpoint),
          );
          gone.push(row.endpoint);
        } else if (delivery === 'sent') sent++;
        else if (delivery === 'skipped') skipped++;
      } catch (e) {
        console.error('push-notify: send failed', service(row.endpoint), e);
      }
    }),
  );
  if (skipped > 0) {
    console.log('push-notify: APNs secrets are not set; skipped', skipped, 'iPhone(s) in the app');
  }

  if (gone.length > 0) {
    const forgot = await rpc('push_forget', { p_secret: secret, p_endpoints: gone });
    if (!forgot.ok)
      console.error('push-notify: push_forget failed', forgot.status, await forgot.text());
  }

  const emailed =
    event === 'daily' || event === 'day_before'
      ? await emailReminders(secret, key)
      : event === 'event_notice'
        ? await emailInvites(secret, key)
        : 0;

  return reply(200, { owed: owed.length, sent, skipped, forgotten: gone.length, emailed });
});

/**
 * The day-ahead reminder by email, with its push: a timed event's 24 hours
 * before ('day_before'), an all-day event's in the daily run.
 * event_reminder_emails records and returns each one due, so a second run
 * sends nothing. One that Resend refuses is logged, not retried.
 */
async function emailReminders(secret: string, key: unknown): Promise<number> {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.log('push-notify: RESEND_API_KEY or INVITE_FROM is not set; no reminder emails');
    return 0;
  }
  const dueResponse = await rpc('event_reminder_emails', { p_secret: secret, p_key: key });
  if (!dueResponse.ok) {
    console.error(
      'push-notify: event_reminder_emails failed',
      dueResponse.status,
      await dueResponse.text(),
    );
    return 0;
  }
  const due = (await dueResponse.json()) as DueEmail[];
  let emailed = 0;
  for (const row of due) {
    const message = reminderEmail(row);
    try {
      const sendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, ...message }),
      });
      if (sendResponse.ok) emailed++;
      else console.error('push-notify: a reminder email was refused', sendResponse.status);
    } catch (e) {
      console.error('push-notify: a reminder email failed', e);
    }
  }
  return emailed;
}

const SITE = Deno.env.get('SITE_URL') ?? 'https://thesciclub.com';

/**
 * Members invited by name to an invite-only event, emailed the event with
 * Going, Maybe and Can't go (20261114070000), once each: event_invite_emails
 * records each one it returns. One that Resend refuses is logged, not retried.
 */
async function emailInvites(secret: string, key: unknown): Promise<number> {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.log('push-notify: RESEND_API_KEY or INVITE_FROM is not set; no invite emails');
    return 0;
  }
  const dueResponse = await rpc('event_invite_emails', { p_secret: secret, p_key: key });
  if (!dueResponse.ok) {
    console.error(
      'push-notify: event_invite_emails failed',
      dueResponse.status,
      await dueResponse.text(),
    );
    return 0;
  }
  const due = (await dueResponse.json()) as DueInvite[];
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  // One picture for the event, signed once.
  const pictures = new Map<string, Promise<string | null>>();
  let emailed = 0;
  for (const row of due) {
    try {
      if (row.photo_path && !pictures.has(row.photo_path)) {
        pictures.set(row.photo_path, signedPhotoUrl(SUPABASE_URL, headers, row.photo_path));
      }
      const imageUrl = row.photo_path ? ((await pictures.get(row.photo_path)) ?? null) : null;
      const message = memberInviteEmail(row, SITE, imageUrl);
      const sendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromWithName(EMAIL_FROM, message.senderName),
          to: [row.email],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (sendResponse.ok) emailed++;
      else console.error('push-notify: an invite email was refused', sendResponse.status);
    } catch (e) {
      console.error('push-notify: an invite email failed', e);
    }
  }
  return emailed;
}
