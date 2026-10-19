'use client';

import { Callout } from '@firmivra/ui';
import {
  BuildingOffice,
  EnvelopeSimple,
  FileText,
  GearSix,
  type Icon,
  IdentificationCard,
  Monitor,
  PaintBrush,
  Palette,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import { SettingsHeader } from './settings-parts';

/** The six tabs of Company Profile & Branding; each is its own Settings page (PAGE-MAP). */
export const BRAND_TABS = [
  { id: 'profile', label: 'Company Profile', href: '/settings/profile', icon: IdentificationCard },
  { id: 'branding', label: 'Branding & White Label', href: '/settings/branding', icon: PaintBrush },
  {
    id: 'communications',
    label: 'Email & Communications',
    href: '/settings/communications',
    icon: EnvelopeSimple,
  },
  { id: 'portal', label: 'Client Portal Branding', href: '/settings/portal', icon: Monitor },
  { id: 'legal', label: 'Documents & Legal', href: '/settings/legal', icon: FileText },
  { id: 'preferences', label: 'Preferences', href: '/settings/preferences', icon: GearSix },
] as const satisfies readonly { id: string; label: string; href: string; icon: Icon }[];
export type BrandTab = (typeof BRAND_TABS)[number]['id'];

/**
 * The top of Company Profile & Branding (company-profile-branding-and-white-label.jpg): Settings >
 * Company Profile & Branding, the tile, title and line, Make It Yours, and the six tabs.
 */
export function BrandFrame({ tab, children }: { tab: BrandTab; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SettingsHeader
        icon={BuildingOffice}
        title="Company Profile & Branding"
        subtitle="Manage your company information, customize your branding, and white-label your Firmivra experience."
        action={
          <div className="w-full max-w-sm">
            <Callout icon={Palette} tone="navy" surface="info" title="Make It Yours">
              Customize the platform to match your brand. Changes will be reflected across the
              dashboard, client portal, emails, and reports.
            </Callout>
          </div>
        }
      />
      <nav
        aria-label="Company Profile & Branding"
        className="flex flex-wrap gap-x-1 border-b border-divider"
      >
        {BRAND_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 border-b-3 px-2 text-sm whitespace-nowrap ${on ? 'border-action font-semibold text-action' : 'border-transparent text-heading hover:text-action'}`}
            >
              {createElement(t.icon, {
                'aria-hidden': true,
                weight: 'fill',
                className: 'size-4 text-action',
              })}
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

/** One white card of the page: the bold title, its line, and the fields (no tile, as drawn). */
export function BrandCard({
  title,
  subtitle,
  testId,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm ${className}`}
    >
      <div>
        <h2 className="text-lg font-bold text-heading">{title}</h2>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
