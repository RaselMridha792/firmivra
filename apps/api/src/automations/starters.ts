import type { Def } from './logic.js';

// The popular rule templates a firm can install (idempotent by name: the table has no starter key).

const settings = {
  logAll: true,
  notifyOnFailureUserIds: [],
  addToCalendar: false,
} as Def['settings'];

export interface Starter {
  name: string;
  description: string;
  category: 'INVOICES_PAYMENTS' | 'COMPLIANCE_DEADLINES' | 'CLIENTS' | 'APPOINTMENTS';
  definition: Def;
}

export const STARTERS: Starter[] = [
  {
    name: 'Overdue invoice reminder',
    description:
      'Reminds the client three days after an invoice is overdue, and makes a follow-up task.',
    category: 'INVOICES_PAYMENTS',
    definition: {
      trigger: {
        module: 'INVOICES_PAYMENTS',
        event: 'invoice.overdue',
        timing: 'AFTER',
        offsetValue: 3,
        offsetUnit: 'DAY',
      },
      matchMode: 'ALL',
      conditions: [],
      actions: [
        {
          id: 'remind',
          type: 'SEND_CLIENT_MESSAGE',
          config: {
            subject: 'A reminder about invoice {{record.label}}',
            body: 'Hello {{client.firstName}}, invoice {{record.label}} is past its due date. Please let us know if you have any questions.',
          },
          delayMinutes: 0,
          dependsOn: null,
        },
        {
          id: 'follow-up',
          type: 'CREATE_TASK',
          config: {
            title: 'Follow up on overdue invoice {{record.label}} for {{client.name}}',
            priority: 'HIGH',
            dueInDays: 3,
          },
          delayMinutes: 0,
          dependsOn: null,
        },
      ],
      settings,
    },
  },
  {
    name: 'Deadline preparation task',
    description: 'Makes a preparation task a week before a client’s deadline.',
    category: 'COMPLIANCE_DEADLINES',
    definition: {
      trigger: {
        module: 'COMPLIANCE_DEADLINES',
        event: 'deadline.approaching',
        timing: 'BEFORE',
        offsetValue: 7,
        offsetUnit: 'DAY',
      },
      matchMode: 'ALL',
      conditions: [],
      actions: [
        {
          id: 'prepare',
          type: 'CREATE_TASK',
          config: {
            title: 'Prepare {{record.label}} for {{client.name}}',
            priority: 'MEDIUM',
            dueInDays: 5,
          },
          delayMinutes: 0,
          dependsOn: null,
        },
      ],
      settings,
    },
  },
  {
    name: 'Welcome new client',
    description: 'Sends a welcome message to a new client and notes it on the record.',
    category: 'CLIENTS',
    definition: {
      trigger: { module: 'CLIENTS', event: 'client.created', timing: 'IMMEDIATE' },
      matchMode: 'ALL',
      conditions: [],
      actions: [
        {
          id: 'welcome',
          type: 'SEND_CLIENT_MESSAGE',
          config: {
            subject: 'Welcome to {{firm.name}}',
            body: 'Hello {{client.firstName}}, welcome to {{firm.name}}. We are glad to work with you.',
          },
          delayMinutes: 0,
          dependsOn: null,
        },
        {
          id: 'note',
          type: 'ADD_CLIENT_NOTE',
          config: { body: 'Welcome message sent on {{date.today}}.' },
          delayMinutes: 0,
          dependsOn: 'welcome',
        },
      ],
      settings,
    },
  },
  {
    name: 'Appointment preparation task',
    description: 'Makes a preparation task a day before an appointment.',
    category: 'APPOINTMENTS',
    definition: {
      trigger: {
        module: 'APPOINTMENTS',
        event: 'appointment.upcoming',
        timing: 'BEFORE',
        offsetValue: 1,
        offsetUnit: 'DAY',
      },
      matchMode: 'ALL',
      conditions: [],
      actions: [
        {
          id: 'prepare',
          type: 'CREATE_TASK',
          config: {
            title: 'Prepare for the appointment with {{client.name}}',
            priority: 'MEDIUM',
            dueInDays: 1,
          },
          delayMinutes: 0,
          dependsOn: null,
        },
      ],
      settings,
    },
  },
];
