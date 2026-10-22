import type { CatalogStatus, PricingType } from '@firmivra/types';
import {
  BookOpen,
  Briefcase,
  Buildings,
  CalendarBlank,
  ChartBar,
  FileText,
  Money,
  PencilSimple,
  Shield,
  User,
  UsersThree,
  Cube,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export const CATALOG_KEY = ['services-pricing'] as const;

/** The approved icon keys of the catalog, as the Phosphor icon and the tile colour they get. */
export const CATALOG_ICONS: Record<string, { glyph: Icon; tone: string; label: string }> = {
  user: { glyph: User, tone: 'bg-danger-soft text-danger', label: 'Person' },
  briefcase: { glyph: Briefcase, tone: 'bg-warning-soft text-gold', label: 'Briefcase' },
  calendar: { glyph: CalendarBlank, tone: 'bg-danger-soft text-danger', label: 'Calendar' },
  'chart-bar': { glyph: ChartBar, tone: 'bg-warning-soft text-gold', label: 'Chart' },
  'users-three': { glyph: UsersThree, tone: 'bg-danger-soft text-danger', label: 'People' },
  money: { glyph: Money, tone: 'bg-warning-soft text-gold', label: 'Money' },
  book: { glyph: BookOpen, tone: 'bg-danger-soft text-danger', label: 'Book' },
  'file-text': { glyph: FileText, tone: 'bg-navigation text-on-action', label: 'Document' },
  shield: { glyph: Shield, tone: 'bg-info-soft text-info', label: 'Shield' },
  buildings: { glyph: Buildings, tone: 'bg-purple-soft text-purple', label: 'Buildings' },
  pencil: { glyph: PencilSimple, tone: 'bg-info-soft text-info', label: 'Pencil' },
};

/** The rounded tile of a service or package: its icon, or a cube when it has none. */
export function IconTile({
  icon,
  size = 'md',
}: {
  icon: string | null | undefined;
  size?: 'md' | 'lg';
}) {
  const meta = icon ? CATALOG_ICONS[icon] : undefined;
  const Glyph = meta?.glyph ?? Cube;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-lg ${size === 'lg' ? 'size-16' : 'size-10'} ${meta?.tone ?? 'bg-info-soft text-info'}`}
    >
      <Glyph weight="fill" className={size === 'lg' ? 'size-8' : 'size-5'} />
    </span>
  );
}

/** "$1,234.50" from cents; "—" when there is no price. */
export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** "20%" from basis points. */
export const percent = (basisPoints: number) => `${basisPoints / 100}%`;

export const STATUS_TONE: Record<CatalogStatus, 'success' | 'neutral' | 'warning' | 'info'> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DRAFT: 'warning',
  ARCHIVED: 'neutral',
};
export const STATUS_LABEL: Record<CatalogStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DRAFT: 'Draft',
  ARCHIVED: 'Archived',
};
export const PRICING_LABEL: Record<PricingType, string> = {
  FIXED: 'Fixed Price',
  STARTING_AT: 'Starting At',
  HOURLY: 'Hourly',
  CUSTOM_QUOTE: 'Custom Quote',
  RECURRING: 'Recurring',
};

export const tone = (value: string | null | undefined) =>
  (['info', 'purple', 'success', 'warning', 'danger', 'neutral'] as const).find(
    (t) => t === value,
  ) ?? 'neutral';

export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The API's catalog codes, in the firm's words. */
export const CATALOG_ERRORS: Record<string, string> = {
  DUPLICATE_NAME:
    'Another service or package already uses this name, possibly a draft (see Drafts). Choose another name.',
  ACTIVATION_INCOMPLETE:
    'Add the name, category, short description and price before activating. Save it as a draft meanwhile.',
  IN_USE: 'It is in use. Deactivate or archive it instead.',
  CATEGORY_INACTIVE: 'That category is inactive. Choose another.',
  PACKAGE_HAS_INACTIVE_SERVICE:
    'The package holds an inactive service. Replace or remove it first.',
  INVALID_DISCOUNT: 'The discount makes the package price negative.',
  PROMOTION_CONFLICT: 'This overlaps another promotion that does not stack, or the code is taken.',
  SAVE_CONFLICT: 'Someone saved this after you opened it. Reload and try again.',
};

/** A service field activation needs, as the editor names it. */
export type ActivationField =
  'name' | 'categoryId' | 'shortDescription' | 'basePriceCents' | 'billingFrequency';

/**
 * The first thing a service still needs before it can be active, in the API's own order
 * (catalog-services.service.ts `complete`), or null. Lets a screen say which field is missing
 * instead of the API's single ACTIVATION_INCOMPLETE code.
 */
export function activationGap(s: {
  name?: string | null;
  categoryId?: string | null;
  shortDescription?: string | null;
  pricingType?: PricingType;
  basePriceCents?: number | null;
  billingFrequency?: string | null;
}): { field: ActivationField; message: string } | null {
  if (!s.name?.trim()) return { field: 'name', message: 'Add the service name' };
  if (!s.categoryId) return { field: 'categoryId', message: 'Choose a category' };
  if (!s.shortDescription?.trim())
    return { field: 'shortDescription', message: 'Add a short description' };
  if (
    s.pricingType !== 'CUSTOM_QUOTE' &&
    (s.basePriceCents === null || s.basePriceCents === undefined)
  )
    return { field: 'basePriceCents', message: 'Add the base price' };
  if (s.pricingType === 'RECURRING' && (!s.billingFrequency || s.billingFrequency === 'ONE_TIME'))
    return { field: 'billingFrequency', message: 'Choose how often it bills' };
  return null;
}

/** The same check on a list row (its price carries the type, amount and frequency). */
export const rowActivationGap = (row: {
  name: string;
  category: { id: string } | null;
  shortDescription: string | null;
  price: { type: PricingType; amountCents: number | null; frequency: string | null };
}) =>
  activationGap({
    name: row.name,
    categoryId: row.category?.id,
    shortDescription: row.shortDescription,
    pricingType: row.price.type,
    basePriceCents: row.price.amountCents,
    billingFrequency: row.price.frequency,
  });

export const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">{children}</p>
);
