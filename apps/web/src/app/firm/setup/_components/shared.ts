import type { SetupStep } from '@firmivra/types';

/** Settings and setup progress share a prefix, so one invalidate refreshes both. */
export const FIRM_SETTINGS = ['firm-settings'];
export const SETUP_PROGRESS = ['firm-settings', 'setup'];
export const TEAM = ['team'];

export type WizardStep = SetupStep | 'finish';

/** The five steps, in order (docs/PROJECT-DRAFT-v2.md, setup wizard). */
export const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  { id: 'businessDetails', label: 'Business details' },
  { id: 'team', label: 'Team and access' },
  { id: 'clientPortal', label: 'Client portal' },
  { id: 'finish', label: 'Finish' },
];

export const SETUP_ERRORS: Record<string, string> = {
  SETUP_INCOMPLETE: 'Finish the steps marked "Not done yet" first.',
  ENCRYPTION_UNAVAILABLE: "The EIN can't be saved right now. Clear it to save the rest.",
};

export interface StepProps {
  /** Missing on the first step. */
  onBack?: () => void;
  onNext: () => void;
}
