'use client';

import { Plus, Tag } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export type CatalogTab = 'active' | 'inactive' | 'categories' | 'packages' | 'promotions';
const TABS: { id: CatalogTab; label: string; href: string }[] = [
  { id: 'active', label: 'Active Services', href: '/services-pricing' },
  { id: 'inactive', label: 'Inactive Services', href: '/services-pricing/inactive' },
  { id: 'categories', label: 'Service Categories', href: '/services-pricing/categories' },
  { id: 'packages', label: 'Package Builder', href: '/services-pricing/packages' },
  { id: 'promotions', label: 'Discounts & Promotions', href: '/services-pricing/promotions' },
];

/**
 * The top of the Services & Pricing sub-pages: the tag tile, title, Add New Service, and the five
 * section tabs as links (the services list itself keeps its own copy in services-pricing-screen).
 */
export function CatalogFrame({ tab, children }: { tab: CatalogTab; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid={`catalog-${tab}`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <Tag aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Services &amp; Pricing</h1>
            <p className="text-base text-muted">
              Manage your services, pricing, and what&apos;s included.
            </p>
          </div>
        </div>
        <Link
          href="/services-pricing/new"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-6 text-base font-medium text-on-action hover:bg-action-hover"
        >
          <Plus aria-hidden weight="bold" className="size-5" /> Add New Service
        </Link>
      </header>
      <nav
        aria-label="Services & Pricing sections"
        className="flex min-w-0 overflow-x-auto border-b border-divider"
      >
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === tab ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm whitespace-nowrap ${item.id === tab ? 'border-action bg-table-head font-semibold text-heading' : 'border-transparent font-medium text-action hover:bg-table-head'}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
