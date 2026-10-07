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
export const dashboardStats = [
  ['Pending Applications', pendingApplicationCount, '/applications', FileText, 'blue'],
  ['Active Firms', '0', '/firms', Building, 'green'],
  ['Total Users', '0', undefined, Users, 'purple'],
  ['Monthly Revenue', '$0.00', undefined, CreditCard, 'gold'],
] as const;
export const attentionItems = [
  ['Firm application pending review', pendingApplicationCount, FileText],
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
