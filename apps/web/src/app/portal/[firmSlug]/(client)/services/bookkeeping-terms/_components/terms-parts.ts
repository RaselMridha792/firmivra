import type {
  MyBookkeepingTerms,
  MyBookkeepingTermsState,
  TermsAddOn,
  TermsAdditionalBilling,
} from '@firmivra/types';

/** Client Portal BK-CP3: the words and formats of the portal's bookkeeping terms pages. */

export const STATE_TONE: Record<MyBookkeepingTermsState, 'warning' | 'success' | 'neutral'> = {
  AWAITING_ANSWER: 'warning',
  IN_FORCE: 'success',
  REPLACED: 'neutral',
  ENDED: 'neutral',
};

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number) => MONEY.format(cents / 100);

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
/** A calendar day (`YYYY-MM-DD`) or a time, as "Dec 1, 2026". */
export const dayText = (value: string) =>
  DAY.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));

export const RENEWAL: Record<MyBookkeepingTerms['renewalType'], string> = {
  AUTO: 'Renews automatically',
  MANUAL: 'Renewed by agreement',
  FIXED_TERM: 'Fixed term',
};

export const FREQUENCY: Record<MyBookkeepingTerms['billingFrequency'], string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Yearly',
};

export const TIMING: Record<MyBookkeepingTerms['billingTiming'], string> = {
  ADVANCE: 'billed in advance',
  ARREARS: 'billed after the work',
};

export const paymentTermsText = (
  t: Pick<MyBookkeepingTerms, 'paymentTerms' | 'paymentTermsDays'>,
) =>
  t.paymentTerms === 'DUE_ON_RECEIPT'
    ? 'Due on receipt'
    : t.paymentTerms === 'CUSTOM'
      ? `Due ${t.paymentTermsDays ?? 0} days after the invoice`
      : `Due ${t.paymentTerms.slice(4)} days after the invoice`;

export const BILLING: Record<TermsAdditionalBilling['billing'], string> = {
  SEPARATE: 'Billed separately',
  INCLUDED: 'Included',
  WAIVED: 'Waived',
};

export const ADD_ON_FREQUENCY: Record<NonNullable<TermsAddOn['frequency']>, string> = {
  ONE_TIME: 'one time',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  ANNUAL: 'yearly',
  AS_NEEDED: 'as needed',
};

/** The error codes of an answer, in the client's words. */
export const ANSWER_ERRORS = {
  TERMS_STATE: 'These terms are no longer waiting for your answer. Reload the page.',
  TERMS_CHANGED: 'The firm changed these terms since you opened them. Reload the page.',
  SIGNATURE_PENDING: 'Sign the agreement under Signatures first, then accept.',
  FORBIDDEN: 'Only the main account holder can answer these terms.',
};
