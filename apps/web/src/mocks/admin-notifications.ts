import type {
  PlatformNotificationAttention,
  PlatformNotificationCategory,
  PlatformNotificationPriority,
} from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

const MODULE = 'adminNotifications';

/** Local platform-notification fixtures for S08. No Super Admin API contract exists yet. */
export interface AdminNotificationFixture {
  id: string;
  title: string;
  description: string;
  relatedName: string;
  relatedType: string;
  category: PlatformNotificationCategory;
  occurredAt: string;
  priority: PlatformNotificationPriority;
  isRead: boolean;
  attention: PlatformNotificationAttention;
  actionLabel: 'View Details' | 'Review';
}

const firstPage: Omit<AdminNotificationFixture, 'id' | 'isRead' | 'attention'>[] = [
  {
    title: 'Payment Failed',
    description: 'Monthly subscription payment failed for Bright Tax Solutions.',
    relatedName: 'Bright Tax Solutions',
    relatedType: 'Firm Account',
    category: 'BILLING_SUBSCRIPTIONS',
    occurredAt: '2026-10-14T14:34:00.000Z',
    priority: 'CRITICAL',
    actionLabel: 'View Details',
  },
  {
    title: 'New Firm Application',
    description: 'A new firm application has been submitted and is awaiting review.',
    relatedName: 'Sunrise Accounting',
    relatedType: 'Firm Application',
    category: 'FIRM_APPLICATIONS',
    occurredAt: '2026-10-14T11:20:00.000Z',
    priority: 'HIGH',
    actionLabel: 'Review',
  },
  {
    title: 'Integration Disconnected',
    description: 'QuickBooks integration has been disconnected.',
    relatedName: 'Garcia & Co. CPA',
    relatedType: 'Firm Account',
    category: 'INTEGRATIONS',
    occurredAt: '2026-10-13T18:45:00.000Z',
    priority: 'HIGH',
    actionLabel: 'View Details',
  },
  {
    title: 'New User Added',
    description: 'A new user has been added to your firm.',
    relatedName: 'Lopez Tax Group',
    relatedType: 'Firm Account',
    category: 'FIRMS',
    occurredAt: '2026-10-13T15:12:00.000Z',
    priority: 'NORMAL',
    actionLabel: 'View Details',
  },
  {
    title: 'Subscription Renewed',
    description: 'Your monthly subscription has been successfully renewed.',
    relatedName: 'Prime Accounting',
    relatedType: 'Firm Account',
    category: 'BILLING_SUBSCRIPTIONS',
    occurredAt: '2026-10-12T09:08:00.000Z',
    priority: 'NORMAL',
    actionLabel: 'View Details',
  },
  {
    title: 'System Update',
    description: 'Firmivra will be undergoing scheduled maintenance on Oct 18, 2026.',
    relatedName: 'System',
    relatedType: 'Platform Update',
    category: 'SYSTEM',
    occurredAt: '2026-10-12T08:00:00.000Z',
    priority: 'INFORMATIONAL',
    actionLabel: 'View Details',
  },
  {
    title: 'Suspicious Login Attempt',
    description: 'A suspicious login attempt was blocked.',
    relatedName: 'maria@brighttax.com',
    relatedType: 'User Account',
    category: 'SECURITY',
    occurredAt: '2026-10-11T22:14:00.000Z',
    priority: 'HIGH',
    actionLabel: 'View Details',
  },
];

const templates: Record<
  PlatformNotificationCategory,
  {
    title: string;
    description: string;
    relatedType: string;
    actionLabel: 'View Details' | 'Review';
  }
