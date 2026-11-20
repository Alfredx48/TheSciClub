/**
 * The email an administrator sends a member to ask them to help build the
 * club's team of mentors, from the administrator's own mail app (the owner,
 * 2026-11-20: "I want it to come from me. Maybe a mailto link. Something I
 * can do on my phone"). The words and the subject are the owner's; only the
 * two first names change. Plain text, as a mailto: link can carry no more, so
 * each link is written out, on its own line, and the mail app links it.
 */

export const MENTOR_ASK_SUBJECT = 'Completing your profile and helping us grow';
export const ME_TAB_URL = 'https://thesciclub.com/me';
/** The short form; Apple sends it on to the app's page. */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6825594961';

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
    // A blank line between the steps, and each link on its own line under its
    // step, where a mail app makes it tappable (the owner, 2026-11-20: "put
    // spaces between the 1, 2, 3 in the e-mail and format it nicer").
    '1. Go to the me tab and complete your profile:',
    ME_TAB_URL,
    '',
    '2. Install the iOS app and turn on notifications:',
    APP_STORE_URL,
    '',
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
