import { describe, expect, it } from 'vitest';
import {
  ageFrom,
  injuryBandOf,
  injuryDateLabel,
  injuryStageOf,
  isAdult,
  isNewlyInjured,
  roughYearsSinceInjury,
  timeSinceLabel,
  yearsSinceInjury,
} from '@/lib/injury';

const NOW = new Date('2026-09-11T00:00:00Z');
const dated = (injuryDate: string | null, p: 'day' | 'month' | 'year' | null = 'day') => ({
  injuryDate,
  injuryDatePrecision: p,
});

it('orders shared injury bands even when the date is private', () => {
  const member = { ...dated(null), injuryStage: 'og' as const };
  const bands = [0, 1, 2, 5, 6, 7] as const;
  expect(bands.map((injuryBand) => roughYearsSinceInjury({ ...member, injuryBand }, NOW))).toEqual([
    0.25, 0.75, 1.5, 15, 25, 35,
  ]);
  expect(roughYearsSinceInjury(member, NOW)).toBe(25);
  expect(roughYearsSinceInjury({ ...dated('2016-09-11'), injuryBand: 7 }, NOW)).toBeCloseTo(10);
});

describe('yearsSinceInjury', () => {
  it('computes years from the date, so it cannot go stale', () => {
    expect(yearsSinceInjury(dated('2016-09-11'), NOW)).toBeCloseTo(10, 1);
  });

  it('is null when no date was given', () => {
    expect(yearsSinceInjury(dated(null, null), NOW)).toBeNull();
  });

  it('clamps a future date to zero rather than returning a negative', () => {
    expect(yearsSinceInjury(dated('2030-01-01'), NOW)).toBe(0);
  });
});

describe('isNewlyInjured', () => {
  it('is true under a year', () => {
    expect(isNewlyInjured(dated('2026-03-01'), NOW)).toBe(true);
  });

  it('is false over a year', () => {
    expect(isNewlyInjured(dated('2020-01-01'), NOW)).toBe(false);
  });

  it('is null — not false — when unknown, because those differ', () => {
    expect(isNewlyInjured(dated(null, null), NOW)).toBeNull();
  });
});

describe('injuryDateLabel', () => {
  it('shows only the year when only a year was given', () => {
    expect(injuryDateLabel(dated('2013-01-01', 'year'))).toBe('2013');
  });

  it('shows month and year at month precision', () => {
    expect(injuryDateLabel(dated('2013-03-01', 'month'))).toBe('March 2013');
  });

  it('shows the full date only at day precision', () => {
    expect(injuryDateLabel(dated('2013-03-04', 'day'))).toBe('March 4, 2013');
  });

  it('says nothing without a date', () => {
    expect(injuryDateLabel(dated(null, null))).toBeNull();
  });
});

describe('timeSinceLabel', () => {
  it('counts months in the first year', () => {
    expect(timeSinceLabel(dated('2026-06-11'), NOW)).toBe('3 months post-injury');
  });

  it('counts whole years after that', () => {
    expect(timeSinceLabel(dated('2023-09-11'), NOW)).toBe('3 years post-injury');
  });

  it('uses the singular for one year', () => {
    expect(timeSinceLabel(dated('2025-09-11'), NOW)).toBe('1 year post-injury');
  });

  it('is null when there is no date to say it from', () => {
    expect(timeSinceLabel(dated(null, null), NOW)).toBeNull();
  });
});

describe('ageFrom', () => {
  it('derives age from a birth date', () => {
    expect(ageFrom('1996-01-01', NOW)).toBe(30);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageFrom('1996-12-31', NOW)).toBe(29);
  });

  it('is null without a birth date', () => {
    expect(ageFrom(null, NOW)).toBeNull();
  });
});

describe('the anniversary edge case', () => {
  it('is no longer newly injured on the anniversary', () => {
    expect(isNewlyInjured(dated('2025-09-11'), NOW)).toBe(false);
  });

  it('is still newly injured the day before', () => {
    expect(isNewlyInjured(dated('2025-09-12'), NOW)).toBe(true);
  });
});

describe('the age gate', () => {
  it('admits somebody exactly eighteen today', () => {
    expect(isAdult('2008-09-11', NOW)).toBe(true);
  });

  it('refuses somebody who turns eighteen tomorrow', () => {
    expect(isAdult('2008-09-12', NOW)).toBe(false);
  });

  it('refuses a missing date rather than letting it through', () => {
    expect(isAdult(null, NOW)).toBe(false);
    expect(isAdult('', NOW)).toBe(false);
  });
});

// The owner, 2026-11-17: the date hidden, how long ago shown in its place.
// The edges match public.injury_stage (20261117030000); a hidden date falls
// back to the stage the database sent.
describe('injuryStageOf', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const at = (injuryDate: string) => injuryStageOf({ injuryDate, injuryDatePrecision: 'day' }, now);
  it('puts each edge in the later stage', () => {
    expect(at('2026-05-18')).toBe('new');
    expect(at('2026-05-17')).toBe('recent');
    expect(at('2024-11-18')).toBe('recent');
    expect(at('2024-11-17')).toBe('years');
    expect(at('2016-11-17')).toBe('og');
    expect(at('1986-11-18')).toBe('og');
    expect(at('1986-11-17')).toBe('oog');
  });
  it('uses the sent stage where the date is hidden, and nothing where there is neither', () => {
    expect(
      injuryStageOf({ injuryDate: null, injuryDatePrecision: null, injuryStage: 'og' }, now),
    ).toBe('og');
    expect(injuryStageOf({ injuryDate: null, injuryDatePrecision: null }, now)).toBeNull();
  });
});

describe('injuryBandOf', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  it('puts each edge in the later band, as public.injury_band does', () => {
    const at = (injuryDate: string) =>
      injuryBandOf({ injuryDate, injuryDatePrecision: 'day' }, now);
    expect(
      [
        '2026-05-18',
        '2026-05-17',
        '2025-11-17',
        '2024-11-17',
        '2021-11-17',
        '2016-11-17',
        '2006-11-17',
        '1996-11-17',
        '1986-11-17',
        '1976-11-17',
        '1976-11-18',
      ].map(at),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8]);
  });
  it('uses the sent band where the date is hidden, else the stage, else nothing', () => {
    const hidden = { injuryDate: null, injuryDatePrecision: null };
    expect(injuryBandOf({ ...hidden, injuryBand: 3, injuryStage: 'years' }, now)).toBe(3);
    expect(injuryBandOf({ ...hidden, injuryStage: 'og' }, now)).toBe(6);
    expect(injuryBandOf(hidden, now)).toBeNull();
  });
});
