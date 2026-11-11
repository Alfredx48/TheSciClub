import { describe, expect, it } from 'vitest';
import type { MapContents } from '@/lib/map-data';
import {
  activeFilterCount,
  ageBandsIn,
  filterMembers,
  hasConditions,
  membersBeyond,
  milesForEnough,
  organizationsIn,
  organizationsWithin,
  othersOnly,
  regionsIn,
  toggleFilter,
  topicsIn,
} from '@/routes/peers/filters';
import { makeMember } from '@/test/factory';
import { EMPTY_MEMBER_FILTERS } from '@/types/domain';

const none = EMPTY_MEMBER_FILTERS;

describe('othersOnly', () => {
  const deck = [
    makeMember({ id: 'me', displayName: 'You' }),
    makeMember({ id: 'a', displayName: 'Ajay' }),
  ];

  it('drops the person reading it', () => {
    // The deck answers "who could I talk to", and the reader is not one of
    // them. It skewed the count under it too.
    expect(othersOnly(deck, 'me').map((m) => m.displayName)).toEqual(['Ajay']);
  });

  it('drops nobody when there is no viewer', () => {
    // Signed out, or before onboarding has written a member row.
    expect(othersOnly(deck, null)).toHaveLength(2);
  });
});

// An administrator is a member and sorts like one (the owner, 2026-10-01).
// Until then the club's "official account" was moved to the end of the deck.
describe('an administrator in the deck', () => {
  it('keeps their place in the order, not moved to the end', () => {
    const deck = [
      makeMember({ displayName: 'Ada', isAdmin: true }),
      makeMember({ displayName: 'Bea' }),
    ];
    expect(filterMembers(deck, none, 'everyone').map((m) => m.displayName)).toEqual(['Ada', 'Bea']);
  });
});

describe('segments', () => {
  const deck = [
    makeMember({ displayName: 'Mentor', type: 'mentor', city: 'Eureka' }),
    makeMember({ displayName: 'Local', type: 'peer', city: 'San Jose' }),
    makeMember({ displayName: 'Distant', type: 'peer', city: 'Eureka' }),
  ];

  it('everyone shows the whole deck', () => {
    expect(filterMembers(deck, none, 'everyone')).toHaveLength(3);
  });

  it('mentors shows only mentors', () => {
    expect(filterMembers(deck, none, 'mentors').map((m) => m.displayName)).toEqual(['Mentor']);
  });
});

describe('filters', () => {
  it('filters by region', () => {
    const deck = [
      makeMember({ displayName: 'Quad', region: 'Cervical' }),
      makeMember({ displayName: 'Para', region: 'Thoracic' }),
    ];
    const filtered = filterMembers(deck, { ...none, regions: ['Cervical'] }, 'everyone');
    expect(filtered.map((m) => m.displayName)).toEqual(['Quad']);
  });

  it('keeps mentors or those who are not', () => {
    const deck = [
      makeMember({ displayName: 'M', type: 'mentor' }),
      makeMember({ displayName: 'P', type: 'peer' }),
    ];
    const names = (role: 'mentors' | 'peers') =>
      filterMembers(deck, { ...none, role }, 'everyone').map((m) => m.displayName);
    expect(names('mentors')).toEqual(['M']);
    expect(names('peers')).toEqual(['P']);
  });

  it("keeps the members of one organization, by their words or the club's records", () => {
    const deck = [
      makeMember({ displayName: 'Said', affiliations: ['BORP'] }),
      makeMember({
        displayName: 'Mentor',
        affiliations: [],
        mentorOrganizations: [{ id: 'b', name: 'BORP' }] as never,
      }),
      makeMember({ displayName: 'Other', affiliations: ['NorCal SCI'] }),
    ];
    const kept = filterMembers(deck, { ...none, organization: 'BORP' }, 'everyone');
    expect(kept.map((m) => m.displayName)).toEqual(['Said', 'Mentor']);
    expect(organizationsIn(deck)).toEqual(['BORP', 'NorCal SCI']);
  });

  it("measures from the member's city to where the map places each city", () => {
    const home = { latitude: 37.34, longitude: -121.89 };
    const peerCities = [
      { latitude: 37.8, longitude: -122.27, city: 'Oakland', state: 'CA', memberIds: ['near'] },
      { latitude: 34.05, longitude: -118.24, city: 'LA', state: 'CA', memberIds: ['far'] },
    ];
    expect([...(membersBeyond({ home, peerCities }, 50) ?? [])]).toEqual(['far']);
    expect(membersBeyond({ home, peerCities }, null)).toBeNull();
    expect(membersBeyond({ home: null, peerCities }, 50)).toBeNull();
    // Somebody not placed yet (a new member before the lookup) stays, in order.
    const deck = [
      makeMember({ id: 'far' }),
      makeMember({ id: 'near' }),
      makeMember({ id: 'unplaced' }),
    ];
    expect(
      filterMembers(deck, { ...none, withinMiles: 50 }, 'everyone', new Set(['far'])).map(
        (m) => m.id,
      ),
    ).toEqual(['near', 'unplaced']);
  });

  it('matches a topic filter against interests too, since people file things under both', () => {
    const deck = [makeMember({ displayName: 'A', topics: [], interests: ['Adaptive sports'] })];
    // The chip carries the grouped label, because that is what topicsIn offers.
    expect(filterMembers(deck, { ...none, topics: ['Adaptive sport'] }, 'everyone')).toHaveLength(
      1,
    );
  });

  it('finds a member who wrote the topic another way', () => {
    const deck = [
      makeMember({ displayName: 'Wrote it one way', topics: ['Going back to school'] }),
      makeMember({ displayName: 'Wrote it another', topics: ['Returning to college'] }),
      makeMember({ displayName: 'Not interested', topics: ['Cooking'] }),
    ];
    expect(
      filterMembers(deck, { ...none, topics: ['Back to school'] }, 'everyone').map(
        (m) => m.displayName,
      ),
    ).toEqual(['Wrote it one way', 'Wrote it another']);
  });

  it('combines filters with AND, not OR', () => {
    const deck = [
      makeMember({ displayName: 'Both', region: 'Cervical', type: 'mentor' }),
      makeMember({ displayName: 'OnlyRegion', region: 'Cervical', type: 'peer' }),
    ];
    const filtered = filterMembers(
      deck,
      { ...none, regions: ['Cervical'], role: 'mentors' },
      'everyone',
    );
    expect(filtered.map((m) => m.displayName)).toEqual(['Both']);
  });
});

