import { describe, expect, it } from 'vitest';
import { readSheet, sheetCsvUrl } from '@/lib/invite-sheet';

// The owner's 2026-11-14 board list, as a sheet, a paste and an email's To line.
describe('reading people to invite out of a spreadsheet', () => {
  it('uses a header row, prefers a first name, and copes with quotes and repeats', () => {
    const csv = [
      'Full name,First name,Email address,Role',
      '"Li, Suet Fei",Suet Fei,suetfei@example.com,Board',
      'Matt Beadon,Matt,MATT.beadon@example.com,"Board, treasurer"',
      'Nobody,,,',
      'Matt again,Matt,matt.beadon@example.com,',
    ].join('\r\n');
    const read = readSheet(csv);
    expect(read.people).toEqual([
      { email: 'suetfei@example.com', name: 'Suet Fei' },
      { email: 'MATT.beadon@example.com', name: 'Matt' },
    ]);
    expect(read.skipped).toEqual(['Nobody']);
    expect(read.repeats).toBe(1);
    // The whole row, for the table checked before sending (2026-11-19).
    expect(read.columns).toEqual(['Full name', 'First name', 'Email address', 'Role']);
    expect(read.rows).toEqual([
      ['Li, Suet Fei', 'Suet Fei', 'suetfei@example.com', 'Board'],
      ['Matt Beadon', 'Matt', 'MATT.beadon@example.com', 'Board, treasurer'],
    ]);
  });

  it('reads rows pasted from a sheet without a header, and a To line of names and addresses', () => {
    expect(readSheet('Natalie Zahr\tnatalie@example.com\nsam@example.com\t').people).toEqual([
      { email: 'natalie@example.com', name: 'Natalie Zahr' },
      { email: 'sam@example.com', name: null },
    ]);
    expect(
      readSheet('Shara Poppe <shara@example.com>, "Anatol Poppe" <anatol@example.com>').people,
    ).toEqual([
      { email: 'shara@example.com', name: 'Shara Poppe' },
      { email: 'anatol@example.com', name: 'Anatol Poppe' },
    ]);
  });

  it('reads a bare list of addresses, however it is separated', () => {
    expect(
      readSheet('a@example.com, b@example.com;c@example.com d@example.com\ne@example.com').people,
    ).toEqual(['a', 'b', 'c', 'd', 'e'].map((x) => ({ email: `${x}@example.com`, name: null })));
  });

  it('turns a Google Sheets link into its CSV, keeping the tab', () => {
    const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
    expect(
      sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=42`),
    ).toBe(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=42`);
    expect(sheetCsvUrl('https://example.com/spreadsheets/d/abc')).toBeNull();
  });
});
