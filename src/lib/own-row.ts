import type { HomeStartup } from '@/lib/home/types';
import { onKeptReadsStale } from '@/lib/kept-reads';
import { onDirectoryChanged, onForgetSharedReads } from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';

/**
 * The signed-in member's own `members` row, one read shared by the door
 * (lib/account.tsx), Me, Home's profile card and the profile pages. Each
 * read it on its own before: Me alone was three reads per show.
 *
 * Kept OWN_ROW_FRESH_MS. Let go at sign-out or a switch of account, and on
 * any write from this device (lib/kept-reads.ts).
 */
export const OWN_ROW_FRESH_MS = 60_000;

/** Every column those screens show. A read asking for any other reads alone. */
export const OWN_ROW_COLUMNS = [
  'id',
  'status',
  'is_admin',
  'display_name',
  'username',
  'type',
  'photo_path',
  'photo_alt',
  'city',
  'state',
  'zip',
  'level_range',
  'exact_level',
  'injury_type',
  'condition_name',
  'completeness',
  'injury_date',
  'injury_date_precision',
  'show_injury_date',
  'birth_date',
  'created_at',
  'show_in_browse',
  'show_on_map',
  'wants_to_mentor',
  'gender',
  'languages',
  'bio',
  'how_injured',
  'topics',
  'marital_status',
  'has_children',
  'children_when',
  'independence',
  'employment',
  'education',
  'education_when',
  'field_of_work',
  'interests',
  'self_care',
  'detail',
  'declined',
  'other_organizations',
  'sports_equipment',
  'grants',
] as const;

/** Columns the app may know before the database does (profile-api.ts). */
const NEWEST_COLUMNS = new Set(['declined', 'sports_equipment', 'grants', 'other_organizations']);

export type OwnRow = Record<string, unknown>;

/**
 * The row (null: no row, not a member yet) or why it could not be read.
 * Undefined: the caller reads alone, as before (a column it alone asks for).
 */
export type SharedRow =
  | { row: OwnRow | null; error: null; homeStartup?: HomeStartup }
  | { row: null; error: Error }
  | undefined;

let kept: { at: number; read: Promise<SharedRow> } | null = null;

export function ownRowChanged(): void {
  kept = null;
}

onForgetSharedReads(ownRowChanged);
// Any write from this device (a username, a setting), or another screen open.
onKeptReadsStale(ownRowChanged);
onDirectoryChanged(ownRowChanged);

/** A column the database does not have yet (Postgres 42703). */
function missingColumn(error: { code?: unknown; message?: unknown }): boolean {
  return error.code === '42703' || /column .* does not exist/i.test(String(error.message));
}

async function readHomeStartup(userId: string): Promise<SharedRow> {
  try {
    const { data, error } = (await getSupabase().rpc('home_startup')) as {
      data: { viewer?: unknown; member?: OwnRow | null; feed?: unknown; rooms?: unknown } | null;
      error: unknown;
    };
    if (error || data?.viewer !== userId) return undefined;
    const { member, feed, rooms } = data;
    if (member === null) return { row: null, error: null };
    if (member?.id !== userId) return undefined;
    if (member.status === 'active' && Array.isArray(feed) && Array.isArray(rooms)) {
      return { row: member, error: null, homeStartup: { feed, rooms } };
    }
    return { row: member, error: null };
  } catch {
    return undefined;
  }
}

async function readRow(homeFor?: string): Promise<SharedRow> {
  const supabase = getSupabase();
  try {
    if (homeFor) {
      const startup = await readHomeStartup(homeFor);
      if (startup) return startup;
    }
    let result = await supabase.from('members').select(OWN_ROW_COLUMNS.join(', ')).maybeSingle();
    if (result.error && missingColumn(result.error)) {
      result = await supabase
        .from('members')
        .select(OWN_ROW_COLUMNS.filter((c) => !NEWEST_COLUMNS.has(c)).join(', '))
        .maybeSingle();
      // Still a column short: each caller reads its own, as before.
      if (result.error && missingColumn(result.error)) return undefined;
    }
    if (result.error) return { row: null, error: result.error };
    return { row: (result.data as OwnRow | null) ?? null, error: null };
  } catch (error) {
    return { row: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * The shared row: the kept one while under OWN_ROW_FRESH_MS old, else read.
 * `since`: only a read started at or after it will do (the door, on a new
 * screen).
 */
export function readOwnRow(
  columns: readonly string[],
  { since, homeFor }: { since?: number; homeFor?: string } = {},
): Promise<SharedRow> {
  if (!columns.every((c) => (OWN_ROW_COLUMNS as readonly string[]).includes(c))) {
    return Promise.resolve(undefined);
  }
  const now = Date.now();
  if (kept && now - kept.at < OWN_ROW_FRESH_MS && (since === undefined || kept.at >= since)) {
    return kept.read;
  }
  const entry = { at: now, read: readRow(homeFor) };
  kept = entry;
  void entry.read.then((answer) => {
    if ((answer === undefined || answer.error) && kept === entry) kept = null;
  });
  return entry.read;
}

/** "a, b, c" as a select names them, for readOwnRow. */
export function columnsOf(select: string): string[] {
  return select
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
