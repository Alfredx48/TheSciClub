import { describe, expect, it } from 'vitest';
import { wheelOf } from './wheelies';

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
