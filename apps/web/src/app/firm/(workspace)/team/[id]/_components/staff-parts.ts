import type { MembershipRole, TeamMemberStatus } from '@firmivra/types';
import { STAFF_ERRORS } from '../../new/_components/wizard-parts';

/** A member's status as the badge shows it. */
export const STATUS_LOOKS: Record<
  TeamMemberStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }
> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'info' },
  LOCKED: { label: 'Locked', tone: 'warning' },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
};

/** Owner and Admin change a member; everyone else with the page reads it. */
export const canManage = (role: MembershipRole | undefined) => role === 'OWNER' || role === 'ADMIN';

/** "Sep 28, 2026 8:14 AM". */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "Mar 15, 2024". */
export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The API's answers about one member in the screen's words. */
export const MEMBER_ERRORS: Record<string, string> = {
  ...STAFF_ERRORS,
  NOT_FOUND: 'This staff member was not found. Go back to Staff Management and open them again.',
  VALIDATION_FAILED: 'Check the highlighted fields and try again.',
  SAVE_CONFLICT:
    'Someone saved this account while you were editing. Reload to see their changes, then make yours again.',
  CANNOT_CHANGE_SELF: 'You cannot change your own access. Ask another Owner or Admin.',
  LAST_ACTIVE_OWNER: 'The firm needs at least one active owner, so this account stays active.',
  NOT_INVITED: 'This person has already joined, so there is no invite to send again.',
  NOT_DEACTIVATED: 'This account is not deactivated.',
  NOT_LOCKED: 'This account is not locked.',
  FORBIDDEN: 'Only an Owner or an Admin can change staff accounts.',
};
