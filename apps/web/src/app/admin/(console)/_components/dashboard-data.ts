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
import type { ShellNotification, ShellSearchItem } from '../../../../components/app-shell/types';

export const sampleApplicationId = '00000000-0000-4000-8000-000000000001';
export const recentApplications = [
  [
    'LVP Accounting & Taxes',
    'Octavia Holder',
    'octavia@lvpaccounting.com',
    'Sep 28, 2026',
    '10:24 AM',
  ],
] as const;
export const pendingApplicationCount = recentApplications.length;
export const dashboardSearchItems: readonly ShellSearchItem[] = [
  {
    id: 'application-lvp',
    kind: 'Application',
    label: 'LVP Accounting & Taxes',
    detail: 'Octavia Holder · octavia@lvpaccounting.com',
    href: '/applications/' + '00000000-0000-4000-8000-000000000001',
  },
  {
    id: 'firm-lvp',
    kind: 'Firm',
    label: 'LVP Accounting & Taxes',
    detail: 'Pending setup',
    href: '/firms',
  },
  {
    id: 'user-octavia',
    kind: 'User',
    label: 'Octavia Holder',
    detail: 'Owner · LVP Accounting & Taxes',
    href: '/applications/' + '00000000-0000-4000-8000-000000000001',
  },
];
export const dashboardNotifications: readonly ShellNotification[] = [
  {
    id: 'pending-lvp-application',
    title: 'Firm application pending review',
    detail: 'LVP Accounting & Taxes · Sep 28, 2026',
    href: '/applications/' + '00000000-0000-4000-8000-000000000001',
  },
];
export const growthPeriods = {
  week: { label: 'Last 7 Days', dates: ['Sep 22', 'Sep 24', 'Sep 26', 'Sep 28'] },
  month: { label: 'Last 30 Days', dates: ['Sep 1', 'Sep 8', 'Sep 15', 'Sep 22', 'Sep 28'] },
  quarter: { label: 'Last 90 Days', dates: ['Jul 1', 'Jul 22', 'Aug 12', 'Sep 4', 'Sep 28'] },
} as const;
export const dashboardStats = [
  ['Pending Applications', pendingApplicationCount, '/applications', FileText, 'blue'],
  ['Active Firms', '0', '/firms', Building, 'green'],
  ['Total Users', '0', undefined, Users, 'purple'],
  ['Monthly Revenue', '$0.00', undefined, CreditCard, 'gold'],
] as const;
export const attentionItems = [
  ['Firm application pending review', pendingApplicationCount, FileText, '/applications'],
  ['Payment issues', 0, TriangleAlert],
  ['Open support tickets', 0, Headset],
  ['New users this week', 0, Users],
  ['Renewals this week', 0, ChartColumn],
] as const;
export const systemStatuses = 'Platform|Database|File Storage|Email Service|Client Portals'.split(
  '|',
);
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
