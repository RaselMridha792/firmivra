import {
  Building,
  ChartColumn,
  Contact,
  CreditCard,
  FileText,
  Headset,
  Receipt,
  ShieldCheck,
  TriangleAlert,
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
    icon: FileText,
    tone: 'blue',
    testId: 'stat-pending-applications',
  },
  {
    key: 'activeFirms',
    label: 'Active Firms',
    href: '/firms',
    icon: Building,
    tone: 'green',
    testId: 'stat-active-firms',
  },
  {
    key: 'totalUsers',
    label: 'Total Users',
    href: undefined,
    icon: Users,
    tone: 'purple',
    testId: 'stat-total-users',
  },
  {
    key: 'monthlyRevenueCents',
    label: 'Monthly Revenue',
    href: undefined,
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

export const platformModules = [
  ['Sales', ChartColumn],
  ['Leads / CRM', Contact],
  ['Team Management', Users],
  ['Subscriptions', CreditCard],
  ['Billing', Receipt],
  ['Support', Headset],
  ['Reports & Analytics', ChartColumn],
  ['Audit & Security', ShieldCheck],
] as const;