> = {
  FIRMS: {
    title: 'Firm Activity Update',
    description: 'A firm account was updated by an administrator.',
    relatedType: 'Firm Account',
    actionLabel: 'View Details',
  },
  FIRM_APPLICATIONS: {
    title: 'Application Needs Review',
    description: 'A firm application has a new update for review.',
    relatedType: 'Firm Application',
    actionLabel: 'Review',
  },
  SALES_LEADS: {
    title: 'Lead Activity Update',
    description: 'A lead record has new activity in the sales pipeline.',
    relatedType: 'Lead',
    actionLabel: 'View Details',
  },
  BILLING_SUBSCRIPTIONS: {
    title: 'Billing Notice',
    description: 'There is a new billing or subscription update.',
    relatedType: 'Firm Account',
    actionLabel: 'View Details',
  },
  SUPPORT: {
    title: 'Support Ticket Update',
    description: 'A support ticket has a new update.',
    relatedType: 'Support Ticket',
    actionLabel: 'View Details',
  },
  INTEGRATIONS: {
    title: 'Integration Status Update',
    description: 'An integration connection has a new status update.',
    relatedType: 'Firm Account',
    actionLabel: 'View Details',
  },
  SECURITY: {
    title: 'Security Event',
    description: 'A security event needs administrator attention.',
    relatedType: 'User Account',
    actionLabel: 'View Details',
  },
  SYSTEM: {
    title: 'Platform Update',
    description: 'There is a new platform status or maintenance update.',
    relatedType: 'Platform Update',
    actionLabel: 'View Details',
  },
};

const relatedNames = [
  'Bright Tax Solutions',
  'Sunrise Accounting',
  'Garcia & Co. CPA',
  'Lopez Tax Group',
  'Prime Accounting',
  'Northstar Financial',
  'maria@brighttax.com',
  'System',
];
const categories: PlatformNotificationCategory[] = [
  'FIRMS',
  'FIRM_APPLICATIONS',
  'SALES_LEADS',
  'BILLING_SUBSCRIPTIONS',
  'SUPPORT',
  'INTEGRATIONS',
  'SECURITY',
  'SYSTEM',
];
/** The reference image shows 124 notifications, 37 unread, 12 needing action and 5 critical. */
export function createAdminNotificationFixtures(): AdminNotificationFixture[] {
  const actionRequiredIndexes = new Set([0, 1, 2, 7, 13, 20, 35, 48, 62, 77, 88, 110]);
  const criticalIndexes = new Set([0, 18, 39, 67, 101]);

  function fixture(index: number): AdminNotificationFixture {
    if (index < firstPage.length) {
      const row = firstPage[index];
      if (!row) throw new Error(`Missing notification fixture ${index}`);
      return {
        ...row,
        id: `platform-notification-${String(index + 1).padStart(3, '0')}`,
        isRead: index > 2,
        attention: actionRequiredIndexes.has(index) ? 'ACTION_REQUIRED' : 'NONE',
      };
    }

    const category = categories[(index * 3 + 1) % categories.length] ?? 'FIRMS';
    const template = templates[category];
    const day = 14 - (Math.floor((index - firstPage.length) / 8) % 14);
    const hour = (index * 7) % 24;
    const minute = (index * 13) % 60;
    return {
      id: `platform-notification-${String(index + 1).padStart(3, '0')}`,
      title: template.title,
      description: template.description,
      relatedName: relatedNames[index % relatedNames.length] ?? 'Firm Account',
      relatedType: template.relatedType,
      category,
      occurredAt: new Date(Date.UTC(2026, 9, day, hour, minute)).toISOString(),
      priority: criticalIndexes.has(index)
        ? 'CRITICAL'
        : index % 7 === 0
          ? 'HIGH'
          : index % 5 === 0
            ? 'INFORMATIONAL'
            : 'NORMAL',
      isRead: !(index >= 7 && index < 41),
      attention: actionRequiredIndexes.has(index) ? 'ACTION_REQUIRED' : 'NONE',
      actionLabel: template.actionLabel,
    };
  }

  return Array.from({ length: 124 }, (_, index) => fixture(index));
}

/** The Super Admin notifications API is not available yet, so dev uses a typed local mock. */
export async function listAdminNotifications(): Promise<AdminNotificationFixture[]> {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
  return mockedEmpty(MODULE) ? [] : createAdminNotificationFixtures();
}
