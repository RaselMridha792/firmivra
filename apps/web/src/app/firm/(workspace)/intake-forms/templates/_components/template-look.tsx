'use client';

import {
  Buildings,
  ChartBar,
  ClipboardText,
  FileText,
  type Icon,
  User,
  UsersThree,
} from '@phosphor-icons/react';
import type { FormCategory } from '@firmivra/types';
import { tileTones, type TileTone } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { errorCode, errorMessage } from '../../../../../../lib/errors';

/** Every query of this page starts with Arfan's ['intake-forms'], so one invalidate refreshes both. */
export const INTAKE_KEY = ['intake-forms'] as const;
export const LIBRARY_KEY = [...INTAKE_KEY, 'library'] as const;

type ChipTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple';

/**
 * Each category's tile and chip in form-templates-dashboard.jpg: Personal Tax a red document with
 * a blue chip, Business Tax a green building, Bookkeeping a purple document, Payroll amber people,
 * Advisory a green bar chart, Client Onboarding a blue person. Tax Planning and Other have no
 * frame: Tax Planning takes Advisory's look (the design's Tax Planning Discovery card), Other navy.
 */
export const CATEGORY_LOOK: Record<FormCategory, { icon: Icon; tone: TileTone; chip: ChipTone }> = {
  PERSONAL_TAX: { icon: FileText, tone: 'red', chip: 'info' },
  BUSINESS_TAX: { icon: Buildings, tone: 'green', chip: 'success' },
  BOOKKEEPING: { icon: FileText, tone: 'purple', chip: 'purple' },
  PAYROLL: { icon: UsersThree, tone: 'amber', chip: 'warning' },
  TAX_PLANNING: { icon: ChartBar, tone: 'green', chip: 'success' },
  ADVISORY: { icon: ChartBar, tone: 'green', chip: 'success' },
  CLIENT_ONBOARDING: { icon: User, tone: 'blue', chip: 'info' },
  OTHER: { icon: ClipboardText, tone: 'navy', chip: 'neutral' },
};

/** The design's tab and sidebar order; the two categories it does not show come last. */
export const CATEGORY_ORDER: FormCategory[] = [
  'PERSONAL_TAX',
  'BUSINESS_TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'ADVISORY',
  'CLIENT_ONBOARDING',
  'TAX_PLANNING',
  'OTHER',
];

/** The six category tabs the design shows after All Templates. */
export const TAB_CATEGORIES = CATEGORY_ORDER.slice(0, 6);

/** A category's solid icon on its soft tile: round on the cards, rounded square in the sidebar. */
export function CategoryTile({
  category,
  shape = 'round',
}: {
  category: FormCategory;
  shape?: 'round' | 'square';
}) {
  const { icon: Glyph, tone } = CATEGORY_LOOK[category];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${tileTones[tone]} ${shape === 'round' ? 'size-12 rounded-full' : 'size-9 rounded-lg'}`}
    >
      <Glyph aria-hidden weight="fill" className={shape === 'round' ? 'size-6' : 'size-5'} />
    </span>
  );
}

const DAY = 86_400_000;

/** "Sep 10, 2026". */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "Used 3 days ago", "Used 1 week ago" (Recently Used), from the template's last use. */
export function usedAgo(iso: string, now: number): string {
  // Rounded: "now" is read when the frame first shows, a moment before the list arrives.
  const days = Math.max(0, Math.round((now - Date.parse(iso)) / DAY));
  if (days === 0) return 'Used today';
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  if (days < 7) return `Used ${relative.format(-days, 'day')}`;
  if (days < 30) return `Used ${relative.format(-Math.floor(days / 7), 'week')}`;
  if (days < 365) return `Used ${relative.format(-Math.floor(days / 30), 'month')}`;
  return `Used ${relative.format(-Math.floor(days / 365), 'year')}`;
}

/** "K. Allen", as the design writes the owner under each card. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length < 2 || !first || !last) return name;
  return `${first.charAt(0)}. ${last}`;
}

/** The quiet line a frame shows instead of its content (empty, no access, failed). */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/**
 * A frame whose data did not load keeps its frame and says so quietly (docs/design-match.md
 * rule 2): never one error panel for the page, never a made-up number.
 */
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (errorCode(error) === 'FORBIDDEN')
    return <Quiet>You don&apos;t have permission to see templates.</Quiet>;
  return (
    <p className="text-sm text-muted" title={errorMessage(error)} data-testid="frame-failed">
      Could not load this right now.{' '}
      <button type="button" onClick={onRetry} className="font-medium text-link underline">
        Try again
      </button>
    </p>
  );
}
