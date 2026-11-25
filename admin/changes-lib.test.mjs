// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pacificDay, parseEntry, surfaceOf, weekOf } from './changes-lib.mjs';

// The change log sorts releases into Pacific days and Monday-to-Sunday weeks; the release
// tags are in UTC, where an evening release is already the next day.
describe('the change log', () => {
  it('puts a release in the Pacific day and week it went out in', () => {
    // Sunday 22 November, 11:01 PM Pacific: Monday already in UTC.
    expect(pacificDay('2026-11-23T07:01:00Z')).toBe('2026-11-22');
    expect(weekOf('2026-11-22')).toBe('2026-11-16');
    // An hour later it is Monday, and a new week.
    expect(pacificDay('2026-11-23T08:01:00Z')).toBe('2026-11-23');
    expect(weekOf('2026-11-23')).toBe('2026-11-23');
    // Across a month's end, and a year's.
    expect(weekOf('2026-12-02')).toBe('2026-11-30');
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
  });

  it('names the part of the club a change touched, by its files and then its first line', () => {
    const chat = ['src/routes/chat/thread-page.tsx', 'src/routes/chat/thread-page.test.tsx'];
    expect(surfaceOf(chat)).toBe('Chat');
    // A part members see comes before the shared code beside it, however many files.
    expect(surfaceOf(['src/components/a.tsx', 'src/components/b.tsx', ...chat.slice(0, 1)])).toBe(
      'Chat',
    );
    // A database change says no part: its first line does.
    const migration = ['supabase/migrations/20261119120000_a_boost_counts_as_a_new_reply.sql'];
    expect(surfaceOf(migration, 'A boost counts as a new reply would')).toBe('Chat');
    expect(surfaceOf(migration, 'Tidy the indexes')).toBe('Other');
    expect(surfaceOf(['.github/workflows/site.yml'], 'Deploy from an Action')).toBe(
      'Behind the scenes',
    );
    // Its own entry does not make a change an Admin one.
    expect(surfaceOf([...chat, 'admin/changes/entries/2026-11-25-chat.md'])).toBe('Chat');
  });

  it('reads an entry: its title, part, summary and screenshots', () => {
    const entry = parseEntry(
      [
        '---',
        'title: Chat scrolls to the message you just sent',
        'surface: chat',
        '---',
        'Sending a message scrolls down to it.',
        'Before, you had to tap New messages.',
        '',
        '![Before](shots/2026-11-25-chat-before.jpg)',
        '![After](shots/2026-11-25-chat-after.jpg)',
        '![Elsewhere](../../secret.png)',
      ].join('\n'),
    );
    expect(entry).toMatchObject({
      title: 'Chat scrolls to the message you just sent',
      surface: 'Chat',
      shots: [
        { label: 'Before', file: '2026-11-25-chat-before.jpg' },
        { label: 'After', file: '2026-11-25-chat-after.jpg' },
      ],
    });
    expect(entry?.summary).toContain('Sending a message scrolls down to it. Before, you had');
    expect(parseEntry('No front matter.')).toBeNull();
  });
});
