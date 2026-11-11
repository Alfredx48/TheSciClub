import { describeError, describeThrown } from '@/lib/describe-error';
import { sendInvite } from '@/lib/send-invite';
import { getSupabase } from '@/lib/supabase';
import type { EventAudience, RsvpStatus } from '@/types/domain';

/**
 * Who can see an event, its public page, and registering from it
 * (the owner, 2026-10-22; 20261022180000 and 20261022190000).
 *
 * The database decides every one of these: can_see_event() for members,
 * public_event() for anybody with the link, event_guest_list() for the
 * event's organizers. Nothing here filters on its own account.
 */

type Failure = Parameters<typeof describeError>[0];
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(
  name: string,
  args: Record<string, unknown>,
  refusal: string,
): Promise<Result<T>> {
  try {
    const { data, error } = (await getSupabase().rpc(name, args)) as {
      data: T;
      error: Failure | null;
    };
    if (error) return { ok: false, error: describeError(error, refusal) };
    return { ok: true, value: data };
  } catch (thrown) {
    return { ok: false, error: describeThrown(thrown, refusal) };
  }
}

/* --------------------------------------------------------------- audience */

/** For the event form, after saving: this date and, in a series, every later one. */
export function setEventAudience(
  eventId: string,
  audience: EventAudience,
  groups: string[],
): Promise<Result<null>> {
  return call<null>(
    'set_event_audience',
    { event: eventId, audience, groups: audience === 'groups' ? groups : [] },
    'Who can see the event was not saved.',
  );
}

/** Members of chosen organizations, or invite only: nobody else sees it, even from the link. */
export function isPrivateAudience(audience: EventAudience): boolean {
  return audience === 'followers' || audience === 'organizations' || audience === 'people';
}

export interface VisibilityOrganization {
  id: string;
  name: string;
  shortCode: string;
  logoPath: string | null;
}

export interface Invitee {
  id: string;
  displayName: string;
  username: string;
  photoPath: string | null;
}

/** Who an event is for (20261106030000). Groups and invitees only for whoever may change it. */
export interface EventVisibility {
  audience: EventAudience;
  mayChange: boolean;
  organizations: VisibilityOrganization[];
  groups: string[] | null;
  /** Organizers', its creator's, and on an invite-only event its guests' (20261107130000). */
  invitees: Invitee[] | null;
  inviteeCount: number;
  /** Who added it, when the reader may see them. */
  addedBy: Organizer | null;
  /** Who changed it or invited people since, first first (20261107140000). */
  changedBy: Organizer[];
}

export interface Organizer {
  id: string;
  displayName: string;
  photoPath: string | null;
}

interface VisibilityRow {
  audience: EventAudience;
  may_change: boolean;
  organizations: { id: string; name: string; short_code: string; logo_path: string | null }[];
  groups: string[] | null;
  invitees:
    | { id: string; name: string; username: string | null; photo_path: string | null }[]
    | null;
  invitee_count: number;
  added_by?: OrganizerRow | null;
  changed_by?: OrganizerRow[] | null;
}

interface OrganizerRow {
  id: string;
  name: string;
  photo_path: string | null;
}

const toOrganizer = (row: OrganizerRow): Organizer => ({
  id: row.id,
  displayName: row.name,
  photoPath: row.photo_path,
});

export async function fetchEventVisibility(
  eventId: string,
): Promise<Result<EventVisibility | null>> {
  const result = await call<VisibilityRow | null>(
    'event_visibility',
    { p_event: eventId },
    'Could not read who can see the event.',
  );
  if (!result.ok) return result;
  const row = result.value;
  if (!row) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      audience: row.audience,
      mayChange: row.may_change,
      organizations: row.organizations.map((o) => ({
        id: o.id,
        name: o.name,
        shortCode: o.short_code,
        logoPath: o.logo_path,
      })),
      groups: row.groups,
      invitees:
        row.invitees?.map((m) => ({
          id: m.id,
          displayName: m.name,
          username: m.username ?? '',
          photoPath: m.photo_path,
        })) ?? null,
      inviteeCount: row.invitee_count,
      addedBy: row.added_by ? toOrganizer(row.added_by) : null,
      changedBy: (row.changed_by ?? []).map(toOrganizer),
    },
  };
}

