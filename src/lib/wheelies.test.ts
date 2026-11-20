import { describe, expect, it } from 'vitest';
import { monthAfterStarts, monthInWords, wheelOf } from './wheelies';

describe('wheelOf', () => {
  it('fills a spoke for each seventh of the way and changes colour when the seventh would fill', () => {
    const at = (points: number) => {
      const w = wheelOf(points);
      return `${w.level.level}/${w.spokes}`;
    };
    expect(at(0)).toBe('1/0');
    expect(at(14)).toBe('1/0');
    expect(at(15)).toBe('1/1'); // 100 / 7 = 14.3 a spoke
    expect(at(99)).toBe('1/6'); // never all seven: that is the next level
    expect(at(100)).toBe('2/0');
    expect(at(249)).toBe('2/6');
    expect(at(9999)).toBe('9/6');
    expect(at(10000)).toBe('10/7'); // the top is a full wheel
    expect(at(250000)).toBe('10/7');
    expect(wheelOf(312).next?.from).toBe(500);
  });
});

describe('the leaderboard month', () => {
  it('names the month as given, whatever the time zone, and the day the next starts', () => {
    expect(monthInWords('2026-11-01')).toBe('November 2026');
    expect(monthAfterStarts('2026-11-01')).toBe('December 1');
    expect(monthInWords('2026-12-01')).toBe('December 2026');
    expect(monthAfterStarts('2026-12-01')).toBe('January 1');
  });
});
