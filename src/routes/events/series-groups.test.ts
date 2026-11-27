import { describe, expect, it } from 'vitest';
import { cadenceOf, groupBySeries, type SeriesGroup } from '@/routes/events/series-groups';
import { makeEvent } from '@/test/factory';

/** An occurrence `days` after 5 September 2026, at 6pm UTC. */
function on(day: number, overrides: Parameters<typeof makeEvent>[0] = {}) {
  const d = new Date(Date.UTC(2026, 8, 5 + day, 18, 0, 0));
  return makeEvent({ id: `e${day}`, startTime: d.toISOString(), ...overrides });
}

describe('groupBySeries', () => {
  it('shows a series once, where its earliest occurrence sat', () => {
    const list = [
      on(0, { id: 'happy-1', seriesId: 'happy' }),
      on(1, { id: 'oneoff' }),
      on(7, { id: 'happy-2', seriesId: 'happy' }),
      on(14, { id: 'happy-3', seriesId: 'happy' }),
    ];
    const groups = groupBySeries(list);
    expect(groups.map((g) => g.lead.id)).toEqual(['happy-1', 'oneoff']);
    expect(groups[0]?.rest.map((e) => e.id)).toEqual(['happy-2', 'happy-3']);
  });

  it('leads a series with its next date still on, not a cancelled one', () => {
    const list = [
      on(0, { id: 'w1', seriesId: 'w', cancelled: true }),
      on(7, { id: 'w2', seriesId: 'w' }),
      on(14, { id: 'w3', seriesId: 'w', cancelled: true }),
    ];
    const [group] = groupBySeries(list);
    expect(group?.lead.id).toBe('w2');
    expect(group?.rest.map((e) => e.id)).toEqual(['w1', 'w3']);
    // Every date cancelled: the first still stands for it.
    expect(groupBySeries([list[0], list[2]].flatMap((e) => (e ? [e] : [])))[0]?.lead.id).toBe('w1');
  });

  it('keeps the list in date order by each event’s next occurrence', () => {
    // Occurrences of one series are not adjacent in the input, and the group
    // must not jump to where the last one sat.
    const list = [
      on(0, { id: 'a', seriesId: 's1' }),
      on(2, { id: 'b' }),
      on(30, { id: 'a2', seriesId: 's1' }),
      on(40, { id: 'c' }),
    ];
    expect(groupBySeries(list).map((g) => g.lead.id)).toEqual(['a', 'b', 'c']);
  });

  it('never groups one-offs with each other', () => {
    // They all have a null series. Treating that as a shared key would collapse
    // every unrepeated event in the calendar into one row.
    const list = [on(0, { id: 'a' }), on(1, { id: 'b' }), on(2, { id: 'c' })];
    const groups = groupBySeries(list);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.rest.length === 0)).toBe(true);
  });

  it('leaves a series with a single occurrence in the window as a plain row', () => {
    const groups = groupBySeries([on(0, { id: 'only', seriesId: 's1' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rest).toEqual([]);
  });
});

describe('cadenceOf', () => {
  const group = (days: number[]): SeriesGroup => {
    const [lead, ...rest] = days.map((d) => on(d, { seriesId: 's1' }));
    if (!lead) throw new Error('a group needs at least one occurrence');
    return { lead, rest, seriesId: 's1' };
  };

  it('names a weekly rhythm', () => {
    expect(cadenceOf(group([0, 7, 14, 21]))).toBe('Weekly');
  });

  it('is not renamed by one displaced date', () => {
    // A holiday skips a week, doubling one gap. A mean would drag this to
    // fortnightly and rename a weekly class; the median does not.
    expect(cadenceOf(group([0, 7, 21, 28, 35]))).toBe('Weekly');
  });

  it('names fortnightly and monthly', () => {
    expect(cadenceOf(group([0, 14, 28, 42]))).toBe('Fortnightly');
    expect(cadenceOf(group([0, 30, 60, 90]))).toBe('Monthly');
  });

  it('gives an alternating rhythm the same name at any length', () => {
    // The bug a median hid: the middle of an alternating series is whichever
    // value the parity lands on, so Staying Driven read "Twice a week" with
    // eight gaps and "Repeats" with five. The same event, two answers.
    expect(cadenceOf(group([0, 5, 7, 12, 14, 19]))).toBe('Twice a week');
    expect(cadenceOf(group([0, 5, 7, 12, 14, 19, 21, 26, 28]))).toBe('Twice a week');
  });

  it('names a twice-weekly rhythm rather than shrugging at it', () => {
    // The real shape of Staying Driven: Wednesdays and Mondays, so the gaps
    // alternate 5, 2, 5, 2 and the median is 3.5 — past Daily and short of
    // Weekly. It is the biggest series on the calendar, and "Repeats" told a
    // member nothing about it.
    expect(cadenceOf(group([0, 5, 7, 12, 14, 19]))).toBe('Twice a week');
  });

  it('will not name a rhythm from a single gap', () => {
    // Two climbing meet-ups two days apart are not a daily class.
    expect(cadenceOf(group([0, 2]))).toBeNull();
    expect(cadenceOf(group([0, 7]))).toBeNull();
  });

  it('says only "Repeats" when the rhythm is not a familiar one', () => {
    // Twice a year is real, and naming it would be inventing a word for it.
    expect(cadenceOf(group([0, 180, 360]))).toBe('Repeats');
  });

  it('has nothing to say about a single occurrence', () => {
    expect(cadenceOf(group([0]))).toBeNull();
  });
});
