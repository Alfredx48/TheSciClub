/**
 * invite-signup: makes a confirmed account for somebody with an invite link, a
 * live code, or an address that may join now, so there is no email to wait
 * for. The rules are in handler.ts.
 *
 * `POST { email, password, token?, code? }`, with no session yet, so deployed
 * with --no-verify-jwt. What guards it is the token, the code or the sign-up rule.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */

import { type Deps, inviteSignup } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const serviceHeaders: Record<string, string> = {
  apikey: SERVICE_KEY,
  'Content-Type': 'application/json',
};
if (!SERVICE_KEY.startsWith('sb_')) serviceHeaders.Authorization = `Bearer ${SERVICE_KEY}`;

const deps: Deps = {
  async inviteAddress(token) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_address_for_token`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ token }),
    });
    if (!response.ok) return null;
    const address: unknown = await response.json();
    return typeof address === 'string' ? address : null;
  },
  async codeAdmits(code) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/qr_code_details`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_code: code }),
    });
    if (!response.ok) return false;
    const rows = (await response.json()) as { admits?: boolean }[];
    return rows[0]?.admits === true;
  },
  async invited(address) {
    const query = `email=eq.${encodeURIComponent(address)}&status=eq.pending&select=id&limit=1`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/invites?${query}`, {
      headers: serviceHeaders,
    });
    // Unknown is treated as invited: the ordinary sign-up is always safe.
    if (!response.ok) return true;
    return ((await response.json()) as unknown[]).length > 0;
  },
  async mayJoin(address) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_may_join_now`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_address: address }),
    });
    return response.ok && (await response.json()) === true;
  },
  async createConfirmedUser(email, password, metadata) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      }),
    });
    if (!response.ok) return null;
    const made = (await response.json()) as { id?: unknown };
    return typeof made.id === 'string' ? made.id : null;
  },
  async noteUnproven(account) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/note_unproven_email`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_account: account }),
    });
    return response.ok && (await response.json()) === true;
  },
  async removeUser(account) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
    if (!response.ok) console.error('invite-signup: could not remove', account, response.status);
  },
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return reply(405, { created: false });
  try {
    return reply(200, await inviteSignup(await request.json(), deps));
  } catch (e) {
    console.error('invite-signup failed', e);
    return reply(200, { created: false });
  }
});
