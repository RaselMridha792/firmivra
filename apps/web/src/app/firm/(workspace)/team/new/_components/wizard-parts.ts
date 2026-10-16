import {
  type MembershipRole,
  type StaffAccessLevel,
  StaffDraftData,
  type StaffEmploymentType,
} from '@firmivra/types';

/** The four steps of Create Staff (guide §2), each its own page; the draft travels in `?draft=`. */
export const STEPS = [
  { id: 'account', label: 'Account Information', href: '/team/new' },
  { id: 'permissions', label: 'Role & Permissions', href: '/team/new/permissions' },
  { id: 'security', label: 'Access & Security', href: '/team/new/security' },
  { id: 'details', label: 'Additional Details', href: '/team/new/details' },
] as const;
export type WizardStep = (typeof STEPS)[number]['id'];

export function stepHref(step: WizardStep, draftId?: string | null): string {
  const href = STEPS.find((s) => s.id === step)?.href ?? '/team/new';
  return draftId ? `${href}?draft=${encodeURIComponent(draftId)}` : href;
}

/** The draft's form so far, read through the contract's schema; anything else is dropped. */
export function draftData(data: unknown): StaffDraftData {
  const parsed = StaffDraftData.safeParse(data);
  return parsed.success ? parsed.data : {};
}

export const ACCESS_LEVELS: Record<StaffAccessLevel, string> = {
  STANDARD_USER: 'Standard User',
  MANAGER: 'Manager',
  ADMINISTRATOR: 'Administrator',
};

/** User Access Level follows the role until someone picks another (guide §3). */
export function levelForRole(role: MembershipRole | ''): StaffAccessLevel {
  if (role === 'OWNER' || role === 'ADMIN') return 'ADMINISTRATOR';
  if (role === 'MANAGER') return 'MANAGER';
  return 'STANDARD_USER';
}

export const EMPLOYMENT_TYPES: Record<StaffEmploymentType, string> = {
  W2: 'W-2 Employee',
  FORM_1099: '1099 Contractor',
  FULL_TIME: 'Full-Time',
  PART_TIME: 'Part-Time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
  SEASONAL: 'Seasonal',
  INTERN: 'Intern',
  OTHER: 'Other',
};

/** US time zones by IANA name, labelled as the design does. */
export const TIME_ZONES: [string, string][] = [
  ['America/New_York', '(GMT-05:00) Eastern Time (US & Canada)'],
  ['America/Chicago', '(GMT-06:00) Central Time (US & Canada)'],
  ['America/Denver', '(GMT-07:00) Mountain Time (US & Canada)'],
  ['America/Phoenix', '(GMT-07:00) Arizona'],
  ['America/Los_Angeles', '(GMT-08:00) Pacific Time (US & Canada)'],
  ['America/Anchorage', '(GMT-09:00) Alaska'],
  ['Pacific/Honolulu', '(GMT-10:00) Hawaii'],
];

/** The API's answers for Create Staff in the screen's words. */
export const STAFF_ERRORS: Record<string, string> = {
  DUPLICATE_EMAIL: 'This email already belongs to a member or an open invitation.',
  CANNOT_GRANT: 'You cannot give this role or these permissions.',
  PERMISSION_NEEDS_VIEW: 'Give View first in each module you give anything else in.',
  FORBIDDEN: 'Only an Owner or an Admin can create staff accounts.',
  NOT_FOUND: 'This draft was not found. Start a new one.',
};
