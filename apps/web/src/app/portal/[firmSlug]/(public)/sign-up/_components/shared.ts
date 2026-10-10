import type { StepItem } from '@firmivra/ui';

export type SignUpStepId = 'create' | 'email' | 'phone' | 'done';
export const SIGN_UP_STEPS: (StepItem & { id: SignUpStepId })[] = [
  { id: 'create', label: 'Create Account' },
  { id: 'email', label: 'Verify Email' },
  { id: 'phone', label: 'Verify Phone' },
  { id: 'done', label: 'Complete' },
];

/** The sign-up API's own error codes (docs/api/client-auth.yaml). */
export const SIGN_UP_ERRORS: Record<string, string> = {
  SIGN_UP_CLOSED: 'This firm is not taking new sign-ups right now.',
  TERMS_OUTDATED:
    'The Terms of Service or Privacy Policy just changed. Please read them and agree again.',
  SIGN_UP_EXPIRED: 'Your sign-up timed out. Please start again.',
  CODE_INVALID: 'That code is not right or has expired. Check it or send a new one.',
  ALREADY_VERIFIED: 'This step is already done.',
  WRONG_STEP: 'Please follow the steps in order.',
};
