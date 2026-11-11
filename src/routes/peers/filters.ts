/**
 * Who is in the deck.
 *
 * Kept apart from ranking, which decides who is on top. Everything here is a
 * pure function over plain data so the rules can be tested without a database
 * or a component.
 *
 * The filters are the ones members actually reach for in an SCI community:
 * region of injury, city, and the topics somebody is willing to be asked about.
 * Search is names only (owner, 2026-09-21). It used to read across place,
 * level, topics, interests and the bio as well, on the argument that somebody
 * typing "SmartDrive" wants whoever mentioned it anywhere — but typed one
 * letter at a time, "a" is somewhere in every bio, the deck never moved, and
 * the box looked broken. Place, level and topics are what the filter sheet
 * is for; the box finds a person by name and moves on the first keystroke.
 */

import type { MapContents, MapPoint } from '@/lib/map-data';
import { matchesSearch } from '@/lib/search';
import { canonicalTopicsOf } from '@/routes/peers/topics';
import {
  type BrowseMember,
  EMPTY_MEMBER_FILTERS,
  type InjuryRegion,
  type MemberFilters,
  type PeersSegment,
} from '@/types/domain';

export function activeFilterCount(
  filters: MemberFilters,
  startingMiles: number | null = null,
): number {
  return (
    filters.regions.length +
    (filters.condition ? 1 : 0) +
    (filters.role === 'any' ? 0 : 1) +
    (filters.organization ? 1 : 0) +
    (filters.withinMiles === startingMiles ? 0 : 1) +
    filters.topics.length +
    filters.ages.length
  );
}

/** The age groups, by decade (the owner, 2026-10-25). In words, as a screen reader says them. */
export const AGE_BANDS: readonly { id: string; label: string; from: number; to: number }[] = [
  { id: 'under-30', label: 'Under 30', from: 0, to: 29 },
  { id: '30s', label: '30 to 39', from: 30, to: 39 },
  { id: '40s', label: '40 to 49', from: 40, to: 49 },
  { id: '50s', label: '50 to 59', from: 50, to: 59 },
  { id: '60s', label: '60 to 69', from: 60, to: 69 },
  { id: '70-plus', label: '70 and over', from: 70, to: Number.POSITIVE_INFINITY },
];

function bandOf(age: number | null): string | null {
  if (age === null) return null;
  return AGE_BANDS.find((band) => age >= band.from && age <= band.to)?.id ?? null;
}

/** An age group ticked keeps those in it; a member who gave no age is then left out. */
function matchesAge(member: BrowseMember, filters: MemberFilters): boolean {
  if (!filters.ages.length) return true;
  const band = bandOf(member.age);
  return band !== null && filters.ages.includes(band);
}

/** The groups somebody in the deck is in, youngest first. */
export function ageBandsIn(members: BrowseMember[]): string[] {
  const present = new Set(members.map((member) => bandOf(member.age)));
  return AGE_BANDS.filter((band) => present.has(band.id)).map((band) => band.id);
}

/**
 * The level group: a region ticked, or "Other disability", or both, and a
 * member matching any one of them is kept. A condition with a level is in its
 * region too, so ticking Thoracic and the condition chip finds both kinds.
 */
function matchesLevel(member: BrowseMember, filters: MemberFilters): boolean {
  if (!filters.regions.length && !filters.condition) return true;
  return (
    filters.regions.includes(member.region) ||
    (filters.condition && member.injuryType === 'condition')
  );
}

/** Toggle a value in one of the list-shaped filters. */
export function toggleFilter<K extends 'regions' | 'topics' | 'ages'>(
  filters: MemberFilters,
  key: K,
  value: MemberFilters[K][number],
): MemberFilters {
  const current = filters[key] as string[];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...filters, [key]: next };
}

/** The start of any word of the name: "an" finds Mary Ann, "ry" finds nobody. */
function matchesMemberSearch(member: BrowseMember, search: string): boolean {
  return matchesSearch(member.displayName, search);
}

