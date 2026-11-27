import type { ClubEvent } from '@/types/domain';

/**
 * Turning a date-ordered list of events into one row per repeating event.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth doing at all
 * ---------------------------------------------------------------------------
 * The calendar is made of far fewer events than it has rows. Measured against
 * the live feed: 115 upcoming rows are 34 distinct events, and three of them
 * are most of the difference — Staying Driven repeats 27 times, the Friday
 * Happy Hour and Weekly Wednesdays 15 each. A member scanning the default
 * thirty-day window meets the same wheelchair fitness class nine times before
 * reaching anything else.
 *
 * Listing every occurrence is still correct for a calendar — you want to know
 * when *this* Friday's happy hour is — so the problem is scanning rather than
 * correctness, and the answer is to show the next one and say how many more
 * there are, not to hide the rest.
 *
 * ---------------------------------------------------------------------------
 * Counted within the window, never across the whole series
 * ---------------------------------------------------------------------------
 * The events handed in are already filtered — by segment, by date window, by
 * every chip in the sheet. The count and the last date come from those and
 * nothing else, so "8 more dates" always means eight rows that expanding will
 * actually show. Reading the whole series instead would put 27 on a card whose
 * expansion offers nine, under a window the member chose.
 */
export interface SeriesGroup {
  /** The occurrence that stands for the group: the first one in the list. */
  lead: ClubEvent;
  /** Every later occurrence inside the current filters, in the same order. */
  rest: ClubEvent[];
  /**
   * The series this group belongs to, or null for a one-off.
   *
   * A group with a null key always has an empty `rest`: two unrelated events
   * are not a series, and grouping them because neither has one would collapse
   * the whole one-off half of the calendar into a single row.
   */
  seriesId: string | null;
}

/**
 * Group a date-ordered list without reordering it.
 *
 * Each series appears once, at the position of its earliest occurrence, so the
 * list stays in date order by the thing a member is reading it for — the next
 * time each event happens. Occurrences of one series are not adjacent in the
 * input and are not expected to be.
 */
export function groupBySeries(events: ClubEvent[]): SeriesGroup[] {
  const groups: SeriesGroup[] = [];
  const bySeries = new Map<string, SeriesGroup>();

  for (const event of events) {
    if (!event.seriesId) {
      groups.push({ lead: event, rest: [], seriesId: null });
      continue;
    }
    const existing = bySeries.get(event.seriesId);
    if (existing) {
      existing.rest.push(event);
      continue;
    }
    const group: SeriesGroup = { lead: event, rest: [], seriesId: event.seriesId };
    bySeries.set(event.seriesId, group);
    groups.push(group);
  }

  // A cancelled next date does not stand for the series, or the whole of it
  // reads as cancelled (20261127100000): the next date still on does, and
  // the cancelled one stays among its dates.
  return groups.map((group) => {
    if (!group.lead.cancelled) return group;
    const all = [group.lead, ...group.rest];
    const on = all.find((event) => !event.cancelled);
    return on ? { ...group, lead: on, rest: all.filter((event) => event !== on) } : group;
  });
}

/**
 * How often a group repeats, in the member's words, or null when there is not
 * enough of it to say.
 *
 * Derived here and never stored. A cadence is a property of the occurrences in
 * front of somebody — inside a seven-day window a weekly series has one gap and
 * a monthly one has none — so a stored answer would disagree with the list it
 * sits in.
 *
 * ---------------------------------------------------------------------------
 * The statistic is a mean with the largest gap dropped, and both halves matter
 * ---------------------------------------------------------------------------
 * A plain mean is wrong because a holiday skips a week and doubles one gap:
 * [7, 14, 7, 7] averages 8.75 and renames a weekly class.
 *
 * A median is wrong in a way that took a failing test to see. Staying Driven
 * runs Wednesdays and Mondays, so its gaps alternate 5, 2, 5, 2 — and the
 * median of an alternating series is whichever value the middle lands on, so it
 * answers 3.5 with eight gaps and 5 with five gaps. The same event changes
 * rhythm depending on how many occurrences the window happens to hold.
 *
 * Dropping the single largest gap and averaging the rest survives both: the
 * holiday is the outlier it removes, and an alternating pattern keeps its shape
 * whatever the parity. [7, 14, 7, 7] gives 7, and 5, 2, 5, 2 gives 3.5 at any
 * length.
 *
 * Two occurrences give one gap, and one gap is not a rhythm — it is a
 * coincidence with a number attached. Two climbing meet-ups two days apart were
 * being announced as "Daily". Three occurrences before anything is named.
 *
 * Anything not near a familiar rhythm gets "Repeats" rather than an invented
 * word for it.
 */
export function cadenceOf(group: SeriesGroup): string | null {
  return cadenceOfStarts([group.lead, ...group.rest].map((event) => event.startTime));
}

/**
 * The same, from the dates' starts in order: for an event's own page and
 * Stats & controls, which have a series' dates but not a group (the owner,
 * 2026-11-06).
 */
export function cadenceOfStarts(starts: readonly string[]): string | null {
  // Two occurrences give one gap, and one gap is not a rhythm — it is a
  // coincidence with a number attached. Two climbing meet-ups two days apart
  // were being announced as "Daily", which is a claim the data does not make.
  // Three occurrences, two gaps, before naming anything.
  if (starts.length < 3) return null;

  const days: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const previous = Date.parse(starts[i - 1] ?? '');
    const current = Date.parse(starts[i] ?? '');
    if (Number.isNaN(previous) || Number.isNaN(current)) continue;
    days.push(Math.abs(current - previous) / 86_400_000);
  }
  if (days.length === 0) return null;

  days.sort((a, b) => a - b);
  // Drop the largest gap when there is more than one, so a single skipped week
  // cannot rename the series. See the note above.
  const kept = days.length > 1 ? days.slice(0, -1) : days;
  const median = kept.reduce((total, gap) => total + gap, 0) / kept.length;

  // Generous bands, because a feed's times drift by an hour over a daylight
  // saving boundary and a holiday moves a date by a day or two.
  if (median >= 0.5 && median < 2.5) return 'Daily';
  // Half a week. Staying Driven — the largest series on the calendar at 27
  // occurrences — runs Wednesdays and Mondays, so its gaps alternate 5, 2, 5,
  // 2 and the median lands at 3.5: past Daily, short of Weekly, and it read as
  // the shrug that "Repeats" is. Twice a week is what it does.
  if (median >= 2.5 && median <= 4.5) return 'Twice a week';
  if (median >= 5.5 && median <= 8.5) return 'Weekly';
  if (median >= 12 && median <= 16) return 'Fortnightly';
  if (median >= 26 && median <= 35) return 'Monthly';
  return 'Repeats';
}

/** "Repeats weekly", "Repeats twice a week", or just "Repeats". */
export function repeatsLine(cadence: string | null): string {
  return !cadence || cadence === 'Repeats' ? 'Repeats' : `Repeats ${cadence.toLowerCase()}`;
}
