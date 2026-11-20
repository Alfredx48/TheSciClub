/**
 * The five rules a strike can be given under, as the Terms state them (the owner approved the
 * rulebook, 2026-11-20; 20261120120000). The ids are the database's: member_strikes.rule and
 * chat_anonymous_flags.rule. 'other' is for anything else that breaks the Terms. Strikes from
 * before have no rule.
 *
 * What ends a membership at once (threats, exposing somebody, scams and the rest) is not here:
 * it is not a strike.
 */
export type StrikeRule =
  | 'harassment'
  | 'medical_claims'
  | 'selling'
  | 'spam'
  | 'careless_sharing'
  | 'other';

export interface StrikeRuleText {
  id: StrikeRule;
  name: string;
  /** What counts, in the Terms' words. */
  counts: string;
  /** What is fine, as a sentence, where the line needs drawing. */
  fine: string | null;
}

export const STRIKE_RULES: readonly StrikeRuleText[] = [
  {
    id: 'harassment',
    name: 'Harassment',
    counts:
      'Insulting, mocking or belittling a member; piling on; contacting someone after they asked you to stop.',
    fine: 'Disagreeing politely is fine.',
  },
  {
    id: 'medical_claims',
    name: 'Medical claims as fact',
    counts:
      'Saying a drug, supplement, device or treatment will cure or fix something, or is safe; telling someone to change what their doctor prescribed.',
    fine: 'Sharing your own experience is fine.',
  },
  {
    id: 'selling',
    name: 'Selling or advertising outside the Marketplace',
    counts:
      'Products, services, affiliate links, multi-level marketing, fundraising for a business.',
    fine: 'Selling your own used equipment in the Marketplace is fine.',
  },
  {
    id: 'spam',
    name: 'Spam',
    counts: 'The same post in several rooms, repeated off-topic links, messaging members in bulk.',
    fine: null,
  },
  {
    id: 'careless_sharing',
    name: 'Careless sharing',
    counts:
      'Posting a screenshot of a direct message or group conversation elsewhere; showing a member’s name or photo outside the club without asking.',
    fine: 'Sharing a room post outside the club to get it answered is fine, with the name and photo of whoever wrote it hidden.',
  },
  {
    id: 'other',
    name: 'Something else in the Terms',
    counts: 'Anything else the Terms of Service do not allow.',
    fine: null,
  },
];

export function strikeRule(rule: string | null | undefined): StrikeRuleText | null {
  return STRIKE_RULES.find((r) => r.id === rule) ?? null;
}

/** The rule's name, or null for a strike from before rules. */
export function ruleName(rule: string | null | undefined): string | null {
  return strikeRule(rule)?.name ?? null;
}
