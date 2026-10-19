import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

/** Synthetic display fixtures only; these do not define a Templates API contract. */
export const templateCategories = [
  'Sales',
  'Onboarding',
  'Support',
  'Billing',
  'Firm Applications',
  'System Notices',
] as const;
export type TemplateCategory = (typeof templateCategories)[number];
export interface CommunicationTemplate {
  id: string;
  name: string;
  excerpt: string;
  category: TemplateCategory;
  channel: 'EMAIL' | 'SMS';
  status: 'Active' | 'Archived';
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  subject: string;
  body: string;
  mergeFields: string[];
}

type TemplateSeed = [
  name: string,
  category: TemplateCategory,
  excerpt: string,
  date: string,
  channel?: CommunicationTemplate['channel'],
  creator?: string,
];
const seeds: TemplateSeed[] = [
  ['Welcome to Firmivra', 'Onboarding', 'Thanks for joining our platform...', '2026-10-14'],
  ['Contract Reminder', 'Sales', 'This is a friendly reminder that...', '2026-10-12'],
  [
    'Payment Confirmation',
    'Billing',
    'Your payment has been received...',
    '2026-10-10',
    'EMAIL',
    'System',
  ],
  ['Document Request', 'Support', 'Please upload the following doc...', '2026-10-08'],
  [
    'New Firm Application Received',
    'Firm Applications',
    'A new firm application has been...',
    '2026-10-06',
  ],
  ['Follow Up – No Response', 'Sales', 'Just checking in to see if you ha...', '2026-10-04'],
  [
    'Meeting Confirmation',
    'Sales',
    'Your meeting is confirmed for...',
    '2026-10-02',
    'SMS',
    'Team Member',
  ],
  [
    'Trial Ending Soon',
    'System Notices',
    'Your Firmivra trial ends in 3 days...',
    '2026-09-30',
    'EMAIL',
    'System',
  ],
  ['Invoice Overdue', 'Billing', 'Your invoice is past due. Please...', '2026-09-28'],
  [
    'Password Reset',
    'System Notices',
    'Click the link below to reset your...',
    '2026-09-25',
    'EMAIL',
    'System',
  ],
  [
    'Proposal Follow Up',
    'Sales',
    'Let us know if you have questions about your proposal.',
    '2026-09-24',
  ],
  ['Consultation Reminder', 'Sales', 'Your consultation is coming up soon.', '2026-09-23', 'SMS'],
  ['Thank You for Your Interest', 'Sales', 'Thank you for reaching out to our team.', '2026-09-22'],
  ['Getting Started', 'Onboarding', 'Here are the next steps for your new account.', '2026-09-21'],
  ['Portal Invitation', 'Onboarding', 'You are invited to your client portal.', '2026-09-20'],
  [
    'Account Setup Reminder',
    'Onboarding',
    'Complete your account setup to get started.',
    '2026-09-19',
    'SMS',
  ],
  ['Onboarding Complete', 'Onboarding', 'Your account is ready. Welcome aboard!', '2026-09-18'],
  [
    'Support Request Received',
    'Support',
    'Our support team has received your request.',
    '2026-09-17',
  ],
  [
    'Support Follow Up',
    'Support',
    'Checking in on your recent support request.',
    '2026-09-16',
    'SMS',
  ],
  ['Issue Resolved', 'Support', 'Your support request has been resolved.', '2026-09-15'],
  [
    'Payment Reminder',
    'Billing',
    'A friendly reminder about your upcoming payment.',
    '2026-09-14',
    'SMS',
  ],
  [
    'Application Approved',
    'Firm Applications',
    'Your firm application has been approved.',
    '2026-09-13',
  ],
  [
    'Application Update',
    'Firm Applications',
    'There is an update to your firm application.',
    '2026-09-12',
  ],
  [
    'Application Information Request',
    'Firm Applications',
    'Please provide additional application details.',
    '2026-09-11',
  ],
];

export async function listCommunicationTemplates(): Promise<CommunicationTemplate[]> {
  await mockDelay();
  const state =
    mocked('adminCommunications') && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mockState')
      : null;
  if (!mocked('adminCommunications') || state === 'api-unavailable') {
    throw new TypeError('Templates are unavailable.');
  }
  if (state === 'forbidden')
    throw new ApiRequestError(403, 'FORBIDDEN', 'Templates access denied.');
  if (mockedEmpty('adminCommunications') || state === 'empty') return [];

  return seeds.map(
    (
      [name, category, excerpt, updatedAt, channel = 'EMAIL', createdBy = 'Octavia Holder'],
      index,
    ) => ({
      id: `template-${index + 1}`,
      name,
      category,
      excerpt,
      updatedAt,
      channel,
      createdBy,
      status: 'Active',
      createdAt: index === 0 ? '2026-09-15' : '2026-09-01',
      subject: index === 0 ? 'Welcome to Firmivra!' : name,
      body:
        index === 0
          ? "Hi {{contact_name}},\n\nWelcome to Firmivra! We're excited to have {{firm_name}} on board.\n\nOur team is here to help you get started. If you have any questions, just reply to this message.\n\nBest regards,\nThe Firmivra Team"
          : `Hi {{contact_name}},\n\n${excerpt.replace(/\.\.\.$/, '.')}\n\n${channel === 'EMAIL' ? 'Please contact {{support_email}} if you need help.\n\nBest regards,\n' : ''}{{firm_name}}`,
      mergeFields: [
        '{{firm_name}}',
        '{{contact_name}}',
        '{{first_name}}',
        '{{last_name}}',
        '{{firm_owner}}',
        '{{support_email}}',
      ],
    }),
  );
}
