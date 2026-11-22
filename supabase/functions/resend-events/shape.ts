/** What a Resend event becomes in delivery_log (20261122090000): never the address itself. */
export interface DeliveryRow {
  channel: 'email';
  kind: string | null;
  outcome: string;
  reason: string | null;
  address_hash: string | null;
  message_id: string | null;
}

/** email.delivered → delivered; the ones worth a row. */
const OUTCOMES: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
};

async function hashOf(address: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(address.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

/** One row per address the event is about; none for an event not kept. */
export async function rowsOf(event: unknown): Promise<DeliveryRow[]> {
  if (typeof event !== 'object' || event === null) return [];
  const { type, data } = event as { type?: unknown; data?: unknown };
  const outcome = typeof type === 'string' ? OUTCOMES[type] : undefined;
  if (!outcome || typeof data !== 'object' || data === null) return [];
  const d = data as {
    to?: unknown;
    subject?: unknown;
    email_id?: unknown;
    bounce?: { message?: unknown; type?: unknown; subType?: unknown };
    failed?: { reason?: unknown };
  };
  const reason =
    text(d.bounce?.message, 200) ??
    text([d.bounce?.type, d.bounce?.subType].filter(Boolean).join(' '), 200) ??
    text(d.failed?.reason, 200);
  const to = Array.isArray(d.to) ? d.to : typeof d.to === 'string' ? [d.to] : [];
  const addresses = to.filter((a): a is string => typeof a === 'string' && a.includes('@'));
  const base = {
    channel: 'email' as const,
    kind: text(d.subject, 120),
    outcome,
    reason,
    message_id: text(d.email_id, 80),
  };
  if (addresses.length === 0) return [{ ...base, address_hash: null }];
  return Promise.all(
    addresses.slice(0, 20).map(async (a) => ({ ...base, address_hash: await hashOf(a) })),
  );
}
