'use client';

import { PageHeader } from '@firmivra/ui';
import {
  CaretLeft,
  CaretRight,
  ChartBar,
  Cube,
  FileText,
  SquaresFour,
  Users,
  WebhooksLogo,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { PlatformIntegration } from '../../../../../mocks/admin-integrations';

/**
 * The shell every Integrations page shares: the page header (breadcrumbs or a back link, title,
 * subtitle, actions), the section navigation (docx §1 and §13: Dashboard, Platform Integrations,
 * Customer Catalog, API & Webhooks, Logs, Usage), and a link styled as the kit's button.
 */

export const INTEGRATIONS_SECTIONS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    hint: 'Health and recent activity',
    href: '/integrations',
    icon: SquaresFour,
  },
  {
    id: 'platform',
    label: 'Platform Integrations',
    hint: 'Firmivra infrastructure',
    href: '/integrations/platform',
    icon: Cube,
  },
  {
    id: 'catalog',
    label: 'Customer Integration Catalog',
    hint: 'Manage availability for client firms',
    href: '/integrations/catalog',
    icon: Users,
  },
  {
    id: 'api-webhooks',
    label: 'API & Webhooks',
    hint: 'Keys, webhooks, and API access',
    href: '/integrations/api-webhooks',
    icon: WebhooksLogo,
  },
  {
    id: 'logs',
    label: 'Integration Logs',
    hint: 'Sync events and errors',
    href: '/integrations/logs',
    icon: FileText,
  },
  {
    id: 'usage',
    label: 'Usage & Analytics',
    hint: 'Monitor usage and performance',
    href: '/integrations/usage',
    icon: ChartBar,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: Icon;
}[];
export type IntegrationsSection = (typeof INTEGRATIONS_SECTIONS)[number]['id'];

/** The section a path belongs to: `/integrations/platform/new/review` is Platform Integrations. */
export function sectionOf(pathname: string): IntegrationsSection {
  const found = INTEGRATIONS_SECTIONS.find(
    (section) =>
      section.id !== 'dashboard' &&
      (pathname === section.href || pathname.startsWith(`${section.href}/`)),
  );
  return found?.id ?? 'dashboard';
}

/**
 * The section tiles (the dashboard design's row under the cards): icon, name and a one-line hint;
 * the current section is solid blue. `current` defaults to the section of the address.
 */
export function IntegrationsNav({ current }: { current?: IntegrationsSection }) {
  const pathname = usePathname();
  const active = current ?? sectionOf(pathname);
  return (
    <nav aria-label="Integrations sections" data-testid="integrations-nav">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1440px]:grid-cols-6">
        {INTEGRATIONS_SECTIONS.map((section) => {
          const on = section.id === active;
          const Glyph = section.icon;
          return (
            <li key={section.id} className="min-w-0">
              <Link
                href={section.href}
                aria-current={on ? 'page' : undefined}
                className={`flex h-full min-w-0 items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  on
                    ? 'border-action bg-action text-on-action'
                    : 'border-border bg-surface text-heading hover:border-action hover:bg-canvas'
                }`}
              >
                <Glyph
                  aria-hidden
                  weight="fill"
                  className={`size-6 shrink-0 ${on ? 'text-on-action' : 'text-heading'}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm leading-snug font-semibold wrap-break-word">
                    {section.label}
                  </span>
                  <span
                    className={`hidden text-xs leading-snug sm:block ${on ? 'text-on-action' : 'text-muted'}`}
                  >
                    {section.hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface Crumb {
  label: string;
  /** Left out on the current page (the last crumb). */
  href?: string;
}

/** "‹ Integrations › Customer Integration Catalog": the last item is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const back = items.findLast((item) => item.href)?.href;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {back ? (
        <Link href={back} aria-label="Back" className="rounded-sm text-heading hover:text-action">
          <CaretLeft aria-hidden weight="bold" className="size-4" />
        </Link>
      ) : null}
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            {index ? <CaretRight aria-hidden weight="bold" className="size-3 text-muted" /> : null}
            {item.href ? (
              <Link href={item.href} className="text-text hover:text-action hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-text">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "‹ Back to Integrations" above a title (the manage design). */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-2 rounded-sm text-sm text-text hover:text-action"
    >
      <CaretLeft aria-hidden weight="bold" className="size-4" />
      {label}
    </Link>
  );
}

/**
 * The page header every Integrations page uses: breadcrumbs or a back link above the title, a
 * one-line subtitle, and the page's buttons on the right (the primary one last).
 */
export function IntegrationsHeader({
  title,
  subtitle,
  crumbs,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      actions={actions}
      above={crumbs ? <Breadcrumbs items={crumbs} /> : back ? <BackLink {...back} /> : undefined}
    />
  );
}

const buttonLook = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-border bg-surface text-action hover:bg-canvas',
};
/** A link that looks like the kit's Button: navigation stays a real link. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  children,
  className = '',
}: {
  href: string;
  variant?: keyof typeof buttonLook;
  /** `sm`: the slimmer button of a table row ("Manage"). */
  size?: 'md' | 'sm';
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-control text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${size === 'sm' ? 'min-h-9 px-5 py-1.5' : 'min-h-11 px-4 py-2'} ${buttonLook[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

const STEP_PATHS = {
  SERVICE: '',
  CONNECTION: '/connection',
  SETTINGS: '/settings',
  REVIEW: '/review',
} as const;
/**
 * Where a draft's setup continues: the wizard's step route with the draft's id in `?draft=`
 * (the wizard routes have no id segment). Every wizard page reads `draft` from the address.
 */
export function setupHref(integration: Pick<PlatformIntegration, 'id' | 'setupStep'>): string {
  return `/integrations/platform/new${STEP_PATHS[integration.setupStep]}?draft=${encodeURIComponent(integration.id)}`;
}
/** The manage page of one platform integration. */
export const platformHref = (id: string) => `/integrations/platform/${encodeURIComponent(id)}`;
/** The central log, filtered to one integration (docx §13: deep links carry their filters). */
export const logsHref = (integrationId: string) =>
  `/integrations/logs?integration=${encodeURIComponent(integrationId)}`;
