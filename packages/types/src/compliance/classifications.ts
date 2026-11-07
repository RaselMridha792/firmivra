import { z } from 'zod';

// CD-F14 (Octavia's Compliance review, Oct 28): a rule names federal tax classifications from one
// list, and an LLC is not one classification: single-member (taxed with its owner), multi-member
// (taxed as a partnership), or electing S or C (taxed as that corporation). A client's entity type
// is free text on its profile; `classificationOf` reads it, and a bare "LLC" says nothing about
// its taxes, so a rule that could apply asks staff instead of guessing.

export const FEDERAL_CLASSIFICATIONS = [
  'INDIVIDUAL',
  'SOLE_PROPRIETOR',
  'LLC_SINGLE_MEMBER',
  'LLC_MULTI_MEMBER',
  'LLC_S_ELECTION',
  'LLC_C_ELECTION',
  'PARTNERSHIP',
  'S_CORPORATION',
  'C_CORPORATION',
  'NONPROFIT',
  'TRUST_ESTATE',
] as const;
export const FederalClassification = z.enum(FEDERAL_CLASSIFICATIONS);
export type FederalClassification = z.infer<typeof FederalClassification>;

export const CLASSIFICATION_LABEL: Record<FederalClassification, string> = {
  INDIVIDUAL: 'Individual',
  SOLE_PROPRIETOR: 'Sole proprietor',
  LLC_SINGLE_MEMBER: 'Single-member LLC',
  LLC_MULTI_MEMBER: 'Multi-member LLC',
  LLC_S_ELECTION: 'LLC electing S corporation',
  LLC_C_ELECTION: 'LLC electing C corporation',
  PARTNERSHIP: 'Partnership',
  S_CORPORATION: 'S corporation',
  C_CORPORATION: 'C corporation',
  NONPROFIT: 'Nonprofit',
  TRUST_ESTATE: 'Trust or estate',
};

/** How the IRS taxes it: an LLC by its election, or its default by members. */
export const TAXED_AS: Record<FederalClassification, FederalClassification> = {
  INDIVIDUAL: 'INDIVIDUAL',
  SOLE_PROPRIETOR: 'SOLE_PROPRIETOR',
  LLC_SINGLE_MEMBER: 'SOLE_PROPRIETOR',
  LLC_MULTI_MEMBER: 'PARTNERSHIP',
  LLC_S_ELECTION: 'S_CORPORATION',
  LLC_C_ELECTION: 'C_CORPORATION',
  PARTNERSHIP: 'PARTNERSHIP',
  S_CORPORATION: 'S_CORPORATION',
  C_CORPORATION: 'C_CORPORATION',
  NONPROFIT: 'NONPROFIT',
  TRUST_ESTATE: 'TRUST_ESTATE',
};

export const LLC_CLASSIFICATIONS = [
  'LLC_SINGLE_MEMBER',
  'LLC_MULTI_MEMBER',
  'LLC_S_ELECTION',
  'LLC_C_ELECTION',
] as const satisfies readonly FederalClassification[];

/** Read in order: an LLC's election before a plain corporation, a plain "LLC" last. */
const READINGS: [RegExp, FederalClassification | 'LLC'][] = [
  [/\b(llc|limited liability)\b.*\bs\b.*\b(corp|corporation|election|elect)/, 'LLC_S_ELECTION'],
  [/\bs\b.*\b(election|elect)\b.*\b(llc|limited liability)\b/, 'LLC_S_ELECTION'],
  [/\b(llc|limited liability)\b.*\bc\b.*\b(corp|corporation|election|elect)/, 'LLC_C_ELECTION'],
  [/\bc\b.*\b(election|elect)\b.*\b(llc|limited liability)\b/, 'LLC_C_ELECTION'],
  [/\b(single member|smllc|disregarded)\b/, 'LLC_SINGLE_MEMBER'],
  [/\b(multi member|multiple member|mmllc)\b/, 'LLC_MULTI_MEMBER'],
  [/\b(s corp|s corporation|scorp|1120 s)\b/, 'S_CORPORATION'],
  [/\b(c corp|c corporation|ccorp|1120)\b|^(corp|corporation|inc|incorporated)$/, 'C_CORPORATION'],
  [/\b(partnership|lp|llp|lllp|1065)\b/, 'PARTNERSHIP'],
  [/\b(sole prop|sole proprietor|sole proprietorship|schedule c)\b/, 'SOLE_PROPRIETOR'],
  [/\b(non profit|nonprofit|not for profit|501 c|501c|charity|exempt organization)\b/, 'NONPROFIT'],
  [/\b(trust|estate)\b/, 'TRUST_ESTATE'],
  [/^(individual|person|personal|1040)$/, 'INDIVIDUAL'],
  [/\b(llc|limited liability company)\b/, 'LLC'],
];

/**
 * A client's entity type (or a rule's older free-text entry) as a classification. "LLC" alone is
 * returned as 'LLC': it does not say how the LLC is taxed. Null when the text is none of these.
 */
export function classificationOf(
  text: string | null | undefined,
): FederalClassification | 'LLC' | null {
  if (!text) return null;
  const code = text.trim().toUpperCase();
  if ((FEDERAL_CLASSIFICATIONS as readonly string[]).includes(code)) {
    return code as FederalClassification;
  }
  const plain = text
    .toLowerCase()
    .replace(/[_\-().,/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, kind] of READINGS) if (pattern.test(plain)) return kind;
  return null;
}
