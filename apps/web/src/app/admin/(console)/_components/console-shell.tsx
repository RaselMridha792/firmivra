'use client';

import {
  Bell,
  Building2,
  CreditCard,
  FileChartColumn,
  FileText,
  Headset,
  House,
  MessageCircleMore,
  Plug,
  ReceiptText,
  Settings,
  ShieldCheck,
  SquareUser,
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
      { label: 'Firms', icon: Building2, href: '/firms' },
    ],
    // The modules, in the order of firmivra-sidebar-states-mockup.jpg. Leads / CRM has no route
    // of its own yet (the pipeline holds the leads), so it stays a "Soon" item.
    [
      { label: 'Sales Center', icon: TrendingUp, href: '/sales' },
      { label: 'Leads / CRM', icon: SquareUser, soon: true },
      { label: 'Pipeline', icon: TrendingUp, href: '/sales/pipeline' },
      { label: 'Team', icon: Users, href: '/team' },
      { label: 'Communications', icon: MessageCircleMore, href: '/communications' },
      { label: 'Subscriptions', icon: CreditCard, href: '/subscriptions' },
      { label: 'Billing', icon: ReceiptText, href: '/billing' },
      { label: 'Support', icon: Headset, href: '/support' },
      { label: 'Reports & Analytics', icon: FileChartColumn, href: '/reports' },
      { label: 'Notifications', icon: Bell, href: '/notifications' },
      { label: 'Integrations', icon: Plug, href: '/integrations' },
      { label: 'Audit & Security', icon: ShieldCheck, href: '/audit-security' },
      { label: 'System Settings', icon: Settings, href: '/system-settings' },
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
