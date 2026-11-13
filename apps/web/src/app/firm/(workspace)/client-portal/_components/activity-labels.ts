import type { Icon } from '@phosphor-icons/react';
import {
  CalendarBlank,
  ChatCircleText,
  ClipboardText,
  CurrencyDollar,
  Eye,
  FileArrowUp,
  Key,
  LockSimple,
  LockSimpleOpen,
  ShieldCheck,
  SignIn,
  SignOut,
  SlidersHorizontal,
  UserCircle,
  UserMinus,
  UserPlus,
} from '@phosphor-icons/react';

/**
 * The portal activity's types (apps/api client-portal/portal-activity.ts and the staff actions)
 * as the Client Portal module names them. An unknown type shows as itself, never hidden.
 */
export const ACTIVITY: Record<string, { label: string; icon: Icon }> = {
  'portal.signed_in': { label: 'Portal Login', icon: SignIn },
  'portal.signed_out': { label: 'Signed Out', icon: SignOut },
  'document.uploaded': { label: 'Document Uploaded', icon: FileArrowUp },
  'document.viewed': { label: 'Document Viewed', icon: Eye },
  'document_request.not_available': { label: 'Request Marked Not Available', icon: FileArrowUp },
  'request_packet.submitted': { label: 'Requests Submitted', icon: ClipboardText },
  'message.sent': { label: 'Message from Client', icon: ChatCircleText },
  'intake.submitted': { label: 'Intake Form Submitted', icon: ClipboardText },
  'invoice.viewed': { label: 'Invoice Viewed', icon: CurrencyDollar },
  'invoice.checkout_started': { label: 'Payment Started', icon: CurrencyDollar },
  'appointment.booked': { label: 'Appointment Scheduled', icon: CalendarBlank },
  'appointment.changed': { label: 'Appointment Changed', icon: CalendarBlank },
  'profile.updated': { label: 'Profile Updated', icon: UserCircle },
  'profile.name_change_requested': { label: 'Name Change Requested', icon: UserCircle },
  'service.cancellation_requested': { label: 'Cancellation Requested', icon: ClipboardText },
  'portal.locked': { label: 'Portal Access Locked', icon: LockSimple },
  'portal.unlocked': { label: 'Portal Access Unlocked', icon: LockSimpleOpen },
  'portal.visibility_changed': { label: 'Portal Content Changed', icon: SlidersHorizontal },
  'portal.deactivated': { label: 'Portal Deactivated', icon: UserMinus },
  'portal.reactivated': { label: 'Portal Reactivated', icon: UserPlus },
  'portal.access_reset': { label: 'Access Reset Sent', icon: Key },
  'portal.mfa_reset': { label: 'MFA Reset', icon: ShieldCheck },
};

export const activityOf = (type: string) => ACTIVITY[type] ?? { label: type, icon: ClipboardText };

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
export const dayText = (iso: string) => DATE.format(new Date(iso));
export const timeText = (iso: string) => TIME.format(new Date(iso));

/** "JS" from "Jane Smith"; one letter for one word. */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
