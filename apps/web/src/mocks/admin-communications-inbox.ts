import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

const MODULE = 'adminCommunications';

export type CommunicationChannel = 'Email' | 'SMS' | 'Internal';
export type CommunicationContactType = 'Client' | 'Lead' | 'Support' | 'Internal';

export interface CommunicationMessage {
  id: string;
  from: 'contact' | 'admin';
  sender: string;
  body: string;
  time: string;
  channel: CommunicationChannel;
}

export interface CommunicationConversation {
  id: string;
  name: string;
  initials: string;
  avatarTone: 'blue' | 'green' | 'amber' | 'purple' | 'grey';
  preview: string;
  time: string;
  contactType: CommunicationContactType;
  channel: CommunicationChannel;
  unread: boolean;
  assignedTo: string | null;
  mention: boolean;
  scheduled: boolean;
  messages: CommunicationMessage[];
}

export interface CommunicationsMock {
  currentAdmin: string;
  summary: {
    unread: number;
    open: number;
    waiting: number;
    scheduled: number;
    failed: number;
    channels: Record<'All' | CommunicationChannel, number>;
    trendNote: string;
    trends: {
      unread: { text: string; direction: 'up' | 'down'; good: boolean };
      open: { text: string; direction: 'up' | 'down'; good: boolean };
      waiting: { text: string; direction: 'up' | 'down'; good: boolean };
      scheduled: { text: string; direction: 'up' | 'down'; good: boolean };
      failed: { text: string; direction: 'up' | 'down'; good: boolean };
    };
  };
  conversations: CommunicationConversation[];
  contactDetails: {
    primaryContact: string;
    email: string;
    phone: string;
    plan: string;
    status: string;
    source: string;
  } | null;
  tags: { label: string; tone: 'success' | 'info' | 'purple' }[];
  activity: {
    id: string;
    kind: 'email' | 'sent' | 'tag' | 'status' | 'created';
    title: string;
    time: string;
  }[];
}

const conversationRows: CommunicationConversation[] = [
  {
    id: 'blue-ridge',
    name: 'Blue Ridge Consulting',
    initials: 'BR',
    avatarTone: 'blue',
    preview: "Thank you for the update! We're ready ...",
    time: '10:24 AM',
    contactType: 'Client',
    channel: 'Email',
    unread: true,
    assignedTo: 'Octavia Holder',
    mention: true,
    scheduled: false,
    messages: [
      {
        id: 'br-1',
        from: 'contact',
        sender: 'Karen Wilson',
        body: "Hi Octavia,\n\nThank you for the update! We're ready to move forward with the next steps. Can you send over the onboarding checklist and let us know what documents you need from our side?\n\nBest regards,\nKaren Wilson\nBlue Ridge Consulting",
        time: 'Oct 14, 2026 10:21 AM',
        channel: 'Email',
      },
      {
        id: 'br-2',
        from: 'admin',
        sender: 'Octavia Holder',
        body: "Hi Karen,\n\nAbsolutely! I'll send the onboarding checklist over now. If you have any questions, just let me know.\n\nBest,\nOctavia",
        time: 'Oct 14, 2026 10:24 AM',
        channel: 'Email',
      },
    ],
  },
  {
    id: 'jordan',
    name: 'Jordan & Co.',
    initials: 'JS',
    avatarTone: 'blue',
    preview: 'Can you send over the contract?',
    time: '9:18 AM',
    contactType: 'Lead',
    channel: 'SMS',
    unread: true,
    assignedTo: null,
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'thrive',
    name: 'Thrive Accounting',
    initials: 'TW',
    avatarTone: 'green',
    preview: 'Perfect! Looking forward to it.',
    time: '8:45 AM',
    contactType: 'Client',
    channel: 'Email',
    unread: false,
    assignedTo: 'Octavia Holder',
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'metro',
    name: 'Metro Consulting',
    initials: 'MP',
    avatarTone: 'amber',
    preview: 'We need assistance with onboarding ...',
    time: 'Yesterday',
    contactType: 'Support',
    channel: 'Email',
    unread: false,
    assignedTo: null,
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'wilson',
    name: 'Wilson Tax Partners',
    initials: 'KW',
    avatarTone: 'grey',
    preview: 'Payment was successful. Thank you!',
    time: 'Yesterday',
    contactType: 'Client',
    channel: 'SMS',
    unread: false,
    assignedTo: 'Octavia Holder',
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'samantha',
    name: 'Samantha Lee',
    initials: 'SJ',
    avatarTone: 'blue',
    preview: 'Do you have availability next week?',
    time: 'Oct 12',
    contactType: 'Lead',
    channel: 'Email',
    unread: true,
    assignedTo: 'Octavia Holder',
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'redwood',
    name: 'Redwood Finance',
    initials: 'RP',
    avatarTone: 'green',
    preview: 'Can we get a status update?',
    time: 'Oct 12',
    contactType: 'Client',
    channel: 'Email',
    unread: false,
    assignedTo: 'Octavia Holder',
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'daniel',
    name: 'Daniel Wright (Internal)',
    initials: 'DT',
    avatarTone: 'purple',
    preview: 'The new template is ready for review.',
    time: 'Oct 11',
    contactType: 'Internal',
    channel: 'Internal',
    unread: false,
    assignedTo: 'Octavia Holder',
    mention: true,
    scheduled: false,
    messages: [],
  },
  {
    id: 'legacy',
    name: 'Legacy Accounting',
    initials: 'LG',
    avatarTone: 'green',
    preview: "We've submitted all required documents.",
    time: 'Oct 11',
    contactType: 'Client',
    channel: 'Email',
    unread: false,
    assignedTo: null,
    mention: false,
    scheduled: false,
    messages: [],
  },
  {
    id: 'tom',
    name: 'Tom Edwards',
    initials: 'TM',
    avatarTone: 'blue',
    preview: 'Let me know if you need anything else.',
    time: 'Oct 10',
    contactType: 'Lead',
    channel: 'SMS',
    unread: false,
    assignedTo: 'Octavia Holder',
    mention: false,
    scheduled: false,
    messages: [],
  },
];