/**
 * Who sees the event: this date and, in a series, every later one. An org
 * admin may do it on an imported event too. Resolves to how many were newly
 * invited, each of whom is told.
 */
export function setEventVisibility(
  eventId: string,
  choice: { audience: EventAudience; groups: string[]; organizations: string[]; people: string[] },
): Promise<Result<number>> {
  return call<number>(
    'set_event_visibility',
    {
      p_event: eventId,
      p_audience: choice.audience,
      p_groups: choice.audience === 'groups' ? choice.groups : [],
      p_organizations: choice.audience === 'organizations' ? choice.organizations : [],
      p_people: choice.audience === 'people' ? choice.people : [],
    },
    'Who can see the event was not saved.',
  );
}

/** The group chats a groups-only event is for, for the form that changes it. */
export async function fetchAudienceGroups(eventId: string): Promise<string[]> {
  const result = await call<string[] | null>(
    'event_audience_groups_of',
    { event: eventId },
    'Could not read the groups.',
  );
  return result.ok ? (result.value ?? []) : [];
}

export interface AudienceHint {
  audience: EventAudience;
  /** Only for a followers event: whose followers. */
  organization: { id: string; name: string; shortCode: string; logoPath: string | null } | null;
}

interface HintRow {
  audience: EventAudience;
  organization_id: string | null;
  organization_name: string | null;
  organization_short_code: string | null;
  organization_logo_path: string | null;
}

/**
 * For a member who cannot see an event, from a link: who it is for, and
 * nothing else. Null when there is no such event, or they can see it.
 */
export async function fetchAudienceHint(eventId: string): Promise<AudienceHint | null> {
  const result = await call<HintRow[] | null>(
    'event_audience_hint',
    { event: eventId },
    'Could not check the event.',
  );
  const row = result.ok ? result.value?.[0] : undefined;
  if (!row) return null;
  return {
    audience: row.audience,
    organization:
      row.organization_id && row.organization_name
        ? {
            id: row.organization_id,
            name: row.organization_name,
            shortCode: row.organization_short_code ?? '',
            logoPath: row.organization_logo_path,
          }
        : null,
  };
}

/* ------------------------------------------------------------ public page */

export interface PublicEvent {
  id: string;
  /** Whether it has an RSVP button (20261101080000). */
  takesRsvps: boolean;
  title: string;
  description: string;
  descriptionHtml: string;
  startTime: string;
  endTime: string | null;
  allDay: boolean;
  timezone: string | null;
  location: string;
  city: string | null;
  state: string | null;
  format: string | null;
  url: string | null;
  registrationUrl: string | null;
  photoPath: string | null;
  morePhotos?: { path: string; alt: string }[];
  photoAlt: string | null;
  organization: { id: string; name: string; shortCode: string; logoPath: string | null } | null;
}

interface PublicEventRow {
  id: string;
  takes_rsvps: boolean | null;
  title: string;
  description: string | null;
  description_html: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean | null;
  timezone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  event_format: string | null;
  url: string | null;
  registration_url: string | null;
  photo_path: string | null;
  photo_alt: string | null;
  more_photos?: { path: string; alt: string }[] | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_short_code: string | null;
  organization_logo_path: string | null;
}

