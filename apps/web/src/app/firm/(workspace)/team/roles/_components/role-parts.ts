import type { MembershipRole, PermissionCapability, PermissionModule } from '@firmivra/types';
import type { TileTone } from '@firmivra/ui';
import {
  Calculator,
  CalendarCheck,
  ChartBar,
  ChartLine,
  ChartPieSlice,
  ChatCircleDots,
  ClipboardText,
  CurrencyCircleDollar,
  Eye,
  Files,
  FileText,
  Gear,
  Globe,
  Headset,
  House,
  type Icon,
  IdentificationCard,
  Lightning,
  ListChecks,
  PaperPlaneTilt,
  PlusCircle,
  PuzzlePiece,
  Receipt,
  ShieldCheck,
  ShieldStar,
  Tag,
  User,
  UsersFour,
  UsersThree,
} from '@phosphor-icons/react';

/** Each module's tinted tile in the grid, as Create Staff step 2 draws them. */
export const MODULE_LOOKS: Record<PermissionModule, [Icon, TileTone]> = {
  DASHBOARD: [House, 'navy'],
  CLIENTS: [UsersThree, 'blue'],
  LEADS: [PlusCircle, 'red'],
  APPOINTMENTS: [CalendarCheck, 'purple'],
  INTAKE_FORMS: [ClipboardText, 'blue'],
  DOCUMENTS: [FileText, 'green'],
  CLIENT_PORTAL: [Globe, 'blue'],
  TASKS: [ListChecks, 'navy'],
  TAX_RETURNS: [IdentificationCard, 'blue'],
  BOOKKEEPING: [Calculator, 'blue'],
  PAYROLL: [CurrencyCircleDollar, 'green'],
  TAX_PLANNING: [ChartPieSlice, 'navy'],
  BUSINESS_ADVISORY: [ChartBar, 'blue'],
  INVOICES_PAYMENTS: [Receipt, 'navy'],
  MESSAGES: [ChatCircleDots, 'red'],
  COMMUNICATIONS: [PaperPlaneTilt, 'red'],
  AUTOMATIONS: [Lightning, 'navy'],
  COMPLIANCE: [ShieldCheck, 'navy'],
  REPORTS: [ChartLine, 'navy'],
  TEMPLATES: [Files, 'navy'],
  SERVICES_PRICING: [Tag, 'green'],
  STAFF_MANAGEMENT: [UsersFour, 'blue'],
  INTEGRATIONS: [PuzzlePiece, 'navy'],
  SETTINGS: [Gear, 'navy'],
};

/** Each role's tile in Role Templates (Settings > Users & Roles draws them tinted). */
export const ROLE_LOOKS: Record<MembershipRole, [Icon, TileTone]> = {
  OWNER: [ShieldStar, 'navy'],
  ADMIN: [ShieldCheck, 'amber'],
  MANAGER: [UsersFour, 'purple'],
  STAFF: [User, 'blue'],
  BOOKKEEPER: [Calculator, 'amber'],
  TAX_PREPARER: [IdentificationCard, 'blue'],
  CLIENT_SUPPORT: [Headset, 'green'],
  BUSINESS_CONSULTANT: [ChartBar, 'purple'],
  READ_ONLY: [Eye, 'grey'],
};

/** The grid's columns: the guide's seven capabilities (§6), View first. */
export const CAPABILITY_ORDER: PermissionCapability[] = [
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'APPROVE',
  'MANAGE',
  'EXPORT',
];

/** Every other capability needs View in its module (PERMISSION_NEEDS_VIEW). */
export const NEEDS_VIEW: Record<string, string> = Object.fromEntries(
  CAPABILITY_ORDER.filter((c) => c !== 'VIEW').map((c) => [c, 'VIEW']),
);

/** The API's answers for roles in the screen's words. */
export const ROLE_ERRORS: Record<string, string> = {
  CANNOT_GRANT: 'You cannot change this role, or give what you do not have yourself.',
  PERMISSION_NEEDS_VIEW: 'Give View first in each module you give anything else in.',
  NOT_IMPLEMENTED: 'Custom roles are not available yet.',
  FORBIDDEN: 'Only an Owner or an Admin can change roles.',
};