function matchesSegment(member: BrowseMember, segment: PeersSegment): boolean {
  if (segment === 'mentors') return member.type === 'mentor';
  return true;
}

/** Every organization a member is part of, by name: their own words and the club's records. */
function organizationsOf(member: BrowseMember): string[] {
  return [
    ...member.affiliations,
    ...member.representedOrganizations.map((organization) => organization.name),
    ...member.mentorOrganizations.map((organization) => organization.name),
  ];
}

/** The organizations of the members given, for the sheet's list, by name. */
export function organizationsIn(members: BrowseMember[]): string[] {
  return [...new Set(members.flatMap(organizationsOf))].sort((a, b) => a.localeCompare(b));
}

const EARTH_MILES = 3958.8;

/** As the crow flies, from city middle to city middle. */
function milesBetween(a: MapPoint, b: MapPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const up = radians(b.latitude - a.latitude);
  const across = radians(b.longitude - a.longitude);
  const h =
    Math.sin(up / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(across / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

/** How many a tab should open on, where there are that many. */
const ENOUGH = 20;
const STEP_MILES = 5;
const MOST_MILES = 200;

/**
 * Where Peers and Organizations start (the owner, 2026-11-01): the shortest
 * distance on the slider with at least 20 in it, so a remote member is not shown
 * an empty club. Something with several places counts at its nearest. Null, any
 * distance, with no home to measure from, or fewer than 20 within reach.
 */
export function milesForEnough(
  home: MapPoint | null,
  places: readonly (MapPoint & { id: string })[],
): number | null {
  if (!home) return null;
  const nearest = new Map<string, number>();
  for (const place of places) {
    const miles = milesBetween(home, place);
    nearest.set(place.id, Math.min(miles, nearest.get(place.id) ?? miles));
  }
  const twentieth = [...nearest.values()].sort((a, b) => a - b)[ENOUGH - 1];
  if (twentieth === undefined) return null;
  const miles = Math.max(STEP_MILES, Math.ceil(twentieth / STEP_MILES) * STEP_MILES);
  return miles > MOST_MILES ? null : miles;
}

/** Each member where the map holds them, for `milesForEnough`. */
export function memberPlaces(
  contents: Pick<MapContents, 'peerCities'>,
  me: string | null,
): (MapPoint & { id: string })[] {
  return contents.peerCities.flatMap((city) =>
    city.memberIds
      .filter((id) => id !== me)
      .map((id) => ({ id, latitude: city.latitude, longitude: city.longitude })),
  );
}

/** The organizations with a place within so many miles of the reader. */
/** How far each placed organization's nearest place is from home, in miles. */
export function organizationMiles(
  contents: Pick<MapContents, 'home' | 'organizations'>,
): Map<string, number> {
  const miles = new Map<string, number>();
  const { home } = contents;
  if (!home) return miles;
  for (const place of contents.organizations) {
    const away = milesBetween(home, place);
    miles.set(place.id, Math.min(away, miles.get(place.id) ?? away));
  }
  return miles;
}

export function organizationsWithin(
  contents: Pick<MapContents, 'home' | 'organizations'>,
  miles: number,
): ReadonlySet<string> {
  const { home } = contents;
  if (!home) return new Set();
  return new Set(
    contents.organizations
      .filter((place) => milesBetween(home, place) <= miles)
      .map((place) => place.id),
  );
}

/**
 * Who is placed further than so many miles from the reader, from what the map
 * already holds (the middle of a ZIP code or city, never closer). Somebody with
 * no place yet, or who keeps off the map, cannot be measured and stays in the
 * list (the owner, 2026-11-10: a new member vanished until the nightly import).
 * Null with no distance asked, or no home to measure from.
 */
export function membersBeyond(
  contents: Pick<MapContents, 'home' | 'peerCities'>,
  miles: number | null,
): ReadonlySet<string> | null {
  const { home } = contents;
  if (miles === null || !home) return null;
  return new Set(
    contents.peerCities
      .filter((city) => milesBetween(home, city) > miles)
      .flatMap((city) => city.memberIds),
  );
}

export function filterMembers(
  members: BrowseMember[],
  chosen: MemberFilters,
  segment: PeersSegment,
  chosenFar: ReadonlySet<string> | null = null,
): BrowseMember[] {
  // A search looks through everybody (the owner, 2026-11-01): no filter or
  // distance hides somebody whose name was typed. Mentors still means mentors.
  const searching = chosen.search.trim() !== '';
  const filters = searching ? { ...EMPTY_MEMBER_FILTERS, search: chosen.search } : chosen;
  const far = searching ? null : chosenFar;
  const kept = members.filter((member) => {
    if (!matchesSegment(member, segment)) return false;
    if (!matchesLevel(member, filters)) return false;
    if (!matchesAge(member, filters)) return false;
    if (filters.role === 'mentors' && member.type !== 'mentor') return false;
    if (filters.role === 'peers' && member.type === 'mentor') return false;
    if (filters.organization && !organizationsOf(member).includes(filters.organization)) {
      return false;
    }
    if (far?.has(member.id)) return false;
    // A member matches a topic filter if any selected topic appears in their
    // topics *or* their interests — people file the same thing under both.
    //
    // Matched on the grouped form, so "Back to school" finds the member who
    // wrote "Going back to school" as well. See topics.ts for why that is not
    // a nicety: the raw strings split six members wanting one conversation
    // across four chips, none of which found more than two of them.
    if (filters.topics.length) {
      const theirs = new Set(
        canonicalTopicsOf([...member.topics, ...member.interests]).map((t) => t.toLowerCase()),
      );
      const hit = filters.topics.some((t) => theirs.has(t.toLowerCase()));
      if (!hit) return false;
    }
    return matchesMemberSearch(member, filters.search);
  });

  return kept;
}

/**
 * Everyone but the person reading.
 *
 * The deck answers "who could I talk to", and you are not one of them — every
 * other card is a conversation that could happen and your own is a dead end.
 * It skewed the counts too: "25 of 25 members" counted the reader, and in a
 * club this size a filter down to one city could say three when it means two
 * other people and you.
 *
 * Done here rather than in `browse_members`, deliberately. The view backs
 * `/peers/:id` as well as the deck, and dropping yourself from it would take
 * your own profile with it — which is the page Me now links to so you can see
 * what you are presenting.
 */
export function othersOnly(members: BrowseMember[], viewerId: string | null): BrowseMember[] {
  if (!viewerId) return members;
  return members.filter((member) => member.id !== viewerId);
}

/** The distinct values present in a deck, for building the filter sheet's options. */
export function regionsIn(members: BrowseMember[]): InjuryRegion[] {
  return [...new Set(members.map((m) => m.region))].sort();
}

/** Whether anybody in the deck has a condition: the chip is drawn only then. */
export function hasConditions(members: BrowseMember[]): boolean {
  return members.some((m) => m.injuryType === 'condition');
}

/**
 * Topics, most-shared first.
 *
 * Grouped before counting (topics.ts), which is what makes the count mean
 * anything: the raw strings are free text and 53 of the 61 in the seeded
 * directory were named by exactly one person, so ordering by frequency was
 * ordering a list of ones. Grouped, that falls to 17 of 29.
 *
 * Sorting alphabetically would bury the topics that actually narrow a deck
 * under the singletons that remain, so this orders by how many members share
 * one and lets the caller cap the list.
 */
export function topicsIn(members: BrowseMember[], limit?: number): string[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    // Deduplicated per member, so somebody who wrote both "Back to school" and
    // "Returning to college" counts once toward the group rather than twice.
    for (const topic of canonicalTopicsOf(member.topics)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => topic);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