/** A public event, for anybody with the link; null for any other event. */
export async function fetchPublicEvent(eventId: string): Promise<Result<PublicEvent | null>> {
  const result = await call<PublicEventRow[] | null>(
    'public_event',
    { event: eventId },
    'Could not load this event.',
  );
  if (!result.ok) return result;
  const row = result.value?.[0];
  if (!row) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: row.id,
      takesRsvps: row.takes_rsvps !== false,
      title: row.title,
      description: row.description ?? '',
      descriptionHtml: row.description_html ?? '',
      startTime: row.start_time,
      endTime: row.end_time,
      allDay: Boolean(row.all_day),
      timezone: row.timezone,
      location: row.location ?? '',
      city: row.city,
      state: row.state,
      format: row.event_format,
      url: row.url,
      registrationUrl: row.registration_url,
      photoPath: row.photo_path,
      photoAlt: row.photo_alt,
      morePhotos: row.more_photos ?? [],
      organization:
        row.organization_id && row.organization_name
          ? {
              id: row.organization_id,
              name: row.organization_name,
              shortCode: row.organization_short_code ?? '',
              logoPath: row.organization_logo_path,
            }
          : null,
    },
  };
}

/* ------------------------------------------------------------ registering */

export interface Registration {
  eventId: string;
  status: RsvpStatus;
  name: string;
  email: string;
  phone: string;
  /** The hosting organization's name, for the welcome page. */
  organizer?: string;
}

/** Keeps a registration for the event's organizers, account or not. */
export function registerForEvent(registration: Registration): Promise<Result<null>> {
  return call<null>(
    'register_for_event',
    {
      event: registration.eventId,
      name: registration.name.trim(),
      email: registration.email.trim(),
      phone: registration.phone.trim() || null,
      status: registration.status,
    },
    'The registration was not saved.',
  );
}

/** After registering: sign in, create the account, or ask for an invite (20261102060000). */
export type NextStep = 'member' | 'invited' | 'request';

export async function registrationNextStep(
  eventId: string,
  email: string,
): Promise<Result<NextStep>> {
  const result = await call<string>(
    'registration_next_step',
    { p_event: eventId, p_email: email.trim() },
    'Could not check that just now.',
  );
  if (!result.ok) return result;
  const step = result.value;
  return {
    ok: true,
    value: step === 'member' || step === 'invited' ? step : 'request',
  };
}

/**
 * Registrations made with the signed-in member's confirmed address become
 * their RSVPs. Resolves to those events, newest first.
 */
export async function claimEventRegistrations(): Promise<string[]> {
  const result = await call<string[] | null>(
    'claim_event_registrations',
    {},
    'Could not finish the registration.',
  );
  return result.ok ? (result.value ?? []) : [];
}

/*
 * The registration just made, kept on this device so the welcome page can
 * say so, the join form can start from it, and the app can open the event
 * once its owner is in. The club keeps its own copy (event_registrations);
 * this one is only the device's way back to the event.
 */

const PENDING_KEY = 'sciclub.eventRegistration';

/**
 * How long the welcome page says "You're on our list". The registration itself
 * is kept until its owner is in, but the line is news only for a day: kept for
 * ever, it greeted whoever opened the club in that browser weeks later (the
 * owner, 2026-11-10).
 */
const ON_THE_LIST_MS = 24 * 60 * 60 * 1000;

export function keepPendingRegistration(registration: Registration): void {
  try {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...registration, keptAt: Date.now() }),
    );
  } catch {
    // Private browsing: the registration is kept by the club all the same.
  }
}

export function pendingRegistration(): Registration | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Registration>;
    if (typeof value.eventId !== 'string' || typeof value.email !== 'string') return null;
    return {
      eventId: value.eventId,
      status: value.status === 'interested' ? 'interested' : 'going',
      name: typeof value.name === 'string' ? value.name : '',
      email: value.email,
      phone: typeof value.phone === 'string' ? value.phone : '',
      ...(typeof value.organizer === 'string' ? { organizer: value.organizer } : {}),
    };
  } catch {
    return null;
  }
}

/** Whether the kept registration was made recently enough to greet its owner with. */
export function registeredRecently(now = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw || pendingRegistration() === null) return false;
    const { keptAt } = JSON.parse(raw) as { keptAt?: unknown };
    // One kept before the day's limit carries no time: not news.
    return typeof keptAt === 'number' && now - keptAt >= 0 && now - keptAt < ON_THE_LIST_MS;
  } catch {
    return false;
  }
}

export function forgetPendingRegistration(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing kept.
  }
}

