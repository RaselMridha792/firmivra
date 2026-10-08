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
import { AppShell } from '../../../../components/app-shell/app-shell';
import type { NavSections } from '../../../../components/app-shell/types';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';

/** The count query runs inside SignedIn, so the sidebar never guesses a pending total. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const counts = useApiQuery(['firm-applications', 'counts'], () => api.firmApplications.counts());
  const pendingReview = counts.isError ? undefined : counts.data?.pendingReview;
  const sections: NavSections = [
    [
      { label: 'Dashboard', icon: House, href: '/' },
      {
        label: 'Firm Applications',
        icon: FileText,
        href: '/applications',
        badge: pendingReview ? pendingReview : undefined,
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

  return (
    <AppShell
      subtitle="Super Admin Portal"
      sections={sections}
      roleLabel="Super Admin"
      search="Search firms, applications, users..."
    >
      {children}
    </AppShell>
  );
}
