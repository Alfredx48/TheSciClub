import { useCallback, useEffect, useState } from 'react';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import type { OrganizationCategory } from '@/lib/organization-categories';
import { readPages } from '@/lib/read-pages';
import { onCalendarChanged, onForgetSharedReads } from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';
import type { Organization, OrganizationPlace } from '@/types/domain';

/** The member directory, excluding entries an administrator removed. */
interface OrganizationRow {
  joins_need_approval?: boolean | null;
  collects_rsvps?: boolean | null;
  summary?: string | null;
  anonymous_reviews?: boolean | null;
  id: string;
  short_code: string;
  name: string;
  /** Null when its own site names no place (20261028310000). */
  city: string | null;
  description: string;
  tags: string[] | null;
  can_invite: boolean;
  logo_path: string | null;
  state?: string | null;
  category?: OrganizationCategory | null;
  organization_places?: PlaceRow[] | null;
}

interface PlaceRow {
  id: string;
  position: number;
  label: string | null;
  address: string | null;
  city: string;
  state: string;
  /** Absent before 20261028700000. */
  postal_code?: string | null;
  /** Absent before 20261103030000. */
  note?: string | null;
  url?: string | null;
}

/** Main place first. */
export function toOrganizationPlaces(rows: PlaceRow[] | null | undefined): OrganizationPlace[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(({ id, position, label, address, city, state, postal_code, note, url }) => ({
      id,
      position,
      label,
      address,
      city,
      state,
      postalCode: postal_code ?? null,
      note: note ?? null,
      url: url ?? null,
    }));
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    shortCode: row.short_code,
    name: row.name,
    city: row.city ?? '',
    description: row.description,
    tags: row.tags ?? [],
    canInvite: row.can_invite,
    logoPath: row.logo_path,
    state: row.state ?? null,
    category: row.category ?? null,
    joinsNeedApproval: row.joins_need_approval === true,
    collectsRsvps: row.collects_rsvps === true,
    summary: row.summary ?? null,
    anonymousReviews: row.anonymous_reviews !== false,
    places: toOrganizationPlaces(row.organization_places),
  };
}

/**
 * The club organization behind an affiliation, if there is one.
 *
 * `members.affiliations` is free text — the names NorCal SCI's directory used
 * — so a member can be affiliated with something the club has no row for.
 * Those still render, as the short-code tile, which is why this returns null
 * rather than throwing.
 *
 * The comparison is exact, and stays exact. "Christopher Reeve Foundation" sat
 * on two members for a while and matched nothing, because the club's row is
 * "Christopher & Dana Reeve Foundation" — fixed in the data by
 * 20260916000000, deliberately not by loosening this. An organization decides
 * whose logo is on a member's card and who is recorded as vouching for them;
 * see the migration header, and see jobs/event-ingest/series.js for what
 * matching names on a resemblance does to two things that merely read alike.
 *
 * Matched case- and space-insensitively on the name, then on the short code,
 * because the directory was typed by hand and "NorCal SCI " has turned up.
 */
export function organizationByName(
  organizations: Organization[],
  name: string | null | undefined,
): Organization | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    organizations.find((o) => o.name.trim().toLowerCase() === wanted) ??
    organizations.find((o) => o.shortCode.trim().toLowerCase() === wanted) ??
    null
  );
}

