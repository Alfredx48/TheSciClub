/**
 * Reading an injury date.
 *
 * `injury_date` is a date, not a stored number of years, so time-since-injury is
 * computed on every read and cannot go stale. It is nullable — the NorCal SCI
 * directory does not record it, and "I would rather not say" is a real answer —
 * so every function here has to mean something when it is absent.
 *
 * `injury_date_precision` exists so nothing renders more confidence than was
 * given. Somebody who said "2013" is shown "2013", never a fabricated day.
 */

import {
  type DatePrecision,
  INJURY_BANDS,
  type InjuryBand,
  type InjuryStage,
} from '@/types/domain';

export interface InjuryDated {
  injuryDate: string | null;
  injuryDatePrecision: DatePrecision | null;
}

/**
 * Whole calendar months since the injury, or null when no date was given.
 *
 * Calendar arithmetic rather than dividing elapsed milliseconds by an average
 * year: an exact anniversary is 365 days, an average year is 365.2425, so the
 * division puts somebody at 0.9993 years on the day itself and the label reads
 * "12 months post-injury" instead of "1 year". Counting months makes the
 * anniversary land exactly.
 */
export function monthsSinceInjury(member: InjuryDated, now: Date = new Date()): number | null {
  if (!member.injuryDate) return null;
  const then = new Date(`${member.injuryDate}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;

  let months =
    (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + (now.getUTCMonth() - then.getUTCMonth());
  if (now.getUTCDate() < then.getUTCDate()) months -= 1;
  return months < 0 ? 0 : months;
}

/** Years since injury, fractional. Used for ranking, where the shape matters more
 *  than the exact figure. Null when no date was given. */
export function yearsSinceInjury(member: InjuryDated, now?: Date): number | null {
  const months = monthsSinceInjury(member, now);
  return months === null ? null : months / 12;
}

/**
 * Under a year in. Null when unknown — deliberately not `false`, because
 * "we do not know" and "no" lead to different decisions: the first should not
 * quietly route somebody away from the mentors they might need.
 */
export function isNewlyInjured(member: InjuryDated, now?: Date): boolean | null {
  const months = monthsSinceInjury(member, now);
  return months === null ? null : months < 12;
}

/**
 * How long ago, from the date where there is one (the reader's own, or one its
 * member shows), and otherwise the stage the database sent in its place.
 * The same edges as public.injury_stage (20261117030000).
 */
export function injuryStageOf(
  member: InjuryDated & { injuryStage?: InjuryStage | null },
  now?: Date,
): InjuryStage | null {
  const months = monthsSinceInjury(member, now);
  if (months === null) return member.injuryStage ?? null;
  if (months < 6) return 'new';
  if (months < 24) return 'recent';
  if (months < 120) return 'years';
  if (months < 480) return 'og';
  return 'oog';
}

/** A band as the database sent it, or null. */
export function toInjuryBand(value: unknown): InjuryBand | null {
  return INJURY_BANDS.find((band) => band === value) ?? null;
}

/** Each band's upper edge in months; the last band has none. */
const BAND_EDGES = [6, 12, 24, 60, 120, 240, 360, 480, 600] as const;
/** A band inside each stage, for a database before 20261118226000. */
const STAGE_BAND: Record<InjuryStage, InjuryBand> = {
  new: 0,
  recent: 2,
  years: 4,
  og: 6,
  oog: 9,
};

/** A band inside the stage, where the database sent no band. */
export function stageBand(stage: InjuryStage): InjuryBand {
  return STAGE_BAND[stage];
}

/**
 * Which of the ten bands, for the colour: from the date where there is one,
 * else the band the database sent, else the stage's. The same edges as
 * public.injury_band (20261118226000).
 */
export function injuryBandOf(
  member: InjuryDated & { injuryBand?: InjuryBand | null; injuryStage?: InjuryStage | null },
  now?: Date,
): InjuryBand | null {
  const months = monthsSinceInjury(member, now);
  if (months === null) {
    if (member.injuryBand != null) return member.injuryBand;
    return member.injuryStage ? stageBand(member.injuryStage) : null;
  }
  const band = BAND_EDGES.findIndex((edge) => months < edge);
  return toInjuryBand(band === -1 ? 9 : band);
}

/** The owner's words, 2026-11-17 (no OG or OOG: "just say injured 10+ years"). */
export const INJURY_STAGE_TEXT: Record<InjuryStage, string> = {
  new: 'Newly injured',
  recent: 'Recently injured',
  years: '2–10 years since injury',
  og: 'Injured 10+ years',
  oog: 'Injured 40+ years',
};

/** The stage in words; a condition is diagnosed rather than injured. */
export function injuryStageText(stage: InjuryStage, injuryType?: string | null): string {
  if (injuryType !== 'condition') return INJURY_STAGE_TEXT[stage];
  if (stage === 'new') return 'Newly diagnosed';
  if (stage === 'recent') return 'Recently diagnosed';
  return INJURY_STAGE_TEXT[stage]
    .replace('since injury', 'since diagnosis')
    .replace('Injured', 'Diagnosed');
}

/**
 * Each band in words (the owner, 2026-11-18: "Update the text in all Injured
 * 2-5 years etc"; "<6 mo." and "6-12 mo."), so the words say what the
 * colour does.
 */
export const INJURY_BAND_TEXT: Record<InjuryBand, string> = {
  0: 'Injured <6 mo.',
  1: 'Injured 6–12 mo.',
  2: 'Injured 1–2 years',
  3: 'Injured 2–5 years',
  4: 'Injured 5–10 years',
  5: 'Injured 10–20 years',
  6: 'Injured 20–30 years',
  7: 'Injured 30–40 years',
  8: 'Injured 40–50 years',
  9: 'Injured 50+ years',
};

/** The band in words; a condition is diagnosed rather than injured. */
export function injuryBandText(band: InjuryBand, injuryType?: string | null): string {
  const words = INJURY_BAND_TEXT[band];
  return injuryType === 'condition' ? words.replace('Injured', 'Diagnosed') : words;
}

/** Midpoints in years for profiles that share a band. */
const BAND_YEARS = [0.25, 0.75, 1.5, 3.5, 7.5, 15, 25, 35, 45, 55] as const;

/** A year inside each legacy stage, for profiles without a band. */
const STAGE_YEARS: Record<InjuryStage, number> = {
  new: 0.25,
  recent: 1.25,
  years: 6,
  og: 25,
  oog: 45,
};

/**
 * Years since injury from the date or the shared band. Used for ordering and matching.
 */
export function roughYearsSinceInjury(
  member: InjuryDated & { injuryBand?: InjuryBand | null; injuryStage?: InjuryStage | null },
  now?: Date,
): number | null {
  const years = yearsSinceInjury(member, now);
  if (years !== null) return years;
  if (member.injuryBand != null) return BAND_YEARS[member.injuryBand];
  return member.injuryStage ? STAGE_YEARS[member.injuryStage] : null;
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A date in words at exactly the precision it was given, never more. */
export function dateLabel(iso: string, precision: DatePrecision): string | null {
  const [y, m, d] = iso.split('-');
  if (!y) return null;
  if (precision === 'year') return y;
  const monthName = MONTHS[Number(m) - 1];
  if (!monthName) return y;
  if (precision === 'month') return `${monthName} ${y}`;
  return `${monthName} ${Number(d)}, ${y}`;
}

/** The injury date at exactly the precision it was given, never more. */
export function injuryDateLabel(member: InjuryDated): string | null {
  if (!member.injuryDate || !member.injuryDatePrecision) return null;
  return dateLabel(member.injuryDate, member.injuryDatePrecision);
}

/** "3 years post-injury", or null when there is no date to say it from. */
export function timeSinceLabel(member: InjuryDated, now?: Date): string | null {
  const months = monthsSinceInjury(member, now);
  if (months === null) return null;
  if (months < 12) {
    const m = Math.max(1, months);
    return `${m} month${m === 1 ? '' : 's'} post-injury`;
  }
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} post-injury`;
}

/** Age on a given date, from a birth date. Age is never stored. */
export function ageFrom(birthDate: string | null, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** The club is 18+. One place decides what that means. */
export const MINIMUM_AGE = 18;

export function isAdult(birthDate: string | null, now?: Date): boolean {
  const age = ageFrom(birthDate, now);
  return age !== null && age >= MINIMUM_AGE;
}
