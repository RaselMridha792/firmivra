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

type DashboardMetric = keyof Pick<
  AdminDashboard,
  'pendingApplications' | 'newUsersThisWeek' | 'openTickets' | 'renewalsThisWeek'
>;

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
    // SA-DSH-F02: the Firms list on its Active tab.
    href: '/firms?status=ACTIVE',
    linkLabel: 'View Firms',
    icon: Building2,
    tone: 'green',
    testId: 'stat-active-firms',
  },
  {
    key: 'totalUsers',
    label: 'Total Users',
    // SA-DSH-F03: Reports' Users view (read-only).
    href: '/reports/users',
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

/**
 * Each row opens the list it counts, filtered the same way, at any count. `href: 'week'` is
 * Reports' Users view for this week, from Monday (the page builds it on the viewer's clock).
 */
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
    // SA-DSH-F07: Applications on its Pending tab.
    href: '/applications?tab=PENDING_REVIEW',
  },
  { label: 'Payment issues', icon: TriangleAlert },
  // SA-DSH-F09: Support filtered to Open.
  {
    label: 'Open support tickets',
    key: 'openTickets',
    icon: Headset,
    href: '/support?status=OPEN',
  },
  // SA-DSH-F10: Reports' Users view, this week.
  { label: 'New users this week', key: 'newUsersThisWeek', icon: Users, href: 'week' },
  // SA-DSH-F11: Subscriptions filtered to Renewing this week.
  {
    label: 'Renewals this week',
    key: 'renewalsThisWeek',
    icon: ChartColumn,
    href: '/subscriptions?status=RENEWING_THIS_WEEK',
  },
];

/** SA-DSH-F10: Reports' Users view from this week's Monday to today (UTC days, as Reports). */
export function usersThisWeekHref(now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const monday = new Date(`${today}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return `/reports/users?from=${monday.toISOString().slice(0, 10)}&to=${today}`;
}

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
