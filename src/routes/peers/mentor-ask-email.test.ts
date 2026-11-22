import { describe, expect, it } from 'vitest';
import { QUESTIONS } from '@/routes/profile/questions';
import ANSWERED_SQL from '../../../supabase/migrations/20261121020000_an_admin_sees_whether_a_profile_is_complete.sql?raw';
import {
  MENTOR_ASK_SUBJECT,
  mentorAskBody,
  mentorAskMailto,
  profileComplete,
} from './mentor-ask-email';

describe('mentorAskMailto', () => {
  it('opens a mail app on the right address, subject and whole body', () => {
    const link = mentorAskMailto({
      to: 'lake+sci@example.com',
      member: 'Lake&Jo Thompson',
      admin: 'Wojtek Poppe',
    });
    const url = new URL(link);
    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe('lake+sci@example.com');
    // Read as a mail app does: an "&" in a name must not end the body.
    expect(url.searchParams.get('subject')).toBe(MENTOR_ASK_SUBJECT);
    const body = url.searchParams.get('body') ?? '';
    expect(body.startsWith('Hey Lake&Jo,\r\n\r\nThank you for joining')).toBe(true);
    expect(body.endsWith('Best,\r\nWojtek')).toBe(true);
    expect(body.replace(/\r\n/g, '\n')).toBe(mentorAskBody({ member: 'Lake&Jo', admin: 'Wojtek' }));
  });
});

describe('profileComplete', () => {
  // What admin_member_answered (20261121020000) hands back: 'x' for words and
  // list items, never the answers themselves.
  const everything = (): Record<string, unknown> => {
    const row: Record<string, unknown> = { injury_type: 'quad', declined: [], has_children: false };
    for (const q of QUESTIONS) {
      if (q.column in row) continue;
      row[q.column] = q.kind === 'many' ? ['x'] : q.kind === 'yesno' ? true : 'x';
    }
    return row;
  };

  it('is complete, and the button goes, only when every question that applies is dealt with', () => {
    expect(profileComplete(everything())).toBe(true);
    // Having children asks when, as the Me tab does.
    expect(profileComplete({ ...everything(), has_children: true, children_when: null })).toBe(
      false,
    );
    expect(profileComplete({ ...everything(), how_injured: null, declined: ['howInjured'] })).toBe(
      true,
    );
    expect(profileComplete({ ...everything(), bio: '' })).toBe(false);
  });

  it('is told about every question the profile asks', () => {
    // A question added later and not to the function's list would never count
    // as answered, so its button would never go.
    for (const q of QUESTIONS) expect(ANSWERED_SQL).toContain(`'${q.column}'`);
  });
});
