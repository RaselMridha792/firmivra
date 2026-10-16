import type { StaffGroupStatus, StaffRef } from '@firmivra/types';
import { Avatar, Badge } from '@firmivra/ui';
import {
  Buildings,
  Calculator,
  ChartBar,
  CheckCircle,
  CurrencyCircleDollar,
  FileText,
  Gear,
  type Icon,
  Megaphone,
  MinusCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { createElement } from 'react';

/** The query key root of Teams & Departments; every change refreshes everything under it. */
export const GROUPS = ['departments'] as const;

/** The API's answers for Teams & Departments (DepartmentErrorCode) in the screen's words. */
export const GROUP_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'This name is already used by another department or team.',
  GROUP_IN_USE: 'Active staff are in it. Choose where to move them first.',
  MEMBER_NOT_ACTIVE: 'Choose a member who is active.',
  GROUP_INACTIVE: 'It is not active. Reactivate it first.',
  FORBIDDEN: 'Only an Owner or an Admin can change departments and teams.',
};

const tones = {
  blue: 'bg-info-soft text-info',
  amber: 'bg-warning-soft text-gold',
  green: 'bg-success-soft text-success',
  purple: 'bg-purple-soft text-purple',
  red: 'bg-danger-soft text-danger',
};

/**
 * A group's icon by its name, as the design draws them. Icons and colours are not stored (R42
 * contract); an unknown name gets the building.
 */
const ICONS: [RegExp, Icon, keyof typeof tones][] = [
  [/tax/i, FileText, 'blue'],
  [/book|account/i, Calculator, 'amber'],
  [/payroll/i, CurrencyCircleDollar, 'green'],
  [/client|service|human|hr\b|people/i, UsersThree, 'blue'],
  [/admin|operation/i, Gear, 'purple'],
  [/market|campaign/i, Megaphone, 'red'],
  [/financ|budget/i, ChartBar, 'green'],
];

/** The icon and colour for a group's name (an unknown name gets the blue building). */
function iconFor(name: string): [Icon, keyof typeof tones] {
  const found = ICONS.find(([test]) => test.test(name));
  return found ? [found[1], found[2]] : [Buildings, 'blue'];
}

const iconSizes = {
  sm: ['size-6 rounded-md', 'size-4'],
  md: ['size-8 rounded-lg', 'size-5'],
  lg: ['size-16 rounded-xl', 'size-8'],
} as const;

export function GroupIcon({ name, size = 'md' }: { name: string; size?: keyof typeof iconSizes }) {
  const [glyph, tone] = iconFor(name);
  const [tile, mark] = iconSizes[size];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${tile} ${tones[tone]}`}
    >
      {createElement(glyph, { weight: 'fill', className: mark })}
    </span>
  );
}

/** Head or lead: the photo (initials until avatars exist), the name and the job title. */
export function PersonCell({ person }: { person: StaffRef | null }) {
  if (!person) return <span className="text-muted">No head yet</span>;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={person.name} src={person.avatarUrl ?? undefined} size="md" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-heading">{person.name}</span>
        {person.jobTitle ? (
          <span className="block truncate text-xs text-link">{person.jobTitle}</span>
        ) : null}
      </span>
    </span>
  );
}

export function GroupStatusBadge({ status }: { status: StaffGroupStatus }) {
  if (status === 'ACTIVE')
    return (
      <Badge tone="success" icon={CheckCircle}>
        Active
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={MinusCircle}>
      {status === 'ARCHIVED' ? 'Archived' : 'Inactive'}
    </Badge>
  );
}

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
] as const;

export const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
