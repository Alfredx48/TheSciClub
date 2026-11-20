import { stateCodeForName } from '@/types/domain';

/**
 * Street addresses suggested as an administrator or an organization account
 * types a location (the owner, 2026-10-28). Photon is Komoot's OpenStreetMap
 * search, built for type-ahead and keyless; Nominatim's usage policy forbids
 * type-ahead, so never point this at Nominatim. Members never reach it.
 */
export const PHOTON_ORIGIN = 'https://photon.komoot.io';

/**
 * Characters typed before asking, and the pause after the last one. 150ms,
 * not 300 (the owner, 2026-11-20: "Can we have it suggest faster?"): Photon
 * itself takes most of a second, so the pause was a quarter of the wait.
 */
export const SUGGEST_AFTER = 3;
export const SUGGEST_DELAY_MS = 150;
export const SUGGESTIONS_SHOWN = 5;

export interface AddressSuggestion {
  key: string;
  /** A place's own name, such as a gym's; null for a bare address. */
  name: string | null;
  /** "800 Potter Street", or the street alone when it has no number. */
  street: string;
  city: string;
  /** Two letters. */
  state: string;
  /** 12345 or 12345-6789, or ''. */
  postalCode: string;
  /** The whole address as one line. */
  line: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * What a box suggests: a street address, or a city (the owner, 2026-11-20:
 * "Yes suggest cities", for an event's and an organization's city boxes).
 */
export type SuggestionKind = 'address' | 'city';

/** US only; ten asked, as some come back with no street to fill in. */
export function photonUrl(query: string, kind: SuggestionKind = 'address'): string {
  const params = new URLSearchParams({
    q: query.trim(),
    limit: '10',
    lang: 'en',
    countrycode: 'US',
  });
  // Photon's city layer: cities, towns and villages, no streets or buildings.
  if (kind === 'city') params.set('layer', 'city');
  return `${PHOTON_ORIGIN}/api/?${params.toString()}`;
}

/**
 * A street with no number takes the number typed (the owner, 2026-11-20:
 * "831 Schooner Street, Foster City" came up as Schooner Street alone, and
 * picking it lost the 831). OpenStreetMap has many streets without their
 * houses; the person typing knows the number. A named place keeps its own.
 */
export function withTypedNumber(
  suggestions: readonly AddressSuggestion[],
  typed: string,
): AddressSuggestion[] {
  const number = /^\s*(\d+[a-z]?(?:-\d+)?)\s+\S/i.exec(typed)?.[1];
  if (!number) return [...suggestions];
  return suggestions.map((suggestion) =>
    suggestion.name || /^\d/.test(suggestion.street)
      ? suggestion
      : {
          ...suggestion,
          street: `${number} ${suggestion.street}`,
          line: `${number} ${suggestion.line}`,
        },
  );
}

/** Photon's city layer as suggestions: a US place and its state, no street. */
export function toCitySuggestions(body: unknown): AddressSuggestion[] {
  const features = isRecord(body) && Array.isArray(body.features) ? body.features : [];
  const found: AddressSuggestion[] = [];
  const seen = new Set<string>();
  features.forEach((feature: unknown, index) => {
    const p = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    if (!p || text(p.countrycode).toUpperCase() !== 'US') return;
    const state = stateCodeForName(text(p.state));
    const city = text(p.name);
    if (!state || !city) return;
    const line = `${city}, ${state}`;
    if (seen.has(line)) return;
    seen.add(line);
    const osm = `${text(p.osm_type)}${typeof p.osm_id === 'number' ? p.osm_id : ''}`;
    found.push({
      key: osm || `${index}`,
      name: null,
      street: '',
      city,
      state,
      postalCode: '',
      line,
    });
  });
  return found.slice(0, SUGGESTIONS_SHOWN);
}

/** Photon's GeoJSON as suggestions: US streets only, numbered ones first. */
export function toSuggestions(body: unknown): AddressSuggestion[] {
  const features = isRecord(body) && Array.isArray(body.features) ? body.features : [];
  const found: (AddressSuggestion & { numbered: boolean })[] = [];
  const seen = new Set<string>();
  features.forEach((feature: unknown, index) => {
    const p = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    if (!p || text(p.countrycode).toUpperCase() !== 'US') return;
    const state = stateCodeForName(text(p.state));
    // A street's own feature has its name and no street.
    const road = text(p.street) || (p.osm_key === 'highway' ? text(p.name) : '');
    if (!state || !road) return;
    const number = text(p.housenumber);
    const street = number ? `${number} ${road}` : road;
    const name = text(p.name) && text(p.name) !== road ? text(p.name) : null;
    const city = text(p.city);
    const postalCode = /^\d{5}(-\d{4})?/.exec(text(p.postcode))?.[0] ?? '';
    const line = [street, city, [state, postalCode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    const said = `${name ?? ''}|${line}`;
    if (seen.has(said)) return;
    seen.add(said);
    const osm = `${text(p.osm_type)}${typeof p.osm_id === 'number' ? p.osm_id : ''}`;
    found.push({
      key: osm || `${index}`,
      name,
      street,
      city,
      state,
      postalCode,
      line,
      numbered: number !== '',
    });
  });
  return found
    .sort((a, b) => Number(b.numbered) - Number(a.numbered))
    .slice(0, SUGGESTIONS_SHOWN)
    .map(({ numbered: _, ...suggestion }) => suggestion);
}

// Answers already had, for a backspace or the same words typed again: shown
// at once, Photon not asked. For the page's life; the oldest goes first.
const REMEMBERED_MAX = 100;
const remembered = new Map<string, AddressSuggestion[]>();
const rememberKey = (query: string, kind: SuggestionKind) =>
  `${kind}|${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/** What Photon already answered to these words, or null. */
export function rememberedSuggestions(
  query: string,
  kind: SuggestionKind = 'address',
): AddressSuggestion[] | null {
  return remembered.get(rememberKey(query, kind)) ?? null;
}

/** For tests: forget every answer. */
export function forgetSuggestions(): void {
  remembered.clear();
}

/**
 * Those shown that still fit what is typed now, while Photon is asked: each
 * typed word starts a word of the suggestion ("800 Pott" keeps 800 Potter
 * Street). Shown at once, so typing on narrows the list without a wait.
 */
export function narrowSuggestions(
  shown: readonly AddressSuggestion[],
  typed: string,
): AddressSuggestion[] {
  const words = typed
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  return shown.filter((suggestion) => {
    const own = `${suggestion.name ?? ''} ${suggestion.line}`.toLowerCase().split(/[\s,]+/);
    return words.every((word) => own.some((w) => w.startsWith(word)));
  });
}

/** Null when Photon is slow, down, blocked or the ask was dropped: the box stays as it is. */
export async function suggestAddresses(
  query: string,
  signal: AbortSignal,
  kind: SuggestionKind = 'address',
): Promise<AddressSuggestion[] | null> {
  try {
    const answer = await fetch(photonUrl(query, kind), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    const found = kind === 'city' ? toCitySuggestions(body) : toSuggestions(body);
    const key = rememberKey(query, kind);
    remembered.delete(key);
    remembered.set(key, found);
    if (remembered.size > REMEMBERED_MAX) {
      const oldest = remembered.keys().next().value;
      if (oldest !== undefined) remembered.delete(oldest);
    }
    return found;
  } catch {
    return null;
  }
}
