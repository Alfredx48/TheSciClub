/**
 * The email an administrator sends a member to ask them to help build the
 * club's team of mentors, from the administrator's own mail app (the owner,
 * 2026-11-20: "I want it to come from me. Maybe a mailto link. Something I
 * can do on my phone"). The words and the subject are the owner's; only the
 * two first names change. Plain text, as a mailto: link can carry no more, so
 * the link is written out and the mail app links it.
 */

import { answersFrom } from '@/routes/profile/profile-api';
import { progressOf } from '@/routes/profile/questions';

export const MENTOR_ASK_SUBJECT = 'We need your help';
export const ME_TAB_URL = 'https://thesciclub.com/me';

/**
 * Whether the member's profile is complete, as their own Me tab says "Profile
 * complete": every question that applies answered or declined. From
 * admin_member_answered (20261121020000), which says whether each answer is
 * there and never what it is; the same code as the Me tab works out the rest.
 * Once it is, there is nothing to ask and no Create email (the owner,
 * 2026-11-20: "If a user has completed their profile, then remove that button").
 */
export function profileComplete(answered: Record<string, unknown>): boolean {
  const { answers, declined } = answersFrom(answered);
  return progressOf(answers, declined).percent === 100;
}

/** "Lake" from "Lake Thompson". */
export function firstName(displayName: string | null | undefined): string {
  return displayName?.trim().split(/\s+/)[0] ?? '';
}

export function mentorAskBody({ member, admin }: { member: string; admin: string | null }): string {
  const from = firstName(admin);
  return [
    `Hey ${firstName(member) || 'there'},`,
    '',
    // The owner's words of 2026-11-21, for members whose profile is not complete
    // (the only ones offered the button). The link is written out, as a
    // mailto: body can carry no more, and the mail app makes it tappable.
    `Thank you for joining the SCI Club. We need your help to build our team of mentors before we launch! You are definitely mentor material, but your profile is empty. If you could complete your profile, you could really help us out. The last question “Topics you are happy to talk about” is particularly important as it helps us send questions from newly injured to the right “topic experts”. You can complete your profile here ${ME_TAB_URL}.`,
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
