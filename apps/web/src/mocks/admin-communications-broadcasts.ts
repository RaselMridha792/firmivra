import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

const MODULE = 'adminCommunications';

export type AdminBroadcastStatus = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'FAILED';
export type AdminBroadcastChannel = 'EMAIL' | 'SMS';

/** Local Super Admin screen fixture. No typed Communications API contract exists yet. */
export interface AdminBroadcastFixture {
  id: string;
  name: string;
  description: string;
  channel: AdminBroadcastChannel;
  audience: string;
  status: AdminBroadcastStatus;
  recipients: number;
  openRate: string;
  clickRate: string;
  date: string;
  dateLabel: string;
  timeLabel: string;
  createdBy: string;
}

export interface AdminBroadcastDashboardFixture {
  metrics: {
    total: number;
    drafts: number;
    scheduled: number;
    sent: number;
    failed: number;
  };
  broadcasts: AdminBroadcastFixture[];
}

const sampleDashboard: AdminBroadcastDashboardFixture = {
  metrics: { total: 12, drafts: 5, scheduled: 3, sent: 20, failed: 1 },
  broadcasts: [
    {
      id: 'broadcast-1',
      name: 'New Feature Announcement',
      description: 'Introducing our new dashboard features.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'SENT',
      recipients: 248,
      openRate: '62%',
      clickRate: '18%',
      date: '2026-10-10',
      dateLabel: 'Oct 10, 2026',
      timeLabel: '10:00 AM',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-2',
      name: 'Document Reminder',
      description: 'Reminder to upload missing documents.',
      channel: 'EMAIL',
      audience: 'Firms with Pending Docs',
      status: 'SCHEDULED',
      recipients: 142,
      openRate: '—',
      clickRate: '—',
      date: '2026-10-15',
      dateLabel: 'Oct 15, 2026',
      timeLabel: '9:00 AM',
      createdBy: 'Team Member',
    },
    {
      id: 'broadcast-3',
      name: 'Monthly Newsletter',
      description: 'October firm updates and resources.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'SENT',
      recipients: 312,
      openRate: '58%',
      clickRate: '12%',
      date: '2026-10-01',
      dateLabel: 'Oct 1, 2026',
      timeLabel: '9:00 AM',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-4',
      name: 'Application Follow Up',
      description: 'Checking in on your application.',
      channel: 'SMS',
      audience: 'Firms in Progress Apps',
      status: 'DRAFT',
      recipients: 0,
      openRate: '—',
      clickRate: '—',
      date: '',
      dateLabel: '—',
      timeLabel: '',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-5',
      name: 'Holiday Hours Notice',
      description: 'Our office will be closed for the holiday.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'SENT',
      recipients: 296,
      openRate: '71%',
      clickRate: '14%',
      date: '2026-09-25',
      dateLabel: 'Sep 25, 2026',
      timeLabel: '8:00 AM',
      createdBy: 'System',
    },
    {
      id: 'broadcast-6',
      name: 'Incomplete Applications',
      description: 'Action needed on your application.',
      channel: 'EMAIL',
      audience: 'Firms with Incomplete Apps',
      status: 'FAILED',
      recipients: 0,
      openRate: '—',
      clickRate: '—',
      date: '2026-09-20',
      dateLabel: 'Sep 20, 2026',
      timeLabel: '9:00 AM',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-7',
      name: 'Welcome Series',
      description: 'Welcome to Firmivra!',
      channel: 'EMAIL',
      audience: 'New Firms (last 30 days)',
      status: 'SENT',
      recipients: 45,
      openRate: '67%',
      clickRate: '22%',
      date: '2026-09-12',
      dateLabel: 'Sep 12, 2026',
      timeLabel: '10:00 AM',
      createdBy: 'Team Member',
    },
    {
      id: 'broadcast-8',
      name: 'Payment Reminder',
      description: 'Your subscription payment is due soon.',
      channel: 'SMS',
      audience: 'Past Due Accounts',
      status: 'SCHEDULED',
      recipients: 89,
      openRate: '—',
      clickRate: '—',
      date: '2026-10-16',
      dateLabel: 'Oct 16, 2026',
      timeLabel: '2:00 PM',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-9',
      name: 'October Tax Checklist',
      description: 'A checklist for the upcoming tax season.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'DRAFT',
      recipients: 0,
      openRate: '—',
      clickRate: '—',
      date: '',
      dateLabel: '—',
      timeLabel: '',
      createdBy: 'Octavia Holder',
    },
    {
      id: 'broadcast-10',
      name: 'Trial Ending Notice',
      description: 'Your trial period is ending soon.',
      channel: 'SMS',
      audience: 'Trial Firms',
      status: 'SCHEDULED',
      recipients: 77,
      openRate: '—',
      clickRate: '—',
      date: '2026-10-18',
      dateLabel: 'Oct 18, 2026',
      timeLabel: '10:00 AM',
      createdBy: 'System',
    },
    {
      id: 'broadcast-11',
      name: 'Security Notice',
      description: 'Important account security information.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'SENT',
      recipients: 248,
      openRate: '74%',
      clickRate: '31%',
      date: '2026-09-15',
      dateLabel: 'Sep 15, 2026',
      timeLabel: '11:30 AM',
      createdBy: 'System',
    },
    {
      id: 'broadcast-12',
      name: 'Share Your Feedback',
      description: 'Tell us what you think of Firmivra.',
      channel: 'EMAIL',
      audience: 'All Firms',
      status: 'DRAFT',
      recipients: 0,
      openRate: '—',
      clickRate: '—',
      date: '',
      dateLabel: '—',
      timeLabel: '',
      createdBy: 'Team Member',
    },
  ],
};

const emptyDashboard: AdminBroadcastDashboardFixture = {
  metrics: { total: 0, drafts: 0, scheduled: 0, sent: 0, failed: 0 },
  broadcasts: [],
};

/** Returns synthetic dashboard data only when the local mock is enabled. */
export async function getAdminBroadcastDashboard(): Promise<AdminBroadcastDashboardFixture> {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
  return mockedEmpty(MODULE) ? emptyDashboard : sampleDashboard;
}

/** S10 display fixtures only. These are not a broadcast API contract. */
export interface BroadcastTemplateFixture {
  id: string;
  name: string;
  subject: string;
  message: string;
}

export interface BroadcastOptionsFixture {
  categories: { value: string; label: string }[];
  templates: BroadcastTemplateFixture[];
}

/** Returns local template and category options for the basic-information step. */
export async function listBroadcastOptions(): Promise<BroadcastOptionsFixture> {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Broadcast options are unavailable');
  if (mockedEmpty(MODULE)) return { categories: [], templates: [] };

  return {
    categories: [
      { value: 'sales', label: 'Sales' },
      { value: 'onboarding', label: 'Onboarding' },
      { value: 'support', label: 'Support' },
      { value: 'billing', label: 'Billing' },
      { value: 'firm-applications', label: 'Firm Applications' },
      { value: 'system-notices', label: 'System Notices' },
    ],
    templates: [
      {
        id: 'sample-newsletter',
        name: 'Monthly Newsletter',
        subject: 'Your monthly Firmivra update',
        message: 'Explore this month’s updates, helpful resources, and upcoming events.',
      },
      {
        id: 'sample-welcome',
        name: 'Welcome to Firmivra',
        subject: 'Welcome to your workspace',
        message: 'Welcome! Your workspace is ready. Explore the resources to help you get started.',
      },
    ],
  };
}
