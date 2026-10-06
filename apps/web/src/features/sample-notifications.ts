import type { NotificationItem } from '@firmivra/ui';
export const sampleNotifications: NotificationItem[] = [
  {
    id: 'sample-document',
    title: 'Document received',
    message: 'A sample client shared a document for review.',
    read: false,
    href: '/documents?preview=1',
    time: 'Preview example',
  },
  {
    id: 'sample-invoice',
    title: 'Invoice paid',
    message: 'A sample invoice was paid.',
    read: false,
    href: '/invoices?preview=1',
    time: 'Preview example',
  },
  {
    id: 'sample-signup',
    title: 'Client sign-up',
    message: 'A sample client is awaiting approval.',
    read: true,
    href: '/sign-ups?preview=1',
    time: 'Preview example',
  },
];
