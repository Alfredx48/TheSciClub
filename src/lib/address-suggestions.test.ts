import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  photonUrl,
  suggestAddresses,
  toCitySuggestions,
  toSuggestions,
  withTypedNumber,
} from '@/lib/address-suggestions';

/** Shaped as photon.komoot.io answered on 2026-10-28. */
const feature = (properties: Record<string, unknown>) => ({
  type: 'Feature',
  properties: { countrycode: 'US', osm_type: 'W', ...properties },
  geometry: { type: 'Point', coordinates: [-122.29, 37.85] },
});
const ironworks = feature({
  osm_id: 157158278,
  osm_key: 'leisure',
  osm_value: 'sports_centre',
  type: 'house',
  housenumber: '800',
  name: 'Berkeley Ironworks',
  street: 'Potter Street',
  city: 'Berkeley',
  state: 'California',
  postcode: '94710',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Photon's answer as addresses to fill in", () => {
  it('gives the number and street, the city, the two-letter state and the ZIP, keeping a gym’s name', () => {
    expect(toSuggestions({ features: [ironworks] })).toEqual([
      {
        key: 'W157158278',
        name: 'Berkeley Ironworks',
        street: '800 Potter Street',
        city: 'Berkeley',
        state: 'CA',
        postalCode: '94710',
        line: '800 Potter Street, Berkeley, CA 94710',
      },
    ]);
  });

  it('gives the street alone when there is no house number, and a street’s own name as its street', () => {
    const [pool, road] = toSuggestions({
      features: [
        feature({
          osm_id: 1,
          osm_key: 'leisure',
          name: 'Pool',
          street: 'Adeline Street',
          city: 'Berkeley',
          state: 'California',
        }),
        feature({
          osm_id: 2,
          osm_key: 'highway',
          type: 'street',
          name: 'Adelene Way',
          state: 'Georgia',
          postcode: '30157',
        }),
      ],
    });
    expect(pool).toMatchObject({ name: 'Pool', street: 'Adeline Street', postalCode: '' });
    expect(pool?.line).toBe('Adeline Street, Berkeley, CA');
    expect(road).toMatchObject({ name: null, street: 'Adelene Way', city: '', state: 'GA' });
    expect(road?.line).toBe('Adelene Way, GA 30157');
  });

  it('leaves out anything outside the US, with no street, or in no state it knows', () => {
    expect(
      toSuggestions({
        features: [
          feature({
            countrycode: 'CA',
            street: 'Potter Street',
            housenumber: '800',
            state: 'British Columbia',
          }),
          feature({ countrycode: 'MX', street: 'Calle 5', state: 'California' }),
          feature({ osm_key: 'place', osm_value: 'city', name: 'Berkeley', state: 'California' }),
          feature({ street: 'Calle Loíza', housenumber: '1', state: 'Puerto Rico' }),
          { type: 'Feature' },
          'nonsense',
        ],
      }),
    ).toEqual([]);
    expect(toSuggestions(null)).toEqual([]);
    expect(toSuggestions({ features: 'none' })).toEqual([]);
  });

  it('reads the District of Columbia, and a ZIP+4, and only the first ZIP of several', () => {
    const [pva, two] = toSuggestions({
      features: [
        feature({
          osm_id: 3,
          housenumber: '1875',
          street: 'Eye Street Northwest',
          city: 'Washington',
          state: 'District of Columbia',
          postcode: '20006-5409',
        }),
        feature({
          osm_id: 4,
          housenumber: '1',
          street: 'Main Street',
          city: 'Reno',
          state: 'nevada',
          postcode: '89501;89502',
        }),
      ],
    });
    expect(pva).toMatchObject({ state: 'DC', postalCode: '20006-5409' });
    expect(two).toMatchObject({ state: 'NV', postalCode: '89501' });
  });

  it('puts numbered addresses first, says each once, and shows five at most', () => {
    const street = feature({
      osm_id: 9,
      osm_key: 'highway',
      name: 'Potter Street',
      city: 'Berkeley',
      state: 'California',
    });
    const numbered = (n: number) =>
      feature({
        osm_id: 10 + n,
        housenumber: `${n}`,
        street: 'Potter Street',
        city: 'Berkeley',
        state: 'California',
      });
    const found = toSuggestions({
      features: [
        street,
        numbered(1),
        numbered(1),
        numbered(2),
        numbered(3),
        numbered(4),
        numbered(5),
        numbered(6),
      ],
    });
    expect(found.map((s) => s.street)).toEqual([
      '1 Potter Street',
      '2 Potter Street',
      '3 Potter Street',
      '4 Potter Street',
      '5 Potter Street',
    ]);
  });
});

