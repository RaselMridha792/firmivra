'use client';

import {
  Bell,
  Building,
  ChartColumn,
  Contact,
  CreditCard,
  FileText,
  Headset,
  House,
  Receipt,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell } from '../../../components/app-shell/app-shell';
import type { NavSections } from '../../../components/app-shell/types';
import { SignedIn } from '../../../components/signed-in';
import {
  dashboardNotifications,
  dashboardSearchItems,
  pendingApplicationCount,
} from './_components/dashboard-data';

// Super Admin menu (docs/junior/PAGE-MAP.md). R4 adds the pending count to Firm Applications.
const sections: NavSections = [
  [
    { label: 'Dashboard', icon: House, href: '/' },
    {
      label: 'Firm Applications',
      icon: FileText,
      href: '/applications',
      badge: pendingApplicationCount,
    },
    { label: 'Firms', icon: Building, href: '/firms' },
  ],
  [
    { label: 'Sales', icon: TrendingUp, soon: true },
    { label: 'Leads / CRM', icon: Contact, soon: true },
    { label: 'Team', icon: Users, soon: true },
    { label: 'Subscriptions', icon: CreditCard, soon: true },
    { label: 'Billing', icon: Receipt, soon: true },
    { label: 'Support', icon: Headset, soon: true },
    { label: 'Reports & Analytics', icon: ChartColumn, soon: true },
    { label: 'Notifications', icon: Bell, soon: true },
    { label: 'Audit & Security', icon: ShieldCheck, soon: true },
    { label: 'System Settings', icon: Settings, soon: true },
  ],
];

/** Every signed-in Super Admin page: the sign-in check and the console's sidebar and header. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="admin" signInPath="/sign-in">
      <AppShell
        subtitle="Super Admin Portal"
        sections={sections}
        roleLabel="Super Admin"
        search="Search firms, applications, users…"
        searchItems={dashboardSearchItems}
        notifications={dashboardNotifications}
      >
        {children}
      </AppShell>
    </SignedIn>
  );
}
