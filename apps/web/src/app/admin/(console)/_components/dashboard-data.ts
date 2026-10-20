import {
  Building2,
  ChartColumn,
  CreditCard,
  FileText,
  Headset,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AdminDashboard } from '@firmivra/types';

type DashboardMetric = keyof Pick<AdminDashboard, 'pendingApplications' | 'newUsersThisWeek'>;

/** Labels and presentation only; all displayed figures come from api.firmApplications. */
export const dashboardStats = [
  {
    key: 'pendingApplications',
    label: 'Pending Applications',
    href: '/applications',
    linkLabel: 'View Applications',
    icon: FileText,
    tone: 'blue',
    testId: 'stat-pending-applications',
  },
  {
    key: 'activeFirms',
    label: 'Active Firms',
    href: '/firms',
    linkLabel: 'View Firms',
    icon: Building2,
    tone: 'green',
    testId: 'stat-active-firms',
  },
  {
    key: 'totalUsers',
    label: 'Total Users',
    href: undefined,
    linkLabel: 'View Users',
    icon: Users,
    tone: 'purple',
    testId: 'stat-total-users',
  },
  {
    key: 'monthlyRevenueCents',
    label: 'Monthly Revenue',
    href: undefined,
    linkLabel: 'View Billing',
    icon: CreditCard,
    tone: 'gold',
    testId: 'stat-monthly-revenue',
  },
] as const;

export const attentionItems: {
  label: string;
  icon: LucideIcon;
  key?: DashboardMetric;
  href?: string;
}[] = [
  {
    label: 'Firm application pending review',
    key: 'pendingApplications',
    icon: FileText,
    href: '/applications',
  },
  { label: 'Payment issues', icon: TriangleAlert },
  { label: 'Open support tickets', icon: Headset },
  { label: 'New users this week', key: 'newUsersThisWeek', icon: Users },
  { label: 'Renewals this week', icon: ChartColumn },
];

export const systemStatuses = [
  'Platform',
  'Database',
  'File Storage',
  'Email Service',
  'Client Portals',
];

/**
 * The Platform Modules tiles (the dashboard design's last row). The design is Phase 1's, where
 * every module said "Coming Soon"; the modules are built now, so each tile opens its module with
 * one line about it. Leads / CRM has no page of its own yet: its leads live in the pipeline.
 */
export const platformModules = [
  ['Sales', ChartColumn, '/sales', 'Sales and revenue'],
  ['Leads / CRM', UserRound, '/sales/pipeline', 'Leads in the pipeline'],
  ['Team Management', Users, '/team', 'Staff and roles'],
  ['Subscriptions', CreditCard, '/subscriptions', 'Plans and billing'],
  ['Billing', FileText, '/billing', 'Invoices and payments'],
  ['Support', Headset, '/support', 'Tickets and settings'],
  ['Reports & Analytics', ChartColumn, '/reports', 'Platform reports'],
  ['Audit & Security', ShieldCheck, '/audit-security', 'Events and settings'],
] as const;