describe('asking Photon', () => {
  it('asks Photon, never Nominatim, for US places in English', () => {
    const url = new URL(photonUrl(' 800 Potter '));
    expect(url.origin).toBe('https://photon.komoot.io');
    expect(url.pathname).toBe('/api/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '800 Potter',
      limit: '10',
      lang: 'en',
      countrycode: 'US',
    });
  });

  it('answers null, never throwing, when Photon is down, refuses or the ask is dropped', async () => {
    const signal = new AbortController().signal;
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await suggestAddresses('800 Potter', signal)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('busy', { status: 503 })));
    expect(await suggestAddresses('800 Potter', signal)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await suggestAddresses('800 Potter', signal)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', 'AbortError')));
    expect(await suggestAddresses('800 Potter', signal)).toBeNull();
  });

  it('passes its signal, so a newer ask can drop it', async () => {
    const asked = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(Response.json({ features: [ironworks] })),
    );
    vi.stubGlobal('fetch', asked);
    const controller = new AbortController();
    expect(await suggestAddresses('800 Potter', controller.signal)).toHaveLength(1);
    expect(asked.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });
});

// The owner, 2026-11-20: "Yes suggest cities".
describe("Photon's answer as cities to fill in", () => {
  it('asks its city layer, and gives each US city once with its two-letter state', () => {
    expect(new URL(photonUrl('Oakl', 'city')).searchParams.get('layer')).toBe('city');
    expect(new URL(photonUrl('800 Pot')).searchParams.has('layer')).toBe(false);
    const city = (name: string, state: string, countrycode = 'US') =>
      feature({ osm_id: name.length, type: 'city', name, state, countrycode });
    expect(
      toCitySuggestions({
        features: [
          city('Oakland', 'California'),
          city('Oakland', 'California'),
          city('Oakley', 'California'),
          city('Oakville', 'Ontario', 'CA'),
        ],
      }).map((s) => [s.city, s.state, s.line, s.street]),
    ).toEqual([
      ['Oakland', 'CA', 'Oakland, CA', ''],
      ['Oakley', 'CA', 'Oakley, CA', ''],
    ]);
  });
});

// The owner, 2026-11-20: "831 Schooner Street, Foster City" was suggested as
// Schooner Street alone, and picking it lost the house number.
describe('a street OpenStreetMap has no house numbers for', () => {
  it('takes the number typed; a numbered address or a named place keeps its own', () => {
    const schooner = feature({
      osm_id: 1,
      osm_key: 'highway',
      type: 'street',
      name: 'Schooner Street',
      city: 'Foster City',
      state: 'California',
      postcode: '94404',
    });
    const park = feature({
      osm_id: 2,
      name: 'Schooner Creek Discovery Park',
      housenumber: '4815',
      street: 'Southeast 51st Street',
      city: 'Lincoln City',
      state: 'Oregon',
    });
    const found = toSuggestions({ features: [schooner, park] });
    expect(withTypedNumber(found, '831 schooner stre').map((s) => s.street)).toEqual([
      '4815 Southeast 51st Street',
      '831 Schooner Street',
    ]);
    expect(withTypedNumber(found, '831 schooner stre')[1]?.line).toBe(
      '831 Schooner Street, Foster City, CA 94404',
    );
    // Nothing typed as a number: as Photon said.
    expect(withTypedNumber(found, 'schooner st')).toEqual(found);
  });
});
