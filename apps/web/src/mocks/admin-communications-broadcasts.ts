import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

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

export async function listBroadcastOptions(): Promise<BroadcastOptionsFixture> {
  await mockDelay();
  if (!mocked('adminCommunications')) throw new TypeError('Broadcast options are unavailable');
  if (mockedEmpty('adminCommunications')) return { categories: [], templates: [] };

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
