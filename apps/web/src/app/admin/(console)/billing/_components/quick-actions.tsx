'use client';

import {
  CalendarCheck,
  CaretRight,
  ChartBar,
  Clock,
  FileText,
  GearSix,
  NotePencil,
  Receipt,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { BillingTile, type BillingTone } from './billing-parts';

/** The dashboard's Quick Actions (docx §6.5): each opens the existing screen or module. */

interface QuickAction {
  title: string;
  text: string;
  href: string;
  icon: Icon;
  tone: BillingTone;
}

const FIRST_ROW: QuickAction[] = [
  {
    title: 'Create Invoice',
    text: 'Create and send a new invoice',
    href: '/billing/invoices/new',
    icon: FileText,
    tone: 'green',
  },
  {
    title: 'Manage Payments',
    text: 'View, record, and manage payments',
    href: '/billing/payments',
    icon: Clock,
    tone: 'blue',
  },
  {
    title: 'Create Estimate',
    text: 'Send an estimate to a client',
    href: '/billing/estimates/new',
    icon: NotePencil,
    tone: 'purple',
  },
  {
    title: 'Manage Subscriptions',
    text: 'View and manage recurring plans',
    href: '/subscriptions',
    icon: CalendarCheck,
    tone: 'orange',
  },
];
const SECOND_ROW: QuickAction[] = [
  {
    title: 'Create Credit Note',
    text: 'Issue credits or refunds',
    href: '/billing/credit-notes/new',
    icon: Receipt,
    tone: 'red',
  },
  {
    title: 'Billing Settings',
    text: 'Configure billing preferences',
    href: '/billing/settings',
    icon: GearSix,
    tone: 'teal',
  },
  {
    title: 'View Reports',
    text: 'Download billing reports',
    href: '/reports',
    icon: ChartBar,
    tone: 'grey',
  },
];

function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <li className="min-w-0">
      <Link
        href={action.href}
        className="flex h-full items-center gap-4 rounded-xl bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-focus"
      >
        <BillingTile icon={action.icon} tone={action.tone} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-bold text-heading">{action.title}</span>
          <span className="text-sm text-muted">{action.text}</span>
        </span>
        <CaretRight aria-hidden weight="bold" className="size-5 shrink-0 text-heading" />
      </Link>
    </li>
  );
}

/** Two rows of link cards: four, then three. */
export function QuickActions() {
  return (
    <section aria-labelledby="billing-quick-actions" className="flex flex-col gap-3">
      <h2 id="billing-quick-actions" className="text-xl font-bold text-heading">
        Quick Actions
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FIRST_ROW.map((action) => (
          <QuickActionCard key={action.title} action={action} />
        ))}
      </ul>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SECOND_ROW.map((action) => (
          <QuickActionCard key={action.title} action={action} />
        ))}
      </ul>
    </section>
  );
}