describe('search', () => {
  const deck = [
    makeMember({ displayName: 'Nicole', bio: 'Mostly manual chair; SmartDrive to travel.' }),
    makeMember({ displayName: 'Vicki', selfCare: ['Colostomy'], bio: 'Power chair.' }),
    makeMember({ displayName: 'Ajay', city: 'San Jose' }),
    makeMember({ displayName: 'Mary Ann', topics: ['Adaptive sport'] }),
  ];
  const names = (search: string) =>
    filterMembers(deck, { ...none, search }, 'everyone').map((m) => m.displayName);

  // The first keystroke has to move the deck: "a" is somewhere in every bio,
  // so a search across everything left all of them in place and looked broken.
  it('matches the start of a name, from the first letter', () => {
    expect(names('a')).toEqual(['Ajay', 'Mary Ann']);
    expect(names('an')).toEqual(['Mary Ann']);
    expect(names('v')).toEqual(['Vicki']);
  });

  it('matches the start of a word of the name, not the middle of one', () => {
    expect(names('ry')).toEqual([]);
  });

  // Place, level, topics and the bio are the filter sheet's job. The box
  // reading them too is what made it look as if it did nothing.
  it('reads the name only, not the bio, self-care, city or topics', () => {
    expect(names('smartdrive')).toEqual([]);
    expect(names('colostomy')).toEqual([]);
    expect(names('san jose')).toEqual([]);
    expect(names('adaptive')).toEqual([]);
  });

  it('is case insensitive and ignores surrounding whitespace', () => {
    expect(names('  NICOLE ')).toEqual(['Nicole']);
  });

  it('an empty search matches everyone', () => {
    expect(names('   ')).toHaveLength(4);
  });
});

describe('toggleFilter', () => {
  it('adds then removes, without mutating', () => {
    const on = toggleFilter(none, 'regions', 'Cervical');
    expect(on.regions).toEqual(['Cervical']);
    expect(none.regions).toEqual([]);
    expect(toggleFilter(on, 'regions', 'Cervical').regions).toEqual([]);
  });
});

describe('option lists', () => {
  const deck = [
    makeMember({ region: 'Cervical', city: 'San Jose', topics: ['Driving', 'Travel'] }),
    makeMember({ region: 'Cervical', city: null, topics: ['Driving'] }),
  ];

  it('deduplicates and drops null cities', () => {
    expect(regionsIn(deck)).toEqual(['Cervical']);
    // Grouped: "Driving" is one of the wordings under the driving group, and
    // "Travel" is claimed by nothing, so it keeps the member's own word.
    expect(topicsIn(deck)).toEqual(['Driving and getting about', 'Travel']);
  });

  it('counts active filters but not the search box', () => {
    expect(activeFilterCount({ ...none, regions: ['Cervical'], search: 'x' })).toBe(1);
  });
});