export interface OrganizationsState {
  organizations: Organization[];
  byId: Map<string, Organization>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

type OrganizationsRead = Omit<OrganizationsState, 'reload' | 'loading'>;

/**
 * One read of the directory, shared by every screen that asks.
 *
 * Peers draws a card per member and each card asks for the organizations (for
 * an affiliation's logo), which was a request per card: 203 on a page of 200
 * members (2026-10-14). The directory is the same for every viewer, so one
 * read in flight serves them all, and a read under a minute old is reused
 * outright. Older than that it is shown while a fresh read runs. A failed read
 * is never kept. `reload` always reads again.
 */
const FRESH_FOR_MS = 60_000;
let shared: { read: OrganizationsRead; at: number } | null = null;
let inFlight: Promise<OrganizationsRead> | null = null;

function forgetDirectory() {
  shared = null;
  inFlight = null;
}
onForgetSharedReads(forgetDirectory);
onCalendarChanged(forgetDirectory);

/** 20261105100000: the same rows, its places read in one pass. */
const DIRECTORY_VIEW =
  'id, short_code, name, city, description, tags, can_invite, logo_path, state, category, summary, joins_need_approval, collects_rsvps, anonymous_reviews, organization_places';
const DIRECTORY =
  'id, short_code, name, city, description, tags, can_invite, logo_path, state, category, summary, joins_need_approval, collects_rsvps, anonymous_reviews, organization_places(id, position, label, address, city, state, postal_code, note, url)';
/** Before 20261103030000: no contact note or page for a place. */
const DIRECTORY_WITHOUT_NOTES = DIRECTORY.replace(', note, url)', ')');
/** Before 20261028700000: no ZIP codes. */
const DIRECTORY_WITHOUT_ZIP =
  'id, short_code, name, city, description, tags, can_invite, logo_path, state, organization_places(id, position, label, address, city, state)';

function readDirectory(columns: string, table = 'organizations') {
  return readPages<OrganizationRow>(
    (from, to) =>
      // Cast because the list is longer than supabase-js's types can parse.
      getSupabase()
        .from(table)
        .select(columns)
        .is('removed_at', null)
        .order('name')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: OrganizationRow[] | null;
        error: Failure | null;
      }>,
  );
}

function readOrganizations(): Promise<OrganizationsRead> {
  if (inFlight) return inFlight;
  const read = (async (): Promise<OrganizationsRead> => {
    try {
      let { data, error } = await readDirectory(DIRECTORY_VIEW, 'organization_directory');
      // Until 20261105100000 is live: the embedded places.
      if (error?.code === 'PGRST205' || error?.code === '42P01')
        ({ data, error } = await readDirectory(DIRECTORY));
      // Until 20261103030000, and before it 20261028700000, is live: without them.
      if (error?.code === '42703') ({ data, error } = await readDirectory(DIRECTORY_WITHOUT_NOTES));
      if (error?.code === '42703') ({ data, error } = await readDirectory(DIRECTORY_WITHOUT_ZIP));
      if (error) {
        return {
          organizations: [],
          byId: new Map(),
          error: describeError(error, 'Could not load organizations.'),
        };
      }
      const organizations = (data ?? []).map(toOrganization);
      const result = {
        organizations,
        byId: new Map(organizations.map((o) => [o.id, o])),
        error: null,
      };
      shared = { read: result, at: Date.now() };
      return result;
    } catch (e) {
      return {
        organizations: [],
        byId: new Map(),
        error: describeThrown(e, 'Could not load organizations.'),
      };
    }
  })();
  inFlight = read;
  void read.finally(() => {
    if (inFlight === read) inFlight = null;
  });
  return read;
}

export function useOrganizations(enabled = true): OrganizationsState {
  const [state, setState] = useState<Omit<OrganizationsState, 'reload'>>(() =>
    shared
      ? { ...shared.read, loading: false }
      : { organizations: [], byId: new Map(), loading: true, error: null },
  );

  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (revision === 0 && shared && Date.now() - shared.at < FRESH_FOR_MS) {
      // Another screen's read can land between this screen's render, which
      // found nothing and drew loading, and this effect: take what it found.
      const { read } = shared;
      setState((current) => (current.loading ? { ...read, loading: false } : current));
      return;
    }
    if (revision > 0) inFlight = null;
    let live = true;
    void readOrganizations().then((read) => {
      if (live) setState({ ...read, loading: false });
    });
    return () => {
      live = false;
    };
  }, [enabled, revision]);

  return { ...state, reload };
}
