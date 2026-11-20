/**
 * The email an administrator sends a member to ask them to help build the
 * club's team of mentors, from the administrator's own mail app (the owner,
 * 2026-11-20: "I want it to come from me. Maybe a mailto link. Something I
 * can do on my phone"). The words and the subject are the owner's; only the
 * two first names change. Plain text, as a mailto: link can carry no more, so
 * each link is written out after its words.
 */

export const MENTOR_ASK_SUBJECT = 'Completing your profile and helping us grow';
export const ME_TAB_URL = 'https://thesciclub.com/me';
export const APP_STORE_URL = 'https://apps.apple.com/us/app/the-sci-club/id6825594961';

/** "Lake" from "Lake Thompson". */
export function firstName(displayName: string | null | undefined): string {
  return displayName?.trim().split(/\s+/)[0] ?? '';
}

export function mentorAskBody({ member, admin }: { member: string; admin: string | null }): string {
  const from = firstName(admin);
  return [
    `Hey ${firstName(member) || 'there'},`,
    '',
    'Thank you for joining the SCI Club. We need your help to build our team of mentors! If you could do the following you could really help us out.',
    '',
    `1. Go to the me tab (${ME_TAB_URL}) and complete your profile`,
    `2. Install the iOS app (${APP_STORE_URL}) and turn on notifications`,
    '3. Try to answer a question or ask one. Any content you create makes the app more dynamic and interesting to people with SCI.',
    '',
    "Thank you so much for your help. Let's build this club one wheeler at a time.",
    '',
    from ? `Thanks,\n${from}` : 'Thanks',
  ].join('\n');
}

/**
 * The mailto: link. Line breaks go as CRLF (RFC 6068), and everything after
 * the address is percent-encoded, so an "&" or "?" in a name cannot end the
 * body early or start another field.
 */
export function mentorAskMailto({
  to,
  member,
  admin,
}: {
  to: string;
  member: string;
  admin: string | null;
}): string {
  const body = mentorAskBody({ member, admin }).replace(/\r?\n/g, '\r\n');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(
    MENTOR_ASK_SUBJECT,
  )}&body=${encodeURIComponent(body)}`;
}
