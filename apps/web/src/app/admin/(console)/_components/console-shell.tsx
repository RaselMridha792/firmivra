'use client';

import {
  Bell,
  Building2,
  FileChartColumn,
  CreditCard,
  FileText,
  Headset,
  House,
  SquareUser,
  Settings,
  ShieldCheck,
  Megaphone,
  Wallet,
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
      { label: 'Firms', icon: Building2, href: '/firms' },
    ],
    [
      { label: 'Sales', icon: Megaphone, soon: true },
      { label: 'Leads / CRM', icon: SquareUser, soon: true },
      { label: 'Team', icon: Users, soon: true },
      { label: 'Subscriptions', icon: CreditCard, soon: true },
      { label: 'Billing', icon: Wallet, soon: true },
      { label: 'Support', icon: Headset, soon: true },
      { label: 'Reports & Analytics', icon: FileChartColumn, soon: true },
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