export async function loadAdminCommunicationsMock(): Promise<CommunicationsMock> {
  await mockDelay();
  if (!mocked(MODULE))
    throw new Error(
      'Communications API is unavailable. Enable the adminCommunications mock to preview this page.',
    );
  if (mockedEmpty(MODULE)) {
    return {
      currentAdmin: 'Octavia Holder',
      summary: {
        unread: 0,
        open: 0,
        waiting: 0,
        scheduled: 0,
        failed: 0,
        channels: { All: 0, Email: 0, SMS: 0, Internal: 0 },
        trendNote: 'vs. previous 7 days',
        trends: {
          unread: { text: '0%', direction: 'up', good: true },
          open: { text: '0%', direction: 'up', good: true },
          waiting: { text: '0%', direction: 'up', good: true },
          scheduled: { text: '0%', direction: 'up', good: true },
          failed: { text: '0%', direction: 'down', good: true },
        },
      },
      conversations: [],
      contactDetails: null,
      tags: [],
      activity: [],
    };
  }
  return {
    currentAdmin: 'Octavia Holder',
    summary: {
      unread: 24,
      open: 56,
      waiting: 18,
      scheduled: 12,
      failed: 3,
      channels: { All: 56, Email: 28, SMS: 14, Internal: 8 },
      trendNote: 'vs. previous 7 days',
      trends: {
        unread: { text: '12%', direction: 'up', good: false },
        open: { text: '8%', direction: 'up', good: true },
        waiting: { text: '20%', direction: 'up', good: false },
        scheduled: { text: '33%', direction: 'up', good: true },
        failed: { text: '25%', direction: 'down', good: true },
      },
    },
    conversations: conversationRows,
    contactDetails: {
      primaryContact: 'Karen Wilson',
      email: 'karen@blueridgeconsulting.com',
      phone: '(678) 555-0142',
      plan: 'Professional Plan',
      status: 'Active Client',
      source: 'Website',
    },
    tags: [
      { label: 'Client', tone: 'success' },
      { label: 'Onboarding', tone: 'info' },
      { label: 'Priority', tone: 'purple' },
    ],
    activity: [
      { id: 'email-received', kind: 'email', title: 'Email received', time: 'Oct 14, 10:21 AM' },
      { id: 'email-sent', kind: 'sent', title: 'Email sent', time: 'Oct 14, 10:24 AM' },
      { id: 'tag-added', kind: 'tag', title: 'Tag added: Onboarding', time: 'Oct 13, 2:15 PM' },
      {
        id: 'status-changed',
        kind: 'status',
        title: 'Status changed to Client',
        time: 'Oct 12, 11:03 AM',
      },
      { id: 'lead-created', kind: 'created', title: 'Lead created', time: 'Oct 10, 9:42 AM' },
    ],
  };
}