/* ------------------------------------------------------------- guest list */

export type GuestState = 'member' | 'joining' | 'unconfirmed';

export interface Guest {
  name: string;
  email: string | null;
  phone: string | null;
  status: RsvpStatus;
  state: GuestState;
  respondedAt: string;
  /** A registration from the public page; null for a member's RSVP. */
  registrationId: string | null;
  /** Whether the address is on the invite list already. */
  invite: 'pending' | 'consumed' | null;
  /** The pending invite, where this viewer may send it again. */
  inviteId: string | null;
}

interface GuestRow {
  name: string | null;
  email: string | null;
  phone: string | null;
  status: RsvpStatus;
  state: GuestState;
  responded_at: string;
  registration_id?: string | null;
  invite_status?: string | null;
  invite_id?: string | null;
}

/** The event's guest list, for its organizers and administrators. */
export async function fetchGuestList(eventId: string): Promise<Result<Guest[]>> {
  const result = await call<GuestRow[] | null>(
    'event_guest_list',
    { event: eventId },
    'Could not load the guest list.',
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: (result.value ?? []).map((row) => ({
      name: row.name ?? 'Somebody',
      email: row.email,
      phone: row.phone,
      status: row.status,
      state: row.state,
      respondedAt: row.responded_at,
      registrationId: row.registration_id ?? null,
      invite:
        row.invite_status === 'pending' || row.invite_status === 'consumed'
          ? row.invite_status
          : null,
      inviteId: row.invite_id ?? null,
    })),
  };
}

/**
 * Invites somebody who registered on the public page (20261104000000), then
 * emails the link. Their link starts onboarding with the name and phone they
 * gave. As createInvite: an invite made but not emailed is still made, and
 * comes back ok with `sendError`, for Send again.
 */
export async function inviteGuest(
  registrationId: string,
): Promise<{ ok: true; inviteId: string; sendError?: string } | { ok: false; error: string }> {
  const made = await call<string | null>(
    'invite_event_guest',
    { registration: registrationId },
    'Could not invite them.',
  );
  if (!made.ok) return made;
  const inviteId = made.value;
  if (typeof inviteId !== 'string') return { ok: false, error: 'Could not invite them.' };
  const sent = await sendInvite(inviteId);
  return sent.ok ? { ok: true, inviteId } : { ok: true, inviteId, sendError: sent.error };
}

/** The list as a spreadsheet's CSV: what an organizer takes elsewhere. */
export function guestListCsv(guests: Guest[]): string {
  const cell = (value: string | null) => {
    // Typed by anybody on a public page: a leading = + - @ would be a formula
    // in the organizer's spreadsheet, so it is kept as text.
    const raw = value ?? '';
    const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = guests.map((g) =>
    [g.name, g.email, g.phone, g.status, GUEST_STATE_LABEL[g.state], g.respondedAt]
      .map(cell)
      .join(','),
  );
  return ['Name,Email,Phone,Response,In the club,Responded', ...rows].join('\r\n');
}

export const GUEST_STATE_LABEL: Record<GuestState, string> = {
  member: 'Member',
  joining: 'Joining',
  unconfirmed: 'Not confirmed',
};

/** The address members share a public event by: its short link, if it has one. */
export function publicEventUrl(eventId: string, shortLink?: string | null): string {
  return `https://thesciclub.com/e/${shortLink ?? eventId}`;
}

/** As the database's own check (20261101070000). */
export function isShortLink(link: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(link);
}

/** The event a short link opens; null when none has it. */
export function fetchEventIdByShortLink(link: string): Promise<Result<string | null>> {
  return call<string | null>('event_by_short_link', { p_link: link }, 'Could not load this event.');
}

/** Sets an event's short link, or takes it off when empty. Resolves to what was saved. */
export function setEventShortLink(eventId: string, link: string): Promise<Result<string | null>> {
  return call<string | null>(
    'set_event_short_link',
    { p_event: eventId, p_link: link },
    'The short link was not saved.',
  );
}