describe('the spinal cord condition filter', () => {
  const deck = [
    makeMember({ displayName: 'Quad', region: 'Cervical' }),
    makeMember({ displayName: 'Para', region: 'Thoracic' }),
    makeMember({
      displayName: 'TM',
      injuryType: 'condition',
      conditionName: 'Transverse myelitis',
      region: 'Unknown',
    }),
    makeMember({
      displayName: 'SB at L4',
      injuryType: 'condition',
      conditionName: 'Spina bifida',
      region: 'Lumbar & sacral',
    }),
  ];
  const names = (filters: typeof none) =>
    filterMembers(deck, filters, 'everyone').map((m) => m.displayName);

  it('keeps only members with a condition, with a level or without', () => {
    expect(names({ ...none, condition: true })).toEqual(['TM', 'SB at L4']);
  });

  it('adds to a region ticked beside it, rather than narrowing it', () => {
    expect(names({ ...none, condition: true, regions: ['Cervical'] })).toEqual([
      'Quad',
      'TM',
      'SB at L4',
    ]);
  });

  it('counts as one active filter, and is offered only when somebody has a condition', () => {
    expect(activeFilterCount({ ...none, condition: true })).toBe(1);
    expect(hasConditions(deck)).toBe(true);
    expect(hasConditions(deck.slice(0, 2))).toBe(false);
  });
});

describe('the age filter', () => {
  const deck = [
    makeMember({ id: 'young', age: 24 }),
    makeMember({ id: 'thirty', age: 30 }),
    makeMember({ id: 'forties', age: 49 }),
    makeMember({ id: 'older', age: 71 }),
    makeMember({ id: 'unsaid', age: null }),
  ];
  const ids = (ages: string[]) =>
    filterMembers(deck, { ...none, ages }, 'everyone').map((m) => m.id);

  it('keeps the members in any ticked group, edges included', () => {
    expect(ids(['30s'])).toEqual(['thirty']);
    expect(ids(['under-30', '40s'])).toEqual(['young', 'forties']);
    expect(ids(['70-plus'])).toEqual(['older']);
  });

  it('leaves out a member who gave no age only once a group is ticked', () => {
    expect(ids([])).toContain('unsaid');
    expect(ids(['under-30', '30s', '40s', '50s', '60s', '70-plus'])).not.toContain('unsaid');
  });

  it('offers only the groups somebody is in, youngest first', () => {
    expect(ageBandsIn(deck)).toEqual(['under-30', '30s', '40s', '70-plus']);
  });

  it('counts towards the filter dot', () => {
    expect(activeFilterCount({ ...none, ages: ['30s', '40s'] })).toBe(2);
    expect(toggleFilter({ ...none, ages: ['30s'] }, 'ages', '30s').ages).toEqual([]);
  });
});

describe('searching past the filters', () => {
  it('finds somebody a filter or a distance would hide', () => {
    const deck = [makeMember({ id: 'n', displayName: 'Nicole', city: 'Fresno' })];
    const narrowed = { ...none, search: 'nicole', withinMiles: 5, ages: ['18-29'] };
    expect(filterMembers(deck, narrowed, 'everyone', new Set()).map((m) => m.id)).toEqual(['n']);
  });
});

describe('milesForEnough', () => {
  const home = { latitude: 37.3, longitude: -121.9 };
  // A degree of latitude is about 69 miles.
  const at = (id: number, miles: number) => ({
    id: String(id),
    latitude: 37.3 + miles / 69,
    longitude: -121.9,
  });
  const twenty = (miles: number) => Array.from({ length: 20 }, (_, i) => at(i, miles));

  it('is the shortest stop on the slider with twenty in it', () => {
    expect(milesForEnough(home, twenty(12))).toBe(15);
    expect(milesForEnough(home, twenty(0))).toBe(5);
  });

  it('counts something with several places once, at its nearest', () => {
    const places = [...twenty(12).slice(0, 19), at(0, 1), at(19, 90)];
    expect(milesForEnough(home, places)).toBe(95);
  });

  it('is any distance with too few, too far, or no home', () => {
    expect(milesForEnough(home, twenty(12).slice(1))).toBeNull();
    expect(milesForEnough(home, twenty(300))).toBeNull();
    expect(milesForEnough(null, twenty(12))).toBeNull();
  });
});

describe('organizationsWithin', () => {
  it('finds those with a place within the distance', () => {
    const home = { latitude: 37.3, longitude: -121.9 };
    const place = (id: string, latitude: number) =>
      ({ id, latitude, longitude: -121.9 }) as MapContents['organizations'][number];
    const organizations = [place('near', 37.31), place('far', 45)];
    expect([...organizationsWithin({ home, organizations }, 50)]).toEqual(['near']);
  });
});
