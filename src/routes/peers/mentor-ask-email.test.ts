import { describe, expect, it } from 'vitest';
import { MENTOR_ASK_SUBJECT, mentorAskBody, mentorAskMailto } from './mentor-ask-email';

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
    expect(body.endsWith('Thanks,\r\nWojtek')).toBe(true);
    expect(body.replace(/\r\n/g, '\n')).toBe(mentorAskBody({ member: 'Lake&Jo', admin: 'Wojtek' }));
  });
});
